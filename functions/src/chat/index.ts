import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import OpenAI from 'openai';

const INITIAL_FREE_CHATS = 50;
const MONTHLY_FREE_CHATS = 20;

/** プラン別 月間トークン上限（入出力合計） */
const PLAN_TOKEN_LIMITS: Record<string, number> = {
  standard: 10_000_000,
  pro: 40_000_000,
  expert: 200_000_000,
};

const openaiApiKey = defineSecret('OPENAI_API_KEY');

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function getCurrentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * 認証済みユーザーが OpenAI チャット補完を呼ぶ callable。
 * 無料枠: 初期50チャット、以降20チャット/月。超えたら resource-exhausted。
 */
export const chatComplete = onCall(
  { secrets: [openaiApiKey] },
  async (request): Promise<{ content: string }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'ログインが必要です');
    }
    const uid = request.auth.uid;
    const data = request.data as { messages?: ChatMessagePayload[] } | null;
    const messages = data?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages は配列で1件以上必要です');
    }

    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const currentMonth = getCurrentMonth();
    const snap = await userRef.get();
    const d = snap.data();
    const plan = typeof d?.plan === 'string' ? d.plan : null;
    const limitTokens = plan && plan !== 'admin' ? PLAN_TOKEN_LIMITS[plan] : null;

    if (plan === 'admin') {
      // admin: 上限チェックしない（Firestore で手動設定する運用のみ）
    } else if (limitTokens != null) {
      // 有料プラン: 月間トークン上限でチェック
      const tokenMonth = (d?.tokenUsageMonthYear as string) ?? '';
      const tokenUsage = (d?.tokenUsage as number) ?? 0;
      const currentMonthUsage = tokenMonth === currentMonth ? tokenUsage : 0;
      if (currentMonthUsage >= limitTokens) {
        throw new HttpsError(
          'resource-exhausted',
          '今月のトークン枠を使い切りました。来月になるか、プランをアップグレードしてください。',
        );
      }
    } else {
      // 無料: 従来のチャット回数制限
      let totalChatCount = (d?.totalChatCount as number) ?? 0;
      let monthChatCount = (d?.monthChatCount as number) ?? 0;
      const monthYear = (d?.monthYear as string) ?? '';
      if (monthYear !== currentMonth) {
        monthChatCount = 0;
      }
      if (totalChatCount >= INITIAL_FREE_CHATS && monthChatCount >= MONTHLY_FREE_CHATS) {
        throw new HttpsError(
          'resource-exhausted',
          `今月の無料枠（${MONTHLY_FREE_CHATS}件）を使い切りました。`,
        );
      }
    }

    const apiKey = await openaiApiKey.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'OPENAI_API_KEY が設定されていません');
    }
    const openai = new OpenAI({ apiKey });
    const defaultModel = 'gpt-4o-mini';
    const resp = await openai.chat.completions.create({
      model: defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const content = resp.choices[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new HttpsError('internal', 'OpenAI の応答が空でした');
    }

    const usage = resp.usage;
    const usedTokens =
      typeof usage?.total_tokens === 'number'
        ? usage.total_tokens
        : (typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0) +
          (typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0);

    if (limitTokens != null && usedTokens > 0) {
      const tokenMonth = (d?.tokenUsageMonthYear as string) ?? '';
      if (tokenMonth !== currentMonth) {
        await userRef.set(
          {
            tokenUsageMonthYear: currentMonth,
            tokenUsage: usedTokens,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      } else {
        await userRef.set(
          {
            tokenUsageMonthYear: currentMonth,
            tokenUsage: admin.firestore.FieldValue.increment(usedTokens),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      }
    } else if (limitTokens == null && plan !== 'admin') {
      const monthYear = (d?.monthYear as string) ?? '';
      const totalChatCount = (d?.totalChatCount as number) ?? 0;
      const monthChatCount = (d?.monthChatCount as number) ?? 0;
      const newTotal = totalChatCount + 1;
      const newMonthCount = monthYear === currentMonth ? monthChatCount + 1 : 1;
      await userRef.set(
        { totalChatCount: newTotal, monthChatCount: newMonthCount, monthYear: currentMonth },
        { merge: true },
      );
    }

    return { content };
  },
);

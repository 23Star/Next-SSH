import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import Stripe from 'stripe';

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const DEFAULT_PRICE_ID = 'price_1T34XdD9OOkJwoyh2PfaQdP3';

/**
 * 認証済みユーザー用に Stripe Checkout セッションを作成し、決済ページの URL を返す。
 * 呼び出し元でこの URL にリダイレクト（または open）する。
 */
export const createCheckoutSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request): Promise<{ url: string }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'ログインが必要です');
    }
    const uid = request.auth.uid;
    const data = request.data as {
      successUrl?: string;
      cancelUrl?: string;
      priceId?: string;
    } | null;

    const successUrl = data?.successUrl;
    const cancelUrl = data?.cancelUrl;
    if (typeof successUrl !== 'string' || successUrl.length === 0) {
      throw new HttpsError('invalid-argument', 'successUrl を指定してください');
    }
    if (typeof cancelUrl !== 'string' || cancelUrl.length === 0) {
      throw new HttpsError('invalid-argument', 'cancelUrl を指定してください');
    }

    let priceId = data?.priceId;
    if (typeof priceId !== 'string' || priceId.length === 0) {
      priceId = DEFAULT_PRICE_ID;
    }
    if (!priceId) {
      throw new HttpsError(
        'failed-precondition',
        'priceId の指定か DEFAULT_PRICE_ID の設定が必要です',
      );
    }

    const secret = await stripeSecretKey.value();
    if (!secret) {
      throw new HttpsError('failed-precondition', 'STRIPE_SECRET_KEY が設定されていません');
    }

    const stripe = new Stripe(secret, { apiVersion: '2026-01-28.clover' });

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: uid,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stripeMessage =
        typeof (err as { raw?: { message?: string } })?.raw?.message === 'string'
          ? (err as { raw: { message: string } }).raw.message
          : message;
      throw new HttpsError('internal', `Stripe エラー: ${stripeMessage}`);
    }

    const url = session.url;
    if (!url) {
      throw new HttpsError('internal', 'Checkout セッションの URL を取得できませんでした');
    }
    return { url };
  },
);

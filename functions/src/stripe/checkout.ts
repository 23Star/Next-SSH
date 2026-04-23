import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import Stripe from 'stripe';

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const DEFAULT_PRICE_ID = 'price_1T34XdD9OOkJwoyh2PfaQdP3';

/**
 * 为已认证用户创建 Stripe Checkout 会话，返回支付页面的 URL。
 * 调用方应重定向（或打开）此 URL。
 */
export const createCheckoutSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request): Promise<{ url: string }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '请先登录');
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
      throw new HttpsError('invalid-argument', '请指定 successUrl');
    }
    if (typeof cancelUrl !== 'string' || cancelUrl.length === 0) {
      throw new HttpsError('invalid-argument', '请指定 cancelUrl');
    }

    let priceId = data?.priceId;
    if (typeof priceId !== 'string' || priceId.length === 0) {
      priceId = DEFAULT_PRICE_ID;
    }
    if (!priceId) {
      throw new HttpsError(
        'failed-precondition',
        '需要指定 priceId 或配置 DEFAULT_PRICE_ID',
      );
    }

    const secret = await stripeSecretKey.value();
    if (!secret) {
      throw new HttpsError('failed-precondition', 'STRIPE_SECRET_KEY 未配置');
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
      throw new HttpsError('internal', `Stripe 错误: ${stripeMessage}`);
    }

    const url = session.url;
    if (!url) {
      throw new HttpsError('internal', '无法获取 Checkout 会话的 URL');
    }
    return { url };
  },
);

import * as admin from 'firebase-admin';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import Stripe from 'stripe';
import type { Request, Response } from 'express';

const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

/** Stripe Price ID → 保存到 Firestore 的套餐名 */
const PRICE_ID_TO_PLAN: Record<string, string> = {
  price_1T34XdD9OOkJwoyh2PfaQdP3: 'standard',
  price_1T34YQD9OOkJwoyhHJvXz1fE: 'pro',
  price_1T34YoD9OOkJwoyhKNyXMLhy: 'expert',
};

/**
 * Stripe 调用的 Webhook HTTP 端点。
 * 签名验证需要 rawBody，因此仅接受 POST 请求。
 * 部署后将 URL 注册到 Stripe 控制台的「Webhook」中。
 */
export const stripeWebhook = onRequest(
  { secrets: [stripeWebhookSecret, stripeSecretKey] },
  async (req: Request & { rawBody?: Buffer }, res: Response): Promise<void> => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      res.status(400).send('Missing Stripe-Signature');
      return;
    }

    const rawBody = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      res.status(400).send('Missing raw body');
      return;
    }

    const webhookSecret = await stripeWebhookSecret.value();
    if (!webhookSecret) {
      res.status(500).send('STRIPE_WEBHOOK_SECRET not configured');
      return;
    }

    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Stripe webhook signature verification failed:', message);
      res.status(400).send(`Webhook Error: ${message}`);
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.client_reference_id;
      if (!uid || typeof uid !== 'string') {
        console.warn('checkout.session.completed without client_reference_id');
        res.status(200).send('OK');
        return;
      }

      const db = admin.firestore();
      const userRef = db.collection('users').doc(uid);
      const update: Record<string, unknown> = {
        stripeCheckoutCompletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (session.subscription && typeof session.subscription === 'string') {
        update.stripeSubscriptionId = session.subscription;
        const secret = await stripeSecretKey.value();
        if (secret) {
          const stripe = new Stripe(secret, { apiVersion: '2026-01-28.clover' });
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const priceId = sub.items?.data?.[0]?.price?.id;
          if (typeof priceId === 'string' && PRICE_ID_TO_PLAN[priceId]) {
            update.plan = PRICE_ID_TO_PLAN[priceId];
          }
        }
      }
      if (session.id) {
        update.stripeSessionId = session.id;
      }

      await userRef.set(update, { merge: true });
    }

    res.status(200).send('OK');
  },
);

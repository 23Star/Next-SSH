import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

// 機能ごとの export を集約（責務は各フォルダに分離）
export { helloAissh } from './health';
export { chatComplete, type ChatMessagePayload } from './chat';
export * from './stripe';

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

// 按功能聚合导出（各模块职责分离）
export { helloAissh } from './health';
export { chatComplete, type ChatMessagePayload } from './chat';
export * from './stripe';

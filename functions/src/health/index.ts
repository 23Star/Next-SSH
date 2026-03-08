import { onRequest } from 'firebase-functions/v2/https';

/**
 * 動作確認用のサンプル HTTP 関数。
 * デプロイ後、表示される URL に GET でアクセスすると "AISSH Functions OK" を返す。
 */
export const helloAissh = onRequest((_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.send('AISSH Functions OK');
});

import { onRequest } from 'firebase-functions/v2/https';

/**
 * 用于健康检查的示例 HTTP 函数。
 * 部署后，访问返回的 URL（GET 请求）会返回 "AISSH Functions OK"。
 */
export const helloAissh = onRequest((_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.send('AISSH Functions OK');
});

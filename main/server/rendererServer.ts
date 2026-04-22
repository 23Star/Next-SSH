import fs from 'fs';
import http from 'http';
import path from 'path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** 使用可能なポート候補（20件）。有効範囲は 0–65535。衝突時は次を試し、前回使ったポートを優先して同じオリジンにしログイン維持。 */
const PORT_CANDIDATES = [
  57290, 57291, 57292, 57293, 57294, 57295, 57296, 57297, 57298, 57299,
  58160, 58161, 58162, 58163, 58164, 58165, 58166, 58167, 58168, 58169,
];

function readLastPort(portFilePath: string): number | null {
  try {
    const raw = fs.readFileSync(portFilePath, 'utf-8');
    const data = JSON.parse(raw) as { port?: number };
    const p = data.port;
    if (typeof p === 'number' && Number.isInteger(p) && PORT_CANDIDATES.includes(p)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function writeLastPort(portFilePath: string, port: number): void {
  try {
    fs.writeFileSync(portFilePath, JSON.stringify({ port }), 'utf-8');
  } catch {
    /* ignore */
  }
}

function createRequestHandler(rendererDir: string): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const reqPath = req.url?.split('?')[0] ?? '/';
    const normalized = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const relativePath = normalized.replace(/^[/\\]+/, '');
    const filePath = path.join(rendererDir, relativePath === '' ? 'v2/index.html' : relativePath);

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        const fallback = path.join(rendererDir, 'v2/index.html');
        fs.readFile(fallback, (errFallback, data) => {
          if (errFallback || !data) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
        return;
      }
      fs.readFile(filePath, (errRead, data) => {
        if (errRead || !data) {
          res.writeHead(500);
          res.end();
          return;
        }
        const ext = path.extname(filePath);
        const contentType = MIME[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
  };
}

/**
 * 指定ポートで listen を試す。成功で resolve、EADDRINUSE で reject。
 */
function tryListen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListen = () => {
      server.removeListener('error', onError);
      resolve();
    };
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListen);
      reject(err);
    };
    server.once('listening', onListen);
    server.once('error', onError);
    server.listen(port, 'localhost');
  });
}

/**
 * 本番用: レンダラーを localhost で配信する HTTP サーバを起動する。
 * ポート候補を順に試し、前回使ったポートを優先。成功したポートを保存して次回同じオリジンにし Firebase ログインを維持。
 * portFilePath を渡すと候補リスト＋永続化。渡さないと従来どおり listen(0)。
 */
export function startRendererServer(
  rendererDir: string,
  portFilePath?: string,
): Promise<{ url: string; port: number; close: () => void }> {
  if (!portFilePath) {
    return startRendererServerRandomPort(rendererDir);
  }

  const pathToFile = portFilePath;
  const lastPort = readLastPort(pathToFile);
  const order = lastPort !== null ? [lastPort, ...PORT_CANDIDATES.filter((p) => p !== lastPort)] : PORT_CANDIDATES;

  const handler = createRequestHandler(rendererDir);

  function tryNext(idx: number): Promise<{ url: string; port: number; close: () => void }> {
    if (idx >= order.length) {
      return Promise.reject(new Error('Renderer server: all port candidates in use'));
    }
    const server = http.createServer(handler);
    const port = order[idx];
    return tryListen(server, port)
      .then(() => {
        writeLastPort(pathToFile, port);
        return { url: `http://localhost:${port}`, port, close: () => server.close() };
      })
      .catch((err: NodeJS.ErrnoException) => {
        server.close();
        // どの listen エラーでも次ポートを試す（EADDRINUSE 以外でも FW/AV 等で失敗しうる）
        if (idx + 1 < order.length) return tryNext(idx + 1);
        return Promise.reject(err);
      });
  }

  return tryNext(0);
}

function startRendererServerRandomPort(rendererDir: string): Promise<{ url: string; port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createRequestHandler(rendererDir));
    server.listen(0, 'localhost', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Renderer server: could not get port'));
        return;
      }
      const port = addr.port;
      resolve({
        url: `http://localhost:${port}`,
        port,
        close: () => server.close(),
      });
    });
    server.on('error', reject);
  });
}

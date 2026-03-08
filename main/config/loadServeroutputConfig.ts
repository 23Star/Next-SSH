import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface ServeroutputConfig {
  ServeroutputContentRecordMax: number;
  ServeroutputContentTotalMax: number;
}

const DEFAULTS: ServeroutputConfig = {
  ServeroutputContentRecordMax: 40000,
  ServeroutputContentTotalMax: 100000,
};

let cached: ServeroutputConfig | null = null;

/**
 * config/prompt.json を読み込む。
 * ファイルが無い場合は DEFAULTS を返す。初回のみ読み込み、以降はキャッシュを返す。
 */
export function loadServeroutputConfig(): ServeroutputConfig {
  if (cached) return cached;
  const projectRootFromMain = path.join(__dirname, '..', '..');
  const candidates = [
    path.join(projectRootFromMain, 'config', 'prompt.json'),
    path.join(process.cwd(), 'config', 'prompt.json'),
    path.join(app.getAppPath(), 'config', 'prompt.json'),
  ];
  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as { ServeroutputContentRecordMax?: number; ServeroutputContentTotalMax?: number };
      const recordMax = Number(data.ServeroutputContentRecordMax);
      const totalMax = Number(data.ServeroutputContentTotalMax);
      if (Number.isFinite(recordMax) && recordMax > 0 && Number.isFinite(totalMax) && totalMax > 0) {
        cached = { ServeroutputContentRecordMax: recordMax, ServeroutputContentTotalMax: totalMax };
        return cached;
      }
    } catch {
      // ファイルなし or パースエラーは次を試す
    }
  }
  cached = DEFAULTS;
  return cached;
}

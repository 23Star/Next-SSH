import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface ChatConfig {
  ChatContextTotalMax: number;
}

const DEFAULTS: ChatConfig = {
  ChatContextTotalMax: 20000,
};

let cached: ChatConfig | null = null;

/**
 * config/prompt.json を読み込む。
 * ファイルが無い場合は DEFAULTS を返す。初回のみ読み込み、以降はキャッシュを返す。
 */
export function loadChatConfig(): ChatConfig {
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
      const data = JSON.parse(raw) as { ChatContextTotalMax?: number };
      const totalMax = Number(data.ChatContextTotalMax);
      if (Number.isFinite(totalMax) && totalMax > 0) {
        cached = { ChatContextTotalMax: totalMax };
        return cached;
      }
    } catch {
      // ファイルなし or パースエラーは次を試す
    }
  }
  cached = DEFAULTS;
  return cached;
}

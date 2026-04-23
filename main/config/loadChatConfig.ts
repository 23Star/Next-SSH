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
 * 读取 config/prompt.json。
 * 文件不存在时返回 DEFAULTS。仅首次读取，之后返回缓存。
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
      // 文件不存在或解析错误时尝试下一个
    }
  }
  cached = DEFAULTS;
  return cached;
}

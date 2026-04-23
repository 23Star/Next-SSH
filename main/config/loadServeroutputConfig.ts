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
 * 读取 config/prompt.json。
 * 文件不存在时返回 DEFAULTS。仅首次读取，之后返回缓存。
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
      // 文件不存在或解析错误时尝试下一个
    }
  }
  cached = DEFAULTS;
  return cached;
}

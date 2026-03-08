import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type Locale = 'ja' | 'en' | 'zn';

export interface UserSettings {
  locale: Locale;
}

const FILENAME = 'settings.json';
const DEFAULTS: UserSettings = { locale: 'ja' };

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), FILENAME);
}

export function getSettings(): UserSettings {
  const filePath = getSettingsPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Partial<UserSettings>;
    const locale = data.locale === 'en' || data.locale === 'zn' ? data.locale : 'ja';
    return { locale };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setLocale(locale: Locale): void {
  const settings = getSettings();
  settings.locale = locale;
  const filePath = getSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function getLocale(): Locale {
  return getSettings().locale;
}

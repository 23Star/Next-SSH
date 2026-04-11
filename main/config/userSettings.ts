import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export type Locale = 'en' | 'zn' | 'ru';
export type Theme = 'dark' | 'light';

export interface UserSettings {
  locale: Locale;
  theme: Theme;
}

const FILENAME = 'settings.json';
const DEFAULTS: UserSettings = { locale: 'zn', theme: 'dark' };

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), FILENAME);
}

function readSettings(): Partial<UserSettings> {
  const filePath = getSettingsPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Partial<UserSettings>;
  } catch {
    return {};
  }
}

function writeSettings(settings: UserSettings): void {
  const filePath = getSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function getSettings(): UserSettings {
  const data = readSettings();
  const locale = data.locale === 'en' || data.locale === 'zn' || data.locale === 'ru' ? data.locale : DEFAULTS.locale;
  const theme = data.theme === 'dark' || data.theme === 'light' ? data.theme : DEFAULTS.theme;
  return { locale, theme };
}

export function getLocale(): Locale {
  return getSettings().locale;
}

export function setLocale(locale: Locale): void {
  const settings = getSettings();
  settings.locale = locale;
  writeSettings(settings);
}

export function getTheme(): Theme {
  return getSettings().theme;
}

export function setTheme(theme: Theme): void {
  const settings = getSettings();
  settings.theme = theme;
  writeSettings(settings);
}

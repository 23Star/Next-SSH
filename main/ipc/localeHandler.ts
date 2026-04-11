import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLocale as getStoredLocale, setLocale as setStoredLocale, getTheme as getStoredTheme, setTheme as setStoredTheme, type Locale, type Theme } from '../config/userSettings';

type LangPack = Record<string, string>;

let langCache: Record<string, LangPack> | null = null;

function loadLangJson(): Record<string, LangPack> {
  if (langCache) return langCache;
  const projectRoot = path.join(__dirname, '..', '..');
  const candidates = [
    path.join(projectRoot, 'resource', 'lang.json'),
    path.join(process.cwd(), 'resource', 'lang.json'),
    path.join(app.getAppPath(), 'resource', 'lang.json'),
  ];
  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      langCache = JSON.parse(raw) as Record<string, LangPack>;
      return langCache!;
    } catch {
      // continue
    }
  }
  langCache = { en: {}, zn: {}, ru: {} };
  return langCache;
}

export function registerLocaleHandlers(): void {
  ipcMain.handle('locale:get', () => getStoredLocale());
  ipcMain.handle('locale:set', (_event, locale: Locale) => {
    setStoredLocale(locale);
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('locale-changed', locale));
  });
  ipcMain.handle('locale:getLangPack', (_event, locale: Locale) => {
    const all = loadLangJson();
    const pack = all[locale] ?? all.en ?? {};
    return pack as LangPack;
  });

  ipcMain.handle('theme:get', () => getStoredTheme());
  ipcMain.handle('theme:set', (_event, theme: Theme) => {
    setStoredTheme(theme);
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('theme-changed', theme));
  });
}

let currentLang: Record<string, string> = {};

export function t(key: string): string {
  return currentLang[key] ?? key;
}

export function setCurrentLang(pack: Record<string, string>): void {
  currentLang = pack;
}

export function updateI18n(): void {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) (el as HTMLElement).textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && el instanceof HTMLInputElement) el.placeholder = t(key);
    if (key && el instanceof HTMLTextAreaElement) el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) (el as HTMLElement).title = t(key);
  });
}

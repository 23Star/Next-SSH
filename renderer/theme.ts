export type Theme = 'dark' | 'light';

let currentTheme: Theme = 'dark';

export function setTheme(theme: Theme): void {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
}

export function getTheme(): Theme {
  return currentTheme;
}

export function getXtermTheme(): {
  background: string;
  foreground: string;
  selectionBackground: string;
  selectionForeground: string;
} {
  const s = getComputedStyle(document.documentElement);
  return {
    background: s.getPropertyValue('--terminal-bg').trim() || '#1A1918',
    foreground: s.getPropertyValue('--terminal-fg').trim() || '#E8E6DC',
    selectionBackground: s.getPropertyValue('--terminal-selection-bg').trim() || '#264f78',
    selectionForeground: s.getPropertyValue('--terminal-selection-fg').trim() || '#E8E6DC',
  };
}

export function getMonacoThemeId(): string {
  return currentTheme === 'dark' ? 'vs-dark' : 'vs';
}

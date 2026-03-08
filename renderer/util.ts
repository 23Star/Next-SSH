import type { Environment } from './types';

export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function pathJoin(parent: string, name: string): string {
  if (/^[A-Za-z]:[/\\]/.test(name) || name.startsWith('/')) return name;
  const p = parent.replace(/[/\\]+$/, '');
  const sep = parent.includes('\\') ? '\\' : '/';
  return p ? p + sep + name : name;
}

/** パスから親ディレクトリを取得（/ と \ 両対応）。 */
export function getParentDir(pathStr: string): string {
  const i = Math.max(pathStr.lastIndexOf('/'), pathStr.lastIndexOf('\\'));
  return i <= 0 ? pathStr : pathStr.slice(0, i);
}

export function displayName(env: Environment): string {
  return env.name?.trim() || `${env.username}@${env.host}:${env.port}`;
}

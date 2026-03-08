/**
 * エクスプローラー右クリックコンテキストメニュー。
 * ファイル・フォルダ両方対象。貼り付けは「右クリックしたフォルダの中」または「ファイルの親フォルダ」に実行。
 * showContextMenu はメインパネル・ファイルタブの右クリックでも利用する。
 */
import { t } from './i18n';
import { state } from './state';

type Api = NonNullable<typeof window.electronAPI>;

const MENU_ID = 'explorerContextMenu';

function hideMenu(): void {
  const el = document.getElementById(MENU_ID);
  if (el) el.remove();
}

/** パスから親ディレクトリを取得（/ と \ 両対応）。 */
function getParentDir(pathStr: string): string {
  const i = Math.max(pathStr.lastIndexOf('/'), pathStr.lastIndexOf('\\'));
  return i <= 0 ? pathStr : pathStr.slice(0, i);
}

/** Main に送る前にパスを正規化（混在区切りを / に統一。Main 側で path.sep に変換される）。 */
function normalizePathForIpc(p: string): string {
  return p.replace(/\\/g, '/');
}

function menuItemStyle(): string {
  return 'display:block;width:100%;text-align:left;padding:8px 14px;border:none;background:transparent;color:inherit;cursor:pointer;font-size:13px;';
}

function createMenuItem(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'explorerContextMenuItem';
  btn.textContent = label;
  btn.style.cssText = menuItemStyle();
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'var(--hover-bg, rgba(255,255,255,0.08))';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'transparent';
  });
  btn.addEventListener('click', () => {
    hideMenu();
    onClick();
  });
  return btn;
}

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

/** 任意の位置にコンテキストメニューを表示（エクスプローラー・メインパネルタブ共通）。 */
export function showContextMenu(ev: MouseEvent, items: ContextMenuItem[]): void {
  hideMenu();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'explorerContextMenu';
  menu.style.cssText = `position:fixed;left:${ev.clientX}px;top:${ev.clientY}px;z-index:9999;background:var(--panel-bg, #2d2d2d);border:1px solid var(--border, #444);border-radius:6px;padding:4px 0;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
  items.forEach((item) => menu.appendChild(createMenuItem(item.label, item.onClick)));
  document.body.appendChild(menu);
  const close = () => {
    hideMenu();
    document.removeEventListener('click', close);
    document.removeEventListener('contextmenu', close);
  };
  requestAnimationFrame(() => document.addEventListener('click', close, { once: true }));
  document.addEventListener('contextmenu', close, { once: true });
}

/** 削除後に親フォルダを再読み込みするコールバック（explorer.refreshExplorerDir を渡す）。 */
export type OnRefreshExplorerDir = (api: Api, parentDir: string) => Promise<void>;

/**
 * コンテナにコンテキストメニューをバインドする。
 * ファイル・フォルダ両方でメニュー表示。貼り付け＝右クリックしたフォルダの中（ファイルの場合はその親）へ。
 */
export function bindExplorerContextMenu(
  container: HTMLElement,
  api: Api,
  getIsLocalTab: () => boolean,
  getPcRoot: () => string | null,
  getConnectionId: () => number | null,
  onRefreshDir?: OnRefreshExplorerDir,
): void {
  document.addEventListener(
    'contextmenu',
    (e: Event) => {
      const ev = e as MouseEvent;
      if (!container.contains(ev.target as Node)) return;
      const item = (ev.target as HTMLElement).closest?.('.explorerItem') as HTMLElement | null;
      if (!item) return;
      const pathVal = item.dataset.path;
      const isDir = item.dataset.isdir === 'true';
      const isLocal = getIsLocalTab();
      const pcRoot = getPcRoot();
      const connectionId = getConnectionId();
      if (!pathVal) return;
      if (isLocal && pcRoot != null && pathVal === pcRoot) return;
      if (!isLocal && connectionId == null) return;
      e.preventDefault();
      e.stopPropagation();

      const pathNorm = isLocal ? normalizePathForIpc(pathVal) : pathVal;
      const pasteTargetDir = isDir ? pathVal : getParentDir(pathVal);

      const items: ContextMenuItem[] = [];

      items.push({
        label: t('download'),
        onClick: async () => {
          if (isLocal && api.explorer?.downloadToDestination) {
            try {
              await api.explorer.downloadToDestination([pathNorm]);
            } catch {
              // エラーは Main でログ済み
            }
          } else if (!isLocal && connectionId != null && api.explorer?.downloadFromRemote) {
            try {
              await api.explorer.downloadFromRemote(connectionId, [pathVal]);
            } catch {
              // エラーは Main でログ済み
            }
          }
        },
      });

      if (isLocal) {
        items.push({
          label: t('copy'),
          onClick: () => {
            state.copiedFilePaths = [pathNorm];
            state.copyTarget = 'local';
          },
        });
        items.push({
          label: t('paste'),
          onClick: async () => {
            if (state.copiedFilePaths.length === 0 || state.copyTarget !== 'local') return;
            const targetDir = normalizePathForIpc(pasteTargetDir);
            if (!api.explorer?.copyToFolder) return;
            try {
              await api.explorer.copyToFolder(state.copiedFilePaths, targetDir);
            } catch {
              // エラーは Main でログ済み
            }
          },
        });
      }

      items.push({
        label: t('copyPath'),
        onClick: () => {
          navigator.clipboard.writeText(pathVal).catch(() => {});
        },
      });

      if (isLocal && api.explorer?.deletePath && onRefreshDir) {
        const explorerApi = api.explorer;
        items.push({
          label: t('delete'),
          onClick: async () => {
            if (!confirm(t('confirmDelete') ?? '削除しますか？')) return;
            try {
              await explorerApi.deletePath(pathNorm);
              await onRefreshDir(api, getParentDir(pathVal));
            } catch (err) {
              api.logToMain?.('[explorerContextMenu] delete error', err);
            }
          },
        });
      }

      showContextMenu(ev, items);
    },
    true,
  );
}

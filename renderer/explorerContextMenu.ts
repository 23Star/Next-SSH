/**
 * Explorer right-click context menu. Supports files and folders.
 * showContextMenu is also used by main panel tabs.
 */
import { t } from './i18n';
import { state } from './state';

type Api = NonNullable<typeof window.electronAPI>;

const MENU_ID = 'explorerContextMenu';

function hideMenu(): void {
  const el = document.getElementById(MENU_ID);
  if (el) el.remove();
}

/** Get parent directory from path (supports / and \). */
function getParentDir(pathStr: string): string {
  const i = Math.max(pathStr.lastIndexOf('/'), pathStr.lastIndexOf('\\'));
  return i <= 0 ? pathStr : pathStr.slice(0, i);
}

/** Normalize path separators to / before sending to main process. */
function normalizePathForIpc(p: string): string {
  return p.replace(/\\/g, '/');
}

function createMenuItem(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'explorerContextMenuItem';
  btn.textContent = label;
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

/** Show a context menu at the specified position (shared by explorer and main panel tabs). */
export function showContextMenu(ev: MouseEvent, items: ContextMenuItem[]): void {
  hideMenu();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'explorerContextMenu';
  menu.style.left = `${ev.clientX}px`;
  menu.style.top = `${ev.clientY}px`;
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

export type OnRefreshExplorerDir = (api: Api, parentDir: string) => Promise<void>;

/**
 * Bind context menu to a container. Supports both files and folders.
 * Paste = into right-clicked folder (or parent of right-clicked file).
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
              // Error logged by main process
            }
          } else if (!isLocal && connectionId != null && api.explorer?.downloadFromRemote) {
            try {
              await api.explorer.downloadFromRemote(connectionId, [pathVal]);
            } catch {
              // Error logged by main process
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
              // Error logged by main process
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
            if (!confirm(t('confirmDelete'))) return;
            try {
              await explorerApi.deletePath(pathNorm);
              await onRefreshDir(api, getParentDir(pathNorm));
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

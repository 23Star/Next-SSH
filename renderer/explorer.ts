import { state, getExplorerTargetKey, getExplorerState } from './state';
import { t } from './i18n';
import { pathJoin, getParentDir, escapeHtml } from './util';
import * as explorerContextMenu from './explorerContextMenu';
import * as editor from './editor';
import * as terminal from './terminal';

type Api = NonNullable<typeof window.electronAPI>;

const EXPLORER_LOCAL_LABEL = 'PC';

function getCurrentExplorerState(): { home: string | null; loadedPaths: Record<string, import('./types').ExplorerEntry[]>; expanded: Set<string> } {
  return getExplorerState(state.activeExplorerTarget);
}

export function clearExplorerStateForTarget(api: Api, target: 'local' | number): void {
  const key = getExplorerTargetKey(target);
  state.explorerByTarget[key] = {
    home: null,
    loadedPaths: {},
    expanded: new Set(),
  };
  if (state.activeExplorerTarget === target) {
    renderExplorerTree(api);
  }
}

/** 旧 API: 現在のターゲットの状態をクリア（タブ閉じ時など）。 */
export function clearExplorerState(api: Api): void {
  clearExplorerStateForTarget(api, state.activeExplorerTarget);
}

export async function loadExplorerRootForTarget(api: Api, target: 'local' | number): Promise<void> {
  const es = getExplorerState(target);
  try {
    if (target === 'local') {
      if (!api.explorer?.getLocalHome || !api.explorer?.listLocalDirectory) return;
      const home = await api.explorer.getLocalHome();
      state.localHomeDir = home;
      es.home = home;
      const entries = await api.explorer.listLocalDirectory(home);
      es.loadedPaths[home] = entries;
      es.expanded.add(home);
    } else {
      if (!api.explorer?.getHome || !api.explorer?.listDirectory) return;
      const home = await api.explorer.getHome(target);
      es.home = home;
      const entries = await api.explorer.listDirectory(target, home);
      es.loadedPaths[home] = entries;
      es.expanded.add(home);
    }
    if (state.activeExplorerTarget === target) renderExplorerTree(api);
  } catch {
    es.home = null;
    if (state.activeExplorerTarget === target) renderExplorerTree(api);
  }
}

export async function loadExplorerRoot(api: Api): Promise<void> {
  await loadExplorerRootForTarget(api, state.activeExplorerTarget);
}

async function loadExplorerDir(api: Api, dirPath: string): Promise<void> {
  const target = state.activeExplorerTarget;
  const es = getExplorerState(target);
  if (es.loadedPaths[dirPath] !== undefined) return;
  try {
    if (target === 'local') {
      if (!api.explorer?.listLocalDirectory) return;
      const entries = await api.explorer.listLocalDirectory(dirPath);
      es.loadedPaths[dirPath] = entries;
    } else {
      if (!api.explorer?.listDirectory) return;
      const entries = await api.explorer.listDirectory(target, dirPath);
      es.loadedPaths[dirPath] = entries;
    }
    renderExplorerTree(api);
  } catch {
    es.loadedPaths[dirPath] = [];
    renderExplorerTree(api);
  }
}

export function setActiveExplorerTarget(api: Api, target: 'local' | number): void {
  state.activeExplorerTarget = target;
  state.selectedExplorerPath = null;
  state.selectedExplorerIsDir = null;
  renderExplorerTabBar(api);
  const es = getExplorerState(target);
  if (es.home !== null) {
    renderExplorerTree(api);
  } else {
    loadExplorerRootForTarget(api, target);
  }
  updateExplorerUpButton(api);
}

export function renderExplorerTabBar(api: Api): void {
  const bar = document.getElementById('explorerTabBar');
  if (!bar) return;
  const tabs: { target: 'local' | number; label: string }[] = [{ target: 'local', label: EXPLORER_LOCAL_LABEL }];
  state.terminalTabs.forEach((tab) => {
    tabs.push({ target: tab.connectionId, label: tab.name });
  });
  bar.innerHTML = tabs
    .map(
      (tab) =>
        `<button type="button" class="explorerTab ${state.activeExplorerTarget === tab.target ? 'active' : ''}" data-explorer-target="${tab.target === 'local' ? 'local' : String(tab.target)}" title="${escapeHtml(tab.label)}">${escapeHtml(tab.label)}</button>`,
    )
    .join('');
  bar.querySelectorAll('.explorerTab').forEach((btn) => {
    const targetVal = (btn as HTMLElement).dataset.explorerTarget;
    if (!targetVal) return;
    const target: 'local' | number = targetVal === 'local' ? 'local' : Number(targetVal);
    btn.addEventListener('click', () => setActiveExplorerTarget(api, target));
  });
}

function updateExplorerUpButton(_api: Api): void {
  const btn = document.getElementById('btnExplorerUp');
  if (!btn) return;
  const es = getCurrentExplorerState();
  if (!es.home) {
    (btn as HTMLButtonElement).disabled = true;
    return;
  }
  if (state.activeExplorerTarget === 'local') {
    (btn as HTMLButtonElement).disabled = state.localHomeDir !== null && es.home === state.localHomeDir;
    return;
  }
  const parent = pathJoin(es.home, '..');
  const atRoot = parent === es.home || parent === '.' || parent === '..';
  (btn as HTMLButtonElement).disabled = atRoot;
}

/** 現在表示中のフォルダを再読み込み。 */
export async function reloadExplorerCurrent(api: Api): Promise<void> {
  const es = getCurrentExplorerState();
  if (!es.home) return;
  delete es.loadedPaths[es.home];
  await loadExplorerDir(api, es.home);
  renderExplorerTree(api);
  updateExplorerUpButton(api);
}

/** 指定フォルダのキャッシュを破棄して再読み込み（削除・リネーム後に呼ぶ）。 */
export async function refreshExplorerDir(api: Api, parentDir: string): Promise<void> {
  const es = getCurrentExplorerState();
  delete es.loadedPaths[parentDir];
  await loadExplorerDir(api, parentDir);
  renderExplorerTree(api);
}

export async function explorerUp(api: Api): Promise<void> {
  const es = getCurrentExplorerState();
  if (!es.home) return;
  let parent: string;
  if (state.activeExplorerTarget === 'local') {
    if (state.localHomeDir !== null && es.home === state.localHomeDir) return;
    if (!api.explorer?.getLocalParent) return;
    parent = await api.explorer.getLocalParent(es.home);
    if (parent === es.home) return;
  } else {
    parent = pathJoin(es.home, '..');
    if (parent === es.home || parent === '.' || parent === '..') return;
  }
  es.home = parent;
  if (es.loadedPaths[parent] === undefined) {
    try {
      if (state.activeExplorerTarget === 'local' && api.explorer?.listLocalDirectory) {
        es.loadedPaths[parent] = await api.explorer.listLocalDirectory(parent);
      } else if (state.activeExplorerTarget !== 'local' && api.explorer?.listDirectory) {
        es.loadedPaths[parent] = await api.explorer.listDirectory(state.activeExplorerTarget, parent);
      }
    } catch {
      es.loadedPaths[parent] = [];
    }
  }
  es.expanded.add(parent);
  renderExplorerTree(api);
  updateExplorerUpButton(api);
}

export function renderExplorerTree(api: Api): void {
  const el = document.getElementById('explorerTreeContainer');
  if (!el) return;
  const es = getCurrentExplorerState();
  if (es.home === null) {
    el.innerHTML = `<p class="panelPlaceholder">${t('explorer.placeholder')}</p>`;
    updateExplorerUpButton(api);
    return;
  }
  const isLocal = state.activeExplorerTarget === 'local';
  const pcRoot = state.localHomeDir;
  function renderLevel(dirPath: string, depth: number): string {
    const entries = es.loadedPaths[dirPath];
    if (!entries) return '';
    return entries
      .map((e) => {
        const fullPath = pathJoin(dirPath, e.name);
        const isExpanded = es.expanded.has(fullPath);
        const childrenHtml = e.isDirectory ? renderLevel(fullPath, depth + 1) : '';
        const expandIcon = e.isDirectory ? (isExpanded ? '▼' : '▶') : ' ';
        const selected = state.selectedExplorerPath === fullPath ? ' explorerItem--selected' : '';
        return `<div class="explorerItem${selected}" data-path="${escapeHtml(fullPath)}" data-isdir="${e.isDirectory}">
          <span class="explorerItemLabel" style="padding-left: ${depth * 12 + 4}px">
            <span class="explorerItemExpand">${expandIcon}</span>
            <span class="explorerItemName">${escapeHtml(e.name)}</span>
          </span>
          ${isExpanded && childrenHtml ? `<div class="explorerChildren">${childrenHtml}</div>` : ''}
        </div>`;
      })
      .join('');
  }
  const html = renderLevel(es.home, 0);
  el.innerHTML = html || '<p class="panelPlaceholder">（空）</p>';
  if (isLocal && api.explorer?.startDrag) {
    el.querySelectorAll('.explorerItem').forEach((item) => {
      const pathVal = (item as HTMLElement).dataset.path;
      if (!pathVal || pathVal === pcRoot) return;
      item.addEventListener('mousedown', (e: Event) => {
        const me = e as MouseEvent;
        if (me.button !== 0) return;
        const startX = me.clientX;
        const startY = me.clientY;
        const DRAG_THRESHOLD = 5;
        let started = false;
        const onMove = (e2: Event) => {
          const m2 = e2 as MouseEvent;
          if (started) return;
          const dx = m2.clientX - startX;
          const dy = m2.clientY - startY;
          if (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD) {
            started = true;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            api.explorer!.startDrag(pathVal);
          }
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }
  el.querySelectorAll('.explorerItem[data-isdir="true"]').forEach((item) => {
    const pathVal = (item as HTMLElement).dataset.path;
    if (!pathVal) return;
    item.querySelector('.explorerItemLabel')?.addEventListener('click', async () => {
      state.selectedExplorerPath = pathVal;
      state.selectedExplorerIsDir = true;
      if (es.expanded.has(pathVal)) {
        es.expanded.delete(pathVal);
      } else {
        if (es.loadedPaths[pathVal] === undefined) await loadExplorerDir(api, pathVal);
        es.expanded.add(pathVal);
      }
      renderExplorerTree(api);
      requestAnimationFrame(() => el.focus());
    });
  });

  el.querySelectorAll('.explorerItem[data-isdir="false"]').forEach((item) => {
    const pathVal = (item as HTMLElement).dataset.path;
    if (!pathVal) return;
    const target: 'local' | number = isLocal ? 'local' : state.activeExplorerTarget;
    if (isLocal && !api.explorer?.readLocalFile) return;
    if (!isLocal && !api.explorer?.readRemoteFile) return;
    const label = item.querySelector('.explorerItemLabel');
    label?.addEventListener('click', () => {
      state.selectedExplorerPath = pathVal;
      state.selectedExplorerIsDir = false;
      renderExplorerTree(api);
      requestAnimationFrame(() => el.focus());
    });
    label?.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      const tabId = await editor.openFileInEditor(api, pathVal, target);
      if (tabId != null) {
        terminal.updateTerminalPanelVisibility(api);
        terminal.renderMainPanelTabBar(api);
        editor.focusActiveEditor();
      }
    });
  });

  updateExplorerUpButton(api);
}

let dropTargetBound = false;
let contextMenuBound = false;
let keyboardBound = false;
/** ドラッグ中にマウスが重なっているフォルダのパス。ドロップ先に使う。 */
let currentDropTargetPath: string | null = null;

/** リネーム用のアプリ内モーダル（window.prompt は Electron で背面に隠れるため）。 */
function showRenameDialog(defaultName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const id = 'explorerRenameDialog';
    let wrap = document.getElementById(id);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = id;
      wrap.className = 'passphraseDialog';
      wrap.innerHTML = `
        <div class="passphraseDialogBackdrop"></div>
        <div class="passphraseDialogBox">
          <p class="passphraseDialogTitle">${escapeHtml(t('renamePrompt') || '新しい名前')}</p>
          <input type="text" id="renameDialogInput" class="renameDialogInput" />
          <div class="passphraseDialogActions">
            <button type="button" id="renameDialogOk">OK</button>
            <button type="button" id="renameDialogCancel">${t('form.cancel')}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector('.passphraseDialogBackdrop')?.addEventListener('click', () => {
        wrap!.style.display = 'none';
        resolve(null);
      });
      wrap.querySelector('#renameDialogCancel')?.addEventListener('click', () => {
        wrap!.style.display = 'none';
        resolve(null);
      });
      wrap.querySelector('#renameDialogOk')?.addEventListener('click', () => {
        const input = wrap!.querySelector('#renameDialogInput') as HTMLInputElement;
        const v = input?.value?.trim() ?? '';
        wrap!.style.display = 'none';
        resolve(v || null);
      });
      wrap.querySelector('#renameDialogInput')?.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter') {
          ke.preventDefault();
          (wrap!.querySelector('#renameDialogOk') as HTMLButtonElement)?.click();
        }
        if (ke.key === 'Escape') {
          ke.preventDefault();
          (wrap!.querySelector('#renameDialogCancel') as HTMLButtonElement)?.click();
        }
      });
    }
    const input = wrap.querySelector('#renameDialogInput') as HTMLInputElement;
    if (input) {
      input.value = defaultName;
      input.select();
    }
    wrap.style.display = 'flex';
    requestAnimationFrame(() => input?.focus());
  });
}

/** 選択項目で F2 → リネーム、Enter → ファイルならエディタで開く／フォルダなら展開。一度だけバインド。 */
export function setupExplorerKeyboard(api: Api): void {
  if (keyboardBound) return;
  const el = document.getElementById('explorerTreeContainer');
  if (!el) return;
  keyboardBound = true;

  const sidebarExplorer = document.getElementById('sidebarExplorer');
  document.addEventListener(
    'keydown',
    async (e: KeyboardEvent) => {
      const inExplorer = el?.contains(document.activeElement) || sidebarExplorer?.contains(document.activeElement);
      if (e.key === 'F2' && inExplorer && state.selectedExplorerPath && state.activeExplorerTarget === 'local' && api.explorer?.renamePath) {
        e.preventDefault();
        e.stopPropagation();
        const oldPath = state.selectedExplorerPath;
        const baseName = oldPath.split(/[/\\]/).filter(Boolean).pop() ?? '';
        const newName = await showRenameDialog(baseName);
        if (newName == null || newName === '' || newName === baseName) return;
        try {
          await api.explorer.renamePath(oldPath, newName);
          const parentDir = getParentDir(oldPath);
          const es = getCurrentExplorerState();
          delete es.loadedPaths[parentDir];
          await loadExplorerDir(api, parentDir);
          state.selectedExplorerPath = pathJoin(parentDir, newName);
          renderExplorerTree(api);
        } catch (err) {
          api.logToMain?.('[explorer] F2 rename error', err);
        }
        return;
      }
      if (!inExplorer) return;
      if (e.key !== 'Enter' || !state.selectedExplorerPath) return;
      e.preventDefault();
    const pathVal = state.selectedExplorerPath;
    const es = getCurrentExplorerState();
    if (state.selectedExplorerIsDir) {
      if (es.expanded.has(pathVal)) {
        es.expanded.delete(pathVal);
      } else {
        if (es.loadedPaths[pathVal] === undefined) await loadExplorerDir(api, pathVal);
        es.expanded.add(pathVal);
      }
      renderExplorerTree(api);
    } else {
      const target: 'local' | number = state.activeExplorerTarget === 'local' ? 'local' : state.activeExplorerTarget;
      if (state.activeExplorerTarget === 'local' && !api.explorer?.readLocalFile) return;
      if (state.activeExplorerTarget !== 'local' && !api.explorer?.readRemoteFile) return;
      const tabId = await editor.openFileInEditor(api, pathVal, target);
      if (tabId != null) {
        terminal.updateTerminalPanelVisibility(api);
        terminal.renderMainPanelTabBar(api);
        editor.focusActiveEditor();
      }
    }
    },
    true,
  );
}

/** 右クリックで「ダウンロード」メニューを表示。ローカル（PC）タブのみ。一度だけバインド。 */
export function setupExplorerContextMenu(api: Api): void {
  if (contextMenuBound) return;
  const el = document.getElementById('explorerTreeContainer');
  if (!el) return;
  contextMenuBound = true;
  explorerContextMenu.bindExplorerContextMenu(
    el,
    api,
    () => state.activeExplorerTarget === 'local',
    () => state.localHomeDir,
    () => (state.activeExplorerTarget === 'local' ? null : state.activeExplorerTarget),
    refreshExplorerDir,
  );
}

const DROP_TARGET_CLASS = 'explorerItem--dropTarget';

function updateDropTargetHighlight(container: HTMLElement, folderPath: string | null): void {
  container.querySelectorAll(`.${DROP_TARGET_CLASS}`).forEach((n) => n.classList.remove(DROP_TARGET_CLASS));
  if (!folderPath) return;
  const item = Array.from(container.querySelectorAll('.explorerItem[data-isdir="true"]')).find(
    (n) => (n as HTMLElement).dataset.path === folderPath,
  );
  if (item) (item as HTMLElement).classList.add(DROP_TARGET_CLASS);
}

function findFolderPathUnderPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const item = el.closest('.explorerItem[data-isdir="true"]') as HTMLElement | null;
  return item?.dataset.path ?? null;
}

/** Phase1: Windows Explorer などからドロップを受け付ける。一度だけバインド。ドロップ先＝マウスが重なっているフォルダ、またはパネル背景なら表示ルート（PC ルート以外）。 */
export function bindExplorerDropTarget(api: Api): void {
  if (dropTargetBound) return;
  const el = document.getElementById('explorerTreeContainer');
  if (!el) return;
  dropTargetBound = true;
  el.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (state.activeExplorerTarget === 'local') {
      const folderPath = findFolderPathUnderPoint(e.clientX, e.clientY);
      const es = getExplorerState('local');
      if (folderPath) {
        currentDropTargetPath = folderPath;
      } else if (es.home && es.home !== state.localHomeDir) {
        currentDropTargetPath = es.home;
      } else {
        currentDropTargetPath = null;
      }
    } else {
      const folderPath = findFolderPathUnderPoint(e.clientX, e.clientY);
      const es = getExplorerState(state.activeExplorerTarget);
      currentDropTargetPath = folderPath || es.home || null;
    }
    updateDropTargetHighlight(el, currentDropTargetPath);
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    currentDropTargetPath = null;
    updateDropTargetHighlight(el, null);
  });
  el.addEventListener('drop', async (e: DragEvent) => {
    e.preventDefault();
    const targetDir = currentDropTargetPath;
    currentDropTargetPath = null;
    updateDropTargetHighlight(el, null);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if ('path' in f && typeof (f as { path?: string }).path === 'string') {
        paths.push((f as { path: string }).path);
      }
    }
    if (paths.length === 0) return;
    if (state.activeExplorerTarget === 'local') {
      if (!targetDir || targetDir === state.localHomeDir) return;
      if (!api.explorer?.copyToFolder) return;
      try {
        const es = getExplorerState('local');
        await api.explorer.copyToFolder(paths, targetDir);
        delete es.loadedPaths[targetDir];
        await loadExplorerDir(api, targetDir);
        renderExplorerTree(api);
      } catch (err) {
        api.logToMain?.('[explorer] drop error', err);
      }
    } else {
      if (!targetDir || !api.explorer?.uploadToRemote) return;
      try {
        await api.explorer.uploadToRemote(state.activeExplorerTarget, paths, targetDir);
        const es = getExplorerState(state.activeExplorerTarget);
        delete es.loadedPaths[targetDir];
        await loadExplorerDir(api, targetDir);
        renderExplorerTree(api);
      } catch (err) {
        api.logToMain?.('[explorer] drop (remote) error', err);
      }
    }
  });
}

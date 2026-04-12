/**
 * メインパネル内のファイルエディタ（Monaco）。ローカル／リモート（SSH）ファイルの開く・編集・保存。
 * monaco-editor は動的 import で読み込む（起動時の Vite 解決エラーを避ける）。
 */
import { state } from './state';
import { t } from './i18n';
import { getMonacoThemeId } from './theme';
import * as terminal from './terminal';
import { showMessage } from './message';

type Api = NonNullable<typeof window.electronAPI>;

export type EditorTarget = 'local' | number;

function getLanguageFromPath(filePath: string): string {
  const base = filePath.replace(/^.*[/\\]/, '').toLowerCase();
  const ext = base.replace(/^.*\./, '').toLowerCase();
  if (base === 'dockerfile' || base === 'dockerfile.dev') return 'dockerfile';
  const map: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    py: 'python',
    php: 'php',
    rb: 'ruby',
    c: 'cpp',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    java: 'java',
    go: 'go',
    rs: 'rust',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    sc: 'scala',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    pl: 'perl',
    pm: 'perl',
    lua: 'lua',
    xml: 'xml',
    ini: 'ini',
    bat: 'bat',
    cmd: 'bat',
    ps1: 'powershell',
    dockerfile: 'dockerfile',
  };
  return map[ext] ?? 'plaintext';
}

/**
 * 既に同じ filePath + target のエディタタブがあればその tabId を返す。
 */
export function findEditorTabByPath(filePath: string, target: EditorTarget): string | null {
  const normalized = normalizePath(filePath);
  const tab = state.mainPanelTabs.find(
    (t) =>
      t.kind === 'editor' &&
      normalizePath(t.filePath) === normalized &&
      t.target === target,
  );
  return tab?.id ?? null;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * エディタタブ用の Monaco を作成し、state に登録する。
 */
export async function createEditorForTab(api: Api, tabId: string, filePath: string, initialContent: string): Promise<void> {
  if (state.editorInstances.has(tabId)) return;
  const editorContainerEl = document.getElementById('editorContainer');
  if (!editorContainerEl) return;

  const monaco = await import('monaco-editor');
  const language = getLanguageFromPath(filePath);
  if (language === 'python') {
    await import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js');
  }

  const container = document.createElement('div');
  container.className = 'editorTabContent';
  container.dataset.tabId = tabId;
  container.style.display = 'none';
  editorContainerEl.appendChild(container);

  const editor = monaco.editor.create(container, {
    value: initialContent,
    language,
    theme: getMonacoThemeId(),
    minimap: { enabled: false },
    fontSize: 14,
    wordWrap: 'on',
    automaticLayout: true,
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveEditorTab(api, tabId);
  });

  state.editorLastSavedContentByTabId[tabId] = initialContent;

  editor.onDidChangeModelContent(() => {
    const current = editor.getValue();
    const saved = state.editorLastSavedContentByTabId[tabId] ?? '';
    state.editorDirtyByTabId[tabId] = current !== saved;
    window.dispatchEvent(new CustomEvent('main-panel-tab-bar-refresh'));
  });

  state.editorInstances.set(tabId, { editor, container });
}

/** 行単位の diff からハンク一覧を返す（1-based 行番号）。 */
function computeHunks(oldText: string, newText: string): Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> {
  const oldLines = oldText.split(/\n/);
  const newLines = newText.split(/\n/);
  const hunks: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i += 1;
      j += 1;
    }
    if (i >= oldLines.length && j >= newLines.length) break;
    const startI = i;
    const startJ = j;
    let found = false;
    for (let ii = startI; ii <= oldLines.length; ii += 1) {
      for (let jj = startJ; jj <= newLines.length; jj += 1) {
        if (ii < oldLines.length && jj < newLines.length && oldLines[ii] === newLines[jj]) {
          hunks.push({
            oldStart: startI + 1,
            oldEnd: ii,
            newStart: startJ + 1,
            newEnd: jj,
          });
          i = ii;
          j = jj;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      hunks.push({
        oldStart: startI + 1,
        oldEnd: oldLines.length,
        newStart: startJ + 1,
        newEnd: newLines.length,
      });
      break;
    }
  }
  return hunks;
}

let diffEditorInstance: unknown = null;
let diffOriginalModel: unknown = null;
let diffModifiedModel: unknown = null;

/**
 * 適用前の diff プレビューを開く。Ctrl+N / Ctrl+Shift+Y でハンク移動、「適用する」で確定（undo 対応）。
 */
export async function setPendingDiff(tabId: string, proposedContent: string): Promise<boolean> {
  logToStdout('setPendingDiff', tabId, 'proposedLen', proposedContent.length);
  const inst = state.editorInstances.get(tabId);
  if (!inst) {
    logToStdout('setPendingDiff false: no inst');
    return false;
  }
  const currentContent = (inst.editor as { getValue(): string }).getValue();
  if (currentContent === proposedContent) {
    logToStdout('setPendingDiff false: unchanged');
    return false;
  }
  const tab = state.mainPanelTabs.find((t) => t.id === tabId);
  const filePath = tab?.kind === 'editor' ? tab.filePath : '';
  const language = getLanguageFromPath(filePath);
  const hunks = computeHunks(currentContent, proposedContent);
  logToStdout('setPendingDiff currentLen', currentContent.length, 'hunks', hunks.length);
  if (hunks.length === 0) {
    logToStdout('setPendingDiff false: no hunks');
    return false;
  }

  if (state.pendingDiff) cancelPendingDiff();
  const monaco = await import('monaco-editor');
  const originalModel = monaco.editor.createModel(currentContent, language);
  const modifiedModel = monaco.editor.createModel(proposedContent, language);
  diffOriginalModel = originalModel;
  diffModifiedModel = modifiedModel;

  const wrap = document.getElementById('diffPreviewWrap');
  const container = document.getElementById('diffPreviewContainer');
  if (!wrap || !container) {
    logToStdout('setPendingDiff false: no wrap or container');
    return false;
  }
  container.innerHTML = '';
  const diffEditor = monaco.editor.createDiffEditor(container, {
    theme: getMonacoThemeId(),
    readOnly: true,
    renderSideBySide: true,
    automaticLayout: true,
  });
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  diffEditorInstance = diffEditor;

  state.pendingDiff = {
    tabId,
    currentContent,
    proposedContent,
    hunks,
    currentHunkIndex: 0,
  };
  wrap.style.display = 'flex';
  (wrap as HTMLElement).tabIndex = 0;
  (wrap as HTMLElement).focus();
  revealDiffHunk(0);
  logToStdout('setPendingDiff true: diff opened');
  return true;
}

function revealDiffHunk(index: number): void {
  if (!state.pendingDiff || !diffEditorInstance) return;
  const { hunks } = state.pendingDiff;
  if (hunks.length === 0) return;
  const i = Math.max(0, Math.min(index, hunks.length - 1));
  state.pendingDiff.currentHunkIndex = i;
  const modified = (diffEditorInstance as { getModifiedEditor(): { revealLineInCenter(line: number): void } }).getModifiedEditor();
  modified.revealLineInCenter(hunks[i].newStart);
}

export function diffNextHunk(): boolean {
  if (!state.pendingDiff) return false;
  const next = state.pendingDiff.currentHunkIndex + 1;
  if (next >= state.pendingDiff.hunks.length) return false;
  revealDiffHunk(next);
  return true;
}

export function diffPrevHunk(): boolean {
  if (!state.pendingDiff) return false;
  const prev = state.pendingDiff.currentHunkIndex - 1;
  if (prev < 0) return false;
  revealDiffHunk(prev);
  return true;
}

export function applyPendingDiff(api: Api): void {
  logToStdout('applyPendingDiff called');
  if (!state.pendingDiff) {
    logToStdout('applyPendingDiff early return: no pendingDiff');
    return;
  }
  const { tabId, proposedContent } = state.pendingDiff;
  const inst = state.editorInstances.get(tabId);
  if (!inst) {
    logToStdout('applyPendingDiff early return: no editor inst for tabId', tabId);
    cancelPendingDiff();
    return;
  }
  try {
    const ed = inst.editor as unknown as {
      getModel(): { getFullModelRange(): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } } | null;
      executeEdits(source: string, edits: Array<{ range: unknown; text: string }>): boolean;
      pushUndoStop?(): void;
    };
    const model = ed.getModel();
    if (!model) {
      logToStdout('applyPendingDiff early return: no model');
    } else {
      const range = model.getFullModelRange();
      logToStdout('applyPendingDiff applying', 'proposedLen', proposedContent.length);
      ed.executeEdits('apply-diff', [{ range, text: proposedContent }]);
      ed.pushUndoStop?.();
      state.editorDirtyByTabId[tabId] = true;
      window.dispatchEvent(new CustomEvent('main-panel-tab-bar-refresh'));
      logToStdout('applyPendingDiff done');
    }
  } catch (err) {
    logToStdout('applyPendingDiff error', err);
  } finally {
    cancelPendingDiff();
  }
  if (api) terminal.renderMainPanelTabBar(api);
}

export function cancelPendingDiff(): void {
  const wrap = document.getElementById('diffPreviewWrap');
  if (wrap) wrap.style.display = 'none';
  if (diffEditorInstance) {
    (diffEditorInstance as { dispose(): void }).dispose();
    diffEditorInstance = null;
  }
  if (diffOriginalModel) {
    (diffOriginalModel as { dispose(): void }).dispose();
    diffOriginalModel = null;
  }
  if (diffModifiedModel) {
    (diffModifiedModel as { dispose(): void }).dispose();
    diffModifiedModel = null;
  }
  state.pendingDiff = null;
}

const APPLY_LOG = '[AISSH apply]';

function logToStdout(...args: unknown[]): void {
  window.electronAPI?.logToMain?.(APPLY_LOG, ...args);
}

/**
 * 指定タブのエディタで search_replace を実行する（ファイル修正の適用）。
 * oldStr が空のときはファイル全体を newStr で上書き。それ以外は先頭の一致箇所を 1 回だけ置換。該当がなければ false。
 */
export function applySearchReplace(tabId: string, oldStr: string, newStr: string): boolean {
  const fullReplace = oldStr === '';
  logToStdout({ tabId, fullReplace, oldLen: oldStr.length, newLen: newStr.length });
  const inst = state.editorInstances.get(tabId);
  if (!inst) {
    logToStdout('WARN editor instance not found', tabId);
    return false;
  }
  const ed = inst.editor as unknown as { getModel(): { getValue(): string }; setValue(v: string): void };
  const model = ed.getModel();
  if (!model) {
    logToStdout('WARN no model', tabId);
    return false;
  }
  if (fullReplace) {
    ed.setValue(newStr);
    state.editorDirtyByTabId[tabId] = true;
    logToStdout('ok (full overwrite)');
    return true;
  }
  const content = model.getValue();
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    logToStdout('WARN OLD not found. oldStr first 80 chars:', oldStr.slice(0, 80).replace(/\n/g, '\\n'));
    return false;
  }
  const newContent = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
  ed.setValue(newContent);
  state.editorDirtyByTabId[tabId] = true;
  logToStdout('ok (replaced at index', idx, ')');
  return true;
}

export async function applyThemeToAllEditors(): Promise<void> {
  const monaco = await import('monaco-editor');
  monaco.editor.setTheme(getMonacoThemeId());
}

/**
export function saveEditorTab(api: Api, tabId: string): void {
  const tab = state.mainPanelTabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== 'editor' || !api.explorer) return;
  const inst = state.editorInstances.get(tabId);
  if (!inst) return;
  const content = inst.editor.getValue();
  const onFail = (err: unknown) =>
    showMessage({
      title: t('editor.saveFailed'),
      message: `${t('editor.saveFailed')}: ${err instanceof Error ? err.message : String(err)}`,
    });
  if (tab.target === 'local') {
    api.explorer.writeLocalFile(tab.filePath, content).then(() => {
      state.editorDirtyByTabId[tabId] = false;
      state.editorLastSavedContentByTabId[tabId] = content;
      window.dispatchEvent(new CustomEvent('main-panel-tab-bar-refresh'));
    }).catch(onFail);
  } else {
    api.explorer.writeRemoteFile(tab.target, tab.filePath, content).then(() => {
      state.editorDirtyByTabId[tabId] = false;
      state.editorLastSavedContentByTabId[tabId] = content;
      window.dispatchEvent(new CustomEvent('main-panel-tab-bar-refresh'));
    }).catch(onFail);
  }
}

export function disposeEditorForTab(tabId: string): void {
  const inst = state.editorInstances.get(tabId);
  if (inst) {
    inst.editor.dispose();
    inst.container.remove();
    state.editorInstances.delete(tabId);
  }
  // Also clean up any leftover loading placeholder
  const editorContainerEl = document.getElementById('editorContainer');
  if (editorContainerEl) {
    const loader = editorContainerEl.querySelector(`[data-tab-id="${tabId}"]`);
    if (loader) loader.remove();
  }
  delete state.editorDirtyByTabId[tabId];
  delete state.editorLastSavedContentByTabId[tabId];
  // Cancel pending diff if it belongs to this tab
  if (state.pendingDiff?.tabId === tabId) {
    cancelPendingDiff();
  }
}

/**
 * アクティブなタブがエディタならそのエディタにフォーカスする。
 */
export function focusActiveEditor(): void {
  const tab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (tab?.kind !== 'editor') return;
  const inst = state.editorInstances.get(tab.id);
  if (inst) inst.editor.focus();
}

const LARGE_FILE_THRESHOLD = 512 * 1024; // 512KB

/** Track loading tab IDs so closeMainPanelTab can abort them. */
const loadingTabs = new Set<string>();

export function isLoadingTab(tabId: string): boolean {
  return loadingTabs.has(tabId);
}

function removeLoadingTab(tabId: string, editorContainerEl: HTMLElement | null): void {
  loadingTabs.delete(tabId);
  const loader = editorContainerEl?.querySelector(`[data-tab-id="${tabId}"]`);
  if (loader) loader.remove();
  const idx = state.mainPanelTabs.findIndex((t) => t.id === tabId);
  if (idx !== -1) state.mainPanelTabs.splice(idx, 1);
  state.activeMainPanelTabId = state.mainPanelTabs.length > 0
    ? state.mainPanelTabs[Math.min(idx, state.mainPanelTabs.length - 1)].id
    : null;
}

/**
 * ファイルをエディタで開く。ローディング表示、中止ボタン、大ファイル警告付き。
 */
export async function openFileInEditor(api: Api, filePath: string, target: EditorTarget): Promise<string | null> {
  const existingId = findEditorTabByPath(filePath, target);
  if (existingId) return existingId;

  const label = filePath.replace(/^.*[/\\]/, '') || filePath;
  const tabId = `editor-${Date.now()}`;

  // --- Large file check ---
  try {
    let fileSize = 0;
    if (target === 'local' && api.explorer?.getLocalFileSize) {
      fileSize = await api.explorer.getLocalFileSize(filePath);
    } else if (target !== 'local' && api.explorer?.getRemoteFileSize) {
      fileSize = await api.explorer.getRemoteFileSize(target, filePath);
    }
    if (fileSize > LARGE_FILE_THRESHOLD) {
      const sizeStr = fileSize > 1024 * 1024
        ? `${(fileSize / (1024 * 1024)).toFixed(1)}MB`
        : `${(fileSize / 1024).toFixed(0)}KB`;
      const msg = t('editor.largeFileWarning').replace('%s', sizeStr);
      const confirmed = window.confirm(msg);
      if (!confirmed) return null;
    }
  } catch {
    // If size check fails, proceed anyway
  }

  state.mainPanelTabs.push({ id: tabId, kind: 'editor', filePath, label, target });
  state.activeMainPanelTabId = tabId;
  loadingTabs.add(tabId);

  // Show loading placeholder with cancel button
  const editorContainerEl = document.getElementById('editorContainer');
  if (editorContainerEl) {
    const loader = document.createElement('div');
    loader.className = 'editorTabContent editorLoading';
    loader.dataset.tabId = tabId;
    loader.innerHTML = `<div class="editorLoadingSpinner"></div>
      <span class="editorLoadingText">${t('explorer.loading')}</span>
      <button type="button" class="editorLoadingCancel" id="editorCancel-${tabId}">${t('editor.cancelLoad')}</button>`;
    editorContainerEl.appendChild(loader);
  }

  terminal.renderMainPanelTabBar(api);

  // Cancel button handler
  const cancelBtn = document.getElementById(`editorCancel-${tabId}`);
  cancelBtn?.addEventListener('click', () => {
    if (loadingTabs.has(tabId)) {
      removeLoadingTab(tabId, editorContainerEl);
      terminal.renderMainPanelTabBar(api);
    }
  });

  // Check if already cancelled during await
  if (!loadingTabs.has(tabId)) return null;

  let content: string;
  try {
    if (target === 'local') {
      if (!api.explorer?.readLocalFile) return null;
      content = await api.explorer.readLocalFile(filePath);
    } else {
      if (!api.explorer?.readRemoteFile) return null;
      content = await api.explorer.readRemoteFile(target, filePath);
    }
  } catch (err) {
    if (loadingTabs.has(tabId)) {
      removeLoadingTab(tabId, editorContainerEl);
      terminal.renderMainPanelTabBar(api);
      await showMessage({
        title: t('editor.openFailed'),
        message: `${t('editor.openFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return null;
  }

  // Check again if cancelled while reading
  if (!loadingTabs.has(tabId)) return null;
  loadingTabs.delete(tabId);

  // Remove loading placeholder, create real editor
  const loader = editorContainerEl?.querySelector(`.editorLoading[data-tab-id="${tabId}"]`);
  if (loader) loader.remove();
  await createEditorForTab(api, tabId, filePath, content);
  terminal.renderMainPanelTabBar(api);
  return tabId;
}

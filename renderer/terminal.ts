import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { state, getExplorerState, getNextConnectionId, syncTerminalStateFromMainPanel } from './state';
import { t } from './i18n';
import { displayName, escapeHtml } from './util';
import { getXtermTheme } from './theme';
import * as explorer from './explorer';
import * as editor from './editor';
import * as explorerContextMenu from './explorerContextMenu';
import * as sidebar from './sidebar';
import * as serverInfo from './serverInfo';
import { showMessage } from './message';

type Api = NonNullable<typeof window.electronAPI>;

export function createTerminalForTab(api: Api, connectionId: number, name: string): void {
  if (state.terminalInstances.has(connectionId)) return;
  const container = document.createElement('div');
  container.className = 'terminalTabContent';
  container.dataset.connectionId = String(connectionId);
  container.style.display = 'none';
  document.getElementById('terminalContainer')?.appendChild(container);

  const term = new Terminal({
    cursorBlink: true,
    theme: getXtermTheme(),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();
  term.onData((data) => {
    if (api.terminal) api.terminal.write(connectionId, data);
  });

  // マウスドラッグで選択 → マウスアップ時にクリップボードへコピー
  container.addEventListener('mouseup', () => {
    if (term.hasSelection()) {
      const text = term.getSelection();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
    }
  });

  // 右クリックでペースト（キー入力と同じ経路で SSH に送る＝一文字ずつ api.terminal.write）
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    navigator.clipboard.readText().then((text) => {
      if (text && api.terminal) {
        for (const c of text) {
          api.terminal.write(connectionId, c);
        }
      }
    }).catch(() => {});
  });

  state.terminalInstances.set(connectionId, { term, fitAddon, container });
  if (!state.terminalBufferByConnection[connectionId]) state.terminalBufferByConnection[connectionId] = '';
  sendTerminalResize(api, connectionId);
}

export async function createLocalTerminalForTab(api: Api, tabId: string): Promise<void> {
  if (state.localTerminalInstances.has(tabId)) return;
  const container = document.createElement('div');
  container.className = 'terminalTabContent';
  container.dataset.tabId = tabId;
  container.style.display = 'none';
  document.getElementById('terminalContainer')?.appendChild(container);

  const term = new Terminal({
    cursorBlink: true,
    theme: getXtermTheme(),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();
  term.onData((data) => {
    if (api.terminal?.localWrite) api.terminal.localWrite(tabId, data);
  });

  container.addEventListener('mouseup', () => {
    if (term.hasSelection()) {
      const text = term.getSelection();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
    }
  });
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    navigator.clipboard.readText().then((text) => {
      if (text && api.terminal?.localWrite) api.terminal.localWrite(tabId, text);
    }).catch(() => {});
  });

  state.localTerminalInstances.set(tabId, { term, fitAddon, container });
  try {
    if (api.terminal?.localConnect) await api.terminal.localConnect(tabId);
  } catch (err) {
    term.dispose();
    container.remove();
    state.localTerminalInstances.delete(tabId);
    throw err;
  }
  setTimeout(() => {
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims && api.terminal?.localResize) api.terminal.localResize(tabId, dims.cols, dims.rows);
  }, 100);
}

/** fit 後に呼び、SSH の PTY に現在の行数・列数を通知する（vim 等の縦幅用） */
export function sendTerminalResize(api: Api, connectionId: number): void {
  const inst = state.terminalInstances.get(connectionId);
  if (!inst || !api.terminal?.resize) return;
  api.terminal.resize(
    connectionId,
    inst.term.rows,
    inst.term.cols,
    inst.container.clientHeight,
    inst.container.clientWidth,
  );
}

export function disposeTerminalForTab(connectionId: number): void {
  const inst = state.terminalInstances.get(connectionId);
  if (!inst) return;
  inst.term.dispose();
  inst.container.remove();
  state.terminalInstances.delete(connectionId);
  delete state.terminalBufferByConnection[connectionId];
}

function getLocalTerminalLabel(): string {
  return t('button.local');
}

/** メインパネルタブのラベル（種別に応じて） */
function getMainPanelTabLabel(tab: import('./types').MainPanelTab): string {
  if (tab.kind === 'terminal') return tab.name;
  if (tab.kind === 'local-terminal') return getLocalTerminalLabel();
  if (tab.kind === 'editor') return tab.label;
  return (tab as { id: string }).id;
}

export function renderMainPanelTabBar(api: Api): void {
  const bar = document.getElementById('terminalTabBar');
  const nameEl = document.getElementById('terminalEnvName');
  if (!bar) return;
  if (state.mainPanelTabs.length === 0) {
    bar.innerHTML = '';
    if (nameEl) nameEl.textContent = '';
    return;
  }
  bar.innerHTML = state.mainPanelTabs
    .map(
      (tab) => {
        const label = escapeHtml(getMainPanelTabLabel(tab));
        const dirtyDot =
          tab.kind === 'editor' && state.editorDirtyByTabId[tab.id]
            ? `<span class="terminalTabDirty" title="${t('terminal.unsaved')}">●</span>`
            : '';
        return `<span class="terminalTab ${tab.id === state.activeMainPanelTabId ? 'active' : ''}" data-tab-id="${escapeHtml(tab.id)}" title="${escapeHtml(getMainPanelTabLabel(tab))}">
          <span class="terminalTabLabel">${dirtyDot}${label}</span>
          <button type="button" class="terminalTabClose" data-tab-id="${escapeHtml(tab.id)}" aria-label="${t('terminal.close')}">×</button>
        </span>`;
      },
    )
    .join('');

  bar.querySelectorAll('.terminalTab').forEach((el) => {
    const tabId = (el as HTMLElement).dataset.tabId;
    if (!tabId) return;
    el.querySelector('.terminalTabLabel')?.addEventListener('click', () => switchMainPanelTab(api, tabId));
    el.querySelector('.terminalTabClose')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMainPanelTab(api, tabId);
    });
    el.addEventListener('contextmenu', (e: Event) => {
      const ev = e as MouseEvent;
      const tab = state.mainPanelTabs.find((t) => t.id === tabId);
      if (tab?.kind !== 'editor') return;
      ev.preventDefault();
      ev.stopPropagation();
      const filePath = tab.filePath;
      const target = tab.target;
      const isLocal = target === 'local';
      const es = state.activeExplorerTarget === (isLocal ? 'local' : target) ? getExplorerState(isLocal ? 'local' : target) : null;
      const items: explorerContextMenu.ContextMenuItem[] = [];
      items.push({
        label: t('copyPath'),
        onClick: () => navigator.clipboard.writeText(filePath).catch(() => {}),
      });
      items.push({
        label: t('copy'),
        onClick: () => {
          if (isLocal) {
            state.copiedFilePaths = [filePath];
            state.copyTarget = 'local';
          }
        },
      });
      if (isLocal && state.copiedFilePaths.length > 0 && state.copyTarget === 'local' && es?.home && api.explorer?.copyToFolder) {
        items.push({
          label: t('paste'),
          onClick: () => api.explorer!.copyToFolder(state.copiedFilePaths, es.home!).catch(() => {}),
        });
      }
      if (!isLocal && typeof target === 'number' && api.explorer?.downloadFromRemote) {
        items.push({
          label: t('download'),
          onClick: () => api.explorer!.downloadFromRemote(target, [filePath]).catch(() => {}),
        });
      }
      explorerContextMenu.showContextMenu(ev, items);
    });
  });

  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  const isTerminalActive = activeTab?.kind === 'terminal' || activeTab?.kind === 'local-terminal';
  const terminalContainerEl = document.getElementById('terminalContainer');
  const editorContainerEl = document.getElementById('editorContainer');
  if (terminalContainerEl) terminalContainerEl.style.display = isTerminalActive ? 'block' : 'none';
  if (editorContainerEl) {
    editorContainerEl.classList.toggle('visible', activeTab?.kind === 'editor');
    state.editorInstances.forEach((inst, tabId) => {
      inst.container.style.display = activeTab?.kind === 'editor' && activeTab.id === tabId ? 'block' : 'none';
    });
    if (activeTab?.kind === 'editor') setTimeout(() => editor.focusActiveEditor(), 50);
  }

  state.terminalInstances.forEach((inst, connectionId) => {
    const activeCid = activeTab?.kind === 'terminal' ? activeTab.connectionId : null;
    inst.container.style.display = connectionId === activeCid ? 'block' : 'none';
    if (connectionId === activeCid) setTimeout(() => { inst.fitAddon.fit(); sendTerminalResize(api, connectionId); }, 50);
  });
  state.localTerminalInstances.forEach((inst, tabId) => {
    inst.container.style.display = activeTab?.kind === 'local-terminal' && activeTab.id === tabId ? 'block' : 'none';
    if (activeTab?.kind === 'local-terminal' && activeTab.id === tabId) {
      setTimeout(() => {
        inst.fitAddon.fit();
        if (api.terminal?.localResize) api.terminal.localResize(tabId, inst.fitAddon.proposeDimensions()?.cols ?? 120, inst.fitAddon.proposeDimensions()?.rows ?? 30);
      }, 50);
    }
  });

  if (nameEl) nameEl.textContent = activeTab ? getMainPanelTabLabel(activeTab) : '';
}

/** @deprecated 互換のため残す。中で renderMainPanelTabBar を呼ぶ。 */
export function renderTerminalTabBar(api: Api): void {
  renderMainPanelTabBar(api);
}

export function switchMainPanelTab(api: Api, tabId: string): void {
  if (!state.mainPanelTabs.some((t) => t.id === tabId)) return;
  state.activeMainPanelTabId = tabId;
  syncTerminalStateFromMainPanel();
  renderMainPanelTabBar(api);
  // Explorer auto-follows active tab
  const tab = state.mainPanelTabs.find((t) => t.id === tabId);
  if (tab?.kind === 'terminal') {
    explorer.setActiveExplorerTarget(api, tab.connectionId);
    serverInfo.loadServerInfo(api, tab.connectionId);
  } else if (tab?.kind === 'local-terminal') {
    explorer.setActiveExplorerTarget(api, 'local');
    serverInfo.loadServerInfo(api, null);
  }
  window.dispatchEvent(new Event('main-panel-tabs-changed'));
}

/** @deprecated 互換のため残す。connectionId で閉じる。 */
export function switchTerminalTab(api: Api, connectionId: number): void {
  const tab = state.mainPanelTabs.find((t) => t.kind === 'terminal' && t.connectionId === connectionId);
  if (tab) switchMainPanelTab(api, tab.id);
}

function disposeLocalTerminalTab(tabId: string): void {
  const inst = state.localTerminalInstances.get(tabId);
  if (!inst) return;
  inst.term.dispose();
  inst.container.remove();
  state.localTerminalInstances.delete(tabId);
}

function closeMainPanelTab(api: Api, tabId: string): void {
  const tab = state.mainPanelTabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (tab.kind === 'terminal' && api.terminal) {
    api.terminal.disconnect(tab.connectionId);
    disposeTerminalForTab(tab.connectionId);
    if (state.activeExplorerTarget === tab.connectionId) {
      state.activeExplorerTarget = 'local';
      explorer.loadExplorerRootForTarget(api, 'local');
    }
    explorer.clearExplorerStateForTarget(api, tab.connectionId);
    const key = String(tab.connectionId);
    if (state.explorerByTarget[key]) delete state.explorerByTarget[key];
  } else if (tab.kind === 'local-terminal' && api.terminal) {
    api.terminal.localDisconnect(tabId);
    disposeLocalTerminalTab(tabId);
  } else if (tab.kind === 'editor') {
    if (editor.isLoadingTab(tabId)) {
      // Loading tab: cancel loading then remove
      const editorContainerEl = document.getElementById('editorContainer');
      const loader = editorContainerEl?.querySelector(`[data-tab-id="${tabId}"]`);
      if (loader) loader.remove();
      editor.disposeEditorForTab(tabId);
    } else {
      editor.disposeEditorForTab(tabId);
    }
  }
  const idx = state.mainPanelTabs.findIndex((t) => t.id === tabId);
  if (idx !== -1) state.mainPanelTabs.splice(idx, 1);
  if (state.activeMainPanelTabId === tabId) {
    state.activeMainPanelTabId =
      state.mainPanelTabs.length > 0 ? state.mainPanelTabs[Math.min(idx, state.mainPanelTabs.length - 1)].id : null;
  }
  syncTerminalStateFromMainPanel();
  updateTerminalPanelVisibility(api);
  renderMainPanelTabBar(api);
  // If closed tab was the explorer target, switch explorer
  const remainingTerminal = state.mainPanelTabs.find((t) => t.kind === 'terminal');
  const hasLocal = state.mainPanelTabs.some((t) => t.kind === 'local-terminal');
  const hasAnyConnection = remainingTerminal || hasLocal;
  const closedTarget = tab.kind === 'terminal' ? tab.connectionId : tab.kind === 'local-terminal' ? 'local' : null;
  if (closedTarget !== null && state.activeExplorerTarget === closedTarget) {
    if (!hasAnyConnection) {
      // No tabs left: clear explorer to empty
      explorer.clearExplorerStateForTarget(api, 'local');
      state.activeExplorerTarget = 'local';
      explorer.renderExplorerTree(api);
    } else {
      explorer.setActiveExplorerTarget(api, hasLocal ? 'local' : (remainingTerminal ? remainingTerminal.connectionId : 'local'));
    }
  } else if (!hasAnyConnection) {
    explorer.clearExplorerStateForTarget(api, 'local');
    state.activeExplorerTarget = 'local';
    explorer.renderExplorerTree(api);
  } else {
    explorer.renderExplorerTree(api);
  }
  window.dispatchEvent(new Event('main-panel-tabs-changed'));
}

/** @deprecated 互換のため残す。connectionId で閉じる。 */
export function closeTerminalTab(api: Api, connectionId: number): void {
  const tab = state.mainPanelTabs.find((t) => t.kind === 'terminal' && t.connectionId === connectionId);
  if (tab) closeMainPanelTab(api, tab.id);
}

export function updateTerminalPanelVisibility(api: Api): void {
  const welcome = document.getElementById('welcomeArea');
  const panel = document.getElementById('mainPanel');
  const show = state.mainPanelTabs.length > 0;
  if (welcome) welcome.style.display = show ? 'none' : 'block';
  if (panel) panel.classList.toggle('visible', show);
  if (show) renderMainPanelTabBar(api);
}

/** アクティブなターミナルにフォーカス（ショートカット用）。 */
export function focusActiveTerminal(): void {
  const tab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (!tab) return;
  if (tab.kind === 'terminal') {
    const inst = state.terminalInstances.get(tab.connectionId);
    if (inst) inst.term.focus();
  } else if (tab.kind === 'local-terminal') {
    const inst = state.localTerminalInstances.get(tab.id);
    if (inst) inst.term.focus();
  }
}

/** 指定 env のターミナルタブに切り替えてフォーカス。 */
export function switchToTabByEnvId(api: Api, envId: number): void {
  const tab = state.mainPanelTabs.find((t) => t.kind === 'terminal' && t.envId === envId);
  if (!tab) return;
  state.activeMainPanelTabId = tab.id;
  syncTerminalStateFromMainPanel();
  updateTerminalPanelVisibility(api);
  renderMainPanelTabBar(api);
  focusActiveTerminal();
}

/** ローカルターミナルタブに切り替えてフォーカス（なければ新規作成）。 */
export function focusOrCreateLocalTerminalTab(api: Api): void {
  const existing = state.mainPanelTabs.find((t) => t.kind === 'local-terminal');
  if (existing) {
    state.activeMainPanelTabId = existing.id;
    syncTerminalStateFromMainPanel();
    updateTerminalPanelVisibility(api);
    renderMainPanelTabBar(api);
    focusActiveTerminal();
    return;
  }
  void openLocalTerminalTab(api);
}

export function setupTerminalDataListener(api: Api): void {
  if (!api.terminal) return;
  api.terminal.onData((payload) => {
    const inst = state.terminalInstances.get(payload.connectionId);
    if (inst) inst.term.write(payload.data);
    if (!state.terminalBufferByConnection[payload.connectionId]) state.terminalBufferByConnection[payload.connectionId] = '';
    state.terminalBufferByConnection[payload.connectionId] += payload.data;
    if (state.terminalBufferByConnection[payload.connectionId].length > state.TERMINAL_BUFFER_MAX) {
      state.terminalBufferByConnection[payload.connectionId] = state.terminalBufferByConnection[payload.connectionId].slice(-state.TERMINAL_BUFFER_MAX);
    }
    api.serveroutput?.append(payload.connectionId, payload.data);
  });
  api.terminal.onLocalData?.((payload) => {
    const inst = state.localTerminalInstances.get(payload.tabId);
    if (inst) inst.term.write(payload.data);
    if (!state.localTerminalBufferByTabId[payload.tabId]) state.localTerminalBufferByTabId[payload.tabId] = '';
    state.localTerminalBufferByTabId[payload.tabId] += payload.data;
    if (state.localTerminalBufferByTabId[payload.tabId].length > state.TERMINAL_BUFFER_MAX) {
      state.localTerminalBufferByTabId[payload.tabId] = state.localTerminalBufferByTabId[payload.tabId].slice(-state.TERMINAL_BUFFER_MAX);
    }
  });
}

export function showPassphraseDialog(show: boolean): void {
  const dialog = document.getElementById('passphraseDialog');
  const input = document.getElementById('passphraseInput') as HTMLInputElement;
  if (dialog) dialog.style.display = show ? 'flex' : 'none';
  if (input) {
    if (show) {
      input.value = '';
      input.disabled = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          input.focus();
        });
      });
    }
  }
}

export async function doConnectWithPassphrase(api: Api, passphrase: string | null): Promise<void> {
  if (state.selectedId === null || !api.terminal) return;
  const env = state.envList.find((e) => e.id === state.selectedId);
  if (!env) return;
  showPassphraseDialog(false);
  state.connectingId = state.selectedId;
  sidebar.refreshConnectListDisplay(api);
  const connectionId = getNextConnectionId();
  try {
    await api.terminal.connect(connectionId, state.selectedId, passphrase);
    const name = displayName(env);
    const tabId = `terminal-${connectionId}`;
    state.mainPanelTabs.push({ id: tabId, kind: 'terminal', connectionId, envId: state.selectedId, name });
    state.activeMainPanelTabId = tabId;
    syncTerminalStateFromMainPanel();
    createTerminalForTab(api, connectionId, name);
    const saved = await api.serveroutput?.get(connectionId);
    if (saved) state.terminalBufferByConnection[connectionId] = saved.slice(-state.TERMINAL_BUFFER_MAX);
    updateTerminalPanelVisibility(api);
    renderMainPanelTabBar(api);
    explorer.setActiveExplorerTarget(api, connectionId);
    serverInfo.loadServerInfo(api, connectionId);
    focusActiveTerminal();
    window.dispatchEvent(new Event('main-panel-tabs-changed'));
  } catch (err) {
    void showMessage({
      title: t('alert.connectFail'),
      message: err instanceof Error ? err.message : String(err),
    });
    await api.refocusWindow?.();
  } finally {
    state.connectingId = null;
    sidebar.refreshConnectListDisplay(api);
  }
}

export async function doConnect(api: Api): Promise<void> {
  if (state.selectedId === null) {
    void showMessage({ title: t('alert.connectFail'), message: t('alert.selectEnv') });
    return;
  }
  const env = state.envList.find((e) => e.id === state.selectedId);
  if (!env) {
    void showMessage({ title: t('alert.connectFail'), message: t('alert.envNotFound') });
    return;
  }
  if (env.authType === 'key') {
    showPassphraseDialog(true);
    return;
  }
  await doConnectWithPassphrase(api, null);
}

export function submitPassphraseDialog(api: Api): void {
  const input = document.getElementById('passphraseInput') as HTMLInputElement;
  const value = input?.value.trim() ?? '';
  doConnectWithPassphrase(api, value === '' ? null : value);
}

export function bindPassphraseDialog(api: Api): void {
  document.getElementById('btnPassphraseOk')?.addEventListener('click', () => submitPassphraseDialog(api));
  document.getElementById('passphraseInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitPassphraseDialog(api);
    }
  });
  document.getElementById('btnPassphraseCancel')?.addEventListener('click', () => {
    showPassphraseDialog(false);
  });
}

export function applyThemeToAllTerminals(): void {
  const theme = getXtermTheme();
  state.terminalInstances.forEach((inst) => { inst.term.options.theme = theme; });
  state.localTerminalInstances.forEach((inst) => { inst.term.options.theme = theme; });
}

export function doDisconnect(api: Api): void {
  if (state.activeMainPanelTabId) closeMainPanelTab(api, state.activeMainPanelTabId);
}

/** ローカルターミナルタブを 1 つ追加して開く。 */
export async function openLocalTerminalTab(api: Api): Promise<void> {
  const tabId = `local-${Date.now()}`;
  state.mainPanelTabs.push({ id: tabId, kind: 'local-terminal' });
  state.activeMainPanelTabId = tabId;
  syncTerminalStateFromMainPanel();
  try {
    await createLocalTerminalForTab(api, tabId);
  } catch (err) {
    const idx = state.mainPanelTabs.findIndex((t) => t.id === tabId);
    if (idx !== -1) state.mainPanelTabs.splice(idx, 1);
    state.activeMainPanelTabId = state.mainPanelTabs.length > 0 ? state.mainPanelTabs[0].id : null;
    syncTerminalStateFromMainPanel();
    updateTerminalPanelVisibility(api);
    renderMainPanelTabBar(api);
    void showMessage({
      title: t('terminal.localError'),
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  updateTerminalPanelVisibility(api);
  renderMainPanelTabBar(api);
  explorer.setActiveExplorerTarget(api, 'local');
  focusActiveTerminal();
  window.dispatchEvent(new Event('main-panel-tabs-changed'));
}

/**
 * フォーカス移動ショートカット（Cursor / VS Code に寄せた割当）。
 * Ctrl/Cmd+@, Ctrl+`, Ctrl+1 : メインパネルに移動（ターミナル or エディタ）
 * Ctrl/Cmd+L : チャットパネルに移動
 * Ctrl/Cmd+E : エクスプローラーに移動
 * Ctrl/Cmd+R : コネクトリストに移動
 * Ctrl+Tab : タブ移動・進む（メインパネル／チャットでフォーカス時）
 * Ctrl+Shift+Tab : タブ移動・戻る
 */
import { state } from './state';
import * as terminal from './terminal';
import * as chat from './chat';
import * as editor from './editor';

type Api = NonNullable<typeof window.electronAPI>;

const isMod = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

/** メインパネル（中央のタブ領域）にフォーカス。アクティブタブがターミナルならターミナル、エディタならエディタにフォーカス。 */
function focusMainPanel(): void {
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (activeTab?.kind === 'terminal' || activeTab?.kind === 'local-terminal') {
    terminal.focusActiveTerminal();
    return;
  }
  if (activeTab?.kind === 'editor') {
    editor.focusActiveEditor();
    return;
  }
  const panel = document.getElementById('mainPanel');
  if (panel && typeof (panel as HTMLElement).focus === 'function') (panel as HTMLElement).focus();
}

function focusTerminal(): void {
  terminal.focusActiveTerminal();
}

function focusChat(): void {
  const el = document.getElementById('chatInput');
  if (el && el instanceof HTMLTextAreaElement) el.focus();
}

function focusExplorer(): void {
  const el = document.getElementById('explorerTreeContainer');
  if (el && el instanceof HTMLElement) el.focus();
}

function focusConnectList(): void {
  const el = document.getElementById('connectList');
  if (el && el instanceof HTMLElement) el.focus();
}

function switchMainPanelTabNext(api: Api, backward: boolean): void {
  const tabs = state.mainPanelTabs;
  if (tabs.length <= 1) return;
  let idx = tabs.findIndex((t) => t.id === state.activeMainPanelTabId);
  if (idx === -1) idx = backward ? tabs.length - 1 : 0;
  const nextIdx = backward ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
  terminal.switchMainPanelTab(api, tabs[nextIdx].id);
  focusMainPanel();
}

function switchChatTabNext(api: Api, backward: boolean): void {
  const sessions = state.chatSessions;
  if (sessions.length <= 1) return;
  let idx = sessions.findIndex((s) => s.id === state.activeChatSessionId);
  if (idx === -1) idx = backward ? sessions.length - 1 : 0;
  const nextIdx = backward ? (idx - 1 + sessions.length) % sessions.length : (idx + 1) % sessions.length;
  chat.switchChatTab(api, sessions[nextIdx].id);
  focusChat();
}

export function bindFocusShortcuts(api: Api): void {
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const shift = e.shiftKey;

      // diff 表示中は Ctrl+N / Ctrl+Y or Ctrl+Shift+Y を最優先（Monaco に奪われないよう先に処理）
      if (state.pendingDiff && (e.ctrlKey || e.metaKey)) {
        window.electronAPI?.logToMain?.('[AISSH shortcuts] diff key', { key: e.key, keyLower: key, shift, ctrl: e.ctrlKey, meta: e.metaKey });
        if (!shift && key === 'n') {
          window.electronAPI?.logToMain?.('[AISSH shortcuts] → cancelPendingDiff');
          e.preventDefault();
          e.stopPropagation();
          editor.cancelPendingDiff();
          return;
        }
        if (key === 'y') {
          window.electronAPI?.logToMain?.('[AISSH shortcuts] → applyPendingDiff');
          e.preventDefault();
          e.stopPropagation();
          editor.applyPendingDiff(api);
          return;
        }
      }

      // Ctrl+Tab / Ctrl+Shift+Tab : タブ移動（メインパネル or チャット）
      if (isMod(e) && key === 'tab') {
        const inMain = document.activeElement?.closest('#mainPanel');
        const inChat = document.activeElement?.closest('#chatPanel');
        if (inMain && state.mainPanelTabs.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          switchMainPanelTabNext(api, shift);
          return;
        }
        if (inChat && state.chatSessions.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          switchChatTabNext(api, shift);
          return;
        }
      }

      if (!isMod(e)) return;

      // Ctrl+@ / Ctrl+` / Ctrl+1 : メインパネルに移動（VS Code の Ctrl+1 = エディタフォーカスに合わせた）
      if (!shift && (e.key === '`' || e.key === '@' || e.key === '1')) {
        e.preventDefault();
        e.stopPropagation();
        focusMainPanel();
        return;
      }
      // Ctrl+L : チャットパネルに移動
      if (!shift && key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        focusChat();
        return;
      }
      // Ctrl+E : エクスプローラーに移動
      if (!shift && key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        focusExplorer();
        return;
      }
      // Ctrl+R : コネクトリストに移動
      if (!shift && key === 'r') {
        e.preventDefault();
        e.stopPropagation();
        focusConnectList();
        return;
      }
    },
    true,
  );
}

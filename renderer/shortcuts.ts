/**
 * 焦点移动快捷键（参照 Cursor / VS Code 的按键分配）。
 * Ctrl/Cmd+@, Ctrl+`, Ctrl+1 : 切换到主面板（终端或编辑器）
 * Ctrl/Cmd+L : 切换到聊天面板
 * Ctrl/Cmd+E : 切换到资源管理器
 * Ctrl/Cmd+R : 切换到连接列表
 * Ctrl+Tab : 切换标签页（前进）（在主面板/聊天获得焦点时）
 * Ctrl+Shift+Tab : 切换标签页（后退）
 */
import { state } from './state';
import * as terminal from './terminal';
import * as chat from './chat';
import * as editor from './editor';

type Api = NonNullable<typeof window.electronAPI>;

const isMod = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

/** 聚焦主面板（中央标签区域）。活动标签为终端则聚焦终端，为编辑器则聚焦编辑器。 */
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

      // diff 显示期间优先处理 Ctrl+N / Ctrl+Y 或 Ctrl+Shift+Y（防止被 Monaco 拦截）
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

      // Ctrl+Tab / Ctrl+Shift+Tab : 切换标签页（主面板或聊天）
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

      // Ctrl+@ / Ctrl+` / Ctrl+1 : 切换到主面板（与 VS Code 的 Ctrl+1 = 编辑器聚焦一致）
      if (!shift && (e.key === '`' || e.key === '@' || e.key === '1')) {
        e.preventDefault();
        e.stopPropagation();
        focusMainPanel();
        return;
      }
      // Ctrl+L : 切换到聊天面板
      if (!shift && key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        focusChat();
        return;
      }
      // Ctrl+E : 切换到资源管理器
      if (!shift && key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        focusExplorer();
        return;
      }
      // Ctrl+R : 切换到连接列表
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

import type { Terminal } from 'xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { Environment, TerminalTab, ChatMessage, ChatSession, ExplorerEntry, MainPanelTab } from './types';

export const state = {
  selectedId: null as number | null,
  editingId: null as number | null,
  /** envId being connected (non-null = connecting spinner active). */
  connectingId: null as number | null,
  envList: [] as Environment[],

  /** 主面板标签列表（终端/编辑器/DB 等同级排列）。 */
  mainPanelTabs: [] as MainPanelTab[],
  /** 当前活动的主面板标签 id。 */
  activeMainPanelTabId: null as string | null,

  terminalTabs: [] as TerminalTab[],
  activeTabConnectionId: null as number | null,
  nextConnectionId: 1,
  terminalInstances: new Map<number, { term: Terminal; fitAddon: FitAddon; container: HTMLElement }>(),
  /** 本地终端标签的 xterm 实例。key 为主面板的 tab id。 */
  localTerminalInstances: new Map<string, { term: Terminal; fitAddon: FitAddon; container: HTMLElement }>(),
  terminalBufferByConnection: {} as Record<number, string>,
  /** 每个本地终端标签的最近输出（用于聊天上下文）。key 为主面板的 tab id。 */
  localTerminalBufferByTabId: {} as Record<string, string>,
  TERMINAL_BUFFER_MAX: 40000,

  /** 编辑器标签的 Monaco 实例。key 为主面板的 tab id。 */
  editorInstances: new Map<string, { editor: { getValue(): string; setValue(s: string): void; focus(): void; dispose(): void }; container: HTMLElement }>(),
  /** 未保存的编辑器标签。key 为主面板的 tab id。 */
  editorDirtyByTabId: {} as Record<string, boolean>,
  /** 最后保存的内容（用于 Ctrl+Z 回退时取消脏标记）。key 为主面板的 tab id。 */
  editorLastSavedContentByTabId: {} as Record<string, string>,

  /** 应用前的 diff 预览。非 null 时 Ctrl+N / Ctrl+Shift+Y 移动差异块。 */
  pendingDiff: null as {
    tabId: string;
    currentContent: string;
    proposedContent: string;
    hunks: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }>;
    currentHunkIndex: number;
  } | null,

  chatSessions: [] as ChatSession[],
  activeChatSessionId: null as number | null,
  chatMessagesBySession: {} as Record<number, ChatMessage[]>,
  chatLoading: false,
  showThinking: true,
  aiPermissionMode: 'ask' as 'ask' | 'confirm' | 'auto',

  /** Agentic loop: true while auto/confirm command execution loop is running. */
  agentLoopRunning: false,
  /** Set to true to abort the running agent loop. */
  agentLoopAbort: false,
  /** Max turns for agent loop to prevent infinite loops. 30 covers complex multi-step tasks. */
  AGENT_LOOP_MAX_TURNS: 30,
  /** Max terminal output chars to feed back to AI per command. 8 000 chars ≈ 200 lines. */
  AGENT_OUTPUT_MAX_CHARS: 8000,

  /** Explorer 当前显示的目标。'local' 或 connectionId。与终端的 activeTab 独立。 */
  activeExplorerTarget: 'local' as 'local' | number,
  /** 每个目标的 Explorer 状态。key 为 'local' 或 String(connectionId)。 */
  explorerByTarget: {} as Record<string, { home: string | null; loadedPaths: Record<string, ExplorerEntry[]>; expanded: Set<string> }>,
  /** Explorer 中当前选中项的路径（单击设置，双击/回车打开）。 */
  selectedExplorerPath: null as string | null,
  /** 选中项是否为目录（用于决定回车时的行为）。 */
  selectedExplorerIsDir: null as boolean | null,
  /** 本地根目录（getLocalHome 的结果）。用于判断是否禁用"上级"按钮。 */
  localHomeDir: null as string | null,
  /** 右键"复制"保留的路径（用于粘贴）。仅支持本地。 */
  copiedFilePaths: [] as string[],
  /** 复制来源是本地还是 connectionId。 */
  copyTarget: null as 'local' | number | null,

  EXPLORER_HEIGHT_MIN: 80,
  EXPLORER_HEIGHT_MAX: 800,
  SERVER_INFO_HEIGHT_MIN: 80,
  SERVER_INFO_HEIGHT_MAX: 600,
  CHAT_INPUT_HEIGHT_MIN: 48,
  CHAT_INPUT_HEIGHT_MAX: 240,
  chatTextareaHeight: 80,

  sidebarWidth: 280,
  chatPanelWidth: 320,
  sidebarExplorerHeight: 200,
  sidebarServerInfoHeight: 200,
  sidebarServersHeight: 0,
  sidebarCollapsed: { servers: false, explorer: false, serverInfo: false } as Record<string, boolean>,
  _savedExplorerHeight: 0 as number,
  _savedServerInfoHeight: 0 as number,
  showExplorerDetails: true,
};

export function getNextConnectionId(): number {
  const id = state.nextConnectionId;
  state.nextConnectionId += 1;
  return id;
}

/** 从 mainPanelTabs 中提取终端标签为 TerminalTab[]（用于兼容已有代码）。 */
export function getTerminalTabsFromMainPanel(): TerminalTab[] {
  return state.mainPanelTabs
    .filter((t): t is MainPanelTab & { kind: 'terminal' } => t.kind === 'terminal')
    .map((t) => ({ connectionId: t.connectionId, envId: t.envId, name: t.name }));
}

/** 如果活动标签是终端则返回 connectionId（用于兼容已有代码）。 */
export function getActiveConnectionId(): number | null {
  if (!state.activeMainPanelTabId) return null;
  const tab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  return tab?.kind === 'terminal' ? tab.connectionId : null;
}

/** mainPanelTabs 变更后同步 terminalTabs / activeTabConnectionId。 */
export function syncTerminalStateFromMainPanel(): void {
  state.terminalTabs = getTerminalTabsFromMainPanel();
  const active = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  state.activeTabConnectionId = active?.kind === 'terminal' ? active.connectionId : null;
}

export function getExplorerTargetKey(target: 'local' | number): string {
  return target === 'local' ? 'local' : String(target);
}

export function getExplorerState(target: 'local' | number): {
  home: string | null;
  loadedPaths: Record<string, ExplorerEntry[]>;
  expanded: Set<string>;
} {
  const key = getExplorerTargetKey(target);
  if (!state.explorerByTarget[key]) {
    state.explorerByTarget[key] = {
      home: null,
      loadedPaths: {},
      expanded: new Set(),
    };
  }
  return state.explorerByTarget[key];
}

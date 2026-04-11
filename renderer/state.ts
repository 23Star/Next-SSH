import type { Terminal } from 'xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { Environment, TerminalTab, ChatMessage, ChatSession, ExplorerEntry, MainPanelTab } from './types';

export const state = {
  selectedId: null as number | null,
  editingId: null as number | null,
  envList: [] as Environment[],

  /** メインパネルのタブ一覧（ターミナル／エディタ／DB などを同列で並べる）。 */
  mainPanelTabs: [] as MainPanelTab[],
  /** 現在アクティブなメインパネルタブの id。 */
  activeMainPanelTabId: null as string | null,

  terminalTabs: [] as TerminalTab[],
  activeTabConnectionId: null as number | null,
  nextConnectionId: 1,
  terminalInstances: new Map<number, { term: Terminal; fitAddon: FitAddon; container: HTMLElement }>(),
  /** ローカルターミナルタブの xterm インスタンス。key は mainPanel の tab id。 */
  localTerminalInstances: new Map<string, { term: Terminal; fitAddon: FitAddon; container: HTMLElement }>(),
  terminalBufferByConnection: {} as Record<number, string>,
  /** ローカルターミナルタブごとの直近出力（チャットコンテキスト用）。key は mainPanel の tab id。 */
  localTerminalBufferByTabId: {} as Record<string, string>,
  TERMINAL_BUFFER_MAX: 40000,

  /** エディタタブの Monaco インスタンス。key は mainPanel の tab id。 */
  editorInstances: new Map<string, { editor: { getValue(): string; setValue(s: string): void; focus(): void; dispose(): void }; container: HTMLElement }>(),
  /** 未保存のエディタタブ。key は mainPanel の tab id。 */
  editorDirtyByTabId: {} as Record<string, boolean>,
  /** 最後に保存した内容（Ctrl+Z で戻ったときに ● を消す用）。key は mainPanel の tab id。 */
  editorLastSavedContentByTabId: {} as Record<string, string>,

  /** 適用前の diff プレビュー。null でないとき Ctrl+N / Ctrl+Shift+Y でハンク移動。 */
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

  /** Explorer で今表示しているターゲット。'local' または connectionId。ターミナルの activeTab とは独立。 */
  activeExplorerTarget: 'local' as 'local' | number,
  /** ターゲットごとの Explorer 状態。key は 'local' または String(connectionId)。 */
  explorerByTarget: {} as Record<string, { home: string | null; loadedPaths: Record<string, ExplorerEntry[]>; expanded: Set<string> }>,
  /** Explorer で現在選択している項目のパス（シングルクリックで設定。ダブルクリック／Enter で開く）。 */
  selectedExplorerPath: null as string | null,
  /** 選択項目がディレクトリか（Enter 時の挙動に使用）。 */
  selectedExplorerIsDir: null as boolean | null,
  /** ローカルルート（getLocalHome の結果）。「上へ」の無効判定に使用。 */
  localHomeDir: null as string | null,
  /** 右クリック「コピー」で保持したパス（貼り付け用）。ローカルのみ対応。 */
  copiedFilePaths: [] as string[],
  /** コピー元がローカルか connectionId。 */
  copyTarget: null as 'local' | number | null,

  EXPLORER_HEIGHT_MIN: 80,
  EXPLORER_HEIGHT_MAX: 800,
  CHAT_INPUT_HEIGHT_MIN: 48,
  CHAT_INPUT_HEIGHT_MAX: 240,
  chatTextareaHeight: 80,

  sidebarWidth: 280,
  chatPanelWidth: 320,
  sidebarExplorerHeight: 200,
};

export function getNextConnectionId(): number {
  const id = state.nextConnectionId;
  state.nextConnectionId += 1;
  return id;
}

/** mainPanelTabs から terminal だけを取り出し TerminalTab[] に（既存コード互換用）。 */
export function getTerminalTabsFromMainPanel(): TerminalTab[] {
  return state.mainPanelTabs
    .filter((t): t is MainPanelTab & { kind: 'terminal' } => t.kind === 'terminal')
    .map((t) => ({ connectionId: t.connectionId, envId: t.envId, name: t.name }));
}

/** アクティブなタブがターミナルなら connectionId を返す（既存コード互換用）。 */
export function getActiveConnectionId(): number | null {
  if (!state.activeMainPanelTabId) return null;
  const tab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  return tab?.kind === 'terminal' ? tab.connectionId : null;
}

/** mainPanelTabs 変更後に terminalTabs / activeTabConnectionId を同期する。 */
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

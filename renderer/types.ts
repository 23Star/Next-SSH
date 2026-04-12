export interface Environment {
  id: number;
  name: string | null;
  host: string;
  port: number;
  username: string;
  authType: string;
  password: string | null;
  privateKeyPath: string | null;
  memo: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalTab {
  connectionId: number;
  envId: number;
  name: string;
}

export type MainPanelTab =
  | { id: string; kind: 'terminal'; connectionId: number; envId: number; name: string }
  | { id: string; kind: 'local-terminal' }
  | { id: string; kind: 'editor'; filePath: string; label: string; target: 'local' | number }
  ;

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string | null;
  thinkingDurationMs?: number | null;
  suggestedCommands?: string[] | null;
}

export interface ChatSession {
  id: number;
  title: string;
}

export interface ExplorerEntry {
  name: string;
  isDirectory: boolean;
  size?: string;
  mtime?: string;
  permissions?: string;
}

export interface ServerInfo {
  hostname: string;
  os: string;
  kernel: string;
  cpuCores: number;
  cpuModel: string;
  memoryTotal: string;
  memoryUsed: string;
  diskTotal: string;
  diskUsed: string;
  diskPercent: string;
  uptime: string;
  serverTime: string;
}

declare global {
  interface Window {
    electronAPI?: {
      ping: () => Promise<string>;
      logToMain?: (...args: unknown[]) => Promise<void>;
      terminal?: {
        connect: (connectionId: number, envId: number, passphrase: string | null) => Promise<void>;
        disconnect: (connectionId: number) => Promise<void>;
        write: (connectionId: number, data: string) => Promise<boolean>;
        resize: (connectionId: number, rows: number, cols: number, height?: number, width?: number) => Promise<boolean>;
        onData: (callback: (payload: { connectionId: number; data: string }) => void) => void;
        localConnect: (tabId: string) => Promise<void>;
        localWrite: (tabId: string, data: string) => Promise<boolean>;
        localResize: (tabId: string, cols: number, rows: number) => Promise<boolean>;
        localDisconnect: (tabId: string) => Promise<void>;
        onLocalData: (callback: (payload: { tabId: string; data: string }) => void) => void;
      };
      environment: {
        list: () => Promise<Environment[]>;
        create: (input: Record<string, unknown>) => Promise<Environment>;
        update: (id: number, input: Record<string, unknown>) => Promise<Environment | null>;
        delete: (id: number) => Promise<boolean>;
        testConnection: (host: string, port: number) => Promise<boolean>;
      };
      chat?: {
        complete: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>;
        streamStart: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, enableThinking?: boolean) => void;
        onStreamChunk: (callback: (chunk: { type: 'content' | 'thinking' | 'thinking_end' | 'done' | 'error'; text: string; durationMs?: number }) => void) => void;
      };
      chatSession?: {
        list: () => Promise<Array<{ id: number; title: string; createdAt: string; updatedAt: string }>>;
        create: (title?: string | null) => Promise<{ id: number; title: string; createdAt: string; updatedAt: string }>;
        update: (id: number, input: { title?: string }) => Promise<{ id: number; title: string; createdAt: string; updatedAt: string } | null>;
        delete: (id: number) => Promise<boolean>;
      };
      chatContext?: {
        listBySession: (sessionId: number) => Promise<Array<{ id: number; sessionId: number; role: string; content: string; thinking: string | null; thinkingDurationMs: number | null; suggestedCommands: string[] | null; createdAt: string }>>;
        add: (sessionId: number, role: string, content: string, suggestedCommands?: string[] | null, thinking?: string | null, thinkingDurationMs?: number | null) => Promise<{ id: number; sessionId: number; role: string; content: string; thinking: string | null; thinkingDurationMs: number | null; suggestedCommands: string[] | null; createdAt: string }>;
        deleteByIds: (ids: number[]) => Promise<void>;
      };
      serveroutput?: {
        get: (connectionId: number) => Promise<string>;
        append: (connectionId: number, data: string) => Promise<void>;
      };
      serverInfo?: {
        get: (connectionId: number) => Promise<ServerInfo>;
      };
      explorer?: {
        getHome: (connectionId: number) => Promise<string>;
        listDirectory: (connectionId: number, dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>;
        getLocalHome: () => Promise<string>;
        listLocalDirectory: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>;
        getLocalParent: (dirPath: string) => Promise<string>;
        readLocalFile: (filePath: string) => Promise<string>;
        writeLocalFile: (filePath: string, content: string) => Promise<void>;
        readRemoteFile: (connectionId: number, remotePath: string) => Promise<string>;
        writeRemoteFile: (connectionId: number, remotePath: string, content: string) => Promise<void>;
        getRemoteFileSize: (connectionId: number, remotePath: string) => Promise<number>;
        getLocalFileSize: (filePath: string) => Promise<number>;
        startDrag: (filePath: string) => Promise<void>;
        copyToFolder: (sourcePaths: string[], targetDir: string) => Promise<void>;
        renamePath: (oldPath: string, newName: string) => Promise<void>;
        deletePath: (filePath: string) => Promise<void>;
        downloadToDestination: (sourcePaths: string[]) => Promise<{ ok: boolean }>;
        downloadFromRemote: (connectionId: number, remotePaths: string[]) => Promise<{ ok: boolean }>;
        uploadToRemote: (connectionId: number, localPaths: string[], remoteDir: string) => Promise<void>;
        copyOnRemote: (connectionId: number, sourcePaths: string[], targetDir: string) => Promise<void>;
      };
      locale?: {
        get: () => Promise<'en' | 'zn' | 'ru'>;
        set: (locale: 'en' | 'zn' | 'ru') => Promise<void>;
        getLangPack: (locale: 'en' | 'zn' | 'ru') => Promise<Record<string, string>>;
        onChanged: (callback: (locale: 'en' | 'zn' | 'ru') => void) => void;
      };
      theme?: {
        get: () => Promise<'dark' | 'light'>;
        set: (theme: 'dark' | 'light') => Promise<void>;
        onChanged: (callback: (theme: 'dark' | 'light') => void) => void;
      };
      openExternal?: (url: string) => Promise<void>;
      refocusWindow?: () => Promise<void>;
      settings?: {
        onOpen: (callback: () => void) => void;
      };
      aiSettings?: {
        get: () => Promise<{ apiUrl: string; apiKeyMasked: string; model: string; temperature: number; maxTokens: number; systemPrompt: string }>;
        set: (input: { apiUrl: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string }) => Promise<void>;
        test: () => Promise<{ ok: boolean; message: string }>;
        isConfigured: () => Promise<boolean>;
        getModels: () => Promise<{ ok: boolean; models: Array<{ id: string; owned_by: string }>; error: string }>;
        getPresets: () => Promise<Array<{ name: string; apiUrl: string; model: string }>>;
      };
    };
  }
}

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Electron 28 contextBridgeByteString fix:
 * - Structured Clone (used for objects) handles all Unicode fine
 * - ByteString conversion (used for string args/returns) fails for chars > 255
 * - Therefore: always pass OBJECTS through contextBridge, never raw strings
 * - For functions that need to pass/receive strings, wrap in { v: string }
 */

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('ping'),
  logToMain: (...args: unknown[]) => ipcRenderer.invoke('log:toMain', ...args),
  terminal: {
    connect: (connectionId: number, envId: number, passphrase: string | null) =>
      ipcRenderer.invoke('terminal:connect', connectionId, envId, passphrase),
    disconnect: (connectionId: number) => ipcRenderer.invoke('terminal:disconnect', connectionId),
    write: (connectionId: number, data: string) =>
      ipcRenderer.invoke('terminal:write', connectionId, { v: data }),
    resize: (connectionId: number, rows: number, cols: number, height?: number, width?: number) =>
      ipcRenderer.invoke('terminal:resize', connectionId, rows, cols, height, width),
    onData: (callback: (payload: { connectionId: number; data: string }) => void) => {
      ipcRenderer.on('terminal:data', (_event, payload: { connectionId: number; data: string }) =>
        callback(payload),
      );
    },
    localConnect: (tabId: string) => ipcRenderer.invoke('terminal:localConnect', tabId),
    localWrite: (tabId: string, data: string) =>
      ipcRenderer.invoke('terminal:localWrite', tabId, { v: data }),
    localResize: (tabId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:localResize', tabId, cols, rows),
    localDisconnect: (tabId: string) => ipcRenderer.invoke('terminal:localDisconnect', tabId),
    onLocalData: (callback: (payload: { tabId: string; data: string }) => void) => {
      ipcRenderer.on('terminal:localData', (_event, payload: { tabId: string; data: string }) =>
        callback(payload),
      );
    },
    exec: (connectionId: number, command: string, timeoutMs?: number) =>
      ipcRenderer.invoke('terminal:exec', connectionId, { v: command }, timeoutMs) as Promise<{ stdout: string; stderr: string; exitCode: number | null }>,
    localExec: (command: string, timeoutMs?: number) =>
      ipcRenderer.invoke('terminal:localExec', { v: command }, timeoutMs) as Promise<{ stdout: string; stderr: string; exitCode: number | null }>,
  },
  environment: {
    list: () => ipcRenderer.invoke('environment:list'),
    create: (input: Record<string, unknown>) => ipcRenderer.invoke('environment:create', input),
    update: (id: number, input: Record<string, unknown>) => ipcRenderer.invoke('environment:update', id, input),
    delete: (id: number) => ipcRenderer.invoke('environment:delete', id),
    testConnection: (host: string, port: number) => ipcRenderer.invoke('environment:testConnection', host, port) as Promise<boolean>,
  },
  chat: {
    complete: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) =>
      ipcRenderer.invoke('chat:complete', messages).then((r: { v: string }) => r.v),
    streamStart: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, thinkingConfig?: { mode: 'adaptive' | 'enabled' | 'disabled'; budgetTokens?: number } | boolean) =>
      ipcRenderer.invoke('chat:streamStart', messages, thinkingConfig ?? { mode: 'adaptive' }),
    onStreamChunk: (callback: (chunk: { type: 'content' | 'thinking' | 'done' | 'error'; text: string }) => void) => {
      ipcRenderer.removeAllListeners('chat:streamChunk');
      ipcRenderer.on('chat:streamChunk', (_event, chunk: { type: 'content' | 'thinking' | 'done' | 'error'; text: string }) =>
        callback(chunk),
      );
    },
  },
  chatSession: {
    list: () => ipcRenderer.invoke('chatSession:list'),
    create: (title?: string | null) => ipcRenderer.invoke('chatSession:create', title ? { v: title } : null),
    update: (id: number, input: { title?: string }) => ipcRenderer.invoke('chatSession:update', id, input),
    delete: (id: number) => ipcRenderer.invoke('chatSession:delete', id),
  },
  chatContext: {
    listBySession: (sessionId: number) => ipcRenderer.invoke('chatContext:listBySession', sessionId),
    add: (sessionId: number, role: string, content: string, suggestedCommands?: string[] | null, thinking?: string | null, thinkingDurationMs?: number | null) =>
      ipcRenderer.invoke('chatContext:add', sessionId, role, { v: content }, suggestedCommands, thinking ? { v: thinking } : null, thinkingDurationMs ?? null),
    deleteByIds: (ids: number[]) => ipcRenderer.invoke('chatContext:deleteByIds', ids),
  },
  serveroutput: {
    get: (connectionId: number) => ipcRenderer.invoke('serveroutput:get', connectionId),
    append: (connectionId: number, data: string) =>
      ipcRenderer.invoke('serveroutput:append', connectionId, { v: data }),
  },
  explorer: {
    getHome: (connectionId: number) => ipcRenderer.invoke('explorer:getHome', connectionId).then((r: { v: string }) => r.v),
    listDirectory: (connectionId: number, dirPath: string) =>
      ipcRenderer.invoke('explorer:listDirectory', connectionId, { v: dirPath }),
    getLocalHome: () => ipcRenderer.invoke('explorer:getLocalHome').then((r: { v: string }) => r.v),
    listLocalDirectory: (dirPath: string) =>
      ipcRenderer.invoke('explorer:listLocalDirectory', { v: dirPath }),
    getLocalParent: (dirPath: string) => ipcRenderer.invoke('explorer:getLocalParent', { v: dirPath }).then((r: { v: string }) => r.v),
    readLocalFile: (filePath: string) => ipcRenderer.invoke('explorer:readLocalFile', { v: filePath }).then((r: { v: string }) => r.v),
    writeLocalFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('explorer:writeLocalFile', { v: filePath }, { v: content }),
    readRemoteFile: (connectionId: number, remotePath: string) =>
      ipcRenderer.invoke('explorer:readRemoteFile', connectionId, { v: remotePath }).then((r: { v: string }) => r.v),
    writeRemoteFile: (connectionId: number, remotePath: string, content: string) =>
      ipcRenderer.invoke('explorer:writeRemoteFile', connectionId, { v: remotePath }, { v: content }),
    getRemoteFileSize: (connectionId: number, remotePath: string) =>
      ipcRenderer.invoke('explorer:getRemoteFileSize', connectionId, { v: remotePath }).then((r: { v: number }) => r.v),
    getLocalFileSize: (filePath: string) =>
      ipcRenderer.invoke('explorer:getLocalFileSize', { v: filePath }).then((r: { v: number }) => r.v),
    startDrag: (filePath: string) => ipcRenderer.sendSync('explorer:startDrag', filePath),
    copyToFolder: (sourcePaths: string[], targetDir: string) =>
      ipcRenderer.invoke('explorer:copyToFolder', sourcePaths, { v: targetDir }),
    renamePath: (oldPath: string, newName: string) =>
      ipcRenderer.invoke('explorer:renamePath', { v: oldPath }, { v: newName }),
    deletePath: (filePath: string) => ipcRenderer.invoke('explorer:deletePath', { v: filePath }),
    downloadToDestination: (sourcePaths: string[]) =>
      ipcRenderer.invoke('explorer:downloadToDestination', sourcePaths) as Promise<{ ok: boolean }>,
    downloadFromRemote: (connectionId: number, remotePaths: string[]) =>
      ipcRenderer.invoke('explorer:downloadFromRemote', connectionId, remotePaths) as Promise<{ ok: boolean }>,
    uploadToRemote: (connectionId: number, localPaths: string[], remoteDir: string) =>
      ipcRenderer.invoke('explorer:uploadToRemote', connectionId, localPaths, { v: remoteDir }),
    copyOnRemote: (connectionId: number, sourcePaths: string[], targetDir: string) =>
      ipcRenderer.invoke('explorer:copyOnRemote', connectionId, sourcePaths, { v: targetDir }),
    pickLocalFiles: () => ipcRenderer.invoke('explorer:pickLocalFiles') as Promise<string[]>,
  },
  serverInfo: {
    get: (connectionId: number) => ipcRenderer.invoke('serverInfo:get', connectionId),
  },
  locale: {
    get: () => ipcRenderer.invoke('locale:get') as Promise<'en' | 'zn' | 'ru'>,
    set: (locale: 'en' | 'zn' | 'ru') => ipcRenderer.invoke('locale:set', locale),
    getLangPack: (locale: 'en' | 'zn' | 'ru') => ipcRenderer.invoke('locale:getLangPack', { v: locale }),
    onChanged: (callback: (locale: 'en' | 'zn' | 'ru') => void) => {
      ipcRenderer.on('locale-changed', (_event, locale: 'en' | 'zn' | 'ru') => callback(locale));
    },
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get') as Promise<'dark' | 'light'>,
    set: (theme: 'dark' | 'light') => ipcRenderer.invoke('theme:set', theme),
    onChanged: (callback: (theme: 'dark' | 'light') => void) => {
      ipcRenderer.on('theme-changed', (_event, theme: 'dark' | 'light') => callback(theme));
    },
  },
  openExternal: (url: string) => ipcRenderer.invoke('openExternal', url),
  refocusWindow: () => ipcRenderer.invoke('window:refocus'),
  settings: {
    onOpen: (callback: () => void) => {
      ipcRenderer.on('open-settings', () => callback());
    },
  },
  aiSettings: {
    get: () => ipcRenderer.invoke('aiSettings:get'),
    getRaw: () => ipcRenderer.invoke('aiSettings:getRaw') as Promise<{ apiUrl: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string }>,
    set: (input: { apiUrl: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string }) =>
      ipcRenderer.invoke('aiSettings:set', input),
    test: () => ipcRenderer.invoke('aiSettings:test') as Promise<{ ok: boolean; message: string }>,
    isConfigured: () => ipcRenderer.invoke('aiSettings:isConfigured') as Promise<boolean>,
    getModels: () => ipcRenderer.invoke('aiSettings:getModels') as Promise<{ ok: boolean; models: Array<{ id: string; owned_by: string }>; error: string }>,
    getPresets: () => ipcRenderer.invoke('aiSettings:getPresets') as Promise<Array<{ name: string; apiUrl: string; model: string }>>,
  },
});

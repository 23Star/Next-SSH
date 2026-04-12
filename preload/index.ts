import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('ping'),
  logToMain: (...args: unknown[]) => ipcRenderer.invoke('log:toMain', ...args),
  terminal: {
    connect: (connectionId: number, envId: number, passphrase: string | null) =>
      ipcRenderer.invoke('terminal:connect', connectionId, envId, passphrase),
    disconnect: (connectionId: number) => ipcRenderer.invoke('terminal:disconnect', connectionId),
    write: (connectionId: number, data: string) => ipcRenderer.invoke('terminal:write', connectionId, data),
    resize: (connectionId: number, rows: number, cols: number, height?: number, width?: number) =>
      ipcRenderer.invoke('terminal:resize', connectionId, rows, cols, height, width),
    onData: (callback: (payload: { connectionId: number; data: string }) => void) => {
      ipcRenderer.on('terminal:data', (_event, payload: { connectionId: number; data: string }) =>
        callback(payload),
      );
    },
    localConnect: (tabId: string) => ipcRenderer.invoke('terminal:localConnect', tabId),
    localWrite: (tabId: string, data: string) => ipcRenderer.invoke('terminal:localWrite', tabId, data),
    localResize: (tabId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:localResize', tabId, cols, rows),
    localDisconnect: (tabId: string) => ipcRenderer.invoke('terminal:localDisconnect', tabId),
    onLocalData: (callback: (payload: { tabId: string; data: string }) => void) => {
      ipcRenderer.on('terminal:localData', (_event, payload: { tabId: string; data: string }) =>
        callback(payload),
      );
    },
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
      ipcRenderer.invoke('chat:complete', messages),
    streamStart: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) =>
      ipcRenderer.invoke('chat:streamStart', JSON.stringify(messages)),
    onStreamChunk: (callback: (chunk: { type: 'content' | 'thinking' | 'done' | 'error'; text: string }) => void) => {
      ipcRenderer.removeAllListeners('chat:streamChunk');
      ipcRenderer.on('chat:streamChunk', (_event, chunk) => callback(chunk));
    },
  },
  chatSession: {
    list: () => ipcRenderer.invoke('chatSession:list'),
    create: (title?: string | null) => ipcRenderer.invoke('chatSession:create', title),
    update: (id: number, input: { title?: string }) => ipcRenderer.invoke('chatSession:update', id, input),
    delete: (id: number) => ipcRenderer.invoke('chatSession:delete', id),
  },
  chatContext: {
    listBySession: (sessionId: number) => ipcRenderer.invoke('chatContext:listBySession', sessionId),
    add: (sessionId: number, role: string, content: string, suggestedCommands?: string[] | null) =>
      ipcRenderer.invoke('chatContext:add', sessionId, role, content, suggestedCommands),
    deleteByIds: (ids: number[]) => ipcRenderer.invoke('chatContext:deleteByIds', ids),
  },
  serveroutput: {
    get: (connectionId: number) => ipcRenderer.invoke('serveroutput:get', connectionId),
    append: (connectionId: number, data: string) => ipcRenderer.invoke('serveroutput:append', connectionId, data),
  },
  explorer: {
    getHome: (connectionId: number) => ipcRenderer.invoke('explorer:getHome', connectionId),
    listDirectory: (connectionId: number, dirPath: string) =>
      ipcRenderer.invoke('explorer:listDirectory', connectionId, dirPath),
    getLocalHome: () => ipcRenderer.invoke('explorer:getLocalHome') as Promise<string>,
    listLocalDirectory: (dirPath: string) =>
      ipcRenderer.invoke('explorer:listLocalDirectory', dirPath) as Promise<Array<{ name: string; isDirectory: boolean }>>,
    getLocalParent: (dirPath: string) => ipcRenderer.invoke('explorer:getLocalParent', dirPath) as Promise<string>,
    readLocalFile: (filePath: string) => ipcRenderer.invoke('explorer:readLocalFile', filePath) as Promise<string>,
    writeLocalFile: (filePath: string, content: string) => ipcRenderer.invoke('explorer:writeLocalFile', filePath, content),
    readRemoteFile: (connectionId: number, remotePath: string) =>
      ipcRenderer.invoke('explorer:readRemoteFile', connectionId, remotePath) as Promise<string>,
    writeRemoteFile: (connectionId: number, remotePath: string, content: string) =>
      ipcRenderer.invoke('explorer:writeRemoteFile', connectionId, remotePath, content),
    startDrag: (filePath: string) => ipcRenderer.sendSync('explorer:startDrag', filePath),
    copyToFolder: (sourcePaths: string[], targetDir: string) =>
      ipcRenderer.invoke('explorer:copyToFolder', sourcePaths, targetDir),
    renamePath: (oldPath: string, newName: string) => ipcRenderer.invoke('explorer:renamePath', oldPath, newName),
    deletePath: (filePath: string) => ipcRenderer.invoke('explorer:deletePath', filePath),
    downloadToDestination: (sourcePaths: string[]) =>
      ipcRenderer.invoke('explorer:downloadToDestination', sourcePaths) as Promise<{ ok: boolean }>,
    downloadFromRemote: (connectionId: number, remotePaths: string[]) =>
      ipcRenderer.invoke('explorer:downloadFromRemote', connectionId, remotePaths) as Promise<{ ok: boolean }>,
    uploadToRemote: (connectionId: number, localPaths: string[], remoteDir: string) =>
      ipcRenderer.invoke('explorer:uploadToRemote', connectionId, localPaths, remoteDir),
    copyOnRemote: (connectionId: number, sourcePaths: string[], targetDir: string) =>
      ipcRenderer.invoke('explorer:copyOnRemote', connectionId, sourcePaths, targetDir),
  },
  serverInfo: {
    get: (connectionId: number) => ipcRenderer.invoke('serverInfo:get', connectionId),
  },
  locale: {
    get: () => ipcRenderer.invoke('locale:get') as Promise<'en' | 'zn' | 'ru'>,
    set: (locale: 'en' | 'zn' | 'ru') => ipcRenderer.invoke('locale:set', locale),
    getLangPack: (locale: 'en' | 'zn' | 'ru') => ipcRenderer.invoke('locale:getLangPack', locale) as Promise<Record<string, string>>,
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
    set: (input: { apiUrl: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string }) =>
      ipcRenderer.invoke('aiSettings:set', input),
    test: () => ipcRenderer.invoke('aiSettings:test') as Promise<{ ok: boolean; message: string }>,
    isConfigured: () => ipcRenderer.invoke('aiSettings:isConfigured') as Promise<boolean>,
    getModels: () => ipcRenderer.invoke('aiSettings:getModels') as Promise<{ ok: boolean; models: Array<{ id: string; owned_by: string }>; error: string }>,
    getPresets: () => ipcRenderer.invoke('aiSettings:getPresets') as Promise<Array<{ name: string; apiUrl: string; model: string }>>,
  },
});

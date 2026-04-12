import { contextBridge, ipcRenderer } from 'electron';

/**
 * Wrapper: send arg as JSON string, receive JSON string back.
 * Avoids Electron 28 contextBridge ByteString encoding errors for chars > 255 (e.g. •, Chinese).
 */
function jj(channel: string, ...args: unknown[]): Promise<string> {
  return ipcRenderer.invoke(channel, ...args.map((a) => JSON.stringify(a))) as Promise<string>;
}

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
      ipcRenderer.on('terminal:data', (_event, payloadJson: string) => {
        try { callback(JSON.parse(payloadJson)); } catch { /* ignore */ }
      });
    },
    localConnect: (tabId: string) => ipcRenderer.invoke('terminal:localConnect', tabId),
    localWrite: (tabId: string, data: string) => ipcRenderer.invoke('terminal:localWrite', tabId, data),
    localResize: (tabId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:localResize', tabId, cols, rows),
    localDisconnect: (tabId: string) => ipcRenderer.invoke('terminal:localDisconnect', tabId),
    onLocalData: (callback: (payload: { tabId: string; data: string }) => void) => {
      ipcRenderer.on('terminal:localData', (_event, payloadJson: string) => {
        try { callback(JSON.parse(payloadJson)); } catch { /* ignore */ }
      });
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
      jj('chat:complete', messages).then((r) => JSON.parse(r)),
    streamStart: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) =>
      ipcRenderer.invoke('chat:streamStart', JSON.stringify(messages)),
    onStreamChunk: (callback: (chunk: { type: 'content' | 'thinking' | 'done' | 'error'; text: string }) => void) => {
      ipcRenderer.removeAllListeners('chat:streamChunk');
      ipcRenderer.on('chat:streamChunk', (_event, chunkJson: string) => callback(JSON.parse(chunkJson)));
    },
  },
  chatSession: {
    list: () => jj('chatSession:list').then((r) => JSON.parse(r)),
    create: (title?: string | null) => jj('chatSession:create', title).then((r) => JSON.parse(r)),
    update: (id: number, input: { title?: string }) => jj('chatSession:update', id, input),
    delete: (id: number) => jj('chatSession:delete', id),
  },
  chatContext: {
    listBySession: (sessionId: number) => jj('chatContext:listBySession', sessionId).then((r) => JSON.parse(r)),
    add: (sessionId: number, role: string, content: string, suggestedCommands?: string[] | null) =>
      jj('chatContext:add', sessionId, role, content, suggestedCommands).then((r) => JSON.parse(r)),
    deleteByIds: (ids: number[]) => jj('chatContext:deleteByIds', ids),
  },
  serveroutput: {
    get: (connectionId: number) => jj('serveroutput:get', connectionId).then((r) => JSON.parse(r)),
    append: (connectionId: number, data: string) => jj('serveroutput:append', connectionId, data),
  },
  explorer: {
    getHome: (connectionId: number) => jj('explorer:getHome', connectionId).then((r) => JSON.parse(r)),
    listDirectory: (connectionId: number, dirPath: string) =>
      jj('explorer:listDirectory', connectionId, dirPath).then((r) => JSON.parse(r)),
    getLocalHome: () => jj('explorer:getLocalHome').then((r) => JSON.parse(r)) as Promise<string>,
    listLocalDirectory: (dirPath: string) =>
      jj('explorer:listLocalDirectory', dirPath).then((r) => JSON.parse(r)) as Promise<Array<{ name: string; isDirectory: boolean }>>,
    getLocalParent: (dirPath: string) => jj('explorer:getLocalParent', dirPath).then((r) => JSON.parse(r)) as Promise<string>,
    readLocalFile: (filePath: string) => jj('explorer:readLocalFile', filePath).then((r) => JSON.parse(r)) as Promise<string>,
    writeLocalFile: (filePath: string, content: string) => jj('explorer:writeLocalFile', filePath, content),
    readRemoteFile: (connectionId: number, remotePath: string) =>
      jj('explorer:readRemoteFile', connectionId, remotePath).then((r) => JSON.parse(r)) as Promise<string>,
    writeRemoteFile: (connectionId: number, remotePath: string, content: string) =>
      jj('explorer:writeRemoteFile', connectionId, remotePath, content),
    getRemoteFileSize: (connectionId: number, remotePath: string) =>
      jj('explorer:getRemoteFileSize', connectionId, remotePath).then((r) => JSON.parse(r)) as Promise<number>,
    getLocalFileSize: (filePath: string) =>
      jj('explorer:getLocalFileSize', filePath).then((r) => JSON.parse(r)) as Promise<number>,
    startDrag: (filePath: string) => ipcRenderer.sendSync('explorer:startDrag', filePath),
    copyToFolder: (sourcePaths: string[], targetDir: string) =>
      jj('explorer:copyToFolder', sourcePaths, targetDir),
    renamePath: (oldPath: string, newName: string) => jj('explorer:renamePath', oldPath, newName),
    deletePath: (filePath: string) => jj('explorer:deletePath', filePath),
    downloadToDestination: (sourcePaths: string[]) =>
      jj('explorer:downloadToDestination', sourcePaths).then((r) => JSON.parse(r)) as Promise<{ ok: boolean }>,
    downloadFromRemote: (connectionId: number, remotePaths: string[]) =>
      jj('explorer:downloadFromRemote', connectionId, remotePaths).then((r) => JSON.parse(r)) as Promise<{ ok: boolean }>,
    uploadToRemote: (connectionId: number, localPaths: string[], remoteDir: string) =>
      jj('explorer:uploadToRemote', connectionId, localPaths, remoteDir),
    copyOnRemote: (connectionId: number, sourcePaths: string[], targetDir: string) =>
      jj('explorer:copyOnRemote', connectionId, sourcePaths, targetDir),
  },
  serverInfo: {
    get: (connectionId: number) => jj('serverInfo:get', connectionId).then((r) => JSON.parse(r)),
  },
  locale: {
    get: () => ipcRenderer.invoke('locale:get') as Promise<'en' | 'zn' | 'ru'>,
    set: (locale: 'en' | 'zn' | 'ru') => ipcRenderer.invoke('locale:set', locale),
    getLangPack: (locale: 'en' | 'zn' | 'ru') =>
      jj('locale:getLangPack', locale).then((r) => JSON.parse(r)) as Promise<Record<string, string>>,
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
    get: () => ipcRenderer.invoke('aiSettings:get').then((r: string) => JSON.parse(r)),
    set: (input: { apiUrl: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string }) =>
      ipcRenderer.invoke('aiSettings:set', JSON.stringify(input)),
    test: () => ipcRenderer.invoke('aiSettings:test').then((r: string) => JSON.parse(r)) as Promise<{ ok: boolean; message: string }>,
    isConfigured: () => ipcRenderer.invoke('aiSettings:isConfigured') as Promise<boolean>,
    getModels: () => ipcRenderer.invoke('aiSettings:getModels').then((r: string) => JSON.parse(r)) as Promise<{ ok: boolean; models: Array<{ id: string; owned_by: string }>; error: string }>,
    getPresets: () => ipcRenderer.invoke('aiSettings:getPresets').then((r: string) => JSON.parse(r)) as Promise<Array<{ name: string; apiUrl: string; model: string }>>,
  },
});

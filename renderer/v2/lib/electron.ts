// Typed accessors for the preload bridge.
//
// We don't re-declare the full `window.electronAPI` surface here — that lives
// in renderer/types.ts as a `declare global`. This module just provides
// runtime helpers that narrow the optional fields so pages don't have to
// check `electronAPI?` everywhere.

export type Environment = import('../../types').Environment;
export type ExecResult = import('../../types').ExecResult;

export function getApi() {
  const api = window.electronAPI;
  if (!api) throw new Error('electronAPI bridge not available (renderer running outside Electron?)');
  return api;
}

export function getTerminal() {
  const api = getApi();
  if (!api.terminal) throw new Error('electronAPI.terminal not available');
  return api.terminal;
}

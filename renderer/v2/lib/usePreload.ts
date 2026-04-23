// Data preloader — fetches page data sequentially on connect and caches it.
//
// When an SSH connection is established, this hook kicks off a series of
// sequential data fetches (services, processes, firewall, cron, docker) and
// stores results in the session cache. Pages can then read from cache immediately
// on mount, avoiding the white-flash "loading" state.

import { useEffect, useRef } from 'react';
import { getTerminal } from './electron';
import { writeCache, readCache } from './cache';

// Cache keys for each page's data
export const CACHE_KEYS = {
  services: 'page:services',
  processes: 'page:processes',
  processesSummary: 'page:processes:summary',
  cron: 'page:cron',
  firewall: 'page:firewall',
  docker: 'page:docker',
} as const;

async function preloadServices(connectionId: number): Promise<void> {
  try {
    const term = getTerminal();
    const res = await term.exec(
      connectionId,
      'systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null',
      30000,
    );
    writeCache(CACHE_KEYS.services, res.stdout || '');
  } catch { /* best effort */ }
}

async function preloadProcesses(connectionId: number): Promise<void> {
  try {
    const term = getTerminal();
    const [psRes, topRes] = await Promise.all([
      term.exec(
        connectionId,
        'ps -eo pid,user,%cpu,%mem,vsz,rss,tty,stat,start,time,command --sort=-%cpu 2>/dev/null | head -n 101',
        25000,
      ),
      term.exec(connectionId, 'top -b -n 1 2>/dev/null | head -n 10', 15000),
    ]);
    writeCache(CACHE_KEYS.processes, psRes.stdout || '');
    writeCache(CACHE_KEYS.processesSummary, topRes.stdout || '');
  } catch { /* best effort */ }
}

async function preloadCron(connectionId: number): Promise<void> {
  try {
    const term = getTerminal();
    const res = await term.exec(connectionId, 'crontab -l 2>/dev/null || true', 15000);
    writeCache(CACHE_KEYS.cron, res.stdout || '');
  } catch { /* best effort */ }
}

async function preloadFirewall(connectionId: number): Promise<void> {
  try {
    const term = getTerminal();
    const detectRes = await term.exec(connectionId, [
      'command -v ufw >/dev/null 2>&1 && echo "HAS_UFW" || true',
      'command -v firewall-cmd >/dev/null 2>&1 && echo "HAS_FIREWALLD" || true',
      'command -v iptables >/dev/null 2>&1 && echo "HAS_IPTABLES" || true',
    ].join('; '), 15000);
    writeCache(CACHE_KEYS.firewall, detectRes.stdout || '');
  } catch { /* best effort */ }
}

async function preloadDocker(connectionId: number): Promise<void> {
  try {
    const term = getTerminal();
    const res = await term.exec(connectionId, [
      'command -v docker >/dev/null 2>&1 && echo "HAS_DOCKER" || echo "NO_DOCKER"',
      'docker ps --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>/dev/null || true',
      'docker ps -a --filter "status=exited" --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}" 2>/dev/null | head -20 || true',
    ].join('; echo "---SEP---"; '), 25000);
    writeCache(CACHE_KEYS.docker, res.stdout || '');
  } catch { /* best effort */ }
}

const PRELOAD_STEPS = [
  { name: '服务', fn: preloadServices },
  { name: '进程', fn: preloadProcesses },
  { name: '计划任务', fn: preloadCron },
  { name: '防火墙', fn: preloadFirewall },
  { name: 'Docker', fn: preloadDocker },
] as const;

export interface PreloadState {
  loading: boolean;
  progress: number;
  totalSteps: number;
  currentStep: string;
}

// Global mutable state — read by usePreload and usePreloadState
const preloadState: PreloadState = { loading: false, progress: 0, totalSteps: PRELOAD_STEPS.length, currentStep: '' };
let preloadListeners: Set<() => void> = new Set();

function notifyListeners(): void {
  preloadListeners.forEach((fn) => fn());
}

export function getPreloadState(): PreloadState {
  return { ...preloadState };
}

/**
 * Hook that triggers preloading when connection is established.
 * Doesn't cause re-renders — use usePreloadState for UI feedback.
 */
export function usePreload(connectionId: number | null, connStatus: string): void {
  const lastPreloadedId = useRef<number | null>(null);

  useEffect(() => {
    if (connStatus !== 'connected' || connectionId == null) return;
    if (lastPreloadedId.current === connectionId) return;
    lastPreloadedId.current = connectionId;

    preloadState.loading = true;
    preloadState.progress = 0;
    preloadState.currentStep = '';
    notifyListeners();

    const preload = async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 1200));

      for (let i = 0; i < PRELOAD_STEPS.length; i++) {
        preloadState.progress = i + 1;
        preloadState.currentStep = PRELOAD_STEPS[i].name;
        notifyListeners();
        await PRELOAD_STEPS[i].fn(connectionId);
        if (i < PRELOAD_STEPS.length - 1) await new Promise((r) => setTimeout(r, 300));
      }

      preloadState.loading = false;
      preloadState.currentStep = '';
      notifyListeners();
    };

    void preload();
  }, [connectionId, connStatus]);
}

/** Hook for components that need to display preload progress. */
export function usePreloadState(): PreloadState {
  const [, forceUpdate] = useRef({}).current;
  // Use a simple approach: subscribe on mount
  const listener = useRef<() => void>(() => {});

  // Actually use useState for reactivity
  const React = require('react');
  const [state, setState] = React.useState<PreloadState>(getPreloadState());

  React.useEffect(() => {
    const listener = (): void => setState(getPreloadState());
    preloadListeners.add(listener);
    return () => { preloadListeners.delete(listener); };
  }, []);

  return state;
}

/** Read preloaded services data from cache. */
export function getCachedServices(): string | undefined {
  return readCache<string>(CACHE_KEYS.services);
}

/** Read preloaded processes data from cache. */
export function getCachedProcesses(): { ps: string; summary: string } | undefined {
  const ps = readCache<string>(CACHE_KEYS.processes);
  const summary = readCache<string>(CACHE_KEYS.processesSummary);
  if (ps !== undefined) return { ps, summary: summary ?? '' };
  return undefined;
}

/** Read preloaded cron data from cache. */
export function getCachedCron(): string | undefined {
  return readCache<string>(CACHE_KEYS.cron);
}

/** Read preloaded firewall detection from cache. */
export function getCachedFirewall(): string | undefined {
  return readCache<string>(CACHE_KEYS.firewall);
}

/** Read preloaded Docker data from cache. */
export function getCachedDocker(): string | undefined {
  return readCache<string>(CACHE_KEYS.docker);
}

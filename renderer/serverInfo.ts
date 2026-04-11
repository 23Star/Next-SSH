import { state } from './state';
import { t } from './i18n';
import { escapeHtml } from './util';
import type { ServerInfo } from './types';

type Api = NonNullable<typeof window.electronAPI>;

let lastLoadedInfo: ServerInfo | null = null;
let lastConnectionId: number | null = null;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

function renderServerInfo(info: ServerInfo): string {
  const rows: Array<{ label: string; value: string }> = [
    { label: t('serverInfo.hostname'), value: info.hostname },
    { label: t('serverInfo.os'), value: info.os },
    { label: t('serverInfo.kernel'), value: info.kernel },
    { label: t('serverInfo.cpu'), value: `${info.cpuModel} (${info.cpuCores})` },
    { label: t('serverInfo.memory'), value: `${info.memoryUsed} / ${info.memoryTotal}` },
    { label: t('serverInfo.disk'), value: `${info.diskUsed} / ${info.diskTotal} (${info.diskPercent})` },
    { label: t('serverInfo.uptime'), value: info.uptime },
    { label: t('serverInfo.serverTime'), value: info.serverTime },
  ];
  return `<div class="serverInfoTable">${rows
    .map(
      (r) =>
        `<div class="serverInfoRow">
          <span class="serverInfoLabel">${escapeHtml(r.label)}</span>
          <span class="serverInfoValue">${escapeHtml(r.value)}</span>
        </div>`,
    )
    .join('')}</div>`;
}

function renderPlaceholder(): string {
  return `<p class="panelPlaceholder">${t('serverInfo.noConnection')}</p>`;
}

function stopAutoRefresh(): void {
  if (autoRefreshTimer !== null) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function startAutoRefresh(api: Api, connectionId: number): void {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    void loadServerInfo(api, connectionId, true);
  }, 5000);
}

export async function loadServerInfo(api: Api, connectionId: number | null, isAutoRefresh = false): Promise<void> {
  const container = document.getElementById('serverInfoContainer');
  if (!container) return;
  lastConnectionId = connectionId;
  if (!connectionId || !api.serverInfo) {
    lastLoadedInfo = null;
    stopAutoRefresh();
    container.innerHTML = renderPlaceholder();
    return;
  }
  if (!isAutoRefresh) {
    container.innerHTML = `<p class="panelPlaceholder">${t('explorer.loading')}</p>`;
  }
  try {
    const info = await api.serverInfo.get(connectionId);
    lastLoadedInfo = info;
    container.innerHTML = renderServerInfo(info);
    // Start auto-refresh on first successful load
    if (!isAutoRefresh && autoRefreshTimer === null) {
      startAutoRefresh(api, connectionId);
    }
  } catch (err) {
    console.error('[serverInfo] Failed to load server info:', err);
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = `<p class="panelPlaceholder">${t('serverInfo.loadError')}: ${escapeHtml(msg)}</p>`;
  }
}

/** Re-render server info with current locale (called on locale change). */
export function rerenderServerInfo(): void {
  const container = document.getElementById('serverInfoContainer');
  if (!container) return;
  if (lastLoadedInfo) {
    container.innerHTML = renderServerInfo(lastLoadedInfo);
  } else {
    container.innerHTML = renderPlaceholder();
  }
}

export function bindServerInfoReload(api: Api): void {
  document.getElementById('btnServerInfoReload')?.addEventListener('click', () => {
    const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
    if (activeTab?.kind === 'terminal') {
      void loadServerInfo(api, activeTab.connectionId);
    }
  });
}

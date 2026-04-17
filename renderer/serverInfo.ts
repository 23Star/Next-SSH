import { state } from './state';
import { t } from './i18n';
import { escapeHtml } from './util';
import type { ServerInfo } from './types';

type Api = NonNullable<typeof window.electronAPI>;

let lastLoadedInfo: ServerInfo | null = null;
let lastConnectionId: number | null = null;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

function parsePercent(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)%/);
  return m ? Math.min(100, Math.max(0, parseFloat(m[1]))) : null;
}

function progressBar(pct: number): string {
  const cls = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  return `<div class="serverInfoProgress"><div class="serverInfoProgressFill serverInfoProgressFill--${cls}" style="width:${pct.toFixed(0)}%"></div></div>`;
}

function renderServerInfo(info: ServerInfo): string {
  const textRows: Array<{ label: string; value: string }> = [
    { label: t('serverInfo.hostname'), value: info.hostname },
    { label: t('serverInfo.os'), value: info.os },
    { label: t('serverInfo.kernel'), value: info.kernel },
    { label: t('serverInfo.uptime'), value: info.uptime },
    { label: t('serverInfo.serverTime'), value: info.serverTime },
  ];

  const memPct = parsePercent(info.memoryUsed + '/' + info.memoryTotal);
  const diskPct = parsePercent(info.diskPercent);

  const textHtml = textRows
    .map(
      (r) =>
        `<div class="serverInfoRow">
          <span class="serverInfoLabel">${escapeHtml(r.label)}</span>
          <span class="serverInfoValue">${escapeHtml(r.value)}</span>
        </div>`,
    )
    .join('');

  const cpuHtml = `<div class="serverInfoCard">
    <div class="serverInfoCardHeader">
      <span class="serverInfoCardTitle">${escapeHtml(t('serverInfo.cpu'))}</span>
      <span class="serverInfoValue">${escapeHtml(info.cpuCores)} cores</span>
    </div>
    <div class="serverInfoCardSub">${escapeHtml(info.cpuModel)}</div>
  </div>`;

  const memUsedNum = (() => {
    const nums = (info.memoryUsed + ' ' + info.memoryTotal).match(/[\d.]+/g);
    if (nums && nums.length >= 2) {
      const used = parseFloat(nums[0]);
      const total = parseFloat(nums[1]);
      if (total > 0) return Math.round((used / total) * 100);
    }
    return null;
  })();

  const memHtml = `<div class="serverInfoCard">
    <div class="serverInfoCardHeader">
      <span class="serverInfoCardTitle">${escapeHtml(t('serverInfo.memory'))}</span>
      <span class="serverInfoValue">${escapeHtml(info.memoryUsed)} / ${escapeHtml(info.memoryTotal)}</span>
    </div>
    ${memUsedNum !== null ? progressBar(memUsedNum) : ''}
  </div>`;

  const diskHtml = `<div class="serverInfoCard">
    <div class="serverInfoCardHeader">
      <span class="serverInfoCardTitle">${escapeHtml(t('serverInfo.disk'))}</span>
      <span class="serverInfoValue">${escapeHtml(info.diskUsed)} / ${escapeHtml(info.diskTotal)}</span>
    </div>
    ${diskPct !== null ? progressBar(diskPct) : ''}
    ${diskPct !== null ? `<div class="serverInfoCardSub">${diskPct.toFixed(0)}% used</div>` : ''}
  </div>`;

  return `<div class="serverInfoTable">${textHtml}</div>${cpuHtml}${memHtml}${diskHtml}`;
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

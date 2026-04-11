import type { Environment } from './types';
import { state } from './state';
import { t } from './i18n';
import { displayName, escapeHtml } from './util';
import * as terminal from './terminal';
import * as explorerContextMenu from './explorerContextMenu';

type Api = NonNullable<typeof window.electronAPI>;

let connectHandler: (() => void) | undefined;
let connectModalCloseBound = false;

export function setConnectHandler(handler: () => void): void {
  connectHandler = handler;
}

interface ConnectListItem {
  kind: 'local' | 'env';
  envId?: number;
  label: string;
  isConnected: boolean;
}

/** Build list items: Local Terminal (always) + all saved connections. */
function getConnectListItems(): ConnectListItem[] {
  const items: ConnectListItem[] = [];
  const hasLocal = state.mainPanelTabs.some((tab) => tab.kind === 'local-terminal');
  items.push({ kind: 'local', label: t('button.local'), isConnected: hasLocal });

  const connectedEnvIds = new Set(
    state.mainPanelTabs
      .filter((tab): tab is typeof tab & { kind: 'terminal' } => tab.kind === 'terminal')
      .map((tab) => tab.envId),
  );
  for (const env of state.envList) {
    items.push({
      kind: 'env',
      envId: env.id,
      label: displayName(env),
      isConnected: connectedEnvIds.has(env.id),
    });
  }
  return items;
}

export function renderList(api: Api, items: ConnectListItem[]): void {
  const listEl = document.getElementById('connectList');
  if (!listEl) return;
  listEl.innerHTML = items
    .map((item) => {
      const dot = item.isConnected
        ? '<span class="connectDot" aria-hidden="true">●</span>'
        : '';
      const selected = item.kind === 'env' && state.selectedId === item.envId ? 'selected' : '';
      const isLocal = item.kind === 'local';
      return `<li class="serverItem ${isLocal ? 'serverItem--local' : ''} ${selected}" data-kind="${item.kind}" data-env-id="${item.envId ?? ''}">
        ${dot}
        <span class="serverItemName" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      </li>`;
    })
    .join('');

  listEl.querySelectorAll('.serverItem').forEach((el) => {
    const kind = (el as HTMLElement).dataset.kind;
    const envIdStr = (el as HTMLElement).dataset.envId;
    const envId = envIdStr ? Number(envIdStr) : null;

    el.addEventListener('click', () => {
      if (kind === 'local') {
        const existing = state.mainPanelTabs.find((tab) => tab.kind === 'local-terminal');
        if (existing) {
          terminal.switchMainPanelTab(api, existing.id);
        } else {
          void terminal.openLocalTerminalTab(api);
        }
      } else if (envId != null) {
        const connectedTab = state.mainPanelTabs.find(
          (tab) => tab.kind === 'terminal' && tab.envId === envId,
        );
        if (connectedTab) {
          terminal.switchMainPanelTab(api, connectedTab.id);
        } else {
          state.selectedId = envId;
          refreshConnectListDisplay(api);
          terminal.doConnect(api);
        }
      }
    });

    // Right-click: only env items get edit/delete
    if (kind === 'env' && envId != null) {
      el.addEventListener('contextmenu', (e: Event) => {
        const ev = e as MouseEvent;
        ev.preventDefault();
        ev.stopPropagation();
        const items: explorerContextMenu.ContextMenuItem[] = [
          { label: t('button.edit'), onClick: () => openForm(api, envId) },
          { label: t('button.delete'), onClick: async () => { await deleteEnv(api, envId); } },
        ];
        explorerContextMenu.showContextMenu(ev, items);
      });
    }
  });
}

export async function refreshList(api: Api): Promise<void> {
  const items = await api.environment.list();
  state.envList = items;
  refreshConnectListDisplay(api);
}

export function refreshConnectListDisplay(api: Api): void {
  renderList(api, getConnectListItems());
}

function showAddEditServerModal(show: boolean): void {
  const el = document.getElementById('addEditServerModal');
  if (el) el.style.display = show ? 'flex' : 'none';
}

export function openForm(api: Api, envId?: number): void {
  state.editingId = envId ?? null;
  const title = document.getElementById('formTitle');
  const form = document.getElementById('envForm') as HTMLFormElement;
  if (title) title.textContent = envId ? t('form.editTitle') : t('form.addTitle');
  if (form) form.reset();
  if (!envId) toggleAuthFields('password');
  if (envId) {
    api.environment.list().then((items) => {
      const env = items.find((e) => e.id === envId);
      if (env && form) {
        (form.querySelector('[name="name"]') as HTMLInputElement).value = env.name || '';
        (form.querySelector('[name="host"]') as HTMLInputElement).value = env.host;
        (form.querySelector('[name="port"]') as HTMLInputElement).value = String(env.port);
        (form.querySelector('[name="username"]') as HTMLInputElement).value = env.username;
        (form.querySelector('[name="authType"]') as HTMLSelectElement).value = env.authType;
        (form.querySelector('[name="password"]') as HTMLInputElement).value = env.password || '';
        (form.querySelector('[name="privateKeyPath"]') as HTMLInputElement).value = env.privateKeyPath || '';
        (form.querySelector('[name="memo"]') as HTMLInputElement).value = env.memo || '';
        toggleAuthFields(env.authType);
      }
    });
  }
  showAddEditServerModal(true);
}

export function closeAddEditServerModal(): void {
  showAddEditServerModal(false);
}

function showConnectModal(show: boolean): void {
  const el = document.getElementById('connectModal');
  if (el) el.style.display = show ? 'flex' : 'none';
}

export function openConnectModal(api: Api): void {
  const listEl = document.getElementById('connectModalList');
  if (!listEl) return;
  const connectedEnvIds = new Set(
    state.mainPanelTabs
      .filter((tab): tab is typeof tab & { kind: 'terminal' } => tab.kind === 'terminal')
      .map((tab) => tab.envId),
  );
  const hasLocal = state.mainPanelTabs.some((tab) => tab.kind === 'local-terminal');
  const localDot = hasLocal ? '<span class="connectModalDot" aria-hidden="true">●</span>' : '';
  const localRow = `<li class="connectModalItem" data-kind="local" tabindex="0">
          ${localDot}
          <span class="connectModalItemName">${t('button.local')}</span>
        </li>`;
  const envRows = state.envList
    .map(
      (env) =>
        `<li class="connectModalItem" data-kind="env" data-id="${env.id}" tabindex="0">
          ${connectedEnvIds.has(env.id) ? '<span class="connectModalDot" aria-hidden="true">●</span>' : ''}
          <span class="connectModalItemName">${displayName(env)}</span>
          <span class="connectModalItemActions">
            <button type="button" class="connectModalBtn connectModalBtnEdit" data-action="edit" data-id="${env.id}">${t('button.edit')}</button>
            <button type="button" class="connectModalBtn connectModalBtnDelete" data-action="delete" data-id="${env.id}">${t('button.delete')}</button>
          </span>
        </li>`,
    )
    .join('');
  listEl.innerHTML = localRow + envRows;

  if (!connectModalCloseBound) {
    connectModalCloseBound = true;
    const closeBtn = document.getElementById('btnConnectModalClose');
    if (closeBtn) closeBtn.addEventListener('click', () => showConnectModal(false));
    const backdrop = document.getElementById('connectModalBackdrop');
    if (backdrop) backdrop.addEventListener('click', () => showConnectModal(false));
  }

  const localEl = listEl.querySelector('.connectModalItem[data-kind="local"]') as HTMLElement | null;
  if (localEl) {
    localEl.addEventListener('click', () => {
      showConnectModal(false);
      void terminal.openLocalTerminalTab(api);
    });
    localEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showConnectModal(false);
        void terminal.openLocalTerminalTab(api);
      }
    });
  }

  listEl.querySelectorAll('.connectModalItem[data-kind="env"]').forEach((el) => {
    const id = Number((el as HTMLElement).dataset.id);
    const row = el as HTMLElement;
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-action]')) return;
      state.selectedId = id;
      showConnectModal(false);
      connectHandler?.();
    });
    row.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('[data-action]')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        state.selectedId = id;
        showConnectModal(false);
        connectHandler?.();
      }
    });
  });
  listEl.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = Number((e.currentTarget as HTMLElement).dataset.id);
      showConnectModal(false);
      openForm(api, id);
    });
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = Number((e.currentTarget as HTMLElement).dataset.id);
      await deleteEnv(api, id);
      openConnectModal(api);
    });
  });
  showConnectModal(true);
}

export function closeConnectModal(): void {
  showConnectModal(false);
}

export function toggleAuthFields(authType: string): void {
  const labelPassword = document.getElementById('labelPassword');
  const labelKey = document.getElementById('labelKey');
  if (labelPassword) labelPassword.style.display = authType === 'password' ? 'block' : 'none';
  if (labelKey) labelKey.style.display = authType === 'key' ? 'block' : 'none';
}

export async function deleteEnv(api: Api, id: number): Promise<void> {
  if (!confirm(t('confirm.deleteEnv'))) return;
  const ok = await api.environment.delete(id);
  if (ok) {
    if (state.selectedId === id) state.selectedId = null;
    await refreshList(api);
  }
}

export function handleFormSubmit(api: Api, e: Event): void {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const authType = (form.querySelector('[name="authType"]') as HTMLSelectElement).value;
  const input: Record<string, unknown> = {
    name: (form.querySelector('[name="name"]') as HTMLInputElement).value.trim() || null,
    host: (form.querySelector('[name="host"]') as HTMLInputElement).value.trim(),
    port: Number((form.querySelector('[name="port"]') as HTMLInputElement).value) || 22,
    username: (form.querySelector('[name="username"]') as HTMLInputElement).value.trim(),
    authType,
    password: authType === 'password' ? (form.querySelector('[name="password"]') as HTMLInputElement).value || null : null,
    privateKeyPath: authType === 'key' ? (form.querySelector('[name="privateKeyPath"]') as HTMLInputElement).value.trim() || null : null,
    memo: (form.querySelector('[name="memo"]') as HTMLInputElement).value.trim() || null,
  };
  if (state.editingId !== null) {
    api.environment.update(state.editingId, input).then(() => {
      state.editingId = null;
      closeAddEditServerModal();
      refreshList(api);
    });
  } else {
    api.environment.create(input).then(() => {
      closeAddEditServerModal();
      refreshList(api);
    });
  }
}

export async function testConnection(api: Api): Promise<void> {
  const form = document.getElementById('envForm') as HTMLFormElement | null;
  if (!form) return;
  const host = (form.querySelector('[name="host"]') as HTMLInputElement).value.trim();
  const port = Number((form.querySelector('[name="port"]') as HTMLInputElement).value) || 22;
  if (!host) return;
  const btn = document.getElementById('btnTestConnection') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    const ok = await api.environment?.testConnection(host, port);
    if (btn) {
      btn.textContent = ok ? t('form.testSuccess') : t('form.testFail');
      btn.style.color = ok ? 'var(--success-text)' : 'var(--error-text)';
      setTimeout(() => {
        btn.textContent = t('form.testConnection');
        btn.style.color = '';
        if (btn) btn.disabled = false;
      }, 2000);
    }
  } catch {
    if (btn) {
      btn.textContent = t('form.testFail');
      btn.style.color = 'var(--error-text)';
      setTimeout(() => {
        btn.textContent = t('form.testConnection');
        btn.style.color = '';
        if (btn) btn.disabled = false;
      }, 2000);
    }
  }
}

export function getEditingId(): number | null {
  return state.editingId;
}

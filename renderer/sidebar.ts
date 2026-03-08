import type { Environment } from './types';
import { state } from './state';
import { t } from './i18n';
import { displayName, escapeHtml } from './util';
import * as terminal from './terminal';

type Api = NonNullable<typeof window.electronAPI>;

let connectHandler: (() => void) | undefined;
let connectModalCloseBound = false;

export function setConnectHandler(handler: () => void): void {
  connectHandler = handler;
}

/** 接続中（ターミナルタブがある）env の id 一覧（dot 表示用）。 */
function getConnectedEnvIds(): number[] {
  return [
    ...new Set(
      state.mainPanelTabs
        .filter((t): t is typeof t & { kind: 'terminal' } => t.kind === 'terminal')
        .map((t) => t.envId),
    ),
  ];
}

/** Connect list 用: mainPanelTabs からタブ単位の行データを生成。 */
function getConnectListItems(): Array<{ tabId: string; label: string }> {
  const items: Array<{ tabId: string; label: string }> = [];

  const localTabs = state.mainPanelTabs.filter((t) => t.kind === 'local-terminal');
  localTabs.forEach((tab, idx) => {
    const n = idx + 1;
    const base = 'Local';
    const label = n === 1 ? base : `${base}_${n}`;
    items.push({ tabId: tab.id, label });
  });

  const terminalTabs = state.mainPanelTabs.filter((t) => t.kind === 'terminal');
  const occurrences: Record<number, number> = {};
  terminalTabs.forEach((t) => {
    occurrences[t.envId] = (occurrences[t.envId] ?? 0) + 1;
  });
  const seen: Record<number, number> = {};

  terminalTabs.forEach((tab) => {
    const envId = tab.envId;
    const env = state.envList.find((e) => e.id === envId);
    const base = env ? displayName(env) : `Env ${envId}`;
    const total = occurrences[envId] ?? 1;
    let label = base;
    if (total > 1) {
      const idx = (seen[envId] ?? 0) + 1;
      seen[envId] = idx;
      if (idx > 1) label = `${base}_${idx}`;
    }
    items.push({ tabId: tab.id, label });
  });

  return items;
}

export function renderList(api: Api, items: Array<{ tabId: string; label: string }>): void {
  const listEl = document.getElementById('connectList');
  if (!listEl) return;
  const activeTabId = state.activeMainPanelTabId;
  listEl.innerHTML = items
    .map(
      (item) =>
        `<li class="serverItem ${activeTabId === item.tabId ? 'selected' : ''}" data-tab-id="${escapeHtml(item.tabId)}">
      <span class="serverItemName" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
    </li>`,
    )
    .join('');

  listEl.querySelectorAll('.serverItem').forEach((el) => {
    const tabId = (el as HTMLElement).dataset.tabId;
    if (!tabId) return;
    el.addEventListener('click', () => {
      terminal.switchMainPanelTab(api, tabId);
    });
  });
}

export async function refreshList(api: Api): Promise<void> {
  const items = await api.environment.list();
  state.envList = items;
  refreshConnectListDisplay(api);
}

/** パネル表示だけ更新（接続中のサーバーのみ）。 */
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
  const connectedIds = new Set(getConnectedEnvIds());
  const hasLocal = state.mainPanelTabs.some((t) => t.kind === 'local-terminal');
  const localDot = hasLocal ? '<span class="connectModalDot" aria-hidden="true">●</span>' : '';
  const localRow = `<li class="connectModalItem" data-kind="local" tabindex="0">
          ${localDot}
          <span class="connectModalItemName">Local</span>
        </li>`;
  const envRows = state.envList
    .map(
      (env) =>
        `<li class="connectModalItem" data-kind="env" data-id="${env.id}" tabindex="0">
          ${connectedIds.has(env.id) ? '<span class="connectModalDot" aria-hidden="true">●</span>' : ''}
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

export function getEditingId(): number | null {
  return state.editingId;
}

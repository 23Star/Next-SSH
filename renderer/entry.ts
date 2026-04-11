import './style.css';
import 'xterm/css/xterm.css';
import './types';
import { state } from './state';
import { setCurrentLang, updateI18n, t } from './i18n';
import { renderLayout, applyPanelSizes, applyChatInputHeight, bindResizers, bindChatInputResizer, setupTerminalResizeObserver } from './layout';
import * as sidebar from './sidebar';
import * as terminal from './terminal';
import * as explorer from './explorer';
import * as chat from './chat';
import * as editor from './editor';
import * as shortcuts from './shortcuts';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root not found');
const root: HTMLElement = rootEl;

const _api = window.electronAPI;
if (!_api?.environment) {
  root.innerHTML = '<p>electronAPI.environment が利用できません</p>';
  throw new Error('electronAPI.environment not available');
}
const api: NonNullable<typeof window.electronAPI> = _api;

function bindEvents(): void {
  sidebar.setConnectHandler(() => terminal.doConnect(api));
  document.getElementById('btnAdd')?.addEventListener('click', () => sidebar.openForm(api));
  document.getElementById('btnCancel')?.addEventListener('click', () => {
    state.editingId = null;
    sidebar.closeAddEditServerModal();
  });
  document.getElementById('envForm')?.addEventListener('submit', (e) => sidebar.handleFormSubmit(api, e));
  document.querySelector('[name="authType"]')?.addEventListener('change', (e) => {
    sidebar.toggleAuthFields((e.target as HTMLSelectElement).value);
  });
  document.getElementById('btnConnect')?.addEventListener('click', () => terminal.doConnect(api));
  document.getElementById('btnSidebarConnect')?.addEventListener('click', () => sidebar.openConnectModal(api));
  document.getElementById('btnOpenLocalTerminal')?.addEventListener('click', () => terminal.openLocalTerminalTab(api));
  document.getElementById('btnAddLocalTerminal')?.addEventListener('click', () => terminal.openLocalTerminalTab(api));
  document.getElementById('btnDisconnect')?.addEventListener('click', () => terminal.doDisconnect(api));
  applyPanelSizes();
  applyChatInputHeight();
  bindResizers();
  bindChatInputResizer();
  setupTerminalResizeObserver(api);
  terminal.setupTerminalDataListener(api);
  terminal.bindPassphraseDialog(api);
  chat.bindChatEvents(api);
  document.getElementById('btnDiffApply')?.addEventListener('click', () => editor.applyPendingDiff(api));
  document.getElementById('btnDiffCancel')?.addEventListener('click', () => editor.cancelPendingDiff());
  const diffWrap = document.getElementById('diffPreviewWrap');
  diffWrap?.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!state.pendingDiff) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      window.electronAPI?.logToMain?.('[AISSH entry] diffWrap key', { key: e.key, keyLower: key, shift: e.shiftKey });
      if (!e.shiftKey && key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        editor.cancelPendingDiff();
      } else if (key === 'y') {
        e.preventDefault();
        e.stopPropagation();
        editor.applyPendingDiff(api);
      }
    },
    true,
  );
  shortcuts.bindFocusShortcuts(api);
  window.addEventListener('main-panel-tab-bar-refresh', () => {
    terminal.renderMainPanelTabBar(api);
  });
  window.addEventListener('main-panel-tabs-changed', () => {
    sidebar.refreshConnectListDisplay(api);
  });
}

async function updateSettingsLanguageHighlight(api: NonNullable<typeof window.electronAPI>): Promise<void> {
  if (!api.locale) return;
  const locale = await api.locale.get();
  ['ja', 'en', 'zn'].forEach((loc) => {
    const btn = document.querySelector(`.settingsModalLanguage button[data-locale="${loc}"]`);
    if (btn) btn.classList.toggle('is-selected', loc === locale);
  });
}

async function loadAiSettingsToForm(): Promise<void> {
  const settings = await api.aiSettings?.get();
  if (!settings) return;
  const urlInput = document.getElementById('aiApiUrl') as HTMLInputElement | null;
  const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
  const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
  const tempInput = document.getElementById('aiTemperature') as HTMLInputElement | null;
  const tempValue = document.getElementById('aiTempValue');
  const maxTokensInput = document.getElementById('aiMaxTokens') as HTMLInputElement | null;
  const systemPromptInput = document.getElementById('aiSystemPrompt') as HTMLTextAreaElement | null;
  if (urlInput) urlInput.value = settings.apiUrl ?? '';
  if (keyInput) keyInput.value = settings.apiKeyMasked ?? '';
  if (modelInput) modelInput.value = settings.model ?? '';
  if (tempInput) {
    tempInput.value = String(settings.temperature ?? 0.7);
    if (tempValue) tempValue.textContent = String(settings.temperature ?? 0.7);
  }
  if (maxTokensInput) maxTokensInput.value = String(settings.maxTokens ?? 4096);
  if (systemPromptInput) systemPromptInput.value = settings.systemPrompt ?? '';
}

function bindAiSettingsEvents(api: NonNullable<typeof window.electronAPI>): void {
  // Temperature slider value display
  const tempInput = document.getElementById('aiTemperature') as HTMLInputElement | null;
  const tempValue = document.getElementById('aiTempValue');
  tempInput?.addEventListener('input', () => {
    if (tempValue) tempValue.textContent = tempInput.value;
  });

  // Toggle API Key visibility
  document.getElementById('btnToggleApiKey')?.addEventListener('click', () => {
    const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
    if (!keyInput) return;
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  // Test connection
  document.getElementById('btnAiTest')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('aiSettingsTestResult');
    if (resultEl) resultEl.style.display = 'none';
    const urlInput = document.getElementById('aiApiUrl') as HTMLInputElement | null;
    const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
    const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
    const tempInput = document.getElementById('aiTemperature') as HTMLInputElement | null;
    const maxTokensInput = document.getElementById('aiMaxTokens') as HTMLInputElement | null;
    const systemPromptInput = document.getElementById('aiSystemPrompt') as HTMLTextAreaElement | null;

    // Save first, then test
    await api.aiSettings?.set({
      apiUrl: urlInput?.value ?? '',
      apiKey: keyInput?.value ?? '',
      model: modelInput?.value ?? '',
      temperature: parseFloat(tempInput?.value ?? '0.7'),
      maxTokens: parseInt(maxTokensInput?.value ?? '4096', 10),
      systemPrompt: systemPromptInput?.value ?? '',
    });

    const result = await api.aiSettings?.test();
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.textContent = result?.message ?? '';
      resultEl.className = `aiSettingsTestResult ${result?.ok ? 'aiSettingsTestResult--ok' : 'aiSettingsTestResult--fail'}`;
    }
  });

  // Save settings
  document.getElementById('btnAiSave')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('aiApiUrl') as HTMLInputElement | null;
    const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
    const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
    const tempInput = document.getElementById('aiTemperature') as HTMLInputElement | null;
    const maxTokensInput = document.getElementById('aiMaxTokens') as HTMLInputElement | null;
    const systemPromptInput = document.getElementById('aiSystemPrompt') as HTMLTextAreaElement | null;
    const resultEl = document.getElementById('aiSettingsTestResult');

    await api.aiSettings?.set({
      apiUrl: urlInput?.value ?? '',
      apiKey: keyInput?.value ?? '',
      model: modelInput?.value ?? '',
      temperature: parseFloat(tempInput?.value ?? '0.7'),
      maxTokens: parseInt(maxTokensInput?.value ?? '4096', 10),
      systemPrompt: systemPromptInput?.value ?? '',
    });

    // Update custom system prompt cache
    chat.setCustomSystemPrompt(systemPromptInput?.value ?? '');

    // Show success feedback
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.textContent = 'Saved';
      resultEl.className = 'aiSettingsTestResult aiSettingsTestResult--ok';
      setTimeout(() => { resultEl.style.display = 'none'; }, 2000);
    }

    // Update chat panel state
    void chat.updateChatFormLoginState();
  });
}

function bindSettingsAndPlanModals(api: NonNullable<typeof window.electronAPI>): void {
  api.settings?.onOpen(() => {
    const el = document.getElementById('settingsModal');
    if (el) el.style.display = 'flex';
    void updateSettingsLanguageHighlight(api);
    void loadAiSettingsToForm();
  });

  document.getElementById('settingsModalBackdrop')?.addEventListener('click', () => {
    const el = document.getElementById('settingsModal');
    if (el) el.style.display = 'none';
  });
  document.getElementById('btnSettingsClose')?.addEventListener('click', () => {
    const el = document.getElementById('settingsModal');
    if (el) el.style.display = 'none';
  });

  document.getElementById('btnLangJa')?.addEventListener('click', () => api.locale?.set('ja'));
  document.getElementById('btnLangEn')?.addEventListener('click', () => api.locale?.set('en'));
  document.getElementById('btnLangZn')?.addEventListener('click', () => api.locale?.set('zn'));
}

async function runApp(): Promise<void> {
  if (api.locale) {
    try {
      const locale = await api.locale.get();
      const pack = await api.locale.getLangPack(locale);
      setCurrentLang(pack);
    } catch {
      setCurrentLang({});
    }
  }
  renderLayout(root);
  if (api.locale) void updateSettingsLanguageHighlight(api);
  bindEvents();
  bindSettingsAndPlanModals(api);
  bindAiSettingsEvents(api);
  chat.updateChatFormLoginState();
  await sidebar.refreshList(api);
  chat.renderChatMessages();
  explorer.renderExplorerTabBar(api);
  await explorer.loadExplorerRootForTarget(api, 'local');
  explorer.renderExplorerTree(api);
  document.getElementById('btnExplorerUp')?.addEventListener('click', () => explorer.explorerUp(api));
  document.getElementById('btnExplorerReload')?.addEventListener('click', () => explorer.reloadExplorerCurrent(api));
  explorer.bindExplorerDropTarget(api);
  explorer.setupExplorerContextMenu(api);
  explorer.setupExplorerKeyboard(api);
  await chat.loadChatSessions(api);

  // Load custom system prompt on startup
  const aiConf = await api.aiSettings?.get();
  if (aiConf?.systemPrompt) {
    chat.setCustomSystemPrompt(aiConf.systemPrompt);
  }

  if (api.locale) {
    api.locale.onChanged(async (newLocale) => {
      setCurrentLang(await api.locale!.getLangPack(newLocale));
      updateI18n();
      await updateSettingsLanguageHighlight(api);
      await sidebar.refreshList(api);
      explorer.renderExplorerTabBar(api);
      explorer.renderExplorerTree(api);
      chat.renderChatTabBar();
      chat.renderChatMessages();
      const formTitle = document.getElementById('formTitle');
      if (formTitle) formTitle.textContent = sidebar.getEditingId() ? t('form.editTitle') : t('form.addTitle');
    });
  }
}

void runApp();

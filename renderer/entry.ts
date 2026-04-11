import './style.css';
import 'xterm/css/xterm.css';
import './types';
import { state } from './state';
import { setCurrentLang, updateI18n, t } from './i18n';
import { setTheme } from './theme';
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
  root.innerHTML = '<p>electronAPI.environment not available</p>';
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
  document.getElementById('btnAdd')?.addEventListener('click', () => sidebar.openForm(api));
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
  chat.bindThinkToggle();
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

async function updateSettingsLanguageHighlight(): Promise<void> {
  if (!api.locale) return;
  const locale = await api.locale.get();
  ['en', 'zn', 'ru'].forEach((loc) => {
    const btn = document.querySelector(`.settingsModalLanguage button[data-locale="${loc}"]`);
    if (btn) btn.classList.toggle('is-selected', loc === locale);
  });
}

async function updateSettingsThemeHighlight(): Promise<void> {
  if (!api.theme) return;
  const theme = await api.theme.get();
  document.querySelectorAll('[data-theme-value]').forEach((btn) => {
    btn.classList.toggle('is-selected', (btn as HTMLElement).dataset.themeValue === theme);
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

function bindAiSettingsEvents(): void {
  const tempInput = document.getElementById('aiTemperature') as HTMLInputElement | null;
  const tempValue = document.getElementById('aiTempValue');
  tempInput?.addEventListener('input', () => {
    if (tempValue) tempValue.textContent = tempInput.value;
  });

  document.getElementById('btnToggleApiKey')?.addEventListener('click', () => {
    const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
    if (!keyInput) return;
    const btn = document.getElementById('btnToggleApiKey');
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      if (btn) btn.textContent = t('ai.hide');
    } else {
      keyInput.type = 'password';
      if (btn) btn.textContent = t('ai.show');
    }
  });

  // Load presets into dropdown
  api.aiSettings?.getPresets().then((presets) => {
    const select = document.getElementById('aiPresetSelect') as HTMLSelectElement | null;
    if (!select) return;
    presets.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${p.name} (${p.model})`;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      const idx = parseInt(select.value, 10);
      if (isNaN(idx) || !presets[idx]) return;
      const preset = presets[idx];
      const urlInput = document.getElementById('aiApiUrl') as HTMLInputElement | null;
      const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
      if (urlInput) urlInput.value = preset.apiUrl;
      if (modelInput) modelInput.value = preset.model;
    });
  });

  // Detect models
  document.getElementById('btnAiDetectModels')?.addEventListener('click', async () => {
    const listEl = document.getElementById('aiModelsList');
    const testEl = document.getElementById('aiSettingsTestResult');
    if (testEl) testEl.style.display = 'none';
    if (listEl) {
      listEl.style.display = 'block';
      listEl.textContent = '...';
    }
    const urlInput = document.getElementById('aiApiUrl') as HTMLInputElement | null;
    const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
    // Save first so backend has the latest URL/key
    await api.aiSettings?.set({
      apiUrl: urlInput?.value ?? '',
      apiKey: keyInput?.value ?? '',
      model: (document.getElementById('aiModel') as HTMLInputElement | null)?.value ?? '',
      temperature: parseFloat((document.getElementById('aiTemperature') as HTMLInputElement | null)?.value ?? '0.7'),
      maxTokens: parseInt((document.getElementById('aiMaxTokens') as HTMLInputElement | null)?.value ?? '4096', 10),
      systemPrompt: (document.getElementById('aiSystemPrompt') as HTMLTextAreaElement | null)?.value ?? '',
    });
    const result = await api.aiSettings?.getModels();
    if (!result) return;
    if (!result.ok) {
      if (listEl) listEl.textContent = result.error;
      return;
    }
    if (result.models.length === 0) {
      if (listEl) listEl.textContent = t('ai.noModels');
      return;
    }
    if (listEl) {
      listEl.innerHTML = result.models
        .slice(0, 50)
        .map((m) => `<div class="aiModelItem" data-model="${m.id}"><span class="aiModelId">${m.id}</span>${m.owned_by ? `<span class="aiModelOwner">${m.owned_by}</span>` : ''}</div>`)
        .join('');
      listEl.querySelectorAll('.aiModelItem').forEach((item) => {
        item.addEventListener('click', () => {
          const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
          if (modelInput) modelInput.value = (item as HTMLElement).dataset.model ?? '';
        });
      });
    }
  });

  // Test connection
  document.getElementById('btnAiTest')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('aiSettingsTestResult');
    if (resultEl) resultEl.style.display = 'none';
    const urlInput = document.getElementById('aiApiUrl') as HTMLInputElement | null;
    const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
    const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
    const tempInput2 = document.getElementById('aiTemperature') as HTMLInputElement | null;
    const maxTokensInput = document.getElementById('aiMaxTokens') as HTMLInputElement | null;
    const systemPromptInput = document.getElementById('aiSystemPrompt') as HTMLTextAreaElement | null;
    await api.aiSettings?.set({
      apiUrl: urlInput?.value ?? '',
      apiKey: keyInput?.value ?? '',
      model: modelInput?.value ?? '',
      temperature: parseFloat(tempInput2?.value ?? '0.7'),
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

  // Save
  document.getElementById('btnAiSave')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('aiApiUrl') as HTMLInputElement | null;
    const keyInput = document.getElementById('aiApiKey') as HTMLInputElement | null;
    const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
    const tempInput2 = document.getElementById('aiTemperature') as HTMLInputElement | null;
    const maxTokensInput = document.getElementById('aiMaxTokens') as HTMLInputElement | null;
    const systemPromptInput = document.getElementById('aiSystemPrompt') as HTMLTextAreaElement | null;
    const resultEl = document.getElementById('aiSettingsTestResult');
    await api.aiSettings?.set({
      apiUrl: urlInput?.value ?? '',
      apiKey: keyInput?.value ?? '',
      model: modelInput?.value ?? '',
      temperature: parseFloat(tempInput2?.value ?? '0.7'),
      maxTokens: parseInt(maxTokensInput?.value ?? '4096', 10),
      systemPrompt: systemPromptInput?.value ?? '',
    });
    chat.setCustomSystemPrompt(systemPromptInput?.value ?? '');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.textContent = t('ai.saved');
      resultEl.className = 'aiSettingsTestResult aiSettingsTestResult--ok';
      setTimeout(() => { resultEl.style.display = 'none'; }, 2000);
    }
    void chat.updateChatFormLoginState();
  });
}

function bindSettingsModal(): void {
  api.settings?.onOpen(() => {
    const el = document.getElementById('settingsModal');
    if (el) el.style.display = 'flex';
    void updateSettingsLanguageHighlight();
    void updateSettingsThemeHighlight();
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

  document.getElementById('btnLangEn')?.addEventListener('click', () => api.locale?.set('en'));
  document.getElementById('btnLangZn')?.addEventListener('click', () => api.locale?.set('zn'));
  document.getElementById('btnLangRu')?.addEventListener('click', () => api.locale?.set('ru'));
  document.getElementById('btnThemeDark')?.addEventListener('click', () => api.theme?.set('dark'));
  document.getElementById('btnThemeLight')?.addEventListener('click', () => api.theme?.set('light'));
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
  const theme = (await api.theme?.get()) ?? 'dark';
  setTheme(theme);
  renderLayout(root);
  void updateSettingsLanguageHighlight();
  bindEvents();
  bindSettingsModal();
  bindAiSettingsEvents();
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

  const aiConf = await api.aiSettings?.get();
  if (aiConf?.systemPrompt) {
    chat.setCustomSystemPrompt(aiConf.systemPrompt);
  }

  if (api.locale) {
    api.locale.onChanged(async (newLocale) => {
      setCurrentLang(await api.locale!.getLangPack(newLocale));
      updateI18n();
      await updateSettingsLanguageHighlight();
      await sidebar.refreshList(api);
      explorer.renderExplorerTabBar(api);
      explorer.renderExplorerTree(api);
      chat.renderChatTabBar();
      chat.renderChatMessages();
      const formTitle = document.getElementById('formTitle');
      if (formTitle) formTitle.textContent = sidebar.getEditingId() ? t('form.editTitle') : t('form.addTitle');
    });
  }

  if (api.theme) {
    api.theme.onChanged((newTheme) => {
      setTheme(newTheme);
      void updateSettingsThemeHighlight();
      terminal.applyThemeToAllTerminals();
      void editor.applyThemeToAllEditors();
    });
  }
}

void runApp();

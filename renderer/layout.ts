import { state } from './state';
import { t } from './i18n';
import * as terminal from './terminal';

export function renderLayout(root: HTMLElement): void {
  root.innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <section class="sidebarSection servers" id="sidebarServers">
          <div class="sidebarHeader">
            <button type="button" class="sidebarCollapseBtn" data-section="servers" aria-label="Toggle">\u25BC</button>
            <span data-i18n="sidebar.connectList">${t('sidebar.connectList')}</span>
          </div>
          <div class="sidebarContent" id="serversContent">
            <ul class="connectList" id="connectList" tabindex="0"></ul>
            <div class="sidebarFooter">
              <button type="button" id="btnSidebarConnect" data-i18n="button.connect">${t('button.connect')}</button>
              <button type="button" id="btnAdd" data-i18n="sidebar.add">${t('sidebar.add')}</button>
            </div>
          </div>
        </section>
        <div class="layoutResizer layoutResizer--horizontal" id="resizerExplorer" data-i18n-title="resizer.horizontal" title="${t('resizer.horizontal')}"></div>
        <section class="sidebarSection explorer" id="sidebarExplorer">
          <div class="explorerPanelHeader">
            <button type="button" class="sidebarCollapseBtn" data-section="explorer" aria-label="Toggle">\u25BC</button>
            <span class="panelHeader" data-i18n="panel.explorer">${t('panel.explorer')}</span>
            <button type="button" id="btnExplorerUp" class="explorerUpBtn" data-i18n-title="explorer.up" title="${t('explorer.up')}" aria-label="${t('explorer.up')}">↑</button>
            <button type="button" id="btnExplorerDetail" class="explorerUpBtn" data-i18n-title="explorer.toggleDetail" title="${t('explorer.toggleDetail')}" aria-label="${t('explorer.toggleDetail')}">≡</button>
            <button type="button" id="btnExplorerReload" class="explorerUpBtn" data-i18n-title="reload" title="${t('reload')}" aria-label="${t('reload')}">↻</button>
          </div>
          <div class="sidebarContent" id="explorerContent">
            <div class="explorerTreeContainer" id="explorerTreeContainer" tabindex="0"></div>
          </div>
        </section>
        <div class="layoutResizer layoutResizer--horizontal" id="resizerServerInfo" data-i18n-title="resizer.horizontal" title="${t('resizer.horizontal')}"></div>
        <section class="sidebarSection server-info" id="sidebarServerInfo">
          <div class="explorerPanelHeader">
            <button type="button" class="sidebarCollapseBtn" data-section="serverInfo" aria-label="Toggle">\u25BC</button>
            <span class="panelHeader" data-i18n="panel.serverInfo">${t('panel.serverInfo')}</span>
            <button type="button" id="btnServerInfoReload" class="explorerUpBtn" data-i18n-title="serverInfo.refresh" title="${t('serverInfo.refresh')}" aria-label="${t('serverInfo.refresh')}">↻</button>
          </div>
          <div class="sidebarContent" id="serverInfoContent">
            <div class="serverInfoContainer" id="serverInfoContainer"></div>
          </div>
        </section>
      </aside>
      <div class="layoutResizer layoutResizer--vertical" id="resizerSidebar" data-i18n-title="resizer.vertical" title="${t('resizer.vertical')}"></div>
      <div class="contentArea">
        <main class="mainArea">
          <div id="welcomeArea">
            <h1 data-i18n="app.title">${t('app.title')}</h1>
            <p class="mainAreaPlaceholder" id="mainPlaceholder" data-i18n="main.placeholder">${t('main.placeholder')}</p>
          </div>
          <div class="mainPanel" id="mainPanel" tabindex="0">
            <div class="terminalTabBar" id="terminalTabBar"></div>
            <div class="terminalToolbar">
              <span class="terminalEnvName" id="terminalEnvName"></span>
            </div>
            <div class="terminalContainer" id="terminalContainer"></div>
            <div class="editorContainer" id="editorContainer"></div>
            <div id="diffPreviewWrap" class="diffPreviewWrap" style="display: none;">
              <div class="diffPreviewToolbar">
                <span class="diffPreviewHint" data-i18n="diff.hint">${t('diff.hint')}</span>
                <button type="button" id="btnDiffApply" data-i18n="diff.apply">${t('diff.apply')}</button>
                <button type="button" id="btnDiffCancel" data-i18n="diff.cancel">${t('diff.cancel')}</button>
              </div>
              <div id="diffPreviewContainer" class="diffPreviewContainer"></div>
            </div>
          </div>
          <div id="passphraseDialog" class="passphraseDialog" style="display: none;">
            <div class="passphraseDialogBackdrop"></div>
            <div class="passphraseDialogBox">
              <p class="passphraseDialogTitle" data-i18n="passphrase.title">${t('passphrase.title')}</p>
              <p class="passphraseDialogHint" data-i18n="passphrase.hint">${t('passphrase.hint')}</p>
              <input type="password" id="passphraseInput" data-i18n-placeholder="passphrase.placeholder" placeholder="${t('passphrase.placeholder')}" autocomplete="off" />
              <div class="passphraseDialogActions">
                <button type="button" id="btnPassphraseOk" data-i18n="passphrase.connect">${t('passphrase.connect')}</button>
                <button type="button" id="btnPassphraseCancel" data-i18n="passphrase.cancel">${t('passphrase.cancel')}</button>
              </div>
            </div>
          </div>
        </main>
        <div class="layoutResizer layoutResizer--vertical" id="resizerChat" data-i18n-title="resizer.vertical" title="${t('resizer.vertical')}"></div>
        <aside class="chatPanel" id="chatPanel" tabindex="0">
          <div class="chatTabBar" id="chatTabBar"></div>
          <div class="panelHeader" data-i18n="panel.chat">${t('panel.chat')}</div>
          <div class="chatMessages" id="chatMessages"></div>
          <p class="chatLoginPrompt" id="chatLoginPrompt" style="display: none;" data-i18n="chat.loginPrompt">${t('chat.loginPrompt')}</p>
          <form class="chatInputForm" id="chatInputForm">
            <div class="chatInputResizer" id="chatInputResizer" data-i18n-title="resizer.horizontal" title="${t('resizer.horizontal')}"></div>
            <textarea id="chatInput" data-i18n-placeholder="chat.placeholder" placeholder="${t('chat.placeholder')}" autocomplete="off"></textarea>
            <div class="chatThinkWrap" id="thinkSwitchWrap">
              <span class="chatThinkLabel" id="thinkSwitchLabel">${t('ai.thinkMode')}</span>
              <label class="chatThinkSwitch" id="thinkSwitchControl" title="${t('ai.thinkMode')}">
                <input type="checkbox" id="thinkSwitchInput" />
                <span class="chatThinkSlider"></span>
              </label>
              <span class="chatThinkModel" id="thinkSwitchModel"></span>
            </div>
            <button type="submit" id="btnChatSend" data-i18n="chat.send">${t('chat.send')}</button>
          </form>
        </aside>
      </div>
      <div id="connectModal" class="connectModal" style="display: none;">
        <div class="connectModalBackdrop" id="connectModalBackdrop"></div>
        <div class="connectModalBox">
          <h2 class="connectModalTitle" data-i18n="connectModal.title">${t('connectModal.title')}</h2>
          <ul class="connectModalList" id="connectModalList"></ul>
          <div class="connectModalActions">
            <button type="button" id="btnConnectModalClose" data-i18n="form.cancel">${t('form.cancel')}</button>
          </div>
        </div>
      </div>
      <div id="addEditServerModal" class="addEditServerModal" style="display: none;">
        <div class="addEditServerModalBackdrop" id="addEditServerModalBackdrop"></div>
        <div class="addEditServerModalBox">
          <h2 id="formTitle" class="addEditServerModalTitle" data-i18n="form.addTitle">${t('form.addTitle')}</h2>
          <form id="envForm">
            <label><span data-i18n="form.name">${t('form.name')}</span> <input type="text" name="name" data-i18n-placeholder="form.placeholderName" placeholder="${t('form.placeholderName')}" /></label>
            <label><span data-i18n="form.host">${t('form.host')}</span> <input type="text" name="host" required data-i18n-placeholder="form.placeholderHost" placeholder="${t('form.placeholderHost')}" /></label>
            <label><span data-i18n="form.port">${t('form.port')}</span> <input type="number" name="port" value="22" /></label>
            <label><span data-i18n="form.username">${t('form.username')}</span> <input type="text" name="username" required data-i18n-placeholder="form.placeholderUser" placeholder="${t('form.placeholderUser')}" /></label>
            <label><span data-i18n="form.authType">${t('form.authType')}</span> <select name="authType"><option value="password">${t('form.authPassword')}</option><option value="key">${t('form.authKey')}</option></select></label>
            <label id="labelPassword"><span data-i18n="form.authPassword">${t('form.authPassword')}</span> <input type="password" name="password" /></label>
            <label id="labelKey" style="display: none;"><span data-i18n="form.privateKeyPath">${t('form.privateKeyPath')}</span> <input type="text" name="privateKeyPath" data-i18n-placeholder="form.placeholderKey" placeholder="${t('form.placeholderKey')}" /></label>
            <label><span data-i18n="form.memo">${t('form.memo')}</span> <input type="text" name="memo" data-i18n-placeholder="form.placeholderName" placeholder="${t('form.placeholderName')}" /></label>
            <div class="formActions">
              <button type="button" id="btnTestConnection" data-i18n="form.testConnection">${t('form.testConnection')}</button>
              <button type="submit" data-i18n="form.save">${t('form.save')}</button>
              <button type="button" id="btnCancel" data-i18n="form.cancel">${t('form.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
      <div id="messageModal" class="messageModal" style="display: none;">
        <div class="messageModalBackdrop" id="messageModalBackdrop"></div>
        <div class="messageModalBox">
          <h2 class="messageModalTitle" id="messageModalTitle" data-i18n="message.title">${t('message.title')}</h2>
          <div class="messageModalBody">
            <p id="messageModalText"></p>
          </div>
          <div class="messageModalActions">
            <button type="button" id="btnMessageOk" data-i18n="message.ok">${t('message.ok')}</button>
          </div>
        </div>
      </div>
      <div id="settingsModal" class="settingsModal" style="display: none;">
        <div class="settingsModalBackdrop" id="settingsModalBackdrop"></div>
        <div class="settingsModalBox">
          <h2 class="settingsModalTitle" data-i18n="settings.title">${t('settings.title')}</h2>
          <div class="settingsModalSection">
            <h3 class="settingsModalSectionTitle" data-i18n="settings.language">${t('settings.language')}</h3>
            <div class="settingsModalLanguage">
              <button type="button" id="btnLangEn" data-locale="en">English</button>
              <button type="button" id="btnLangZn" data-locale="zn">简体中文</button>
              <button type="button" id="btnLangRu" data-locale="ru">Русский</button>
            </div>
          </div>
          <div class="settingsModalSection">
            <h3 class="settingsModalSectionTitle" data-i18n="settings.theme">${t('settings.theme')}</h3>
            <div class="settingsModalLanguage">
              <button type="button" id="btnThemeDark" data-theme-value="dark" data-i18n="theme.dark">${t('theme.dark')}</button>
              <button type="button" id="btnThemeLight" data-theme-value="light" data-i18n="theme.light">${t('theme.light')}</button>
            </div>
          </div>
          <div class="settingsModalSection" id="aiSettingsSection">
            <h3 class="settingsModalSectionTitle" data-i18n="ai.title">${t('ai.title')}</h3>
            <div class="aiSettingsForm">
              <div class="aiSettingsField">
                <label data-i18n="ai.preset">${t('ai.preset')}</label>
                <select id="aiPresetSelect">
                  <option value="" data-i18n="ai.presetCustom">${t('ai.presetCustom')}</option>
                </select>
              </div>
              <div class="aiSettingsField">
                <label data-i18n="ai.apiUrl">${t('ai.apiUrl')}</label>
                <input type="text" id="aiApiUrl" data-i18n-placeholder="ai.placeholder.url" placeholder="${t('ai.placeholder.url')}" />
              </div>
              <div class="aiSettingsField">
                <label data-i18n="ai.apiKey">${t('ai.apiKey')}</label>
                <div class="aiSettingsKeyRow">
                  <input type="password" id="aiApiKey" data-i18n-placeholder="ai.placeholder.apiKey" placeholder="${t('ai.placeholder.apiKey')}" />
                  <button type="button" id="btnToggleApiKey" class="aiSettingsToggleBtn" data-i18n="ai.show">${t('ai.show')}</button>
                </div>
              </div>
              <div class="aiSettingsField">
                <label data-i18n="ai.model">${t('ai.model')}</label>
                <input type="text" id="aiModel" data-i18n-placeholder="ai.placeholder.model" placeholder="${t('ai.placeholder.model')}" />
              </div>
              <div class="aiSettingsField aiSettingsField--row">
                <div class="aiSettingsFieldHalf">
                  <label><span data-i18n="ai.temperature">${t('ai.temperature')}</span>: <span id="aiTempValue">0.7</span></label>
                  <input type="range" id="aiTemperature" min="0" max="2" step="0.1" value="0.7" />
                </div>
                <div class="aiSettingsFieldHalf">
                  <label data-i18n="ai.maxTokens">${t('ai.maxTokens')}</label>
                  <input type="number" id="aiMaxTokens" value="4096" min="1" max="128000" />
                </div>
              </div>
              <div class="aiSettingsField">
                <label data-i18n="ai.systemPrompt">${t('ai.systemPrompt')}</label>
                <textarea id="aiSystemPrompt" rows="3" data-i18n-placeholder="ai.placeholder.systemPrompt" placeholder="${t('ai.placeholder.systemPrompt')}"></textarea>
              </div>
              <div id="aiSettingsTestResult" class="aiSettingsTestResult" style="display:none;"></div>
              <div id="aiModelsList" class="aiModelsList" style="display:none;"></div>
              <div class="aiSettingsActions">
                <button type="button" id="btnAiDetectModels" data-i18n="ai.detectModels">${t('ai.detectModels')}</button>
                <button type="button" id="btnAiTest" data-i18n="ai.test">${t('ai.test')}</button>
                <button type="button" id="btnAiSave" data-i18n="ai.save">${t('ai.save')}</button>
              </div>
            </div>
          </div>
          <div class="settingsModalActions">
            <button type="button" id="btnSettingsClose" data-i18n="button.close">${t('button.close')}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

let initialSidebarRatioApplied = false;

function applyInitialSidebarRatio(): void {
  if (initialSidebarRatioApplied) return;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.clientHeight <= 0) return;
  initialSidebarRatioApplied = true;
  const resizerPx = RESIZER_HEIGHT * 2;
  const available = sidebar.clientHeight - resizerPx;
  // Split: servers ~40%, explorer ~35%, serverInfo ~25%
  state.sidebarExplorerHeight = Math.min(
    state.EXPLORER_HEIGHT_MAX,
    Math.max(state.EXPLORER_HEIGHT_MIN, Math.round(0.35 * available)),
  );
  state.sidebarServerInfoHeight = Math.min(
    state.SERVER_INFO_HEIGHT_MAX,
    Math.max(state.SERVER_INFO_HEIGHT_MIN, Math.round(0.25 * available)),
  );
}

const RESIZER_HEIGHT = 6;
const SERVERS_HEIGHT_MIN = 80;
const HEADER_HEIGHT = 36;

/** Recalculate all sidebar panel heights so servers fills remaining space. */
export function recalcSidebarLayout(): void {
  const sidebar = document.getElementById('sidebar');
  const serversEl = document.getElementById('sidebarServers');
  const explorerEl = document.getElementById('sidebarExplorer');
  const serverInfoEl = document.getElementById('sidebarServerInfo');
  if (!sidebar || !serversEl) return;

  const totalH = sidebar.clientHeight;
  const resizerH = RESIZER_HEIGHT * 2;
  const availableH = totalH - resizerH;

  // Collapsed panels use HEADER_HEIGHT; expanded panels use their saved height
  let explorerH = state.sidebarCollapsed.explorer ? HEADER_HEIGHT : state.sidebarExplorerHeight;
  let serverInfoH = state.sidebarCollapsed.serverInfo ? HEADER_HEIGHT : state.sidebarServerInfoHeight;

  // Servers fills remaining space
  let serversCalcH: number;
  if (state.sidebarCollapsed.servers) {
    serversCalcH = HEADER_HEIGHT;
  } else {
    serversCalcH = availableH - explorerH - serverInfoH;
    // If servers would be too small, shrink other expanded panels proportionally
    if (serversCalcH < SERVERS_HEIGHT_MIN) {
      const excess = SERVERS_HEIGHT_MIN - serversCalcH;
      const explorerExpanded = !state.sidebarCollapsed.explorer;
      const serverInfoExpanded = !state.sidebarCollapsed.serverInfo;
      if (explorerExpanded && serverInfoExpanded) {
        const totalOther = explorerH + serverInfoH;
        if (totalOther > 0) {
          const scale = Math.max(0, totalOther - excess) / totalOther;
          explorerH = Math.max(HEADER_HEIGHT, Math.round(explorerH * scale));
          serverInfoH = Math.max(HEADER_HEIGHT, Math.round(serverInfoH * scale));
        }
      } else if (explorerExpanded) {
        explorerH = Math.max(HEADER_HEIGHT, explorerH - excess);
      } else if (serverInfoExpanded) {
        serverInfoH = Math.max(HEADER_HEIGHT, serverInfoH - excess);
      }
      serversCalcH = Math.max(SERVERS_HEIGHT_MIN, availableH - explorerH - serverInfoH);
    }
  }

  // Sync state back so drag logic uses clamped values
  if (!state.sidebarCollapsed.explorer) state.sidebarExplorerHeight = explorerH;
  if (!state.sidebarCollapsed.serverInfo) state.sidebarServerInfoHeight = serverInfoH;
  state.sidebarServersHeight = serversCalcH;

  serversEl.style.flexBasis = state.sidebarCollapsed.servers ? `${HEADER_HEIGHT}px` : `${serversCalcH}px`;
  if (explorerEl) {
    explorerEl.style.flexBasis = `${explorerH}px`;
  }
  if (serverInfoEl) {
    serverInfoEl.style.flexBasis = `${serverInfoH}px`;
  }
}

export function applyPanelSizes(): void {
  const sidebarEl = document.getElementById('sidebar');
  const chatEl = document.getElementById('chatPanel');
  if (sidebarEl) sidebarEl.style.width = `${state.sidebarWidth}px`;
  if (chatEl) chatEl.style.width = `${state.chatPanelWidth}px`;
  requestAnimationFrame(() => {
    applyInitialSidebarRatio();
    recalcSidebarLayout();
  });
}

export function applyChatInputHeight(): void {
  const input = document.getElementById('chatInput') as HTMLTextAreaElement;
  if (input) input.style.height = `${state.chatTextareaHeight}px`;
}

export function bindResizers(): void {
  const resizerSidebar = document.getElementById('resizerSidebar');
  const resizerChat = document.getElementById('resizerChat');
  const resizerExplorer = document.getElementById('resizerExplorer');
  const sidebar = document.getElementById('sidebar');
  const chatPanel = document.getElementById('chatPanel');
  const sidebarExplorer = document.getElementById('sidebarExplorer');

  function dragVertical(startX: number, startW: number, onUpdate: (deltaX: number) => void): void {
    function move(e: MouseEvent) {
      onUpdate(e.clientX - startX);
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function dragHorizontal(startY: number, startH: number, onUpdate: (deltaY: number) => void): void {
    function move(e: MouseEvent) {
      onUpdate(e.clientY - startY);
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  resizerSidebar?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = state.sidebarWidth;
    dragVertical(startX, startW, (dx) => {
      state.sidebarWidth = Math.min(600, Math.max(200, startW + dx));
      if (sidebar) sidebar.style.width = `${state.sidebarWidth}px`;
    });
  });

  resizerChat?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = state.chatPanelWidth;
    dragVertical(startX, startW, (dx) => {
      state.chatPanelWidth = Math.min(800, Math.max(200, startW - dx));
      if (chatPanel) chatPanel.style.width = `${state.chatPanelWidth}px`;
    });
  });

  resizerExplorer?.addEventListener('mousedown', (e) => {
    if (state.sidebarCollapsed.explorer || state.sidebarCollapsed.servers) return;
    e.preventDefault();
    const startY = e.clientY;
    const startExplorerH = state.sidebarExplorerHeight;
    const startServersH = state.sidebarServersHeight;
    dragHorizontal(startY, startExplorerH, (dy) => {
      const newServersH = Math.min(
        state.sidebarExplorerHeight + state.sidebarServersHeight - state.EXPLORER_HEIGHT_MIN,
        Math.max(SERVERS_HEIGHT_MIN, startServersH + dy),
      );
      const delta = newServersH - startServersH;
      const newExplorerH = startExplorerH - delta;
      state.sidebarExplorerHeight = newExplorerH;
      state.sidebarServersHeight = newServersH;
      if (sidebarExplorer) sidebarExplorer.style.flexBasis = `${newExplorerH}px`;
      const serversEl = document.getElementById('sidebarServers');
      if (serversEl) serversEl.style.flexBasis = `${newServersH}px`;
    });
  });

  const resizerServerInfo = document.getElementById('resizerServerInfo');
  const sidebarServerInfo = document.getElementById('sidebarServerInfo');
  resizerServerInfo?.addEventListener('mousedown', (e) => {
    if (state.sidebarCollapsed.serverInfo || state.sidebarCollapsed.explorer) return;
    e.preventDefault();
    const startY = e.clientY;
    const startServerInfoH = state.sidebarServerInfoHeight;
    const startExplorerH = state.sidebarExplorerHeight;
    dragHorizontal(startY, startServerInfoH, (dy) => {
      const newExplorerH = Math.min(
        state.sidebarExplorerHeight + state.sidebarServerInfoHeight - state.SERVER_INFO_HEIGHT_MIN,
        Math.max(state.EXPLORER_HEIGHT_MIN, startExplorerH + dy),
      );
      const delta = newExplorerH - startExplorerH;
      const newServerInfoH = startServerInfoH - delta;
      state.sidebarServerInfoHeight = newServerInfoH;
      state.sidebarExplorerHeight = newExplorerH;
      if (sidebarServerInfo) sidebarServerInfo.style.flexBasis = `${newServerInfoH}px`;
      if (sidebarExplorer) sidebarExplorer.style.flexBasis = `${newExplorerH}px`;
    });
  });

  // Recalculate layout when sidebar resizes (e.g. window resize)
  if (sidebar) {
    new ResizeObserver(() => recalcSidebarLayout()).observe(sidebar);
  }
}

export function bindChatInputResizer(): void {
  const resizer = document.getElementById('chatInputResizer');
  const textarea = document.getElementById('chatInput');
  if (!resizer || !textarea) return;
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = state.chatTextareaHeight;
    function move(ev: MouseEvent) {
      const dy = ev.clientY - startY;
      state.chatTextareaHeight = Math.min(
        state.CHAT_INPUT_HEIGHT_MAX,
        Math.max(state.CHAT_INPUT_HEIGHT_MIN, startH - dy),
      );
      (textarea as HTMLTextAreaElement).style.height = `${state.chatTextareaHeight}px`;
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

export function setupTerminalResizeObserver(api: NonNullable<typeof window.electronAPI>): void {
  const container = document.getElementById('terminalContainer');
  if (!container) return;
  const observer = new ResizeObserver(() => {
    const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
    if (activeTab?.kind === 'terminal' && state.activeTabConnectionId !== null) {
      const inst = state.terminalInstances.get(state.activeTabConnectionId);
      inst?.fitAddon.fit();
      terminal.sendTerminalResize(api, state.activeTabConnectionId);
    } else if (activeTab?.kind === 'local-terminal') {
      const inst = state.localTerminalInstances.get(activeTab.id);
      if (inst) {
        inst.fitAddon.fit();
        const dims = inst.fitAddon.proposeDimensions();
        if (dims && api.terminal?.localResize) api.terminal.localResize(activeTab.id, dims.cols, dims.rows);
      }
    }
  });
  observer.observe(container);
}

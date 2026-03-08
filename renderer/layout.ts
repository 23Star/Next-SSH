import { state } from './state';
import { t } from './i18n';
import * as terminal from './terminal';

export function renderLayout(root: HTMLElement): void {
  root.innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <section class="sidebarSection servers">
          <div class="sidebarHeader" data-i18n="sidebar.connectList">${t('sidebar.connectList')}</div>
          <ul class="connectList" id="connectList" tabindex="0"></ul>
          <div class="sidebarFooter">
            <button type="button" id="btnSidebarConnect" data-i18n="button.connect">${t('button.connect')}</button>
            <button type="button" id="btnAdd" data-i18n="sidebar.add">${t('sidebar.add')}</button>
          </div>
        </section>
        <div class="layoutResizer layoutResizer--horizontal" id="resizerExplorer" data-i18n-title="resizer.horizontal" title="${t('resizer.horizontal')}"></div>
        <section class="sidebarSection explorer" id="sidebarExplorer">
          <div class="explorerPanelHeader">
            <span class="panelHeader" data-i18n="panel.explorer">${t('panel.explorer')}</span>
            <div class="explorerTabBar" id="explorerTabBar"></div>
            <button type="button" id="btnExplorerUp" class="explorerUpBtn" title="上へ" aria-label="上へ">↑</button>
            <button type="button" id="btnExplorerReload" class="explorerUpBtn" data-i18n-title="reload" title="${t('reload')}" aria-label="${t('reload')}">↻</button>
          </div>
          <div class="explorerTreeContainer" id="explorerTreeContainer" tabindex="0"></div>
        </section>
      </aside>
      <div class="layoutResizer layoutResizer--vertical" id="resizerSidebar" data-i18n-title="resizer.vertical" title="${t('resizer.vertical')}"></div>
      <div class="contentArea">
        <main class="mainArea">
          <div id="welcomeArea">
            <h1>AISSH</h1>
            <p class="mainAreaPlaceholder" id="mainPlaceholder" data-i18n="main.placeholder">${t('main.placeholder')}</p>
            <p class="mainAreaPlaceholder" style="margin-top: 8px;"><button type="button" id="btnConnect" data-i18n="button.connect">${t('button.connect')}</button></p>
            <p class="mainAreaPlaceholder" style="margin-top: 4px;"><button type="button" id="btnOpenLocalTerminal">Local</button></p>
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
                <span class="diffPreviewHint">受け入れ Ctrl+Y または Ctrl+Shift+Y / 拒否 Ctrl+N</span>
                <button type="button" id="btnDiffApply">適用する</button>
                <button type="button" id="btnDiffCancel">キャンセル</button>
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
              <button type="submit" data-i18n="form.save">${t('form.save')}</button>
              <button type="button" id="btnCancel" data-i18n="form.cancel">${t('form.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
      <div id="messageModal" class="messageModal" style="display: none;">
        <div class="messageModalBackdrop" id="messageModalBackdrop"></div>
        <div class="messageModalBox">
          <h2 class="messageModalTitle" id="messageModalTitle">Message</h2>
          <div class="messageModalBody">
            <p id="messageModalText"></p>
          </div>
          <div class="messageModalActions">
            <button type="button" id="btnMessageOk">OK</button>
          </div>
        </div>
      </div>
      <div id="settingsModal" class="settingsModal" style="display: none;">
        <div class="settingsModalBackdrop" id="settingsModalBackdrop"></div>
        <div class="settingsModalBox">
          <h2 class="settingsModalTitle">Settings</h2>
          <div class="settingsModalSection">
            <h3 class="settingsModalSectionTitle">Account</h3>
            <div id="firebaseAuthSection">
              <div class="settingsAccountRow">
                <button type="button" id="btnFirebaseLogin" data-i18n="auth.login">${t('auth.login')}</button>
                <button type="button" id="btnFirebaseSignUp" data-i18n="auth.signUp">${t('auth.signUp')}</button>
                <span id="firebaseUserEmail" style="display: none;"></span>
                <button type="button" id="btnFirebaseLogout" style="display: none;">Log out</button>
              </div>
              <div class="settingsAccountRow settingsAccountRow--billing">
                <button type="button" id="btnBilling" style="display: none;">Subscribe</button>
              </div>
            </div>
          </div>
          <div class="settingsModalSection">
            <h3 class="settingsModalSectionTitle">Language</h3>
            <div class="settingsModalLanguage">
              <button type="button" id="btnLangJa" data-locale="ja">日本語</button>
              <button type="button" id="btnLangEn" data-locale="en">English</button>
              <button type="button" id="btnLangZn" data-locale="zn">简体中文</button>
            </div>
          </div>
          <div class="settingsModalActions">
            <button type="button" id="btnSettingsClose">Close</button>
          </div>
        </div>
      </div>
      <div id="accountListModal" class="accountListModal" style="display: none;">
        <div class="accountListModalBackdrop" id="accountListModalBackdrop"></div>
        <div class="accountListModalBox">
          <h2 class="accountListModalTitle" id="accountListModalTitle" data-i18n="auth.accountListTitle">${t('auth.accountListTitle')}</h2>
          <div class="accountListModalList" id="accountListModalList"></div>
          <div class="accountListModalActions">
            <button type="button" id="accountListModalOther" data-i18n="auth.otherAccount">${t('auth.otherAccount')}</button>
            <button type="button" id="accountListModalClose">Close</button>
          </div>
        </div>
      </div>
      <div id="planModal" class="planModal" style="display: none;">
        <div class="planModalBackdrop" id="planModalBackdrop"></div>
        <div class="planModalBox">
          <h2 class="planModalTitle" data-i18n="plan.title">${t('plan.title')}</h2>
          <div class="planModalPlans">
            <div class="planModalPlan" data-plan="standard">
              <div class="planModalPlanName" data-i18n="plan.standard">${t('plan.standard')}</div>
              <div class="planModalPlanPrice" data-i18n="plan.price2000">${t('plan.price2000')}</div>
              <div class="planModalPlanDetail" data-i18n="plan.tokens10M">${t('plan.tokens10M')}</div>
              <button type="button" class="planModalPlanBtn" data-i18n="plan.subscribe">${t('plan.subscribe')}</button>
            </div>
            <div class="planModalPlan" data-plan="pro">
              <div class="planModalPlanName" data-i18n="plan.pro">${t('plan.pro')}</div>
              <div class="planModalPlanPrice" data-i18n="plan.price5000">${t('plan.price5000')}</div>
              <div class="planModalPlanDetail" data-i18n="plan.tokens40M">${t('plan.tokens40M')}</div>
              <button type="button" class="planModalPlanBtn" data-i18n="plan.subscribe">${t('plan.subscribe')}</button>
            </div>
            <div class="planModalPlan" data-plan="expert">
              <div class="planModalPlanName" data-i18n="plan.expert">${t('plan.expert')}</div>
              <div class="planModalPlanPrice" data-i18n="plan.price30000">${t('plan.price30000')}</div>
              <div class="planModalPlanDetail" data-i18n="plan.tokens200M">${t('plan.tokens200M')}</div>
              <button type="button" class="planModalPlanBtn" data-i18n="plan.subscribe">${t('plan.subscribe')}</button>
            </div>
          </div>
          <div class="planModalActions">
            <button type="button" id="btnPlanClose" data-i18n="plan.cancel">${t('plan.cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

let initialSidebarRatioApplied = false;

/** 起動時のサーバーリスト : エクスプローラー = 4 : 6 にする。レイアウト確定後に1回だけ適用。 */
function applyInitialSidebarRatio(): void {
  if (initialSidebarRatioApplied) return;
  const sidebar = document.getElementById('sidebar');
  const explorerEl = document.getElementById('sidebarExplorer');
  if (!sidebar || !explorerEl || sidebar.clientHeight <= 0) return;
  initialSidebarRatioApplied = true;
  const resizerPx = 8;
  const h = Math.round(0.6 * (sidebar.clientHeight - resizerPx));
  state.sidebarExplorerHeight = Math.min(
    state.EXPLORER_HEIGHT_MAX,
    Math.max(state.EXPLORER_HEIGHT_MIN, h),
  );
  explorerEl.style.flexBasis = `${state.sidebarExplorerHeight}px`;
}

export function applyPanelSizes(): void {
  const sidebarEl = document.getElementById('sidebar');
  const chatEl = document.getElementById('chatPanel');
  const explorerEl = document.getElementById('sidebarExplorer');
  if (sidebarEl) sidebarEl.style.width = `${state.sidebarWidth}px`;
  if (chatEl) chatEl.style.width = `${state.chatPanelWidth}px`;
  if (explorerEl) {
    explorerEl.style.flexBasis = `${state.sidebarExplorerHeight}px`;
    requestAnimationFrame(() => applyInitialSidebarRatio());
  }
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
    e.preventDefault();
    const startY = e.clientY;
    const startH = state.sidebarExplorerHeight;
    dragHorizontal(startY, startH, (dy) => {
      state.sidebarExplorerHeight = Math.min(
        state.EXPLORER_HEIGHT_MAX,
        Math.max(state.EXPLORER_HEIGHT_MIN, startH - dy),
      );
      if (sidebarExplorer) sidebarExplorer.style.flexBasis = `${state.sidebarExplorerHeight}px`;
    });
  });
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

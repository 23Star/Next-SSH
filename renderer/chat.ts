import type { ChatMessage } from './types';
import { state } from './state';
import { t } from './i18n';
import { escapeHtml } from './util';
import * as terminal from './terminal';
import * as editor from './editor';
import { showMessage } from './message';

type Api = NonNullable<typeof window.electronAPI>;

/** システムプロンプト（言語未取得時のフォールバック・日本語） */
const CHAT_SYSTEM_PROMPT_FALLBACK = `あなたは Linux サーバー管理のアシスタントです。ユーザーの質問に答え、必要な場合は実行可能なコマンドを提案してください。
コマンドを提案する場合は、必ず次の形式のコードブロックで1行ずつ書いてください。
\`\`\`bash
コマンド1
コマンド2
\`\`\`
説明はコードブロックの外に書いてください。

【ファイル修正】ユーザーがファイルの変更を依頼した場合、変更内容は必ず次の形式のコードブロック1つで返してください。ブロック内で 1 行目に ---OLD---、2 行目以降に「置き換え前の文字列」（省略可）、その次に ---NEW--- の行、その後に「置き換え後の文字列」を書きます。既存ファイルの一部だけを変える場合は、該当箇所の前後を含めて一意に特定できる範囲で OLD を書いてください。新規作成やファイル全体の上書きの場合は、OLD を空にすること（---OLD--- の直後に ---NEW--- を書く）。NEW では既存コードと同じインデント（空白・タブ）に合わせること。ファイル先頭で use しているクラスは先頭のバックスラッシュ（\\）を付けずに書くこと。
\`\`\`
---OLD---
（置き換え前。全体上書きの場合は空でよい）
---NEW---
（置き換え後の文字列。複数行可）
\`\`\`

【重要】この会話では、システムメッセージの末尾に「直近のターミナル出力」が付与されている場合があります。その内容はあなたが参照できる共有情報です。「ターミナルを見れない」「直接確認できない」などと答えず、付与されているターミナル出力を根拠に回答してください。付与されていない場合（空の場合）のみ、必要なら「ターミナル出力を共有してください」と伝えてください。

質問に対して、まず1〜2文で結論（いちばんメジャーな答え）を書き、そのあと必要なら詳細や例外を書く。
相手が初心者か上級者か分からないときは、最初は一般的で分かりやすい説明にし、『もっと詳しく』と言われたら技術的に深く答える。`;

let cachedCustomSystemPrompt: string | null = null;

/** ユーザー設定のシステムプロンプトをキャッシュする（設定画面で保存時に更新） */
export function setCustomSystemPrompt(prompt: string | null): void {
  cachedCustomSystemPrompt = prompt;
}

function getChatSystemPrompt(): string {
  if (cachedCustomSystemPrompt && cachedCustomSystemPrompt.trim()) {
    return cachedCustomSystemPrompt.trim();
  }
  const p = t('chat.systemPrompt');
  return p && p !== 'chat.systemPrompt' ? p : CHAT_SYSTEM_PROMPT_FALLBACK;
}

export function getCurrentChatMessages(): ChatMessage[] {
  if (state.activeChatSessionId === null) return [];
  return state.chatMessagesBySession[state.activeChatSessionId] ?? [];
}

function extractSuggestedCommands(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:bash|sh)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    block.split('\n').forEach((line) => {
      const t = line.trim();
      if (t && !t.startsWith('#')) blocks.push(t);
    });
  }
  return blocks;
}

/** メッセージ内の全コードブロックを抽出（言語問わず）。ファイル修正の「適用」用。 */
function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:[\w+-]*)\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trimEnd());
  }
  return blocks;
}

/** search_replace 形式のブロックをパース。---OLD---/---NEW--- または --OLD--/--NEW-- の行で区切られた場合に { old, new } を返す。 */
function parseSearchReplaceBlock(block: string): { old: string; new: string } | null {
  const lines = block.split('\n');
  const isOld = (l: string) => { const t = l.trim(); return t === '---OLD---' || t === '--OLD--'; };
  const isNew = (l: string) => { const t = l.trim(); return t === '---NEW---' || t === '--NEW--'; };
  const i = lines.findIndex((l) => isOld(l));
  const j = lines.findIndex((l) => isNew(l));
  if (i === -1 || j === -1 || j <= i) return null;
  const oldStr = lines.slice(i + 1, j).join('\n').trimEnd();
  const newStr = lines.slice(j + 1).join('\n').trimEnd();
  return { old: oldStr, new: newStr };
}

export function renderChatMessages(): void {
  const el = document.getElementById('chatMessages');
  if (!el) return;
  const messages = getCurrentChatMessages();
  if (messages.length === 0) {
    el.innerHTML = `<p class="chatEmpty">${t('chat.empty')}</p>`;
    return;
  }
  el.innerHTML = messages
    .map((m, msgIndex) => {
      return `<div class="chatMessage chatMessage--${m.role}" data-msg-index="${msgIndex}">
        <span class="chatMessageRole">${m.role === 'user' ? t('chat.roleUser') : t('chat.roleAi')}</span>
        <div class="chatMessageContent">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
      </div>`;
    })
    .join('');
  el.scrollTop = el.scrollHeight;
}

let apiRef: Api | null = null;

export function setChatApi(api: Api): void {
  apiRef = api;
}

const APPLY_LOG = '[AISSH apply]';

function logToStdout(...args: unknown[]): void {
  window.electronAPI?.logToMain?.(APPLY_LOG, ...args);
}

/** 行同士の類似度 0〜1。AI の誤字・余分スペースで完全一致しないときの照合用。レーベンシュタイン距離で 1 - distance/maxLen。 */
function lineSimilarity(a: string, b: string): number {
  const ta = a.trimEnd();
  const tb = b.trimEnd();
  if (ta === tb) return 1;
  const la = ta.length;
  const lb = tb.length;
  const maxLen = Math.max(la, lb, 1);
  const d = levenshtein(ta, tb);
  return 1 - d / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** ファイル内容の行ごとの開始・終了オフセット。 */
function getLineBoundaries(content: string): { start: number; end: number }[] {
  const boundaries: { start: number; end: number }[] = [];
  let start = 0;
  const re = /\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    boundaries.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  boundaries.push({ start, end: content.length });
  return boundaries;
}

/** ブロック内容と現在のエディタ内容から「適用後の内容」を計算する。OLD が見つからない場合は null。 */
function computeProposedContent(blockContent: string, currentContent: string): string | null {
  const parsed = parseSearchReplaceBlock(blockContent);
  if (parsed) {
    let idx = currentContent.indexOf(parsed.old);
    let oldLen = parsed.old.length;
    if (idx === -1) {
      const trimmed = parsed.old.trim();
      idx = currentContent.indexOf(trimmed);
      if (idx !== -1) oldLen = trimmed.length;
    }
    if (idx === -1 && parsed.old.length > 0) {
      const boundaries = getLineBoundaries(currentContent);
      const fileLines = boundaries.map((b) => currentContent.slice(b.start, b.end));
      const oldLines = parsed.old.split(/\r?\n/);
      if (oldLines.length <= fileLines.length) {
        const threshold = 0.8;
        const minMatchRatio = 0.9;
        for (let start = 0; start <= fileLines.length - oldLines.length; start++) {
          let matchCount = 0;
          for (let j = 0; j < oldLines.length; j++) {
            if (lineSimilarity(fileLines[start + j], oldLines[j]) >= threshold) matchCount++;
          }
          if (matchCount >= oldLines.length * minMatchRatio) {
            const blockStart = boundaries[start].start;
            const blockEnd = boundaries[start + oldLines.length - 1].end;
            return currentContent.slice(0, blockStart) + parsed.new + currentContent.slice(blockEnd);
          }
        }
      }
    }
    if (idx === -1) return null;
    return currentContent.slice(0, idx) + parsed.new + currentContent.slice(idx + oldLen);
  }
  return blockContent;
}

/** 隣り合う2ブロックを「置換前・置換後」として適用後の内容を返す。変化がなければ null。 */
function computeProposedContentFromPair(oldBlock: string, newBlock: string, currentContent: string): string | null {
  let idx = currentContent.indexOf(oldBlock);
  let oldLen = oldBlock.length;
  if (idx === -1) {
    const trimmed = oldBlock.trim();
    idx = currentContent.indexOf(trimmed);
    if (idx !== -1) oldLen = trimmed.length;
  }
  if (idx === -1) return null;
  const proposed = currentContent.slice(0, idx) + newBlock + currentContent.slice(idx + oldLen);
  return proposed !== currentContent ? proposed : null;
}

/** 直近の AI メッセージにコードブロックがあれば、アクティブがエディタのとき diff プレビューを即開く。
 * @param forSessionId 指定時はそのセッションの最後のメッセージを使う（送信直後の diff 用）。未指定時はアクティブセッション。
 */
export async function tryOpenDiffPreviewForLastMessage(forSessionId?: number | null): Promise<void> {
  const messages = forSessionId != null
    ? (state.chatMessagesBySession[forSessionId] ?? [])
    : getCurrentChatMessages();
  const last = messages[messages.length - 1];
  logToStdout('tryOpenDiffPreviewForLastMessage START', 'sessionId', forSessionId ?? state.activeChatSessionId, 'msgCount', messages.length);
  if (!last) {
    logToStdout('tryOpenDiffPreview early return: no messages');
    return;
  }
  if (last.role !== 'assistant') {
    logToStdout('tryOpenDiffPreview early return: last role is', last.role);
    return;
  }
  const blocks = extractCodeBlocks(last.content);
  logToStdout('tryOpenDiffPreview blocks.length', blocks.length, 'blocks[0] len', blocks[0]?.length ?? 0);
  if (blocks.length === 0) {
    logToStdout('tryOpenDiffPreview early return: no blocks');
    return;
  }
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (!activeTab || activeTab.kind !== 'editor') {
    logToStdout('tryOpenDiffPreview early return: activeTab is not editor', activeTab?.kind ?? 'no-tab');
    return;
  }
  const inst = state.editorInstances.get(activeTab.id);
  if (!inst) {
    logToStdout('tryOpenDiffPreview early return: no editor instance', activeTab.id);
    return;
  }
  const currentContent = (inst.editor as { getValue(): string }).getValue();
  logToStdout('tryOpenDiffPreview currentContent.length', currentContent.length);
  for (let bi = 0; bi < blocks.length; bi++) {
    const proposedContent = computeProposedContent(blocks[bi], currentContent);
    const same = proposedContent === currentContent;
    logToStdout('tryOpenDiffPreview block', bi, 'proposed', proposedContent === null ? 'null' : 'ok', 'same', same, 'proposedLen', proposedContent?.length ?? 0);
    if (proposedContent !== null && !same) {
      const opened = await editor.setPendingDiff(activeTab.id, proposedContent);
      logToStdout('tryOpenDiffPreview setPendingDiff(block)', bi, 'opened', opened);
      if (opened) return;
    }
  }
  for (let i = 0; i + 1 < blocks.length; i++) {
    const proposedContent = computeProposedContentFromPair(blocks[i], blocks[i + 1], currentContent);
    logToStdout('tryOpenDiffPreview pair', i, i + 1, 'proposed', proposedContent === null ? 'null' : 'ok');
    if (proposedContent !== null) {
      const opened = await editor.setPendingDiff(activeTab.id, proposedContent);
      logToStdout('tryOpenDiffPreview setPendingDiff(pair)', i, 'opened', opened);
      if (opened) return;
    }
  }
  logToStdout('tryOpenDiffPreview END: no diff opened');
}

/** チャットのコードブロックをアクティブなエディタに適用する。diff プレビューを開き、受け入れ Ctrl+Shift+Y / 拒否 Ctrl+N。 */
async function applySearchReplaceToEditor(btn: HTMLButtonElement): Promise<void> {
  const api = apiRef;
  if (!api) return;
  const msgIndex = Number(btn.dataset.msgIndex);
  const blockIndex = Number(btn.dataset.blockIndex);
  const messages = getCurrentChatMessages();
  const msg = messages[msgIndex];
  if (msg?.role !== 'assistant') return;
  const blocks = extractCodeBlocks(msg.content);
  const content = blocks[blockIndex];
  if (content == null) {
    logToStdout('WARN block not found', { msgIndex, blockIndex });
    return;
  }
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (activeTab?.kind !== 'editor') {
    logToStdout('WARN active tab is not editor', { activeTab: activeTab?.kind });
    void showMessage({
      title: 'Diff',
      message: 'エディタでファイルを開いてから操作してください。',
    });
    return;
  }
  const inst = state.editorInstances.get(activeTab.id);
  if (!inst) return;
  const currentContent = (inst.editor as { getValue(): string }).getValue();
  const proposedContent = computeProposedContent(content, currentContent);
  if (proposedContent === null) {
    logToStdout('WARN OLD not found in file');
    void showMessage({
      title: 'Diff',
      message:
        'ファイル内に OLD の文字列が見つかりません。内容が変わっているか、前後を含めて一意に一致する範囲で OLD を書き直してください。',
    });
    return;
  }
  const parsed = parseSearchReplaceBlock(content);
  logToStdout('opening diff preview', { blockIndex, filePath: activeTab.filePath });
  const opened = await editor.setPendingDiff(activeTab.id, proposedContent);
  if (!opened) {
    logToStdout('diff unchanged or error, applying directly');
    if (parsed) {
      editor.applySearchReplace(activeTab.id, parsed.old, parsed.new);
    } else {
      editor.applySearchReplace(activeTab.id, '', content);
    }
  }
  logToStdout('done');
  terminal.renderMainPanelTabBar(api);
}

export async function sendChatMessage(api: Api, userContent: string): Promise<void> {
  if (!userContent.trim() || !api.chat || state.chatLoading || state.activeChatSessionId === null) return;
  if (!api.chatContext) return;
  const content = userContent.trim();
  const sessionId = state.activeChatSessionId;
  const userRow = await api.chatContext.add(sessionId, 'user', content);
  if (!state.chatMessagesBySession[sessionId]) state.chatMessagesBySession[sessionId] = [];
  state.chatMessagesBySession[sessionId].push({
    id: userRow.id,
    role: 'user',
    content: userRow.content,
    suggestedCommands: userRow.suggestedCommands ?? undefined,
  });
  renderChatMessages();
  state.chatLoading = true;
  const sendBtn = document.getElementById('btnChatSend');
  if (sendBtn) (sendBtn as HTMLButtonElement).disabled = true;
  try {
    const messages = getCurrentChatMessages();
    const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
    const buf =
      activeTab?.kind === 'terminal'
        ? (state.terminalBufferByConnection[activeTab.connectionId] ?? '')
        : activeTab?.kind === 'local-terminal'
          ? (state.localTerminalBufferByTabId[activeTab.id] ?? '')
          : '';
    const terminalContext =
      buf.trim().length > 0
        ? `\n\n【直近のターミナル出力（参考）】以下はユーザーが接続しているターミナルの直近の出力です。この内容を参照して回答してください。\n---\n${buf.trim().slice(-8000)}`
        : '';

    // パターンA: 開いているエディタのファイル内容を AI に渡す（プロジェクト制なし・相対パスは使わない）
    const FILE_CONTEXT_MAX = 12000;
    let fileContext = '';
    if (activeTab?.kind === 'editor') {
      const editorInstance = state.editorInstances.get(activeTab.id);
      const text = editorInstance?.editor.getValue() ?? '';
      if (text.trim().length > 0) {
        const trimmed = text.length > FILE_CONTEXT_MAX ? text.slice(-FILE_CONTEXT_MAX) : text;
        fileContext = `\n\n【開いているファイル（エディタ）】以下はユーザーがエディタで開いているファイルの内容です。パス: ${activeTab.filePath}\n---\n${trimmed}`;
      }
    }

    const payload = [
      { role: 'system' as const, content: getChatSystemPrompt() + terminalContext + fileContext },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];
    const reply = await api.chat.complete(payload);
    if (!reply) throw new Error('AI からの応答がありませんでした。');
    const suggestedCommands = extractSuggestedCommands(reply);
    const assistantRow = await api.chatContext.add(sessionId, 'assistant', reply, suggestedCommands);
    state.chatMessagesBySession[sessionId].push({
      id: assistantRow.id,
      role: 'assistant',
      content: assistantRow.content,
      suggestedCommands: assistantRow.suggestedCommands ?? undefined,
    });
    renderChatMessages();
    await tryOpenDiffPreviewForLastMessage(sessionId);
  } catch (err) {
    const errContent = `エラー: ${err instanceof Error ? err.message : String(err)}`;
    const assistantRow = await api.chatContext.add(sessionId, 'assistant', errContent);
    state.chatMessagesBySession[sessionId].push({
      id: assistantRow.id,
      role: 'assistant',
      content: assistantRow.content,
    });
    renderChatMessages();
  } finally {
    state.chatLoading = false;
    if (sendBtn) (sendBtn as HTMLButtonElement).disabled = false;
  }
}

export function renderChatTabBar(): void {
  const bar = document.getElementById('chatTabBar');
  if (!bar) return;
  if (!apiRef?.chatSession) {
    bar.innerHTML = '';
    return;
  }
  const api = apiRef;
  bar.innerHTML =
    state.chatSessions
      .map(
        (s) =>
          `<span class="chatTab ${s.id === state.activeChatSessionId ? 'active' : ''}" data-session-id="${s.id}" title="${escapeHtml(s.title)}">
            <span class="chatTabLabel">${escapeHtml(s.title)}</span>
            <button type="button" class="chatTabClose" data-session-id="${s.id}" aria-label="${t('chat.tabClose')}">×</button>
          </span>`,
      )
      .join('') +
    `<button type="button" class="chatTabNew" id="btnChatTabNew" aria-label="${t('chat.newChat')}">+</button>`;

  bar.querySelectorAll('.chatTab').forEach((el) => {
    const sessionId = Number((el as HTMLElement).dataset.sessionId);
    el.querySelector('.chatTabLabel')?.addEventListener('click', () => switchChatTab(api, sessionId));
    el.querySelector('.chatTabClose')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeChatTab(api, sessionId);
    });
  });
  document.getElementById('btnChatTabNew')?.addEventListener('click', () => addChatTab(api));
}

export async function loadChatSessions(api: Api): Promise<void> {
  if (!api.chatSession) return;
  const list = await api.chatSession.list();
  state.chatSessions = list.map((s) => ({ id: s.id, title: s.title }));
  if (state.chatSessions.length === 0) {
    const created = await api.chatSession.create(t('chat.newChat'));
    state.chatSessions = [{ id: created.id, title: created.title }];
    state.activeChatSessionId = created.id;
    state.chatMessagesBySession[created.id] = [];
  } else {
    if (state.activeChatSessionId === null || !state.chatSessions.some((s) => s.id === state.activeChatSessionId)) {
      state.activeChatSessionId = state.chatSessions[0].id;
    }
    const messages = await api.chatContext!.listBySession(state.activeChatSessionId);
    state.chatMessagesBySession[state.activeChatSessionId] = messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      suggestedCommands: m.suggestedCommands ?? undefined,
    }));
  }
  renderChatTabBar();
  renderChatMessages();
}

export function switchChatTab(api: Api, sessionId: number): void {
  if (!state.chatSessions.some((s) => s.id === sessionId)) return;
  state.activeChatSessionId = sessionId;
  renderChatTabBar();
  if (!(sessionId in state.chatMessagesBySession) && api.chatContext) {
    api.chatContext.listBySession(sessionId).then((messages) => {
      state.chatMessagesBySession[sessionId] = messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        suggestedCommands: m.suggestedCommands ?? undefined,
      }));
      renderChatMessages();
    });
  } else {
    renderChatMessages();
  }
}

export async function addChatTab(api: Api): Promise<void> {
  if (!api.chatSession) return;
  const created = await api.chatSession.create(t('chat.newChat'));
  state.chatSessions.push({ id: created.id, title: created.title });
  state.activeChatSessionId = created.id;
  state.chatMessagesBySession[created.id] = [];
  renderChatTabBar();
  renderChatMessages();
}

export function closeChatTab(api: Api, sessionId: number): void {
  if (!api.chatSession) return;
  const idx = state.chatSessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  api.chatSession.delete(sessionId);
  state.chatSessions.splice(idx, 1);
  delete state.chatMessagesBySession[sessionId];
  if (state.activeChatSessionId === sessionId) {
    state.activeChatSessionId = state.chatSessions.length > 0 ? state.chatSessions[Math.min(idx, state.chatSessions.length - 1)].id : null;
  }
  renderChatTabBar();
  renderChatMessages();
}

/** AI 未設定時は送信不可＋設定促し表示。設定済み時は有効。 */
export async function updateChatFormLoginState(): Promise<void> {
  const configured = await window.electronAPI?.aiSettings?.isConfigured() ?? false;
  const prompt = document.getElementById('chatLoginPrompt');
  const sendBtn = document.getElementById('btnChatSend');
  const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  if (prompt) prompt.style.display = configured ? 'none' : 'block';
  if (sendBtn) (sendBtn as HTMLButtonElement).disabled = !configured;
  if (input) input.disabled = !configured;
}

export function bindChatEvents(api: Api): void {
  apiRef = api;
  updateChatFormLoginState();
  const form = document.getElementById('chatInputForm');
  const input = document.getElementById('chatInput') as HTMLTextAreaElement;
  if (!form || !input) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    sendChatMessage(api, text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const text = input.value;
      input.value = '';
      sendChatMessage(api, text);
    }
  });

  // チャットパネル内のどこをクリックしてもフォーカスし、Ctrl+Tab でタブ移動できるようにする
  const panel = document.getElementById('chatPanel');
  if (panel) {
    panel.addEventListener('mousedown', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !panel.contains(t)) return;
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(t.tagName)) return;
      const tabindex = t.getAttribute('tabindex');
      if (tabindex !== null && tabindex !== '-1') return;
      panel.focus();
    });
  }
}

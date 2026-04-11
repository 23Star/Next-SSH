import type { ChatMessage } from './types';
import { state } from './state';
import { t } from './i18n';
import { escapeHtml } from './util';
import { marked } from 'marked';
import * as terminal from './terminal';
import * as editor from './editor';
import { showMessage } from './message';

type Api = NonNullable<typeof window.electronAPI>;

const CHAT_SYSTEM_PROMPT_FALLBACK = `You are a Linux server management assistant. Answer user questions and suggest runnable commands when needed.
When suggesting commands, write them in code block format, one per line.
\`\`\`bash
command1
command2
\`\`\`
Write explanations outside the code block.

[File edits] When the user asks for file changes, respond with one code block. First line ---OLD---, then "before" string (optional), then ---NEW---, then "after" string. For partial changes include enough context. For new files leave OLD empty.
\`\`\`
---OLD---
(before; leave empty for full overwrite)
---NEW---
(after; multiple lines OK)
\`\`\`

[Important] Terminal output may be attached at the end of system messages. Use it as reference. Only ask for terminal output if none is provided.
Answer in 1-2 sentences first, then add details if needed.`;

let cachedCustomSystemPrompt: string | null = null;

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
      const l = line.trim();
      if (l && !l.startsWith('#')) blocks.push(l);
    });
  }
  return blocks;
}

function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:[\w+-]*)\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trimEnd());
  }
  return blocks;
}

function parseSearchReplaceBlock(block: string): { old: string; new: string } | null {
  const lines = block.split('\n');
  const isOld = (l: string) => { const v = l.trim(); return v === '---OLD---' || v === '--OLD--'; };
  const isNew = (l: string) => { const v = l.trim(); return v === '---NEW---' || v === '--NEW--'; };
  const i = lines.findIndex((l) => isOld(l));
  const j = lines.findIndex((l) => isNew(l));
  if (i === -1 || j === -1 || j <= i) return null;
  return { old: lines.slice(i + 1, j).join('\n').trimEnd(), new: lines.slice(j + 1).join('\n').trimEnd() };
}

function renderMarkdown(text: string): string {
  try {
    return marked.parse(text, { async: false }) as string;
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
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
      const isUser = m.role === 'user';
      const contentHtml = isUser
        ? escapeHtml(m.content).replace(/\n/g, '<br>')
        : renderMarkdown(m.content);
      return `<div class="chatMessage chatMessage--${m.role}" data-msg-index="${msgIndex}">
        <span class="chatMessageRole">${isUser ? t('chat.roleUser') : t('chat.roleAi')}</span>
        <div class="chatMessageContent">${contentHtml}</div>
      </div>`;
    })
    .join('');
  el.scrollTop = el.scrollHeight;
}

/** Render streaming AI message with optional thinking block */
function createStreamingMessage(): { thinkingEl: HTMLElement | null; contentEl: HTMLElement } {
  const el = document.getElementById('chatMessages');
  if (!el) return { thinkingEl: null, contentEl: document.createElement('div') };

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chatMessage chatMessage--assistant chatMessage--streaming';

  const roleSpan = document.createElement('span');
  roleSpan.className = 'chatMessageRole';
  roleSpan.textContent = t('chat.roleAi');
  msgDiv.appendChild(roleSpan);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'chatMessageContent';
  msgDiv.appendChild(contentDiv);

  el.appendChild(msgDiv);
  el.scrollTop = el.scrollHeight;

  return { thinkingEl: null, contentEl: contentDiv };
}

function ensureThinkingBlock(msgDiv: Element): HTMLElement {
  let thinking = msgDiv.querySelector('.chatThinking');
  if (thinking) return thinking as HTMLElement;
  const details = document.createElement('details');
  details.className = 'chatThinking';
  const summary = document.createElement('summary');
  summary.className = 'chatThinkingSummary';
  summary.textContent = t('ai.thinking');
  details.appendChild(summary);
  const content = document.createElement('div');
  content.className = 'chatThinkingContent';
  details.appendChild(content);
  const roleSpan = msgDiv.querySelector('.chatMessageRole');
  const contentEl = msgDiv.querySelector('.chatMessageContent');
  if (roleSpan && contentEl) {
    msgDiv.insertBefore(details, contentEl);
  }
  return content;
}

function finishStreamingMessage(thinkingText: string, contentText: string): void {
  const el = document.getElementById('chatMessages');
  if (!el) return;
  const msgDiv = el.querySelector('.chatMessage--streaming');
  if (!msgDiv) return;
  msgDiv.classList.remove('chatMessage--streaming');

  const thinkingBlock = msgDiv.querySelector('.chatThinking');
  if (thinkingBlock) {
    if (!thinkingText.trim() || !state.showThinking) {
      thinkingBlock.remove();
    } else {
      const thinkingContent = thinkingBlock.querySelector('.chatThinkingContent') as HTMLElement | null;
      if (thinkingContent) thinkingContent.textContent = thinkingText;
    }
  }

  const contentEl = msgDiv.querySelector('.chatMessageContent') as HTMLElement | null;
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(contentText);
  }
}

let apiRef: Api | null = null;

export function setChatApi(api: Api): void {
  apiRef = api;
}

const APPLY_LOG = '[Next-SSH apply]';

function logToStdout(...args: unknown[]): void {
  window.electronAPI?.logToMain?.(APPLY_LOG, ...args);
}

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
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
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
        for (let s = 0; s <= fileLines.length - oldLines.length; s++) {
          let matchCount = 0;
          for (let j = 0; j < oldLines.length; j++) {
            if (lineSimilarity(fileLines[s + j], oldLines[j]) >= threshold) matchCount++;
          }
          if (matchCount >= oldLines.length * minMatchRatio) {
            const blockStart = boundaries[s].start;
            const blockEnd = boundaries[s + oldLines.length - 1].end;
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

export async function tryOpenDiffPreviewForLastMessage(forSessionId?: number | null): Promise<void> {
  const messages = forSessionId != null
    ? (state.chatMessagesBySession[forSessionId] ?? [])
    : getCurrentChatMessages();
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return;
  const blocks = extractCodeBlocks(last.content);
  if (blocks.length === 0) return;
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (!activeTab || activeTab.kind !== 'editor') return;
  const inst = state.editorInstances.get(activeTab.id);
  if (!inst) return;
  const currentContent = (inst.editor as { getValue(): string }).getValue();
  for (let bi = 0; bi < blocks.length; bi++) {
    const proposedContent = computeProposedContent(blocks[bi], currentContent);
    if (proposedContent !== null && proposedContent !== currentContent) {
      await editor.setPendingDiff(activeTab.id, proposedContent);
      return;
    }
  }
  for (let i = 0; i + 1 < blocks.length; i++) {
    const proposedContent = computeProposedContentFromPair(blocks[i], blocks[i + 1], currentContent);
    if (proposedContent !== null) {
      await editor.setPendingDiff(activeTab.id, proposedContent);
      return;
    }
  }
}

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
  if (content == null) return;
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (activeTab?.kind !== 'editor') {
    void showMessage({ title: t('diff.title'), message: t('alert.selectEnv') });
    return;
  }
  const inst = state.editorInstances.get(activeTab.id);
  if (!inst) return;
  const currentContent = (inst.editor as { getValue(): string }).getValue();
  const proposedContent = computeProposedContent(content, currentContent);
  if (proposedContent === null) {
    void showMessage({ title: t('diff.title'), message: t('diff.oldNotFound') });
    return;
  }
  const parsed = parseSearchReplaceBlock(content);
  const opened = await editor.setPendingDiff(activeTab.id, proposedContent);
  if (!opened) {
    if (parsed) {
      editor.applySearchReplace(activeTab.id, parsed.old, parsed.new);
    } else {
      editor.applySearchReplace(activeTab.id, '', content);
    }
  }
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
        ? `\n\n【Terminal Output (reference)】Recent output from the connected terminal:\n---\n${buf.trim().slice(-8000)}`
        : '';

    const FILE_CONTEXT_MAX = 12000;
    let fileContext = '';
    if (activeTab?.kind === 'editor') {
      const editorInstance = state.editorInstances.get(activeTab.id);
      const text = editorInstance?.editor.getValue() ?? '';
      if (text.trim().length > 0) {
        const trimmed = text.length > FILE_CONTEXT_MAX ? text.slice(-FILE_CONTEXT_MAX) : text;
        fileContext = `\n\n【Open file (editor)】Path: ${activeTab.filePath}\n---\n${trimmed}`;
      }
    }

    const payload = [
      { role: 'system' as const, content: getChatSystemPrompt() + terminalContext + fileContext },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // Streaming mode
    const { thinkingEl, contentEl } = createStreamingMessage();
    let thinkingText = '';
    let contentText = '';
    let done = false;

    api.chat.onStreamChunk((chunk) => {
      if (done) return;
      if (chunk.type === 'thinking') {
        thinkingText += chunk.text;
        if (state.showThinking) {
          const msgDiv = document.querySelector('.chatMessage--streaming');
          if (msgDiv) {
            const thinkingContent = ensureThinkingBlock(msgDiv);
            thinkingContent.textContent = thinkingText;
          }
        }
      } else if (chunk.type === 'content') {
        contentText += chunk.text;
        contentEl.textContent = contentText;
      } else if (chunk.type === 'done') {
        done = true;
        finishStreamingMessage(thinkingText, contentText);
        const suggestedCommands = extractSuggestedCommands(contentText);
        api.chatContext!.add(sessionId, 'assistant', contentText, suggestedCommands).then((row) => {
          state.chatMessagesBySession[sessionId].push({
            id: row.id,
            role: 'assistant',
            content: row.content,
            suggestedCommands: row.suggestedCommands ?? undefined,
          });
          renderChatMessages();
          void tryOpenDiffPreviewForLastMessage(sessionId);
        });
      } else if (chunk.type === 'error') {
        done = true;
        contentText += `\n\n**Error:** ${chunk.text}`;
        finishStreamingMessage(thinkingText, contentText);
      }

      if (!done) {
        const chatEl = document.getElementById('chatMessages');
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
      }
    });

    api.chat.streamStart(payload);
  } catch (err) {
    const errContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    api.chatContext!.add(sessionId, 'assistant', errContent).then((row) => {
      state.chatMessagesBySession[sessionId].push({
        id: row.id,
        role: 'assistant',
        content: row.content,
      });
      renderChatMessages();
    });
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

export function bindThinkToggle(): void {
  const btn = document.getElementById('btnThinkToggle');
  if (!btn) return;
  btn.classList.toggle('active', state.showThinking);
  btn.addEventListener('click', () => {
    state.showThinking = !state.showThinking;
    btn.classList.toggle('active', state.showThinking);
    document.querySelectorAll('.chatThinking').forEach((el) => {
      (el as HTMLElement).style.display = state.showThinking ? '' : 'none';
    });
  });
}

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

  const panel = document.getElementById('chatPanel');
  if (panel) {
    panel.addEventListener('mousedown', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || !panel.contains(target)) return;
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(target.tagName)) return;
      const tabindex = target.getAttribute('tabindex');
      if (tabindex !== null && tabindex !== '-1') return;
      panel.focus();
    });
  }
}

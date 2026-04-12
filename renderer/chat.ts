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

/** Patterns that should never be auto-executed. */
const DANGEROUS_PATTERNS = [
  /\brm\s+(-\w*r\w*f\w*\s+|rf\s+)\/(?!tmp\/)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\{.*;\};/,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\binit\s+[06]\b/i,
  /\b(>|>>)\s*\/dev\//i,
];

function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(cmd));
}

/** Extract bash/sh code blocks from markdown text. Returns individual commands. */
function extractBashCommands(text: string): string[] {
  const commands: string[] = [];
  const regex = /```(?:bash|sh)\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    block.split('\n').forEach((line) => {
      const l = line.trim();
      if (l && !l.startsWith('#') && !l.startsWith('//')) commands.push(l);
    });
  }
  return commands;
}

/** Send a command to the active terminal tab. Returns the tab info or null. */
function runCommandInTerminal(cmd: string): { kind: string; connectionId?: number; id?: string } | null {
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  const api = apiRef;
  if (!api || !activeTab) return null;
  if (activeTab.kind === 'terminal') {
    api.terminal.write(activeTab.connectionId, cmd + '\n');
    return { kind: 'terminal', connectionId: activeTab.connectionId };
  } else if (activeTab.kind === 'local-terminal') {
    api.terminal.localWrite(activeTab.id, cmd + '\n');
    return { kind: 'local-terminal', id: activeTab.id };
  }
  return null;
}

/** Truncate output for AI consumption. */
function truncateForAi(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

/** Check if the AI response indicates the task is complete (no more commands to run). */
function isTaskComplete(aiContent: string): boolean {
  // If no bash code blocks, the AI is just explaining — task is done
  const commands = extractBashCommands(aiContent);
  if (commands.length === 0) return true;

  // Check for explicit completion signals in the text
  const lower = aiContent.toLowerCase();
  const completionPhrases = [
    'task complete', 'all done', 'finished', 'no further action',
    '任务完成', '已完成', '全部完成', '没有更多操作',
    'задача выполнена', 'готово', 'завершено',
  ];
  if (completionPhrases.some((p) => lower.includes(p))) return true;

  return false;
}

const AGENT_LOG = '[Agent Loop]';

function agentLog(...args: unknown[]): void {
  console.log(AGENT_LOG, ...args);
  window.electronAPI?.logToMain?.(AGENT_LOG, ...args);
}

/**
 * Agentic loop: execute ONE command per turn, feed result back to AI, let AI decide next step.
 *
 * Flow (similar to Claude Code):
 *   1. AI suggests commands → extract ONLY the first one
 *   2. Execute it via SSH exec channel (clean stdout/stderr + exit code)
 *   3. Send result back to AI
 *   4. AI analyzes and decides: next command, fix error, or done
 *   5. Repeat
 *
 * Key design: one command per turn means AI sees each result individually
 * and can react to failures instead of blindly running 8 commands in sequence.
 */
async function runAgenticLoop(
  sessionId: number,
  initialAiContent: string,
): Promise<void> {
  agentLog('runAgenticLoop STARTED', { mode: state.aiPermissionMode, sessionId });

  if (state.aiPermissionMode === 'ask') {
    agentLog('ABORT: mode is ask');
    return;
  }

  const api = apiRef;
  if (!api?.chat || !api.terminal) {
    agentLog('ABORT: no api.chat or api.terminal');
    return;
  }

  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (!activeTab) {
    agentLog('ABORT: no active tab');
    return;
  }
  if (activeTab.kind !== 'terminal' && activeTab.kind !== 'local-terminal') {
    agentLog('ABORT: active tab is not terminal', { kind: activeTab.kind });
    return;
  }

  state.agentLoopRunning = true;
  state.agentLoopAbort = false;
  updateAgentLoopUI();

  let turnContent = initialAiContent;
  let turnCount = 0;

  try {
    while (turnCount < state.AGENT_LOOP_MAX_TURNS && !state.agentLoopAbort) {
      const commands = extractBashCommands(turnContent);
      agentLog(`Turn ${turnCount}: extracted ${commands.length} commands`, commands);
      if (commands.length === 0 || isTaskComplete(turnContent)) {
        agentLog('Breaking: no commands or task complete');
        break;
      }

      // In confirm mode, don't auto-execute — user clicks "Run" buttons
      if (state.aiPermissionMode === 'confirm') {
        agentLog('Confirm mode: not auto-executing');
        break;
      }

      // Execute ONLY the first command
      const cmd = commands[0];

      if (isDangerousCommand(cmd)) {
        agentLog(`SKIP dangerous: ${cmd}`);
        // Feed the skip back to AI so it knows and can suggest an alternative
        turnCount++;
        const skipMsg = `[Command execution result]\n$ ${cmd}\n[SKIPPED] Dangerous command not executed. Please suggest a safer alternative or explain why this command is needed.`;
        await api.chatContext!.add(sessionId, 'user', skipMsg);
        turnContent = await streamAiFollowUp(api, sessionId);
        if (!turnContent) break;
        continue;
      }

      agentLog(`EXEC: ${cmd}`);

      let feedbackMsg: string;
      try {
        let result: { stdout: string; stderr: string; exitCode: number | null };

        if (activeTab.kind === 'terminal') {
          result = await api.terminal.exec(activeTab.connectionId, cmd, 120000);
        } else {
          result = await api.terminal.localExec(cmd, 120000);
        }

        const outputParts: string[] = [];
        if (result.stdout) {
          outputParts.push(truncateForAi(result.stdout, state.AGENT_OUTPUT_MAX_CHARS));
        }
        if (result.stderr) {
          outputParts.push(`[stderr]\n${truncateForAi(result.stderr, 2000)}`);
        }
        if (result.exitCode !== 0 && result.exitCode !== null) {
          outputParts.push(`[exit code: ${result.exitCode}]`);
        }

        const output = outputParts.join('\n') || '(no output)';
        feedbackMsg = `$ ${cmd}\n${output}`;
        agentLog(`OUTPUT (${output.length} chars): ${output.slice(0, 200)}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        feedbackMsg = `$ ${cmd}\n[ERROR] ${errMsg}`;
        agentLog(`EXEC ERROR: ${errMsg}`);
      }

      if (state.agentLoopAbort) break;

      turnCount++;
      agentLog(`Sending feedback to AI (turn ${turnCount})`);

      // Save command result as user message
      await api.chatContext!.add(sessionId, 'user', `[Command execution result]\n${feedbackMsg}`);

      // Get AI's follow-up response
      turnContent = await streamAiFollowUp(api, sessionId);
      if (!turnContent) break;

      // Small delay before next command
      await new Promise((r) => setTimeout(r, 300));
    }

    agentLog(`Agentic loop finished after ${turnCount} turns`);
  } catch (err) {
    agentLog('Agentic loop ERROR:', err);
  } finally {
    state.agentLoopRunning = false;
    state.agentLoopAbort = false;
    updateAgentLoopUI();
  }
}

/**
 * Stream an AI follow-up response for the agentic loop.
 * Returns the AI's content text, or empty string on error.
 */
async function streamAiFollowUp(api: Api, sessionId: number): Promise<string> {
  const messages = await api.chatContext!.listBySession(sessionId);
  const payload = [
    { role: 'system' as const, content: getChatSystemPrompt() + '\n\n[Important] You just executed a command. The output is provided below. Analyze the result and decide what to do next. If the task is complete, summarize the result without any code blocks. If there are errors, suggest a fix with ONE command. If more steps are needed, suggest the single most important next command. Always prefer giving just ONE command at a time so you can see the result before deciding the next step.' },
    ...messages.slice(-10).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  const { msgDiv, thinkingContentEl, thinkingSummaryEl, contentEl, indicatorEl } = createStreamingMessage();
  let thinkingText = '';
  let contentText = '';
  let thinkingDurationMs: number | null = null;
  let streamDone = false;

  return new Promise<string>((resolve) => {
    const handler = (chunk: { type: string; text: string; durationMs?: number }) => {
      if (streamDone) return;

      if (chunk.type === 'thinking') {
        thinkingText += chunk.text;
        if (state.showThinking) {
          const details = msgDiv.querySelector('.chatThinking');
          if (details) details.classList.remove('chatThinking--hidden');
          thinkingContentEl.innerHTML = renderMarkdown(thinkingText);
        }
      } else if (chunk.type === 'thinking_end') {
        thinkingDurationMs = chunk.durationMs ?? null;
        const spinnerEl = msgDiv.querySelector('.chatThinkingSpinner');
        if (spinnerEl) spinnerEl.classList.add('chatThinkingSpinner--done');
        thinkingSummaryEl.textContent = t('ai.thoughtComplete') + (thinkingDurationMs ? ` (${(thinkingDurationMs / 1000).toFixed(1)}s)` : '');
      } else if (chunk.type === 'content') {
        if (!contentText && indicatorEl.parentNode) indicatorEl.remove();
        contentText += chunk.text;
        contentEl.textContent = contentText;
      } else if (chunk.type === 'done') {
        streamDone = true;
        finishStreamingMessage(msgDiv, thinkingText, contentText, thinkingDurationMs);
        api.chatContext!.add(sessionId, 'assistant', contentText, extractSuggestedCommands(contentText), thinkingText || null, thinkingDurationMs).then((row) => {
          state.chatMessagesBySession[sessionId].push({
            id: row.id, role: 'assistant', content: row.content,
            thinking: row.thinking ?? undefined, thinkingDurationMs: row.thinkingDurationMs ?? undefined,
            suggestedCommands: row.suggestedCommands ?? undefined,
          });
          renderChatMessages();
          void tryOpenDiffPreviewForLastMessage(sessionId);
        });
        agentLog(`AI follow-up done, ${extractBashCommands(contentText).length} commands in response`);
        resolve(contentText);
      } else if (chunk.type === 'error') {
        streamDone = true;
        contentText += `\n\n**Error:** ${chunk.text}`;
        finishStreamingMessage(msgDiv, thinkingText, contentText, thinkingDurationMs);
        agentLog('AI follow-up error:', chunk.text);
        resolve('');
      }

      if (!streamDone) {
        const chatEl = document.getElementById('chatMessages');
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
      }
    };

    api.chat!.onStreamChunk(handler);
    api.chat!.streamStart(payload, state.showThinking);
  });
}

/** Update UI elements to show agent loop status. */
function updateAgentLoopUI(): void {
  const sendBtn = document.getElementById('btnChatSend') as HTMLButtonElement | null;
  const abortBtn = document.getElementById('btnAbortAgent') as HTMLButtonElement | null;
  const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  if (sendBtn) sendBtn.disabled = state.agentLoopRunning;
  if (input) input.disabled = state.agentLoopRunning;

  // Toggle abort button visibility
  if (abortBtn) {
    abortBtn.style.display = state.agentLoopRunning ? 'inline-block' : 'none';
  }

  // Update send button text during agent loop
  if (sendBtn) {
    if (state.agentLoopRunning) {
      sendBtn.textContent = t('ai.thinking');
      sendBtn.style.background = 'var(--border-hover)';
    } else {
      sendBtn.textContent = t('chat.send');
      sendBtn.style.background = '';
    }
  }
}

/** Abort the running agent loop. */
export function abortAgentLoop(): void {
  if (state.agentLoopRunning) {
    state.agentLoopAbort = true;
  }
}

/** Inject copy buttons (and optionally run buttons) into code blocks within a container. */
function injectCodeBlockButtons(container: HTMLElement): void {
  container.querySelectorAll('pre').forEach((pre) => {
    // Skip already-processed blocks
    if (pre.parentElement?.classList.contains('chatCodeBlock')) return;

    const codeEl = pre.querySelector('code');
    const langClass = codeEl?.className?.match(/language-(\w+)/)?.[1] ?? '';
    const isShell = ['bash', 'sh', 'shell', 'zsh'].includes(langClass);
    const codeText = codeEl?.textContent ?? pre.textContent ?? '';

    const wrapper = document.createElement('div');
    wrapper.className = 'chatCodeBlock';

    const header = document.createElement('div');
    header.className = 'chatCodeBlockHeader';

    const langSpan = document.createElement('span');
    langSpan.className = 'chatCodeBlockLang';
    langSpan.textContent = langClass;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'chatCodeBlockActions';

    // Copy button (always present)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'chatCodeBlockCopy';
    copyBtn.textContent = t('common.copy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(codeText).then(() => {
        copyBtn.textContent = t('common.copied');
        setTimeout(() => { copyBtn.textContent = t('common.copy'); }, 1500);
      });
    });
    actionsDiv.appendChild(copyBtn);

    // Run button for shell blocks in confirm mode
    if (isShell && state.aiPermissionMode === 'confirm') {
      const runBtn = document.createElement('button');
      runBtn.className = 'chatCodeBlockRun';
      runBtn.textContent = t('chat.runCommand');
      runBtn.addEventListener('click', () => {
        const commands = codeText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
        commands.forEach((cmd) => runCommandInTerminal(cmd));
        runBtn.textContent = '✓';
        setTimeout(() => { runBtn.textContent = t('chat.runCommand'); }, 1500);
      });
      actionsDiv.appendChild(runBtn);
    }

    header.appendChild(langSpan);
    header.appendChild(actionsDiv);

    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  });
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

      let thinkingHtml = '';
      if (!isUser && m.thinking && m.thinking.trim()) {
        const durationLabel = m.thinkingDurationMs
          ? ` (${(m.thinkingDurationMs / 1000).toFixed(1)}s)`
          : '';
        thinkingHtml = `<details class="chatThinking">
          <summary class="chatThinkingSummary">
            <span class="chatThinkingSpinner chatThinkingSpinner--done"></span>
            <span class="chatThinkingSummaryText">${t('ai.thoughtComplete')}${durationLabel}</span>
          </summary>
          <div class="chatThinkingContent">${renderMarkdown(m.thinking)}</div>
        </details>`;
      }

      return `<div class="chatMessage chatMessage--${m.role}" data-msg-index="${msgIndex}">
        <span class="chatMessageRole">${isUser ? t('chat.roleUser') : t('chat.roleAi')}</span>
        ${thinkingHtml}
        <div class="chatMessageContent">${contentHtml}</div>
      </div>`;
    })
    .join('');
  injectCodeBlockButtons(el);
  el.scrollTop = el.scrollHeight;
}

/** Render streaming AI message with thinking block and streaming indicator */
function createStreamingMessage(): {
  msgDiv: HTMLElement;
  thinkingContentEl: HTMLElement;
  thinkingSummaryEl: HTMLElement;
  contentEl: HTMLElement;
  indicatorEl: HTMLElement;
} {
  const el = document.getElementById('chatMessages');
  if (!el) throw new Error('chatMessages not found');

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chatMessage chatMessage--assistant chatMessage--streaming';

  const roleSpan = document.createElement('span');
  roleSpan.className = 'chatMessageRole';
  roleSpan.textContent = t('chat.roleAi');
  msgDiv.appendChild(roleSpan);

  // Thinking block (initially hidden, shown on first thinking chunk)
  const details = document.createElement('details');
  details.className = 'chatThinking chatThinking--hidden';
  details.open = true;
  const summary = document.createElement('summary');
  summary.className = 'chatThinkingSummary';
  const spinner = document.createElement('span');
  spinner.className = 'chatThinkingSpinner';
  const summaryText = document.createElement('span');
  summaryText.className = 'chatThinkingSummaryText';
  summaryText.textContent = t('ai.thinking');
  summary.appendChild(spinner);
  summary.appendChild(summaryText);
  details.appendChild(summary);
  const thinkingContent = document.createElement('div');
  thinkingContent.className = 'chatThinkingContent';
  details.appendChild(thinkingContent);
  msgDiv.appendChild(details);

  // Streaming indicator (three bouncing dots shown while content area is empty)
  const indicator = document.createElement('div');
  indicator.className = 'chatStreamingIndicator';
  indicator.innerHTML = '<span class="chatStreamingDot"></span><span class="chatStreamingDot"></span><span class="chatStreamingDot"></span>';
  msgDiv.appendChild(indicator);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'chatMessageContent';
  msgDiv.appendChild(contentDiv);

  el.appendChild(msgDiv);
  el.scrollTop = el.scrollHeight;

  return {
    msgDiv,
    thinkingContentEl: thinkingContent,
    thinkingSummaryEl: summaryText,
    contentEl: contentDiv,
    indicatorEl: indicator,
  };
}

function finishStreamingMessage(
  msgDiv: Element,
  thinkingText: string,
  contentText: string,
  _thinkingDurationMs: number | null,
): void {
  msgDiv.classList.remove('chatMessage--streaming');

  const thinkingBlock = msgDiv.querySelector('.chatThinking');
  if (thinkingBlock) {
    if (!thinkingText.trim() || !state.showThinking) {
      thinkingBlock.remove();
    } else {
      // Render thinking as markdown
      const thinkingContent = thinkingBlock.querySelector('.chatThinkingContent') as HTMLElement | null;
      if (thinkingContent) {
        thinkingContent.innerHTML = renderMarkdown(thinkingText);
      }
      // Stop spinner
      const spinner = thinkingBlock.querySelector('.chatThinkingSpinner');
      if (spinner) spinner.classList.add('chatThinkingSpinner--done');
    }
  }

  // Remove streaming indicator if still present
  const indicator = msgDiv.querySelector('.chatStreamingIndicator');
  if (indicator) indicator.remove();

  const contentEl = msgDiv.querySelector('.chatMessageContent') as HTMLElement | null;
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(contentText);
    injectCodeBlockButtons(contentEl);
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
    const { msgDiv, thinkingContentEl, thinkingSummaryEl, contentEl, indicatorEl } = createStreamingMessage();
    let thinkingText = '';
    let contentText = '';
    let thinkingDurationMs: number | null = null;
    let done = false;

    api.chat.onStreamChunk((chunk) => {
      if (done) return;

      if (chunk.type === 'thinking') {
        thinkingText += chunk.text;
        if (state.showThinking) {
          const details = msgDiv.querySelector('.chatThinking');
          if (details) {
            details.classList.remove('chatThinking--hidden');
          }
          thinkingContentEl.innerHTML = renderMarkdown(thinkingText);
        }
      } else if (chunk.type === 'thinking_end') {
        thinkingDurationMs = chunk.durationMs ?? null;
        const spinnerEl = msgDiv.querySelector('.chatThinkingSpinner');
        if (spinnerEl) spinnerEl.classList.add('chatThinkingSpinner--done');
        if (thinkingDurationMs !== null) {
          thinkingSummaryEl.textContent = t('ai.thoughtComplete') + ` (${(thinkingDurationMs / 1000).toFixed(1)}s)`;
        } else {
          thinkingSummaryEl.textContent = t('ai.thoughtComplete');
        }
      } else if (chunk.type === 'content') {
        // Hide streaming indicator on first content chunk
        if (!contentText && indicatorEl.parentNode) {
          indicatorEl.remove();
        }
        contentText += chunk.text;
        contentEl.textContent = contentText;
      } else if (chunk.type === 'done') {
        done = true;
        finishStreamingMessage(msgDiv, thinkingText, contentText, thinkingDurationMs);
        const suggestedCommands = extractSuggestedCommands(contentText);
        api.chatContext!.add(sessionId, 'assistant', contentText, suggestedCommands, thinkingText || null, thinkingDurationMs).then((row) => {
          state.chatMessagesBySession[sessionId].push({
            id: row.id,
            role: 'assistant',
            content: row.content,
            thinking: row.thinking ?? undefined,
            thinkingDurationMs: row.thinkingDurationMs ?? undefined,
            suggestedCommands: row.suggestedCommands ?? undefined,
          });
          renderChatMessages();
          // Start agentic loop for auto mode (intelligent execution with feedback)
          if (state.aiPermissionMode === 'auto') {
            runAgenticLoop(sessionId, contentText).catch(() => {});
          }
          void tryOpenDiffPreviewForLastMessage(sessionId);
        });
      } else if (chunk.type === 'error') {
        done = true;
        contentText += `\n\n**Error:** ${chunk.text}`;
        finishStreamingMessage(msgDiv, thinkingText, contentText, thinkingDurationMs);
      }

      if (!done) {
        const chatEl = document.getElementById('chatMessages');
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
      }
    });

    api.chat.streamStart(payload, state.showThinking);
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
    // Don't re-enable send button if agent loop is still running
    if (!state.agentLoopRunning && sendBtn) (sendBtn as HTMLButtonElement).disabled = false;
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
      thinking: m.thinking ?? undefined,
      thinkingDurationMs: m.thinkingDurationMs ?? undefined,
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
        thinking: m.thinking ?? undefined,
        thinkingDurationMs: m.thinkingDurationMs ?? undefined,
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
  const checkbox = document.getElementById('thinkSwitchInput') as HTMLInputElement | null;
  if (!checkbox) return;
  checkbox.checked = state.showThinking;
  updateThinkSwitchState();

  checkbox.addEventListener('change', () => {
    state.showThinking = checkbox.checked;
    // Toggle only affects future API calls, not historical display
  });
}

/**
 * Known model name patterns that typically support thinking/reasoning.
 * Used ONLY for display hints — the toggle is always available.
 * Detection happens at runtime: if the stream returns reasoning_content, thinking is shown.
 */
const THINKING_MODEL_PATTERNS = [
  // OpenAI
  /\bo[1-4]\b/i,
  /\bo1-/i,
  /\bo3/i,
  /\bo4/i,
  // Claude
  /claude-.*3[.-]5/i,
  /claude-.*4/i,
  /claude-opus/i,
  /claude-sonnet/i,
  // DeepSeek
  /deepseek-r/i,
  /deepseek-reasoner/i,
  /deepseek.*think/i,
  // Qwen
  /qwq/i,
  /qwen3/i,
  /qwen.*think/i,
  // GLM / Zhipu
  /glm-z1/i,
  /glm.*think/i,
  // Gemini
  /gemini.*thinking/i,
  /gemini.*flash.*thinking/i,
  // Grok
  /grok.*think/i,
];

function isKnownThinkingModel(model: string): boolean {
  if (!model) return false;
  return THINKING_MODEL_PATTERNS.some((p) => p.test(model));
}

function updateThinkSwitchState(): void {
  const checkbox = document.getElementById('thinkSwitchInput') as HTMLInputElement | null;
  const wrap = document.getElementById('thinkSwitchWrap');
  const control = document.getElementById('thinkSwitchControl');
  const modelSpan = document.getElementById('thinkSwitchModel');
  if (!checkbox || !wrap) return;

  const modelInput = document.getElementById('aiModel') as HTMLInputElement | null;
  const model = modelInput?.value?.trim() ?? '';

  // Always allow the toggle — thinking is auto-detected from the stream response
  wrap.classList.remove('chatThinkWrap--disabled');
  checkbox.disabled = false;

  // Show model name with hint
  if (modelSpan) {
    modelSpan.textContent = model || '';
    if (!model) {
      modelSpan.title = t('ai.noModel');
    } else if (isKnownThinkingModel(model)) {
      modelSpan.title = `${model} ★`;
    } else {
      modelSpan.title = model;
    }
  }

  if (control) {
    control.title = t('ai.thinkMode');
  }
}

export function refreshThinkToggle(): void {
  updateThinkSwitchState();
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

  // Bind permission mode selector
  const modeSelect = document.getElementById('chatModeSelect') as HTMLSelectElement | null;
  if (modeSelect) {
    modeSelect.value = state.aiPermissionMode;
    modeSelect.addEventListener('change', () => {
      state.aiPermissionMode = modeSelect.value as 'ask' | 'confirm' | 'auto';
    });
  }

  // Bind abort button for agent loop
  const abortBtn = document.getElementById('btnAbortAgent') as HTMLButtonElement | null;
  if (abortBtn) {
    abortBtn.addEventListener('click', () => {
      abortAgentLoop();
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.agentLoopRunning) return;
    const text = input.value;
    input.value = '';
    sendChatMessage(api, text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (state.agentLoopRunning) return;
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

import type { ChatMessage } from './types';
import { state } from './state';
import { t } from './i18n';
import { escapeHtml } from './util';
import { marked } from 'marked';
import * as terminal from './terminal';
import * as editor from './editor';
import { showMessage } from './message';

type Api = NonNullable<typeof window.electronAPI>;

const CHAT_SYSTEM_PROMPT_FALLBACK = `# Next-SSH — AI Assistant

You are an interactive agent for Next-SSH, a cross-platform SSH client. You help users manage remote Linux servers through an SSH connection. Use the instructions below to assist the user effectively.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with server administration.

# System

All text you output is displayed to the user in a chat panel. You can use Github-flavored markdown for formatting.
Commands are executed via SSH exec channel (not interactive PTY). The system sends one command at a time and returns structured results containing stdout, stderr, and exit code.
The user selects one of three permission modes: **Suggest** (commands are only shown, not executed), **Confirm** (each command needs user approval before execution), or **Auto** (commands execute automatically, except dangerous ones).
If the user skips or rejects a command, do not re-attempt the same command. Instead, think about why and adjust your approach.

# Doing Tasks

- The user will primarily request you to perform server administration tasks: system diagnostics, software installation, configuration editing, service management, log analysis, user management, network troubleshooting, and similar.
- You are highly capable. Prefer completing tasks end-to-end rather than giving partial instructions the user has to run manually.
- In general, do not propose changes to files you haven't read. If you need to see a file's content, ask the user to open it in the editor, or suggest a \`cat\` command first.
- Do not create files or directories unless they are absolutely necessary for achieving your goal.
- Avoid giving time estimates for how long operations will take. Focus on what needs to be done.
- If an approach fails, diagnose why before switching tactics — read the error, check your assumptions, try a focused fix. Don't retry the identical action blindly, but don't abandon a viable approach after a single failure either.
- Be careful not to introduce security vulnerabilities. Prioritize writing safe commands: avoid piping untrusted data into shell eval, be cautious with file permissions, and sanitize inputs at system boundaries.

## Code Style

- Don't add features, refactor configurations, or make "improvements" beyond what was asked. A bug fix doesn't need surrounding config cleaned up. A simple install doesn't need extra hardening.
- Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust standard tools. Only validate at boundaries (user input, external APIs).
- Don't create wrapper scripts, utility functions, or abstractions for one-time operations. The right amount of complexity is what the task actually requires.

# Executing Actions with Care

Carefully consider the reversibility and blast radius of actions. Generally you can freely run read-only commands like \`ls\`, \`cat\`, \`stat\`, \`systemctl status\`, \`df\`, \`free\`, \`ps\`. But for actions that are hard to reverse, affect shared systems, or could be destructive, check with the user before proceeding.

Examples of risky actions that warrant user awareness:
- **Destructive operations**: \`rm -rf\`, dropping databases, killing processes, overwriting config files
- **Hard-to-reverse operations**: package removal, service stops, firewall rule changes, partition operations
- **Actions visible to others**: restarting shared services, modifying crontabs, changing user passwords, altering SSH config
- **Service disruptions**: \`systemctl restart\` on production services, \`apt upgrade\` on live servers

When you encounter an obstacle, do not use destructive actions as a shortcut. For instance, try to identify root causes and fix underlying issues rather than force-killing processes or deleting lock files without investigation. In short: only take risky actions carefully, and when in doubt, ask before acting. Measure twice, cut once.

# Command Execution

Commands MUST be placed inside \`\`\`bash code blocks. Give **exactly one bash code block per response** — the system executes it, returns the result, and then you decide the next step.

## Rules

- Place all commands for the current step inside a **single** \`\`\`bash code block.
- **One code block per response.** After receiving the result, give your next bash block (or a final text summary if done).
- Each line in the block is executed sequentially; execution stops on the first non-zero exit code and the result is reported back to you.
- Use \`&&\` to chain commands that must all succeed (e.g., \`apt update && apt install -y nginx\`).
- Use \`;\` only when you want all commands to run regardless of the previous outcome.
- Commands have a **120-second timeout each**. For long-running tasks use \`nohup cmd &\` or split into smaller steps.
- Comment lines starting with \`#\` are ignored.
- Always use absolute paths when the working directory is uncertain.
- Quote paths that may contain spaces.

## Before Creating Files or Directories

- Verify the parent directory exists: \`ls -la /opt/\` before \`mkdir /opt/app\`.
- Check if a file already exists before overwriting: \`ls -la /etc/nginx/sites-available/myapp\`.
- Don't overwrite user files without warning — suggest backup first.

## Environment Awareness

- Detect the OS early if unknown: \`cat /etc/os-release\`, \`uname -a\`.
- Check the init system: \`ps -p 1 -o comm=\` (systemd vs sysvinit vs openrc).
- Note the package manager: apt, yum, dnf, pacman, apk, etc.
- Check available disk space before large operations: \`df -h\`.
- Check memory before memory-intensive tasks: \`free -h\`.

# Error Handling

When a command fails (exit code ≠ 0):

- **Analyze the stderr output** carefully — it usually contains the exact error reason.
- **Permission denied**: Try \`sudo\`. If that fails, check if the user has sudo access: \`sudo -l\`.
- **Command not found**: Check if the package is installed (\`which <cmd>\`), suggest install command for the detected OS.
- **Network timeout / connection refused**: Check connectivity (\`ping\`, \`curl -I\`), DNS (\`nslookup\`), firewall rules (\`iptables -L\`), service status (\`systemctl status\`).
- **Disk full**: Show usage (\`df -h\`, \`du -sh /* | sort -rh | head\`), suggest cleanup (journal vacuum, package cache clean, log rotation).
- **Port already in use**: Find the process (\`ss -tlnp | grep <port>\`, \`lsof -i :<port>\`), ask user before killing.
- **Syntax error**: Show the exact error line, provide corrected command.
- **Dependency conflict**: Suggest resolution strategies specific to the package manager.
- Always explain what went wrong and why before suggesting a fix.

# Security

The following commands are **automatically blocked** by Next-SSH and will never be executed, regardless of permission mode:

- \`rm -rf /\` and variants — recursive root deletion
- \`sudo rm -rf /\` — same with privilege escalation
- \`mkfs\` — disk formatting
- \`dd if=\` — low-level disk operations
- Fork bombs (\`:(){ :|:& };:\`)
- Redirecting output to block devices in \`/dev/sd*\`, \`/dev/nvme*\`, \`/dev/vd*\`

The following commands are **blocked in Auto mode** (require user confirmation):

- \`shutdown\`, \`reboot\`, \`init 0\`, \`init 6\`
- \`systemctl stop/disable\` for critical services (sshd, nginx, mysql, docker, etc.)
- \`iptables -F\` — flush all firewall rules
- \`chmod 777 /\` — world-writable root

If the user requests an operation that needs a blocked command, explain the risk clearly and suggest a safer alternative. Never try to bypass the safety system with creative syntax.

# File Editing

When editing remote files, use this format inside a code block:

\`\`\`
---OLD---
(original text with enough surrounding context to uniquely locate the position)
---NEW---
(modified text)
\`\`\`

Rules:
- The OLD section must be long enough to **uniquely match** a location in the file. Include at least 3 surrounding lines of context.
- For **new files**, leave the OLD section empty.
- Fuzzy matching is supported — minor whitespace and indentation differences are tolerated.
- If the file is large, show only the relevant section, not the entire file.
- For config files, prefer targeted edits over full rewrites.
- Always verify the edit was applied correctly by reading the file afterward.

# Task Completion

- When the task is complete, provide a **text summary with NO code blocks**.
- A response WITHOUT bash code blocks signals that the task is done.
- Your completion summary should include:
  - What was done
  - The current state
  - Any follow-up recommendations or warnings
- If there are remaining steps, give the next command — don't just say "there's more to do."
- Never end a response with code blocks if you're truly done. The system uses the presence/absence of code blocks to decide whether to continue.

# Context Awareness

- **Terminal output** from the active SSH session may be attached to messages. Use it as reference. Only ask for terminal output if none has been provided.
- **Editor content**: If the user has a file open in the editor, its content and path may be included. Use this to understand what they are working on.
- **Conversation history**: Remember results of previously executed commands. Do not repeat commands that have already succeeded unless the situation has changed.
- **Server identity**: Note the hostname, OS, and architecture from early commands. Adjust commands accordingly (e.g., use \`apt\` on Debian/Ubuntu, \`yum\` on CentOS/RHEL).

# Tone and Style

- Answer in the **same language** the user is using.
- **Go straight to the point**. Try the simplest approach first. Do not overdo it.
- Use Markdown formatting: headings for sections, lists for steps, \`backticks\` for commands and paths, **bold** for emphasis.
- Wrap file paths in backticks: \`/etc/nginx/nginx.conf\`
- Wrap command names in backticks: \`systemctl\`, \`apt\`, \`docker\`
- If you can say it in one sentence, don't use three. Prefer short, direct sentences over long explanations.
- Lead with the answer or action, not the reasoning. Skip filler words and preamble.
- Focus output on: decisions that need the user's input, high-level status at milestones, errors or blockers that change the plan.
- Do not restate what the user said — just do it.
- Keep your text output brief and direct. This does not apply to code blocks, which should be complete and correct.

## Critical Rules — Never Break These

- **Never pre-announce commands.** Do NOT write "I'll check X", "I will examine Y", "Let me run Z", "Now I'll install..." before giving a command. Give the bash block directly.
- **Never explain what you are about to do.** Just do it. The command output speaks for itself.
- **One bash block, then stop.** After the system returns the result, continue from there. Never queue up multiple bash blocks in one response.
- **No filler preamble.** Starting a response with "Sure!", "Of course!", "Certainly!" or any similar affirmation is forbidden.
- **Results first, explanations after (if needed).** If a task completed successfully, a one-line confirmation is enough. Do not pad with what you did step by step unless the user asks.`;

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

/**
 * Max total characters of message history sent to the AI per request.
 * At ~4 chars/token this is ≈ 8 000 tokens — well within every modern model's context.
 * Larger values keep more intermediate command results visible to the AI,
 * which is important for multi-step tasks.
 */
const MAX_CONTEXT_CHARS = 32000;

/**
 * Select messages to fit within a character budget.
 * Always keeps the first user message (original task), then fills from the latest backwards.
 */
function selectMessagesForContext(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  if (messages.length === 0) return [];

  // Always keep the first user message (original task description)
  const first = messages[0];
  const firstChars = first.content.length;
  const budget = maxChars - firstChars;

  if (budget <= 0) return [{ ...first, content: first.content.slice(-maxChars) }];

  const selected: ChatMessage[] = [{ ...first }];
  let used = firstChars;

  for (let i = messages.length - 1; i >= 1; i--) {
    const msg = messages[i];
    // Truncate oversized single messages
    const content = msg.content.length > 4000
      ? msg.content.slice(-4000) + '\n...[truncated]'
      : msg.content;

    if (used + content.length > budget) break;
    selected.splice(1, 0, { ...msg, content }); // Insert after first
    used += content.length;
  }

  return selected;
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

/** P0 — Always blocked in every mode (destructive, irreversible). */
const BLOCKED_PATTERNS = [
  /\brm\s+(-\w*r\w*f\w*\s+|rf\s+)\/(?!tmp\/)/i,
  /\bsudo\s+.*\brm\s+(-\w*r\w*f\w*\s+|rf\s+)\/(?!tmp\/)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\{.*;\};/,
  /\b(>|>>)\s*\/dev\/(sd|nvme|vd)/i,
];

/** P1 — Warning level: auto mode skips, confirm mode shows ⚠️ badge. */
const WARNING_PATTERNS = [
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\binit\s+[06]\b/i,
  /\bsystemctl\s+(stop|disable)\s+(sshd|nginx|apache2?|httpd|mysql|mysqld|postgres|postgresql|docker|firewalld|ufw)/i,
  /\biptables\s+-F\b/i,
  /\bchmod\s+(-R\s+)?0?777\s+\//i,
  /\bsudo\s+.*\b(shutdown|reboot)\b/i,
  /\b(>|>>)\s*\/dev\/(?!sd|nvme|vd)/i,
];

function isBlockedCommand(cmd: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(cmd));
}

function isWarningCommand(cmd: string): boolean {
  return WARNING_PATTERNS.some((p) => p.test(cmd));
}

/** Extract bash/sh code blocks from markdown text. Returns individual commands (all blocks). */
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

/**
 * Extract commands from ONLY THE FIRST bash/sh code block.
 *
 * This implements the Claude Code "one tool per turn" pattern:
 *   - AI gives exactly ONE bash block per response
 *   - System executes it and returns the result
 *   - AI sees the result and decides the next step
 *   - A response with NO bash block signals task completion
 *
 * If the AI happens to give multiple code blocks, only the first is
 * executed. The AI will naturally provide the rest in subsequent turns.
 */
function extractFirstBashBlockCommands(text: string): string[] {
  const match = text.match(/```(?:bash|sh)\s*\n?([\s\S]*?)```/);
  if (!match) return [];
  const block = match[1].trim();
  const commands: string[] = [];
  block.split('\n').forEach((line) => {
    const l = line.trim();
    if (l && !l.startsWith('#') && !l.startsWith('//')) commands.push(l);
  });
  return commands;
}

/** Send a command to the active terminal tab. Returns the tab info or null. */
function runCommandInTerminal(cmd: string): { kind: string; connectionId?: number; id?: string } | null {
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  const api = apiRef;
  if (!api || !activeTab || !api.terminal) return null;
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

/** Display command + result in xterm.js terminal (visual only, NOT sent to bash). */
function displayInTerminal(cmd: string, result: { stdout: string; stderr: string; exitCode: number | null } | null, error?: string): void {
  const activeTab = state.mainPanelTabs.find((t) => t.id === state.activeMainPanelTabId);
  if (!activeTab) return;

  let term: { write(data: string): void } | undefined;
  if (activeTab.kind === 'terminal') {
    term = state.terminalInstances.get(activeTab.connectionId)?.term;
  } else if (activeTab.kind === 'local-terminal') {
    term = state.localTerminalInstances.get(activeTab.id)?.term;
  }
  if (!term) return;

  const MAX_DISPLAY = 600;
  let display = `\r\n\x1b[1;33m$ ${cmd}\x1b[0m\r\n`;

  if (error) {
    display += `\x1b[31m[ERROR] ${error}\x1b[0m\r\n`;
  } else if (result) {
    if (result.stdout) {
      const s = result.stdout.length > MAX_DISPLAY ? result.stdout.slice(0, MAX_DISPLAY) + '\r\n...(truncated)' : result.stdout;
      display += s + '\r\n';
    }
    if (result.stderr) {
      const s = result.stderr.length > 300 ? result.stderr.slice(0, 300) + '\r\n...(truncated)' : result.stderr;
      display += `\x1b[31m${s}\x1b[0m\r\n`;
    }
    if (result.exitCode !== 0 && result.exitCode !== null) {
      display += `\x1b[31m[exit code: ${result.exitCode}]\x1b[0m\r\n`;
    }
    if (!result.stdout && !result.stderr) {
      display += '(no output)\r\n';
    }
  }
  display += '\r\n';

  term.write(display);
}

/** Check if the AI response indicates the task is complete (no more commands to run). */
function isTaskComplete(aiContent: string): boolean {
  // No bash code blocks = AI is giving a text summary → task is done.
  // This mirrors Claude Code's pattern: no tool_use = stop the loop.
  const commands = extractBashCommands(aiContent);
  return commands.length === 0;
}

const AGENT_LOG = '[Agent Loop]';

function agentLog(...args: unknown[]): void {
  console.log(AGENT_LOG, ...args);
  window.electronAPI?.logToMain?.(AGENT_LOG, ...args);
}

/**
 * Agentic loop — Claude Code "one tool per turn" pattern adapted for SSH.
 *
 * Each turn:
 *   1. Extract the FIRST bash code block from the AI response
 *   2. Execute each line in that block sequentially (stop on first error)
 *   3. Send the combined result back to AI as a structured feedback message
 *   4. AI streams its next response: another bash block → another turn, or text only → done
 *   5. Repeat until: no bash block in response | max turns | user abort
 *
 * "One block per turn" mirrors Claude Code's one tool_use per response:
 *   AI sees the result of each step before deciding what to do next.
 *   Multiple commands inside ONE block are fine (they're like a single shell script).
 *   A second block in the same response is intentionally ignored — the AI will give it next turn.
 */

/** Show a command approval dialog for confirm mode. Returns true if user approves. */
function showConfirmDialog(cmd: string, isWarning: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.getElementById('agentConfirmDialog');
    const cmdText = document.getElementById('agentConfirmCmd');
    const approveBtn = document.getElementById('agentConfirmApprove');
    const skipBtn = document.getElementById('agentConfirmSkip');
    const warningBadge = document.getElementById('agentConfirmWarning');

    if (!dialog || !cmdText || !approveBtn || !skipBtn) {
      resolve(false);
      return;
    }

    cmdText.textContent = cmd;
    dialog.style.display = 'flex';
    if (warningBadge) warningBadge.style.display = isWarning ? 'inline-block' : 'none';

    const cleanup = () => {
      dialog.style.display = 'none';
      approveBtn.onclick = null;
      skipBtn.onclick = null;
    };

    approveBtn.onclick = () => { cleanup(); resolve(true); };
    skipBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

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
  updateAgentLoopUI(0);

  let turnContent = initialAiContent;
  let turnCount = 0;

  try {
    while (turnCount < state.AGENT_LOOP_MAX_TURNS && !state.agentLoopAbort) {
      // ── Claude Code "one tool per turn": take ONLY the first bash block ──
      const commands = extractFirstBashBlockCommands(turnContent);
      agentLog(`Turn ${turnCount}: first bash block has ${commands.length} command line(s)`, commands);

      if (commands.length === 0) {
        // No bash block → AI gave a text-only response → task is complete
        agentLog('Task complete: no bash block in response');
        break;
      }

      updateAgentLoopUI(turnCount + 1);

      // ── Execute each line in the block sequentially, stop on first error ──
      const allResults: string[] = [];
      let stoppedOnError = false;

      for (let ci = 0; ci < commands.length; ci++) {
        const cmd = commands[ci];
        if (state.agentLoopAbort) break;

        // P0 — Always blocked (destructive / irreversible)
        if (isBlockedCommand(cmd)) {
          agentLog(`BLOCKED (P0): ${cmd}`);
          allResults.push(`Command: ${cmd}\nResult: BLOCKED — this command is classified as destructive and will not be executed. Suggest a safer alternative.`);
          stoppedOnError = true;
          break;
        }

        // P1 — High-risk: auto mode skips, confirm mode shows ⚠️
        if (isWarningCommand(cmd) && state.aiPermissionMode === 'auto') {
          agentLog(`SKIP warning-level command in auto mode: ${cmd}`);
          allResults.push(`Command: ${cmd}\nResult: SKIPPED — high-risk command not auto-executed. If the user explicitly approves, suggest it again.`);
          stoppedOnError = true;
          break;
        }

        // Confirm mode: require user approval before each command
        if (state.aiPermissionMode === 'confirm') {
          const isWarning = isWarningCommand(cmd);
          const approved = await showConfirmDialog(cmd, isWarning);
          if (!approved) {
            agentLog(`SKIP by user: ${cmd}`);
            allResults.push(`Command: ${cmd}\nResult: SKIPPED by user — do not retry this command.`);
            stoppedOnError = true;
            break;
          }
        }

        agentLog(`EXEC [${ci + 1}/${commands.length}]: ${cmd}`);

        let resultMsg: string;
        try {
          let result: { stdout: string; stderr: string; exitCode: number | null };

          if (activeTab.kind === 'terminal') {
            result = await api.terminal.exec(activeTab.connectionId, cmd, 120000);
          } else {
            result = await api.terminal.localExec(cmd, 120000);
          }

          // Show command + output in the terminal panel (visual only, not sent to the shell)
          displayInTerminal(cmd, result);

          // Build structured feedback for the AI (mirrors Claude Code's tool_result format)
          const outputParts: string[] = [];
          outputParts.push(`Command: ${cmd}`);
          outputParts.push(`Exit Code: ${result.exitCode ?? 'unknown'}`);
          if (result.stdout) {
            outputParts.push(`--- stdout ---`);
            outputParts.push(truncateForAi(result.stdout, state.AGENT_OUTPUT_MAX_CHARS));
          }
          if (result.stderr) {
            outputParts.push(`--- stderr ---`);
            outputParts.push(truncateForAi(result.stderr, 2000));
          }
          if (!result.stdout && !result.stderr) {
            outputParts.push(`(no output)`);
          }
          outputParts.push(`--- end ---`);
          resultMsg = outputParts.join('\n');
          agentLog(`OUTPUT (${resultMsg.length} chars): ${resultMsg.slice(0, 200)}`);

          // Non-zero exit code: stop here so AI can react to the error
          if (result.exitCode !== 0 && result.exitCode !== null) {
            stoppedOnError = true;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          resultMsg = `Command: ${cmd}\nResult: ERROR — ${errMsg}`;
          agentLog(`EXEC ERROR: ${errMsg}`);
          displayInTerminal(cmd, null, errMsg);
          stoppedOnError = true;
        }

        allResults.push(resultMsg);

        if (stoppedOnError) break;
      }

      if (state.agentLoopAbort) break;

      // ── Feed results back to AI (one turn = one bash block executed) ──
      turnCount++;
      const feedbackMsg = allResults.length > 1
        ? `[Step ${turnCount}: ${allResults.length} command(s) executed]\n\n${allResults.join('\n\n')}`
        : `[Step ${turnCount}]\n${allResults[0] ?? '(no output)'}`;

      agentLog(`Sending step ${turnCount} feedback to AI, ${allResults.length} result(s), stoppedOnError=${stoppedOnError}`);

      await api.chatContext!.add(sessionId, 'user', `[Command execution result]\n${feedbackMsg}`);

      // Stream the next AI response
      turnContent = await streamAiFollowUp(api, sessionId, turnCount);
      if (!turnContent) break;

      // Brief pause between turns to avoid hammering the API
      await new Promise((r) => setTimeout(r, 200));
    }

    agentLog(`Agentic loop finished after ${turnCount} turn(s)`);
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
 *
 * This is the "tool_result → next response" step of the Claude Code loop.
 */
async function streamAiFollowUp(api: Api, sessionId: number, turnCount?: number): Promise<string> {
  const rawMessages = await api.chatContext!.listBySession(sessionId);
  const messages: ChatMessage[] = rawMessages.map((m) => ({
    id: m.id,
    role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: m.content,
    thinking: m.thinking,
    thinkingDurationMs: m.thinkingDurationMs,
    suggestedCommands: m.suggestedCommands,
  }));
  const loopHint = [
    `\n\n[Agentic Loop — Step ${turnCount ?? '?'}]`,
    `You are executing the user's request step-by-step via SSH.`,
    `Examine the command result above and decide:`,
    `  • Task complete → respond with a text-only summary (NO bash code blocks). This ends the loop.`,
    `  • Error → give ONE bash code block with the fix or diagnosis command.`,
    `  • More steps needed → give ONE bash code block with the next command(s).`,
    `Do NOT give multiple bash code blocks. Give exactly one, then wait for the result.`,
    `Do NOT repeat a command that already succeeded. Do NOT explain what you are about to do — just give the command.`,
  ].join('\n');

  const payload = [
    { role: 'system' as const, content: getChatSystemPrompt() + loopHint },
    ...selectMessagesForContext(messages, MAX_CONTEXT_CHARS).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  const { msgDiv, thinkingContentEl, thinkingSummaryEl, contentEl, indicatorEl } = createStreamingMessage();
  let thinkingText = '';
  let contentText = '';
  let thinkingDurationMs: number | null = null;
  let streamDone = false;

  return new Promise<string>((resolve) => {
    // Safety timeout: resolve with empty string if stream never completes (120s)
    const safetyTimeout = setTimeout(() => {
      if (streamDone) return;
      streamDone = true;
      agentLog('streamAiFollowUp SAFETY TIMEOUT — resolving with empty string');
      finishStreamingMessage(msgDiv, thinkingText, contentText + '\n\n**Error:** AI 响应超时，请重试。', thinkingDurationMs);
      resolve('');
    }, 120_000);

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
        clearTimeout(safetyTimeout);
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
        }).catch((e) => {
          agentLog('streamAiFollowUp save error:', e);
        });
        agentLog(`AI follow-up done, ${extractBashCommands(contentText).length} commands in response`);
        resolve(contentText);
      } else if (chunk.type === 'error') {
        clearTimeout(safetyTimeout);
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
    api.chat!.streamStart(payload, state.showThinking ? { mode: 'adaptive' } : { mode: 'disabled' });
  });
}

/** Update UI elements to show agent loop status and current step number. */
function updateAgentLoopUI(step?: number): void {
  const sendBtn = document.getElementById('btnChatSend') as HTMLButtonElement | null;
  const abortBtn = document.getElementById('btnAbortAgent') as HTMLButtonElement | null;
  const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  if (sendBtn) sendBtn.disabled = state.agentLoopRunning;
  if (input) input.disabled = state.agentLoopRunning;

  // Toggle abort button visibility
  if (abortBtn) {
    abortBtn.style.display = state.agentLoopRunning ? 'inline-block' : 'none';
  }

  // Show step counter in send button while the loop is active
  if (sendBtn) {
    if (state.agentLoopRunning) {
      const stepLabel = step !== undefined && step > 0
        ? `${t('ai.thinking')} · Step ${step}/${state.AGENT_LOOP_MAX_TURNS}`
        : t('ai.thinking');
      sendBtn.textContent = stepLabel;
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
      ...selectMessagesForContext(messages, MAX_CONTEXT_CHARS).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // Streaming mode
    const { msgDiv, thinkingContentEl, thinkingSummaryEl, contentEl, indicatorEl } = createStreamingMessage();
    let thinkingText = '';
    let contentText = '';
    let thinkingDurationMs: number | null = null;
    let done = false;

    // Safety timeout: stop waiting if stream never completes (120s)
    const chatTimeout = setTimeout(() => {
      if (done) return;
      done = true;
      contentText += '\n\n**Error:** AI 响应超时，请重试。';
      finishStreamingMessage(msgDiv, thinkingText, contentText, thinkingDurationMs);
      agentLog('sendChatMessage SAFETY TIMEOUT');
    }, 120_000);

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
        clearTimeout(chatTimeout);
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
          // Start agentic loop for auto and confirm modes (intelligent execution with feedback)
          if (state.aiPermissionMode === 'auto' || state.aiPermissionMode === 'confirm') {
            runAgenticLoop(sessionId, contentText).catch((e) => {
              agentLog('runAgenticLoop unhandled error:', e);
            });
          }
          void tryOpenDiffPreviewForLastMessage(sessionId);
        }).catch((e) => {
          agentLog('done handler error:', e);
        });
      } else if (chunk.type === 'error') {
        clearTimeout(chatTimeout);
        done = true;
        contentText += `\n\n**Error:** ${chunk.text}`;
        finishStreamingMessage(msgDiv, thinkingText, contentText, thinkingDurationMs);
      }

      if (!done) {
        const chatEl = document.getElementById('chatMessages');
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
      }
    });

    api.chat.streamStart(payload, state.showThinking ? { mode: 'adaptive' } : { mode: 'disabled' });
  } catch (err) {
    const errContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    api.chatContext!.add(sessionId, 'assistant', errContent).then((row) => {
      state.chatMessagesBySession[sessionId].push({
        id: row.id,
        role: 'assistant',
        content: row.content,
      });
      renderChatMessages();
    }).catch(() => {});
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

/** Load available models into the chat toolbar model selector. */
async function loadChatModelSelect(api: Api): Promise<void> {
  const select = document.getElementById('chatModelSelect') as HTMLSelectElement | null;
  if (!select) return;

  // Load current settings to get the active model
  const settings = await api.aiSettings?.get();
  const currentModel = settings?.model ?? '';

  // Try fetching model list from the API
  let models: Array<{ id: string }> = [];
  const result = await api.aiSettings?.getModels();
  if (result?.ok && result.models.length > 0) {
    models = result.models;
  }

  select.innerHTML = '';

  if (models.length > 0) {
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id.length > 30 ? m.id.slice(0, 27) + '...' : m.id;
      if (m.id === currentModel) opt.selected = true;
      select.appendChild(opt);
    }
    // If current model not in list, add it
    if (currentModel && !models.some((m) => m.id === currentModel)) {
      const opt = document.createElement('option');
      opt.value = currentModel;
      opt.textContent = currentModel;
      opt.selected = true;
      select.insertBefore(opt, select.firstChild);
    }
  } else {
    // No model list available — just show current model
    const opt = document.createElement('option');
    opt.value = currentModel;
    opt.textContent = currentModel || t('ai.noModel');
    select.appendChild(opt);
  }

  // On change, save the model selection
  select.addEventListener('change', async () => {
    const newModel = select.value;
    const current = await api.aiSettings?.getRaw();
    if (current) {
      await api.aiSettings?.set({
        apiUrl: current.apiUrl ?? '',
        apiKey: current.apiKey ?? '',
        model: newModel,
        temperature: current.temperature ?? 0.7,
        maxTokens: current.maxTokens ?? 4096,
        systemPrompt: current.systemPrompt ?? '',
      });
      refreshThinkToggle();
    }
  });
}

export function bindChatEvents(api: Api): void {
  apiRef = api;
  updateChatFormLoginState();
  loadChatModelSelect(api);
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

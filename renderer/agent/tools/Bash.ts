// Bash: run a shell command on the target (remote via SSH or local PTY-free exec).
//
// This is the primary escape hatch. Higher-level tools (SystemInfo, service
// management, etc.) exist for common tasks and give the model structured input
// surfaces, but Bash remains available for arbitrary work.

import type { ToolContext, ToolDefinition, ToolResult } from '../types';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

interface BashInput {
  command: string;
  timeout_ms?: number;
  description?: string;
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  const head = s.slice(0, Math.floor(limit * 0.7));
  const tail = s.slice(s.length - Math.floor(limit * 0.2));
  return `${head}\n... [truncated ${s.length - head.length - tail.length} chars] ...\n${tail}`;
}

async function runBash(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const input = rawInput as unknown as BashInput;
  const api = window.electronAPI;
  if (!api?.terminal) {
    return { content: 'Error: terminal bridge not available.', isError: true };
  }
  const timeout = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const command = input.command;
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { content: 'Error: `command` must be a non-empty string.', isError: true };
  }

  const res =
    ctx.target.kind === 'remote'
      ? await api.terminal.exec(ctx.target.connectionId, command, timeout)
      : await api.terminal.localExec(command, timeout);

  const stdout = truncate(res.stdout ?? '', MAX_OUTPUT_CHARS);
  const stderr = truncate(res.stderr ?? '', Math.floor(MAX_OUTPUT_CHARS / 3));
  const lines: string[] = [];
  lines.push(`Exit code: ${res.exitCode ?? '(null)'}`);
  if (stdout.length > 0) {
    lines.push('--- stdout ---');
    lines.push(stdout);
  }
  if (stderr.length > 0) {
    lines.push('--- stderr ---');
    lines.push(stderr);
  }
  if (stdout.length === 0 && stderr.length === 0) {
    lines.push('(no output)');
  }

  return {
    content: lines.join('\n'),
    isError: res.exitCode !== 0 && res.exitCode !== null,
    data: res,
  };
}

export const BashTool: ToolDefinition = {
  name: 'bash',
  description:
    'Execute a shell command on the target host and return stdout, stderr, and exit code. ' +
    'Use for one-shot commands that produce bounded output. Long-running or interactive ' +
    'commands (vim, top, ssh) are NOT appropriate — they will hang or produce ANSI noise. ' +
    'For those, tell the user to open a terminal tab instead.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to run. Single line or `&&`-chained. Quote paths with spaces.',
      },
      timeout_ms: {
        type: 'integer',
        description: 'Max execution time in milliseconds. Defaults to 120000 (2 minutes).',
      },
      description: {
        type: 'string',
        description: 'A brief (5–10 word) description of what this command does, for logging.',
      },
    },
    required: ['command'],
  },
  isReadOnly: (rawInput) => {
    // Heuristic: whitelist a few obviously safe command prefixes. Anything
    // else goes through the permission system. A future classifier can do
    // better.
    const cmd = (((rawInput as unknown as BashInput).command) ?? '').trim();
    if (cmd.length === 0) return true;
    const safePrefixes = [
      'ls', 'cat', 'head', 'tail', 'grep', 'find', 'stat', 'wc', 'echo ',
      'pwd', 'whoami', 'id', 'hostname', 'uptime', 'uname', 'df', 'du', 'free',
      'ps', 'top -b', 'ss ', 'netstat', 'ip ', 'lscpu', 'lsblk', 'lsmod',
      'systemctl status', 'systemctl list', 'journalctl',
      'which', 'type', 'file ', 'readlink', 'realpath',
    ];
    return safePrefixes.some((p) => cmd.startsWith(p));
  },
  isConcurrencySafe: () => false,
  execute: runBash,
};

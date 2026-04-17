// ListDir: list directory contents on the target via SFTP (or local fs).
//
// Returns a compact formatted table the model can scan quickly. Keep output
// bounded — huge directories get truncated with a note to narrow the path.

import type { ToolContext, ToolDefinition, ToolResult } from '../types';

const MAX_ENTRIES = 500;

interface ListDirInput {
  path: string;
}

interface Entry {
  name: string;
  isDirectory: boolean;
  size?: string;
  mtime?: string;
  permissions?: string;
}

async function execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const input = rawInput as unknown as ListDirInput;
  const api = window.electronAPI?.explorer;
  if (!api) return { content: 'Error: explorer bridge not available.', isError: true };
  const path = (input.path ?? '').trim();
  if (!path) return { content: 'Error: `path` is required.', isError: true };

  let entries: Entry[];
  try {
    entries =
      ctx.target.kind === 'remote'
        ? await api.listDirectory(ctx.target.connectionId, path)
        : await api.listLocalDirectory(path);
  } catch (err) {
    return {
      content: `Error: failed to list ${path}: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }

  const total = entries.length;
  const truncated = total > MAX_ENTRIES;
  const shown = truncated ? entries.slice(0, MAX_ENTRIES) : entries;

  // Sort: directories first, then alphabetically.
  shown.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [`Directory: ${path} (${total} entries)`];
  for (const e of shown) {
    const typeChar = e.isDirectory ? 'd' : '-';
    const perms = e.permissions ?? '???';
    const size = e.isDirectory ? '-' : e.size ?? '?';
    const mtime = e.mtime ?? '';
    lines.push(`${typeChar}${perms.padEnd(10)} ${size.padStart(10)} ${mtime.padEnd(20)} ${e.name}${e.isDirectory ? '/' : ''}`);
  }
  if (truncated) {
    lines.push(`... [truncated, ${total - MAX_ENTRIES} more entries] — narrow the path or use bash find/ls with filters`);
  }

  return { content: lines.join('\n'), data: { path, total, entries: shown } };
}

export const ListDirTool: ToolDefinition = {
  name: 'list_dir',
  description:
    'List contents of a directory on the target. Returns one line per entry with type, ' +
    'permissions, size, mtime, name. Prefer this over `ls` via bash for structured output. ' +
    'Large directories (>500 entries) are truncated; use bash with `find`/`grep` to narrow.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute directory path on the target host.' },
    },
    required: ['path'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute,
};

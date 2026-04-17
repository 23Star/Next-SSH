// ReadFile: fetch the contents of a file on the target via SFTP.
//
// Returns text content with a line-count header and optional offset/limit for
// large files. If the bridge can't decode the file (binary), the tool returns
// an error string with a hint.

import type { ToolContext, ToolDefinition, ToolResult } from '../types';

const MAX_CHARS = 100_000;
const MAX_CHARS_PER_RESPONSE = 30_000;

interface ReadFileInput {
  path: string;
  offset?: number; // 1-indexed line number to start from
  limit?: number; // number of lines to return
}

async function execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const input = rawInput as unknown as ReadFileInput;
  const api = window.electronAPI?.explorer;
  if (!api) return { content: 'Error: explorer bridge not available.', isError: true };

  const path = (input.path ?? '').trim();
  if (!path) return { content: 'Error: `path` is required.', isError: true };

  let text: string;
  try {
    text =
      ctx.target.kind === 'remote'
        ? await api.readRemoteFile(ctx.target.connectionId, path)
        : await api.readLocalFile(path);
  } catch (err) {
    return {
      content: `Error: failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }

  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
  }

  const allLines = text.split('\n');
  const offset = Math.max(1, input.offset ?? 1);
  const limit = Math.max(1, input.limit ?? 2000);
  const slice = allLines.slice(offset - 1, offset - 1 + limit);

  // Render in `cat -n` style; helps the model reference specific lines later.
  const numbered = slice.map((line, i) => `${String(offset + i).padStart(6)}\t${line}`).join('\n');
  let body = numbered;
  if (body.length > MAX_CHARS_PER_RESPONSE) {
    body = body.slice(0, MAX_CHARS_PER_RESPONSE) + '\n... [truncated, increase offset to read more] ...';
  }

  const header =
    `File: ${path}\n` +
    `Lines: ${allLines.length}${allLines.length > 1 && text.endsWith('\n') ? '' : ' (no trailing newline)'}\n` +
    `Returned: ${offset}..${Math.min(offset + slice.length - 1, allLines.length)}`;
  return { content: `${header}\n---\n${body}`, data: { path, totalLines: allLines.length, offset, limit: slice.length } };
}

export const ReadFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read a text file from the target host via SFTP (remote) or the local filesystem. ' +
    'Returns `cat -n`-style numbered lines. For large files use `offset` (1-indexed start line) ' +
    'and `limit` (max lines). Binary files will fail — use bash with `file` or `xxd` instead.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path on the target host.' },
      offset: { type: 'integer', description: '1-indexed starting line (default 1).' },
      limit: { type: 'integer', description: 'Maximum lines to return (default 2000).' },
    },
    required: ['path'],
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute,
};

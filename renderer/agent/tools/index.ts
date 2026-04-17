// Tool registry + default bundle.
//
// `DEFAULT_TOOLS` is the minimum set any agent session starts with. Panel
// modules can extend this at runtime (e.g., a Services page adds a
// `manage_service` tool before spawning an AI subtask). Tools must have unique
// names; `buildToolSet` enforces that.

import type { ToolDefinition } from '../types';
import { BashTool } from './Bash';
import { ListDirTool } from './ListDir';
import { ReadFileTool } from './ReadFile';
import { SystemInfoTool } from './SystemInfo';

export { BashTool, ListDirTool, ReadFileTool, SystemInfoTool };

export const DEFAULT_TOOLS: ToolDefinition[] = [
  SystemInfoTool,
  ListDirTool,
  ReadFileTool,
  BashTool,
];

export function buildToolSet(...groups: ToolDefinition[][]): ToolDefinition[] {
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];
  for (const group of groups) {
    for (const t of group) {
      if (seen.has(t.name)) {
        throw new Error(`Duplicate tool name: ${t.name}`);
      }
      seen.add(t.name);
      out.push(t);
    }
  }
  return out;
}

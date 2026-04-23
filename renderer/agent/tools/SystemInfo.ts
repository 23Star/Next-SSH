// SystemInfo: one-shot host snapshot.
//
// Runs a batch of canonical read-only commands in parallel via the SSH exec
// channel and returns a structured summary. The panel's Dashboard uses the
// same tool — so what the AI sees is exactly what the user sees, and there's
// only one place that has to know "how to ask a Linux host how it's doing".

import type { ExecResult } from '../../types';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';

export interface SystemSnapshot {
  hostname: string;
  os: string;
  kernel: string;
  uptime: string;
  loadAvg: [number, number, number] | null;
  cpuCores: number | null;
  cpu: { modelName: string | null };
  memoryBytes: { total: number; used: number; free: number; available: number } | null;
  disks: Array<{ mount: string; fs: string; totalBytes: number; usedBytes: number; usePercent: number }>;
  processCount: number | null;
  listeningPorts: Array<{ proto: string; address: string; port: number; process: string | null }>;
}

async function runRemote(api: NonNullable<typeof window.electronAPI>['terminal'] & object, target: ToolContext['target'], cmd: string, timeoutMs = 15_000): Promise<ExecResult> {
  if (!api) throw new Error('terminal bridge not available');
  if (target.kind === 'remote') return api.exec(target.connectionId, cmd, timeoutMs);
  return api.localExec(cmd, timeoutMs);
}

function parseLoadAvg(s: string): [number, number, number] | null {
  const parts = s.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const [a, b, c] = parts.slice(0, 3).map((x) => Number.parseFloat(x));
  if (![a, b, c].every(Number.isFinite)) return null;
  return [a, b, c];
}

// `free -b` output:
//               total        used        free      shared  buff/cache   available
// Mem:     8234614784   423313408  2283655168     1048576  5527646208  7432151040
function parseFree(s: string): SystemSnapshot['memoryBytes'] {
  const line = s.split('\n').find((l) => l.startsWith('Mem:'));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  const total = Number.parseInt(parts[1] ?? '', 10);
  const used = Number.parseInt(parts[2] ?? '', 10);
  const free = Number.parseInt(parts[3] ?? '', 10);
  const available = Number.parseInt(parts[6] ?? parts[5] ?? '', 10);
  if (![total, used, free].every(Number.isFinite)) return null;
  return { total, used, free, available: Number.isFinite(available) ? available : free };
}

// `df -PB1` POSIX output (bytes). Header + rows.
function parseDf(s: string): SystemSnapshot['disks'] {
  const lines = s.split('\n').slice(1).filter((l) => l.trim().length > 0);
  const out: SystemSnapshot['disks'] = [];
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const [fs, total, used, , usePct, mount] = cols;
    const totalBytes = Number.parseInt(total, 10);
    const usedBytes = Number.parseInt(used, 10);
    const usePercent = Number.parseInt((usePct ?? '').replace('%', ''), 10);
    if (!Number.isFinite(totalBytes)) continue;
    // Skip pseudo filesystems.
    if (fs === 'tmpfs' || fs === 'devtmpfs' || fs?.startsWith('overlay')) continue;
    out.push({ mount, fs, totalBytes, usedBytes, usePercent });
  }
  return out;
}

// `ss -Hltn` / `ss -Hlun` output: "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*  users:((\"sshd\",pid=1234,fd=3))"
function parseSsLine(line: string, proto: string): SystemSnapshot['listeningPorts'][number] | null {
  const parts = line.trim().split(/\s+/);
  // Local address is column 4 when `-H` (no header) is used with -l -n.
  const localAddr = parts[3];
  if (!localAddr) return null;
  // IPv6 addresses are wrapped in brackets: [::]:22
  const m = localAddr.match(/^\[?(.+?)\]?:(\d+)$/);
  if (!m) return null;
  const portNum = Number.parseInt(m[2], 10);
  if (!Number.isFinite(portNum)) return null;
  const usersCol = line.match(/users:\(\("([^"]+)"/);
  return { proto, address: m[1], port: portNum, process: usersCol?.[1] ?? null };
}

async function execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const api = window.electronAPI?.terminal;
  if (!api) return { content: 'Error: terminal bridge not available.', isError: true };

  // Canonical read-only commands. Machine-parseable where possible.
  const run = (cmd: string, timeoutMs?: number) => runRemote(api, ctx.target, cmd, timeoutMs);

  const [
    hostnameR,
    osR,
    kernelR,
    uptimeR,
    loadR,
    cpuCountR,
    cpuModelR,
    freeR,
    dfR,
    psR,
    ssTcpR,
    ssUdpR,
  ] = await Promise.all([
    run('hostname'),
    run('cat /etc/os-release 2>/dev/null | grep -E "^PRETTY_NAME=" | cut -d= -f2- | tr -d \'"\''),
    run('uname -r'),
    run('uptime -p 2>/dev/null || uptime'),
    run('cat /proc/loadavg'),
    run('nproc'),
    run('grep -m1 "^model name" /proc/cpuinfo | cut -d: -f2- | sed \'s/^ //\''),
    run('free -b'),
    run('df -PB1 -x tmpfs -x devtmpfs -x squashfs', 20_000),
    run('ps -e --no-headers | wc -l'),
    run('ss -Hltn 2>/dev/null || ss -ltn', 20_000),
    run('ss -Hlun 2>/dev/null || ss -lun', 20_000),
  ]);

  const listeningTcp = (ssTcpR.stdout ?? '')
    .split('\n')
    .map((l) => parseSsLine(l, 'tcp'))
    .filter((x): x is SystemSnapshot['listeningPorts'][number] => x !== null);
  const listeningUdp = (ssUdpR.stdout ?? '')
    .split('\n')
    .map((l) => parseSsLine(l, 'udp'))
    .filter((x): x is SystemSnapshot['listeningPorts'][number] => x !== null);

  const snapshot: SystemSnapshot = {
    hostname: hostnameR.stdout?.trim() || '(unknown)',
    os: osR.stdout?.trim() || '(unknown)',
    kernel: kernelR.stdout?.trim() || '(unknown)',
    uptime: uptimeR.stdout?.trim() || '(unknown)',
    loadAvg: parseLoadAvg(loadR.stdout ?? ''),
    cpuCores: Number.parseInt((cpuCountR.stdout ?? '').trim(), 10) || null,
    cpu: { modelName: (cpuModelR.stdout ?? '').trim() || null },
    memoryBytes: parseFree(freeR.stdout ?? ''),
    disks: parseDf(dfR.stdout ?? ''),
    processCount: Number.parseInt((psR.stdout ?? '').trim(), 10) || null,
    listeningPorts: [...listeningTcp, ...listeningUdp],
  };

  // Render a compact text summary for the model; keep the full structure in `data`.
  const mem = snapshot.memoryBytes;
  const summary: string[] = [];
  summary.push(`Host:     ${snapshot.hostname}`);
  summary.push(`OS:       ${snapshot.os}`);
  summary.push(`Kernel:   ${snapshot.kernel}`);
  summary.push(`Uptime:   ${snapshot.uptime}`);
  if (snapshot.loadAvg) summary.push(`Load:     ${snapshot.loadAvg.join(', ')}`);
  if (snapshot.cpuCores) summary.push(`CPUs:     ${snapshot.cpuCores} × ${snapshot.cpu.modelName ?? 'unknown'}`);
  if (mem) {
    const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(2);
    summary.push(`Memory:   ${gb(mem.total - mem.available)} / ${gb(mem.total)} GiB used`);
  }
  if (snapshot.disks.length > 0) {
    summary.push('Disks:');
    for (const d of snapshot.disks) {
      const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(1);
      summary.push(`  ${d.mount.padEnd(16)} ${gb(d.usedBytes)} / ${gb(d.totalBytes)} GiB (${d.usePercent}%)`);
    }
  }
  if (snapshot.processCount) summary.push(`Processes: ${snapshot.processCount}`);
  if (snapshot.listeningPorts.length > 0) {
    summary.push('Listening ports:');
    const shown = snapshot.listeningPorts.slice(0, 20);
    for (const p of shown) {
      summary.push(`  ${p.proto}/${p.port.toString().padStart(5)} on ${p.address}${p.process ? ` [${p.process}]` : ''}`);
    }
    if (snapshot.listeningPorts.length > shown.length) {
      summary.push(`  (+${snapshot.listeningPorts.length - shown.length} more)`);
    }
  }

  return { content: summary.join('\n'), data: snapshot };
}

export const SystemInfoTool: ToolDefinition = {
  name: 'system_info',
  description:
    'Collect a snapshot of the target host: OS, kernel, uptime, CPU, memory, disk usage, ' +
    'process count, and listening ports. Purely read-only; safe to call anytime. Prefer this ' +
    'over running separate `uname`/`free`/`df` commands when you need an overview.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  execute,
};

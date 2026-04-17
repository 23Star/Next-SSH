// Small, pure formatters. No external deps.

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(idx === 0 ? 0 : fractionDigits)} ${units[idx]}`;
}

export function formatPercent(n: number, fractionDigits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(fractionDigits)}%`;
}

export function percentToTone(percent: number): 'success' | 'warn' | 'danger' | undefined {
  if (!Number.isFinite(percent)) return undefined;
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warn';
  return 'success';
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

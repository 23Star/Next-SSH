import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { getTerminal } from '../lib/electron';

interface FirewallProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

interface RuleRow {
  table: string;
  chain: string;
  spec: string;
}

export function Firewall({ connectionId, connStatus, refreshTick }: FirewallProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ufwStatus, setUfwStatus] = useState('unknown');
  const [nftRows, setNftRows] = useState<RuleRow[]>([]);
  const [listening, setListening] = useState<string>('');

  const canUse = connectionId != null && connStatus === 'connected';

  const load = useCallback(async () => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    try {
      const term = getTerminal();

      const ufw = await term.exec(connectionId, "(command -v ufw >/dev/null && sudo -n ufw status 2>/dev/null) || echo 'inactive/unavailable'", 20000);
      setUfwStatus((ufw.stdout || ufw.stderr || 'unknown').trim());

      const nft = await term.exec(connectionId, "(command -v nft >/dev/null && sudo -n nft -a list ruleset 2>/dev/null) || true", 20000);
      const nftText = nft.stdout.trim();
      const rows: RuleRow[] = [];
      let currentTable = '';
      let currentChain = '';
      nftText.split(/\r?\n/).forEach((line) => {
        const t = line.match(/^table\s+\S+\s+(\S+)/);
        if (t) {
          currentTable = t[1];
          return;
        }
        const c = line.match(/^\s*chain\s+(\S+)\s+\{/);
        if (c) {
          currentChain = c[1];
          return;
        }
        const rule = line.trim();
        if (!rule || rule === '}' || !currentTable || !currentChain) return;
        if (/^(type|policy|hook|counter)/.test(rule)) return;
        rows.push({ table: currentTable, chain: currentChain, spec: rule });
      });
      setNftRows(rows.slice(0, 120));

      const ports = await term.exec(connectionId, "ss -tulpn 2>/dev/null | head -n 80", 15000);
      setListening((ports.stdout || ports.stderr || '').trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const ufwTone = useMemo(() => {
    const s = ufwStatus.toLowerCase();
    if (s.includes('active')) return 'ok';
    if (s.includes('inactive') || s.includes('unavailable')) return 'udp';
    return 'tcp';
  }, [ufwStatus]);

  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">Firewall</h1>
            <div className="ns-page__subtitle">UFW / nftables snapshot</div>
          </div>
        </div>
        <EmptyState icon="firewall" title="Select and connect a host" description="Firewall panel reads the current remote server policy and listening ports." />
      </div>
    );
  }

  return (
    <div className="ns-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">Firewall</h1>
          <div className="ns-page__subtitle">Read-only status and rule snapshot</div>
        </div>
        <button className="ns-btn" onClick={() => void load()} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="ns-msg ns-msg--system" data-tone="error"><span>{error}</span></div>}

      <div className="ns-grid ns-grid--dash">
        <section className="ns-card" data-col="4">
          <h3 className="ns-card__title">UFW</h3>
          <div className="ns-card__value"><span className="ns-tag" data-tone={ufwTone}>{ufwStatus.split(/\r?\n/)[0] || 'unknown'}</span></div>
          <pre className="ns-tool__pre">{ufwStatus || 'No output'}</pre>
        </section>

        <section className="ns-card" data-col="8">
          <h3 className="ns-card__title">nftables rules</h3>
          {nftRows.length === 0 ? (
            <div className="ns-card__caption">No nftables rules detected (or sudo not available).</div>
          ) : (
            <table className="ns-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Chain</th>
                  <th>Rule</th>
                </tr>
              </thead>
              <tbody>
                {nftRows.map((row, idx) => (
                  <tr key={`${row.table}_${row.chain}_${idx}`}>
                    <td>{row.table}</td>
                    <td>{row.chain}</td>
                    <td>{row.spec}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="ns-card" data-col="12">
          <h3 className="ns-card__title">Listening ports</h3>
          <pre className="ns-tool__pre">{listening || 'No listening port data.'}</pre>
        </section>
      </div>
    </div>
  );
}

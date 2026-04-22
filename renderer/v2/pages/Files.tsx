import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { getApi } from '../lib/electron';

interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: string;
  mtime?: string;
  permissions?: string;
}

interface FilesProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

function joinRemotePath(base: string, name: string): string {
  if (base === '/') return `/${name}`;
  return `${base.replace(/\/+$/, '')}/${name}`;
}

function remoteDirParent(dir: string): string {
  if (!dir || dir === '/') return '/';
  const parts = dir.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

export function Files({ connectionId, connStatus, refreshTick }: FilesProps): React.ReactElement {
  const [cwd, setCwd] = useState<string>('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUse = connectionId != null && connStatus === 'connected';

  const loadDir = useCallback(async (dir: string) => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    setPreview('');
    try {
      const api = getApi();
      const list = await api.explorer?.listDirectory(connectionId, dir);
      setEntries(list ?? []);
      setCwd(dir);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  useEffect(() => {
    if (!canUse || connectionId == null) return;
    let mounted = true;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const api = getApi();
        const home = await api.explorer?.getHome(connectionId);
        if (!mounted) return;
        const dir = home && home.trim() ? home : '/';
        setCwd(dir);
        const list = await api.explorer?.listDirectory(connectionId, dir);
        if (!mounted) return;
        setEntries(list ?? []);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [canUse, connectionId, refreshTick]);

  const openEntry = useCallback(async (entry: FileEntry) => {
    if (!connectionId) return;
    const fullPath = joinRemotePath(cwd, entry.name);
    if (entry.isDirectory) {
      void loadDir(fullPath);
      return;
    }
    setSelectedPath(fullPath);
    setPreview('Loading…');
    setError(null);
    try {
      const api = getApi();
      const content = await api.explorer?.readRemoteFile(connectionId, fullPath);
      setPreview(content ?? '');
    } catch (err) {
      setPreview('');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connectionId, cwd, loadDir]);

  const uploadFiles = useCallback(async () => {
    if (!connectionId) return;
    setUploading(true);
    setError(null);
    try {
      const api = getApi();
      const localPaths = await api.explorer?.pickLocalFiles?.();
      if (!localPaths || localPaths.length === 0) return;
      await api.explorer?.uploadToRemote(connectionId, localPaths, cwd);
      await loadDir(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [connectionId, cwd, loadDir]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)),
    [entries],
  );

  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">Files</h1>
            <div className="ns-page__subtitle">Remote SSH file browser</div>
          </div>
        </div>
        <EmptyState icon="files" title="Select and connect a host" description="Files panel only shows remote SSH server files." />
      </div>
    );
  }

  return (
    <div className="ns-page ns-files-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">Files</h1>
          <div className="ns-page__subtitle">Remote server only · upload supported</div>
        </div>
      </div>

      <div className="ns-files-toolbar">
        <button className="ns-btn" onClick={() => void loadDir(remoteDirParent(cwd))}>Up</button>
        <button className="ns-btn" onClick={() => void loadDir(cwd)} disabled={loading}>Refresh</button>
        <button className="ns-btn" data-variant="primary" onClick={() => void uploadFiles()} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload files'}
        </button>
        <code className="ns-files-path">{cwd}</code>
      </div>

      {error && <div className="ns-msg ns-msg--system" data-tone="error"><span>{error}</span></div>}

      <div className="ns-files-grid">
        <section className="ns-card" data-col="6">
          <h3 className="ns-card__title">Directory</h3>
          <div className="ns-files-list">
            {loading ? (
              <div className="ns-card__caption">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="ns-card__caption">No entries.</div>
            ) : (
              sorted.map((entry) => {
                const fullPath = joinRemotePath(cwd, entry.name);
                return (
                  <button
                    key={fullPath}
                    className="ns-files-item"
                    data-selected={selectedPath === fullPath}
                    onClick={() => void openEntry(entry)}
                    title={fullPath}
                  >
                    <span className="ns-files-item__name">{entry.isDirectory ? '📁' : '📄'} {entry.name}</span>
                    <span className="ns-files-item__meta">{entry.isDirectory ? 'dir' : (entry.size || '-')}</span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="ns-card" data-col="6">
          <h3 className="ns-card__title">Preview</h3>
          {selectedPath ? (
            <>
              <div className="ns-card__caption">{basename(selectedPath)}</div>
              <pre className="ns-files-preview">{preview || '(empty file)'}</pre>
            </>
          ) : (
            <div className="ns-card__caption">Select a file to preview content.</div>
          )}
        </section>
      </div>
    </div>
  );
}

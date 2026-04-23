// 文件管理器 — 远程 SSH 文件浏览、编辑、预览。
//
// 支持面包屑目录导航、按文件类型路由预览（文本/Monaco 编辑器、
// 图片、压缩包、二进制文件）、文本文件编辑保存。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Icon, type IconName } from '../components/Icon';
import { getApi, getTerminal } from '../lib/electron';
import { formatBytes } from '../lib/format';

// ——— 类型 ———

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

type FileCategory = 'text' | 'image' | 'archive' | 'video' | 'audio' | 'binary';

interface FilePreviewState {
  path: string;
  category: FileCategory;
  content: string;
  loading: boolean;
  error: string | null;
  fileSize: number | null;
}

interface EditorState {
  originalContent: string;
  currentContent: string;
  isDirty: boolean;
  saving: boolean;
  language: string;
}

// ——— 常量 ———

const TEXT_EXTENSIONS = new Set([
  'txt','md','json','js','ts','tsx','jsx','py','go','rs','java','c','cpp',
  'h','hpp','sh','bash','zsh','yml','yaml','toml','xml','html','htm','css',
  'scss','less','conf','cfg','ini','log','env','sql','proto','vue','svelte',
  'cjs','mjs','cts','mts','rb','php','pl','pm','lua','bat','cmd','ps1',
  'gradle','properties','kt','kts','scala','swift','makefile','cmake',
  'gitignore','editorconfig','dockerfile','service','nginx','conf',
]);

const IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','gif','svg','webp','ico','bmp']);

const ARCHIVE_EXTENSIONS = new Set(['zip','tar','tgz','gz','bz2','tbz2','xz','rar','7z']);

const VIDEO_EXTENSIONS = new Set(['mp4','avi','mkv','mov','wmv','flv','webm','m4v','3gp','ts','mts','ogv']);

const AUDIO_EXTENSIONS = new Set(['mp3','wav','flac','aac','ogg','wma','m4a','opus','aiff','ape','alac']);

const LARGE_TEXT_THRESHOLD = 512 * 1024;
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  ico: 'image/x-icon', bmp: 'image/bmp',
};

// ——— 工具函数 ———

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

function getFileCategory(filename: string): FileCategory {
  const lower = filename.toLowerCase();
  if (['dockerfile','makefile','.gitignore','.env','.editorconfig',
       'readme','license','changelog','docker-compose.yml'].some((s) => lower === s || lower.startsWith(s + '.'))) {
    return 'text';
  }
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx <= 0) {
    // 无扩展名或隐藏文件 — 尝试按常见名称判断
    if (lower.startsWith('.env') || lower === 'readme' || lower === 'license') return 'text';
    return 'binary';
  }
  const ext = lower.slice(dotIdx + 1);
  // 复合扩展名 .tar.gz / .tar.bz2
  const prevDot = lower.lastIndexOf('.', dotIdx - 1);
  if (prevDot !== -1) {
    const compound = lower.slice(prevDot + 1);
    if (compound === 'tar.gz' || compound === 'tar.bz2' || compound === 'tar.xz') return 'archive';
  }
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'binary';
}

function getLanguageFromPath(filePath: string): string {
  const base = filePath.replace(/^.*[/\\]/, '').toLowerCase();
  const ext = base.includes('.') ? base.replace(/^.*\./, '') : base;
  if (base.startsWith('dockerfile')) return 'dockerfile';
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', mts: 'typescript', cts: 'typescript',
    tsx: 'typescript', jsx: 'javascript',
    json: 'json', html: 'html', htm: 'html', css: 'css',
    scss: 'scss', less: 'less', md: 'markdown',
    yml: 'yaml', yaml: 'yaml', py: 'python', php: 'php',
    rb: 'ruby', c: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
    h: 'cpp', hpp: 'cpp', cs: 'csharp', java: 'java',
    go: 'go', rs: 'rust', swift: 'swift', kt: 'kotlin',
    sh: 'shell', bash: 'shell', zsh: 'shell', sql: 'sql',
    xml: 'xml', ini: 'ini', vue: 'html', svelte: 'html',
    lua: 'lua', pl: 'perl', pm: 'perl', conf: 'ini',
    toml: 'ini', dockerfile: 'dockerfile',
  };
  return map[ext] ?? 'plaintext';
}

function getArchiveListCommand(filePath: string): string {
  const lower = filePath.toLowerCase();
  const q = `"${filePath}"`;
  if (lower.endsWith('.zip')) return `unzip -l ${q} 2>/dev/null || zipinfo -1 ${q} 2>/dev/null`;
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return `tar -tzf ${q} 2>/dev/null`;
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return `tar -tjf ${q} 2>/dev/null`;
  if (lower.endsWith('.tar.xz')) return `tar -tJf ${q} 2>/dev/null`;
  if (lower.endsWith('.tar')) return `tar -tf ${q} 2>/dev/null`;
  if (lower.endsWith('.gz')) return `gzip -l ${q} 2>/dev/null`;
  if (lower.endsWith('.rar')) return `unrar l ${q} 2>/dev/null || rar l ${q} 2>/dev/null`;
  if (lower.endsWith('.7z')) return `7z l ${q} 2>/dev/null`;
  return `file ${q} 2>/dev/null`;
}

function getArchiveExtractCommand(filePath: string, targetDir: string): string {
  const lower = filePath.toLowerCase();
  const q = `"${filePath}"`;
  const d = `"${targetDir}"`;
  if (lower.endsWith('.zip')) return `mkdir -p ${d} && unzip -o ${q} -d ${d} 2>&1`;
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return `mkdir -p ${d} && tar -xzf ${q} -C ${d} 2>&1`;
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return `mkdir -p ${d} && tar -xjf ${q} -C ${d} 2>&1`;
  if (lower.endsWith('.tar.xz')) return `mkdir -p ${d} && tar -xJf ${q} -C ${d} 2>&1`;
  if (lower.endsWith('.tar')) return `mkdir -p ${d} && tar -xf ${q} -C ${d} 2>&1`;
  if (lower.endsWith('.rar')) return `mkdir -p ${d} && unrar x -o+ ${q} ${d}/ 2>&1`;
  if (lower.endsWith('.7z')) return `mkdir -p ${d} && 7z x ${q} -o${d} -y 2>&1`;
  return `echo "不支持的压缩格式"`;
}

function categoryIcon(cat: FileCategory): IconName {
  switch (cat) {
    case 'text': return 'fileText';
    case 'image': return 'image';
    case 'archive': return 'archive';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'binary': return 'binary';
  }
}

// ——— 面包屑导航 ———

function BreadcrumbNav({ cwd, onNavigate }: { cwd: string; onNavigate: (dir: string) => void }): React.ReactElement {
  const segments = cwd.split('/').filter(Boolean);
  return (
    <nav className="ns-files-breadcrumb" aria-label="文件路径">
      <button
        className="ns-files-breadcrumb__item"
        onClick={() => onNavigate('/')}
        data-active={cwd === '/'}
      >
        <Icon name="files" size={13} /> /
      </button>
      {segments.map((seg, i) => {
        const partialPath = '/' + segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={partialPath}>
            <span className="ns-files-breadcrumb__sep">/</span>
            <button
              className="ns-files-breadcrumb__item"
              data-active={isLast}
              onClick={() => onNavigate(partialPath)}
            >
              {seg}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ——— 预览子组件 ———

function ImagePreview({ preview }: { preview: FilePreviewState }): React.ReactElement {
  if (preview.loading) return <div className="ns-card__caption" style={{ padding: 'var(--s-6)', textAlign: 'center' }}>加载图片中…</div>;
  if (preview.error) return <div className="ns-msg ns-msg--system" data-tone="error"><span>{preview.error}</span></div>;
  const ext = preview.path.split('.').pop()?.toLowerCase() ?? 'png';
  const mime = MIME_MAP[ext] ?? 'image/png';
  return (
    <div className="ns-files-image-preview">
      <img
        src={`data:${mime};base64,${preview.content}`}
        alt={basename(preview.path)}
        className="ns-files-image-preview__img"
      />
    </div>
  );
}

function ArchivePreview({ preview, onDownload, onExtract, extracting }: {
  preview: FilePreviewState; onDownload: () => void; onExtract: () => void; extracting: boolean;
}): React.ReactElement {
  return (
    <div className="ns-files-archive">
      <div className="ns-files-archive__header">
        <Icon name="archive" size={16} />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>压缩包内容列表</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-2)' }}>
          <button className="ns-btn ns-btn--xs" data-variant="primary" onClick={onExtract} disabled={extracting}>
            <Icon name="extract" size={13} /> {extracting ? '解压中…' : '解压到当前目录'}
          </button>
          <button className="ns-btn ns-btn--xs" onClick={onDownload}>
            <Icon name="download" size={13} /> 下载
          </button>
        </div>
      </div>
      <pre className="ns-files-preview">{preview.content || '（无法列出压缩包内容）'}</pre>
    </div>
  );
}

function BinaryPreview({ filePath, onDownload, fileSize, onForceRead }: { filePath: string; onDownload: () => void; fileSize: number | null; onForceRead: () => void }): React.ReactElement {
  return (
    <div className="ns-files-binary">
      <div className="ns-files-binary__icon"><Icon name="binary" size={24} /></div>
      <div className="ns-files-binary__text">二进制文件</div>
      <div className="ns-card__caption">
        {basename(filePath)}
        {fileSize != null ? ` · ${formatBytes(fileSize)}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <button className="ns-btn" onClick={onForceRead}>
          <Icon name="fileText" size={14} /> 强制查看
        </button>
        <button className="ns-btn" data-variant="primary" onClick={onDownload}>
          <Icon name="download" size={14} /> 下载
        </button>
      </div>
    </div>
  );
}

function VideoPreview({ filePath, fileSize, onForceRead }: { filePath: string; fileSize: number | null; onForceRead: () => void }): React.ReactElement {
  return (
    <div className="ns-files-binary">
      <div className="ns-files-binary__icon"><Icon name="video" size={24} /></div>
      <div className="ns-files-binary__text">视频文件</div>
      <div className="ns-card__caption">
        {basename(filePath)}
        {fileSize != null ? ` · ${formatBytes(fileSize)}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <button className="ns-btn" onClick={onForceRead}>
          <Icon name="fileText" size={14} /> 强制查看
        </button>
      </div>
    </div>
  );
}

function AudioPreview({ filePath, fileSize, onForceRead }: { filePath: string; fileSize: number | null; onForceRead: () => void }): React.ReactElement {
  return (
    <div className="ns-files-binary">
      <div className="ns-files-binary__icon"><Icon name="audio" size={24} /></div>
      <div className="ns-files-binary__text">音频文件</div>
      <div className="ns-card__caption">
        {basename(filePath)}
        {fileSize != null ? ` · ${formatBytes(fileSize)}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
        <button className="ns-btn" onClick={onForceRead}>
          <Icon name="fileText" size={14} /> 强制查看
        </button>
      </div>
    </div>
  );
}

// ——— 主组件 ———

export function Files({ connectionId, connStatus, refreshTick }: FilesProps): React.ReactElement {
  const [cwd, setCwd] = useState<string>('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<FilePreviewState | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const monacoRef = useRef<any>(null);
  const monacoContainerRef = useRef<HTMLDivElement>(null);

  const canUse = connectionId != null && connStatus === 'connected';

  // 加载目录
  const loadDir = useCallback(async (dir: string) => {
    if (!canUse || connectionId == null) return;
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    setPreviewState(null);
    setEditorState(null);
    try {
      const api = getApi();
      const list = await api.explorer?.listDirectory(connectionId, dir);
      setEntries(list ?? []);
      setCwd(dir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission') || msg.includes('Permission')) {
        setError(`权限不足：无法访问目录 "${dir}"`);
      } else if (msg.includes('No such file') || msg.includes('not found')) {
        setError(`目录不存在："${dir}"`);
      } else {
        setError(`加载目录失败：${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [canUse, connectionId]);

  // 初始化加载
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
    return () => { mounted = false; };
  }, [canUse, connectionId, refreshTick]);

  // 保存文件
  const saveFile = useCallback(async () => {
    if (!connectionId || !editorState?.isDirty || !monacoRef.current || !selectedPath) return;
    setEditorState((prev) => prev ? { ...prev, saving: true } : prev);
    setError(null);
    try {
      const content = monacoRef.current.getValue();
      const api = getApi();
      await api.explorer?.writeRemoteFile(connectionId, selectedPath, content);
      setEditorState((prev) => prev ? {
        ...prev,
        originalContent: content,
        isDirty: false,
        saving: false,
      } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission') || msg.includes('Permission')) {
        setError('保存失败：文件权限不足，请检查文件写入权限');
      } else if (msg.includes('read-only') || msg.includes('Read-only')) {
        setError('保存失败：文件系统为只读');
      } else {
        setError(`保存失败：${msg}`);
      }
      setEditorState((prev) => prev ? { ...prev, saving: false } : prev);
    }
  }, [connectionId, editorState?.isDirty, selectedPath]);

  // 下载文件
  const downloadFile = useCallback(async (filePath: string) => {
    if (!connectionId) return;
    try {
      const api = getApi();
      await api.explorer?.downloadFromRemote(connectionId, [filePath]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connectionId]);

  // Monaco 编辑器初始化（文本文件）
  useEffect(() => {
    if (previewState?.category !== 'text' || previewState.loading || !previewState.content) return;
    if (!monacoContainerRef.current) return;

    let disposed = false;

    import('monaco-editor').then((monaco) => {
      if (disposed || !monacoContainerRef.current) return;

      // 销毁旧实例
      if (monacoRef.current) {
        monacoRef.current.dispose();
        monacoRef.current = null;
      }

      const language = getLanguageFromPath(previewState.path);
      const isDark = document.documentElement.classList.contains('theme-dark');

      const editor = monaco.editor.create(monacoContainerRef.current, {
        value: previewState.content,
        language,
        theme: isDark ? 'vs-dark' : 'vs',
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        wordWrap: 'on',
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        padding: { top: 8, bottom: 8 },
      });

      // Ctrl+S
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void saveFile();
      });

      // 脏检测
      editor.onDidChangeModelContent(() => {
        const current = editor.getValue();
        setEditorState((prev) => prev ? {
          ...prev,
          currentContent: current,
          isDirty: current !== prev.originalContent,
        } : prev);
      });

      monacoRef.current = editor;

      setEditorState({
        originalContent: previewState.content,
        currentContent: previewState.content,
        isDirty: false,
        saving: false,
        language,
      });
    });

    return () => {
      disposed = true;
      if (monacoRef.current) {
        monacoRef.current.dispose();
        monacoRef.current = null;
      }
    };
  }, [selectedPath, previewState?.category, previewState?.loading, previewState?.content, saveFile]);

  // Monaco 跟随主题
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!monacoRef.current) return;
      const isDark = document.documentElement.classList.contains('theme-dark');
      import('monaco-editor').then((monaco) => {
        monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // 打开文件
  const openEntry = useCallback(async (entry: FileEntry) => {
    if (!connectionId) return;
    const fullPath = joinRemotePath(cwd, entry.name);

    if (entry.isDirectory) {
      void loadDir(fullPath);
      return;
    }

    const category = getFileCategory(entry.name);
    setSelectedPath(fullPath);
    setPreviewState({ path: fullPath, category, content: '', loading: true, error: null, fileSize: null });
    setEditorState(null);
    setError(null);

    try {
      const api = getApi();

      // 先获取文件大小
      let size = 0;
      try {
        size = await api.explorer?.getRemoteFileSize(connectionId, fullPath) ?? 0;
      } catch { /* 继续无大小信息 */ }

      setPreviewState((prev) => prev ? { ...prev, fileSize: size } : prev);

      // 大文件提示
      if (category === 'text' && size > LARGE_TEXT_THRESHOLD) {
        const sizeStr = size > 1048576 ? `${(size / 1048576).toFixed(1)}MB` : `${(size / 1024).toFixed(0)}KB`;
        if (!window.confirm(`文件较大 (${sizeStr})，可能无法流畅编辑。是否继续？`)) {
          setPreviewState(null);
          setSelectedPath(null);
          return;
        }
      }
      if (category === 'image' && size > IMAGE_SIZE_LIMIT) {
        setPreviewState({ path: fullPath, category: 'binary', content: '', loading: false, error: null, fileSize: size });
        return;
      }

      // 按类型加载
      switch (category) {
        case 'text': {
          const content = await api.explorer?.readRemoteFile(connectionId, fullPath) ?? '';
          setPreviewState((prev) => prev ? { ...prev, content, loading: false, fileSize: size } : prev);
          break;
        }
        case 'image': {
          const term = getTerminal();
          const res = await term.exec(connectionId, `base64 "${fullPath}"`, 30000);
          setPreviewState((prev) => prev ? { ...prev, content: res.stdout || '', loading: false, fileSize: size } : prev);
          break;
        }
        case 'archive': {
          const term = getTerminal();
          const cmd = getArchiveListCommand(fullPath);
          const res = await term.exec(connectionId, cmd, 15000);
          setPreviewState((prev) => prev ? {
            ...prev,
            content: res.stdout || res.stderr || '（无法列出压缩包内容）',
            loading: false,
            fileSize: size,
          } : prev);
          break;
        }
        case 'binary': {
          setPreviewState((prev) => prev ? { ...prev, loading: false, fileSize: size } : prev);
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = msg.includes('permission') || msg.includes('Permission')
        ? `无法读取文件：权限不足`
        : msg.includes('No such file')
          ? `文件不存在`
          : msg.includes('timeout')
            ? `读取超时：文件可能过大`
            : `打开文件失败：${msg}`;
      setPreviewState((prev) => prev ? {
        ...prev, loading: false, error: friendly,
      } : prev);
    }
  }, [connectionId, cwd, loadDir]);

  // 上传文件
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
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission denied') || msg.includes('permission denied')) {
        setError(`上传失败：目标目录 "${cwd}" 权限不足，请切换到有写入权限的目录（如用户主目录）`);
      } else {
        setError(`上传失败：${msg}`);
      }
    } finally {
      setUploading(false);
    }
  }, [connectionId, cwd, loadDir]);

  // 删除文件/目录
  const deleteEntry = useCallback(async (entry: FileEntry) => {
    if (!connectionId) return;
    const fullPath = joinRemotePath(cwd, entry.name);
    const typeLabel = entry.isDirectory ? '目录' : '文件';
    if (!window.confirm(`确定要删除${typeLabel} "${entry.name}" 吗？此操作不可撤销。`)) return;
    setDeleting(true);
    setError(null);
    try {
      const term = getTerminal();
      const cmd = entry.isDirectory
        ? `rm -rf "${fullPath}" 2>&1`
        : `rm -f "${fullPath}" 2>&1`;
      const res = await term.exec(connectionId, cmd, 15000);
      if (res.exitCode !== 0 && res.exitCode !== null) {
        throw new Error(res.stderr || `删除失败 (exit code ${res.exitCode})`);
      }
      if (selectedPath === fullPath) {
        setSelectedPath(null);
        setPreviewState(null);
        setEditorState(null);
      }
      await loadDir(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [connectionId, cwd, selectedPath, loadDir]);

  // 解压压缩包
  const extractArchive = useCallback(async (archivePath: string) => {
    if (!connectionId) return;
    const name = basename(archivePath);
    const nameNoExt = name.replace(/\.(tar\.gz|tar\.bz2|tar\.xz|tgz|tbz2|zip|tar|gz|rar|7z)$/i, '');
    const targetDir = joinRemotePath(cwd, nameNoExt);
    setExtracting(true);
    setError(null);
    try {
      const term = getTerminal();
      const cmd = getArchiveExtractCommand(archivePath, targetDir);
      const res = await term.exec(connectionId, cmd, 60000);
      if (res.exitCode !== 0 && res.exitCode !== null) {
        const errMsg = (res.stderr || res.stdout || '').trim();
        if (errMsg && !errMsg.includes('already exists') && !errMsg.includes('replacing')) {
          throw new Error(errMsg);
        }
      }
      await loadDir(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  }, [connectionId, cwd, loadDir]);

  // 强制以文本方式查看文件
  const forceReadText = useCallback(async () => {
    if (!connectionId || !selectedPath) return;
    setPreviewState((prev) => prev ? { ...prev, loading: true, error: null } : prev);
    try {
      const api = getApi();
      const content = await api.explorer?.readRemoteFile(connectionId, selectedPath) ?? '';
      setPreviewState({ path: selectedPath, category: 'text', content, loading: false, error: null, fileSize: previewState?.fileSize ?? null });
    } catch (err) {
      setPreviewState((prev) => prev ? { ...prev, loading: false, error: `无法以文本方式读取: ${err instanceof Error ? err.message : String(err)}` } : prev);
    }
  }, [connectionId, selectedPath, previewState?.fileSize]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)),
    [entries],
  );

  // 未连接
  if (!canUse) {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">文件</h1>
            <div className="ns-page__subtitle">远程 SSH 文件浏览器</div>
          </div>
        </div>
        <EmptyState icon="files" title="请选择并连接一台主机" description="文件管理仅展示远程 SSH 服务器上的文件" />
      </div>
    );
  }

  return (
    <div className="ns-page ns-files-page">
      <div className="ns-page__header">
        <div>
          <h1 className="ns-page__title">文件</h1>
          <div className="ns-page__subtitle">远程服务器 · 支持上传和编辑</div>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="ns-files-toolbar">
        <button className="ns-btn ns-btn--xs" onClick={() => void loadDir(remoteDirParent(cwd))} title="上级目录">
          <Icon name="chevronLeft" size={14} />
        </button>
        <BreadcrumbNav cwd={cwd} onNavigate={(dir) => void loadDir(dir)} />
        <div style={{ flex: 1 }} />
        <button className="ns-btn ns-btn--xs" onClick={() => void loadDir(cwd)} disabled={loading} title="刷新">
          <Icon name="refresh" size={14} />
        </button>
        <button className="ns-btn ns-btn--xs" data-variant="primary" onClick={() => void uploadFiles()} disabled={uploading}>
          <Icon name="plus" size={14} /> {uploading ? '上传中…' : '上传'}
        </button>
      </div>

      {error && <div className="ns-msg ns-msg--system" data-tone="error"><span>{error}</span></div>}

      <div className="ns-files-grid">
        {/* 目录列表 */}
        <section className="ns-card" data-col="5" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 className="ns-card__title">目录</h3>
          <div className="ns-files-list">
            {loading ? (
              <div className="ns-card__caption">加载中…</div>
            ) : sorted.length === 0 ? (
              <div className="ns-card__caption">目录为空</div>
            ) : (
              sorted.map((entry) => {
                const fullPath = joinRemotePath(cwd, entry.name);
                return (
                  <div
                    key={fullPath}
                    className="ns-files-item"
                    data-selected={selectedPath === fullPath}
                    onClick={() => void openEntry(entry)}
                    title={fullPath}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="ns-files-item__name">
                      <Icon name={entry.isDirectory ? 'files' : categoryIcon(getFileCategory(entry.name))} size={15} />
                      {entry.name}
                    </span>
                    <span className="ns-files-item__meta">
                      {entry.isDirectory ? '目录' : (entry.size || '-')}
                      <button
                        className="ns-btn ns-btn--xs"
                        style={{ marginLeft: 4, padding: '0 4px', minWidth: 'auto', opacity: 0.5 }}
                        title="删除"
                        disabled={deleting}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteEntry(entry);
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 预览面板 */}
        <section className="ns-card" data-col="7" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
            <h3 className="ns-card__title" style={{ marginBottom: 0 }}>预览</h3>
            {selectedPath && (
              <span className="ns-card__caption" style={{ marginLeft: 'auto' }}>
                {basename(selectedPath)}
                {previewState?.fileSize != null ? ` · ${formatBytes(previewState.fileSize)}` : ''}
              </span>
            )}
          </div>

          {!selectedPath ? (
            <div className="ns-card__caption" style={{ padding: 'var(--s-8)', textAlign: 'center' }}>
              选择文件以预览内容
            </div>
          ) : previewState?.loading ? (
            <div className="ns-card__caption" style={{ padding: 'var(--s-6)', textAlign: 'center' }}>
              加载中…
            </div>
          ) : previewState?.error ? (
            <div className="ns-msg ns-msg--system" data-tone="error"><span>{previewState.error}</span></div>
          ) : (() => {
            switch (previewState?.category) {
              case 'text':
                return (
                  <div className="ns-files-editor">
                    <div className="ns-files-editor__bar">
                      <span className="ns-files-editor__lang">{editorState?.language ?? 'plaintext'}</span>
                      {editorState?.isDirty && (
                        <span className="ns-tag" data-tone="warn">已修改</span>
                      )}
                      {editorState?.isDirty && (
                        <span className="ns-card__caption" style={{ fontSize: 'var(--fs-xs)' }}>Ctrl+S 保存</span>
                      )}
                      <button
                        className="ns-btn ns-btn--xs"
                        data-variant="primary"
                        disabled={!editorState?.isDirty || editorState?.saving}
                        onClick={() => void saveFile()}
                        style={{ marginLeft: 'auto' }}
                      >
                        <Icon name="save" size={13} />
                        {editorState?.saving ? '保存中…' : '保存'}
                      </button>
                    </div>
                    <div className="ns-files-editor__monaco" ref={monacoContainerRef} />
                  </div>
                );
              case 'image':
                return <ImagePreview preview={previewState} />;
              case 'archive':
                return (
                  <ArchivePreview
                    preview={previewState}
                    onDownload={() => void downloadFile(selectedPath)}
                    onExtract={() => void extractArchive(selectedPath)}
                    extracting={extracting}
                  />
                );
              case 'video':
                return <VideoPreview filePath={selectedPath} fileSize={previewState?.fileSize ?? null} onForceRead={() => void forceReadText()} />;
              case 'audio':
                return <AudioPreview filePath={selectedPath} fileSize={previewState?.fileSize ?? null} onForceRead={() => void forceReadText()} />;
              case 'binary':
                return <BinaryPreview filePath={selectedPath} onDownload={() => void downloadFile(selectedPath)} fileSize={previewState?.fileSize ?? null} onForceRead={() => void forceReadText()} />;
              default:
                return null;
            }
          })()}
        </section>
      </div>
    </div>
  );
}

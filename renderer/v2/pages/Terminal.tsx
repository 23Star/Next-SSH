// Terminal page — xterm.js multi-tab SSH terminal.
//
// Uses the existing connection managed by useConnection (passed via props).
// When connectionId is available, creates an xterm instance that sends user
// input via terminal:write and receives output via terminal:data push events.
// Supports multiple tabs, each with its own xterm + connection pair.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { getApi } from '../lib/electron';

interface TerminalProps {
  connectionId: number | null;
  connStatus: string;
  refreshTick: number;
}

interface TabInfo {
  id: string;
  label: string;
  connectionId: number;
  term: XTerm;
  fitAddon: FitAddon;
  container: HTMLDivElement;
}

let tabCounter = 0;

export function Terminal({ connectionId, connStatus }: TerminalProps): React.ReactElement {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabsRef = useRef<TabInfo[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataListenerSetRef = useRef(false);

  // Keep ref in sync for cleanup
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Create xterm theme based on current color scheme
  const getXtermTheme = useCallback(() => {
    const isDark = document.documentElement.classList.contains('theme-dark');
    return isDark
      ? {
          background: '#1a1a2e',
          foreground: '#e0e0e0',
          cursor: '#e0e0e0',
          selectionBackground: 'rgba(255,255,255,0.18)',
          black: '#1a1a2e',
          red: '#ff6b6b',
          green: '#69db7c',
          yellow: '#ffd43b',
          blue: '#74c0fc',
          magenta: '#da77f2',
          cyan: '#66d9e8',
          white: '#e0e0e0',
        }
      : {
          background: '#ffffff',
          foreground: '#1a1a2e',
          cursor: '#1a1a2e',
          selectionBackground: 'rgba(0,0,0,0.12)',
          black: '#1a1a2e',
          red: '#e03131',
          green: '#2f9e44',
          yellow: '#e8590c',
          blue: '#1971c2',
          magenta: '#9c36b5',
          cyan: '#0c8599',
          white: '#ffffff',
        };
  }, []);

  // Set up global terminal:data listener once
  useEffect(() => {
    if (dataListenerSetRef.current) return;
    dataListenerSetRef.current = true;
    const api = getApi();
    api.terminal?.onData((payload: { connectionId: number; data: string }) => {
      const tab = tabsRef.current.find((t) => t.connectionId === payload.connectionId);
      if (tab) tab.term.write(payload.data);
    });
  }, []);

  // Create an xterm tab
  const createTab = useCallback(
    (connId: number, label: string): TabInfo | null => {
      if (!containerRef.current) return null;
      const id = `term-${++tabCounter}-${Date.now()}`;

      const div = document.createElement('div');
      div.className = 'ns-terminal-instance';
      div.dataset.tabId = id;
      div.style.display = 'none';
      containerRef.current.appendChild(div);

      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Menlo, monospace)',
        theme: getXtermTheme(),
        convertEol: true,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(div);

      // Small delay to ensure DOM is ready before fitting
      setTimeout(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore fit errors during init
        }
      }, 50);

      const api = getApi();

      // User input → SSH
      term.onData((data: string) => {
        if (api.terminal) void api.terminal.write(connId, data);
      });

      // Mouse selection → clipboard
      div.addEventListener('mouseup', () => {
        if (term.hasSelection()) {
          const text = term.getSelection();
          if (text) navigator.clipboard.writeText(text).catch(() => {});
        }
      });

      // Right-click → paste
      div.addEventListener('contextmenu', (e: Event) => {
        e.preventDefault();
        navigator.clipboard
          .readText()
          .then((text: string) => {
            if (text && api.terminal) {
              for (const c of text) {
                void api.terminal.write(connId, c);
              }
            }
          })
          .catch(() => {});
      });

      // Resize observer
      const observer = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims && api.terminal) {
            void api.terminal.resize(connId, dims.rows, dims.cols);
          }
        } catch {
          // ignore
        }
      });
      observer.observe(div);

      const tab: TabInfo = { id, label, connectionId: connId, term, fitAddon, container: div };
      return tab;
    },
    [getXtermTheme],
  );

  // Auto-create first tab when connection is established
  const connectionIdRef = useRef(connectionId);
  connectionIdRef.current = connectionId;

  useEffect(() => {
    if (connStatus !== 'connected' || connectionId == null) return;
    if (!containerRef.current) return;
    // Use ref to check — avoids stale closure issues
    if (tabsRef.current.some((t) => t.connectionId === connectionId)) return;

    const tab = createTab(connectionId, `SSH #${connectionId}`);
    if (!tab) return;

    tabsRef.current = [...tabsRef.current, tab];
    setTabs([...tabsRef.current]);
    setActiveTabId(tab.id);

    // Resize after visible
    setTimeout(() => {
      try {
        tab.fitAddon.fit();
        const api = getApi();
        const dims = tab.fitAddon.proposeDimensions();
        if (dims && api.terminal) {
          void api.terminal.resize(connectionId, dims.rows, dims.cols);
        }
      } catch {
        // ignore
      }
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, connStatus]);

  // Show/hide tabs when activeTabId changes
  useEffect(() => {
    tabsRef.current.forEach((tab) => {
      tab.container.style.display = tab.id === activeTabId ? 'block' : 'none';
    });
    // Fit active tab
    const active = tabsRef.current.find((t) => t.id === activeTabId);
    if (active) {
      setTimeout(() => {
        try {
          active.fitAddon.fit();
        } catch {
          // ignore
        }
      }, 20);
    }
  }, [activeTabId, tabs]);

  // Cleanup all tabs on unmount
  useEffect(() => {
    return () => {
      tabsRef.current.forEach((tab) => {
        tab.term.dispose();
        tab.container.remove();
      });
      tabsRef.current = [];
    };
  }, []);

  // Not connected
  if (connectionId == null || connStatus !== 'connected') {
    return (
      <div className="ns-page">
        <div className="ns-page__header">
          <div>
            <h1 className="ns-page__title">终端</h1>
            <div className="ns-page__subtitle">交互式 SSH 终端</div>
          </div>
        </div>
        <EmptyState
          icon="terminal"
          title="请选择并连接一台主机"
          description="在远程服务器上打开交互式终端会话"
        />
      </div>
    );
  }

  const closeTab = (tabId: string): void => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    tab.term.dispose();
    tab.container.remove();
    const remaining = tabsRef.current.filter((t) => t.id !== tabId);
    tabsRef.current = remaining;
    setTabs(remaining);
    if (activeTabId === tabId) {
      const newActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      setActiveTabId(newActive);
    }
  };

  return (
    <div className="ns-terminal-page">
      <div className="ns-terminal-tabbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`ns-terminal-tab ${tab.id === activeTabId ? 'ns-terminal-tab--active' : ''}`}
          >
            <button
              className="ns-terminal-tab__label"
              onClick={() => setActiveTabId(tab.id)}
              title={tab.label}
            >
              <Icon name="terminal" size={14} />
              <span>{tab.label}</span>
            </button>
            <button
              className="ns-terminal-tab__close"
              onClick={() => closeTab(tab.id)}
              title="关闭标签页"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button
          className="ns-terminal-tab__add"
          onClick={() => {
            if (!connectionId) return;
            const tab = createTab(connectionId, `SSH #${tabs.length + 1}`);
            if (!tab) return;
            tabsRef.current = [...tabsRef.current, tab];
            setTabs([...tabsRef.current]);
            setActiveTabId(tab.id);
            setTimeout(() => {
              try {
                tab.fitAddon.fit();
                const api = getApi();
                const dims = tab.fitAddon.proposeDimensions();
                if (dims && api.terminal && connectionId) {
                  void api.terminal.resize(connectionId, dims.rows, dims.cols);
                }
              } catch { /* ignore */ }
            }, 100);
          }}
          title="新建终端"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="ns-terminal-container" ref={containerRef} />
    </div>
  );
}

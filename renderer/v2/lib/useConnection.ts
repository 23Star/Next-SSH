// Manage a single active SSH connection for the panel pages.
//
// When the user selects a host in the topbar we allocate a unique
// connectionId and call terminal.connect. Subsequent exec calls from the
// Dashboard / Services / Files pages pass that id through. Passphrase-
// protected keys aren't supported here yet — Settings will grow that prompt.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi } from './electron';
import type { ConnStatus } from '../shell/HostPicker';

export interface Connection {
  hostId: number | null;
  connectionId: number | null;
  status: ConnStatus;
  error: string | null;
}

export interface ConnectionState extends Connection {
  select: (hostId: number | null) => Promise<void>;
  disconnect: () => void;
}

export function useConnection(): ConnectionState {
  const [state, setState] = useState<Connection>({
    hostId: null,
    connectionId: null,
    status: 'disconnected',
    error: null,
  });
  // Guard against race conditions when the user rapidly switches hosts.
  const tokenRef = useRef(0);

  const disconnect = useCallback((): void => {
    tokenRef.current += 1;
    setState((s) => {
      if (s.connectionId != null) {
        try {
          getApi().terminal?.disconnect(s.connectionId);
        } catch {
          // best-effort
        }
      }
      return { hostId: null, connectionId: null, status: 'disconnected', error: null };
    });
  }, []);

  const select = useCallback(async (hostId: number | null): Promise<void> => {
    // Tear down any prior connection before starting a new one.
    const myToken = ++tokenRef.current;
    setState((prev) => {
      if (prev.connectionId != null) {
        try {
          getApi().terminal?.disconnect(prev.connectionId);
        } catch {
          // best-effort
        }
      }
      return { hostId, connectionId: null, status: hostId == null ? 'disconnected' : 'connecting', error: null };
    });
    if (hostId == null) return;

    const connectionId = Date.now();
    try {
      await getApi().terminal?.connect(connectionId, hostId, null);
      if (tokenRef.current !== myToken) return; // stale
      setState({ hostId, connectionId, status: 'connected', error: null });
    } catch (err) {
      if (tokenRef.current !== myToken) return;
      setState({
        hostId,
        connectionId: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // Disconnect on unmount.
  useEffect(() => () => disconnect(), [disconnect]);

  return { ...state, select, disconnect };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { socketUrl } from '../lib/socket';

/**
 * Keeps a WebSocket to the CineSync server open while `enabled` is true and
 * reconnects with backoff if it drops. Handlers are read from refs, so callers
 * can pass inline functions without causing reconnects.
 *
 * Returns { send, status } where status is 'idle' | 'connecting' | 'open' | 'closed'.
 */
export function useSocket({ enabled = true, onMessage, onOpen } = {}) {
  const wsRef = useRef(null);
  const handlers = useRef({ onMessage, onOpen });
  handlers.current = { onMessage, onOpen };
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let retryTimer = 0;
    let attempt = 0;

    const connect = () => {
      if (!alive) return;
      setStatus('connecting');
      const ws = new WebSocket(socketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
        handlers.current.onOpen?.(ws);
      };
      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        handlers.current.onMessage?.(data);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!alive) return;
        setStatus('closed');
        attempt += 1;
        retryTimer = window.setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
      };
    };

    connect();
    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled]);

  const send = useCallback((message) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }, []);

  return { send, status };
}

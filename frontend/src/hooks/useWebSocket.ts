import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ServerMessage = {
  type: string;
  [key: string]: unknown;
};

type WSState = "connecting" | "connected" | "disconnected";

export function useWebSocket(baseUrl: string, bookId?: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WSState>("disconnected");
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  // Callback ref for processing messages synchronously
  const onMessageRef = useRef<((msg: ServerMessage) => void) | null>(null);

  // Compute the full WebSocket URL including /ws/{bookId} path
  const url = useMemo(() => {
    if (!bookId) return null;
    // Convert http:// to ws://, https:// to wss://
    const wsBase = baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/ws/${bookId}`;
  }, [baseUrl, bookId]);

  const connect = useCallback(() => {
    if (!url) return; // Don't connect if no URL (no bookId)
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState("connected");
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as ServerMessage;
        console.log("[WS] Received message:", msg.type, msg);
        // Call the callback synchronously for EVERY message
        if (onMessageRef.current) {
          onMessageRef.current(msg);
        }
        setLastMessage(msg);
        setMessages((prev) => [...prev.slice(-200), msg]);
      } catch {
        /* ignore bad json */
      }
    };

    ws.onclose = () => {
      // Only update state if this is still the active WebSocket
      // (avoids race condition when disconnect + reconnect happens quickly)
      if (wsRef.current === ws) {
        setState("disconnected");
        wsRef.current = null;
      }
    };

    ws.onerror = () => {
      if (wsRef.current === ws) {
        setState("disconnected");
      }
    };
  }, [url]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState("disconnected");
  }, []);

  // Set the message callback
  const setOnMessage = useCallback((callback: ((msg: ServerMessage) => void) | null) => {
    onMessageRef.current = callback;
  }, []);

  // Auto-reconnect when bookId changes
  useEffect(() => {
    // Close existing connection when bookId changes
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setState("disconnected");
    }

    // Connect to new URL if we have a valid bookId
    if (url) {
      connect();
    }

    return () => {
      wsRef.current?.close();
    };
  }, [url, connect]);

  return { state, messages, lastMessage, connect, send, disconnect, setOnMessage, url };
}

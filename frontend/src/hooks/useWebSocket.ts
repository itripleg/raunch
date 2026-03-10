import { useCallback, useEffect, useRef, useState } from "react";

export type ServerMessage = {
  type: string;
  [key: string]: unknown;
};

type WSState = "connecting" | "connected" | "disconnected";

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WSState>("disconnected");
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setState("connected");

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as ServerMessage;
        setLastMessage(msg);
        setMessages((prev) => [...prev.slice(-200), msg]);
      } catch {
        /* ignore bad json */
      }
    };

    ws.onclose = () => {
      setState("disconnected");
      wsRef.current = null;
    };

    ws.onerror = () => {
      setState("disconnected");
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

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { state, messages, lastMessage, connect, send, disconnect };
}

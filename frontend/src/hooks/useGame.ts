import { useEffect, useMemo, useReducer } from "react";
import { useWebSocket, type ServerMessage } from "./useWebSocket";

export type CharacterInfo = {
  species?: string;
  emotional_state?: string;
  location?: string;
};

export type CharacterTick = {
  action?: string;
  dialogue?: string;
  emotional_state?: string;
  inner_thoughts?: string;
  desires_update?: string;
};

export type TickData = {
  tick: number;
  narration: string;
  events: string[];
  characters: Record<string, CharacterTick>;
  attached_to: string | null;
};

export type WorldInfo = {
  world_id?: string;
  world_name?: string;
  created_at?: string;
  tick_count?: number;
  world_time?: string;
  mood?: string;
};

type HistoryTick = {
  tick: number;
  narration: string;
  events: string[];
  world_time?: string;
  mood?: string;
  characters?: Record<string, CharacterTick>;
};

type CharHistoryTick = {
  tick: number;
  inner_thoughts?: string;
  action?: string;
  dialogue?: string;
  emotional_state?: string;
};

type State = {
  world: WorldInfo | null;
  characterNames: string[];
  characterDetails: Record<string, CharacterInfo>;
  attachedTo: string | null;
  ticks: TickData[];
  history: HistoryTick[];
  characterHistory: { name: string; ticks: CharHistoryTick[] } | null;
  replayTick: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
  error: string | null;
};

type Action =
  | { type: "WELCOME"; world: WorldInfo; characters: string[] }
  | { type: "TICK"; data: TickData }
  | { type: "ATTACHED"; character: string }
  | { type: "DETACHED" }
  | { type: "CHARACTERS"; characters: Record<string, CharacterInfo> }
  | { type: "WORLD"; snapshot: Record<string, unknown> }
  | { type: "STATUS"; data: Record<string, unknown> }
  | { type: "HISTORY"; ticks: HistoryTick[] }
  | { type: "CHARACTER_HISTORY"; character: string; ticks: CharHistoryTick[] }
  | { type: "REPLAY"; data: Record<string, unknown> }
  | { type: "ERROR"; message: string }
  | { type: "CLEAR_ERROR" }
  | { type: "RESET" };

const initial: State = {
  world: null,
  characterNames: [],
  characterDetails: {},
  attachedTo: null,
  ticks: [],
  history: [],
  characterHistory: null,
  replayTick: null,
  status: null,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "WELCOME":
      return { ...initial, world: action.world, characterNames: action.characters };
    case "TICK":
      return { ...state, ticks: [...state.ticks.slice(-100), action.data] };
    case "ATTACHED":
      return { ...state, attachedTo: action.character };
    case "DETACHED":
      return { ...state, attachedTo: null };
    case "CHARACTERS":
      return {
        ...state,
        characterDetails: action.characters,
        characterNames: Object.keys(action.characters),
      };
    case "WORLD":
      return { ...state, world: { ...state.world, ...action.snapshot } as WorldInfo };
    case "STATUS":
      return { ...state, status: action.data };
    case "HISTORY": {
      // Convert history ticks to TickData and merge with existing live ticks
      const existingTickNums = new Set(state.ticks.map(t => t.tick));
      const historyAsTicks: TickData[] = action.ticks
        .filter(h => !existingTickNums.has(h.tick))
        .map(h => ({
          tick: h.tick,
          narration: h.narration || "",
          events: h.events || [],
          characters: (h.characters || {}) as Record<string, CharacterTick>,
          attached_to: null,
        }));
      const merged = [...historyAsTicks, ...state.ticks];
      merged.sort((a, b) => a.tick - b.tick);
      return { ...state, ticks: merged, history: action.ticks };
    }
    case "CHARACTER_HISTORY":
      return { ...state, characterHistory: { name: action.character, ticks: action.ticks } };
    case "REPLAY":
      return { ...state, replayTick: action.data };
    case "ERROR":
      return { ...state, error: action.message };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "RESET":
      return initial;
    default:
      return state;
  }
}

export function useGame(wsUrl: string) {
  const { state: wsState, lastMessage, connect, send, disconnect } = useWebSocket(wsUrl);
  const [game, dispatch] = useReducer(reducer, initial);

  // Process incoming messages
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as ServerMessage;

    switch (msg.type) {
      case "welcome":
        dispatch({
          type: "WELCOME",
          world: msg.world as WorldInfo,
          characters: msg.characters as string[],
        });
        break;
      case "tick":
        dispatch({ type: "TICK", data: msg as unknown as TickData });
        break;
      case "attached":
        dispatch({ type: "ATTACHED", character: msg.character as string });
        break;
      case "detached":
        dispatch({ type: "DETACHED" });
        break;
      case "characters":
        dispatch({ type: "CHARACTERS", characters: msg.characters as Record<string, CharacterInfo> });
        break;
      case "world":
        dispatch({ type: "WORLD", snapshot: msg.snapshot as Record<string, unknown> });
        break;
      case "status":
        dispatch({ type: "STATUS", data: msg });
        break;
      case "history":
        dispatch({ type: "HISTORY", ticks: msg.ticks as HistoryTick[] });
        break;
      case "character_history":
        dispatch({
          type: "CHARACTER_HISTORY",
          character: msg.character as string,
          ticks: msg.ticks as CharHistoryTick[],
        });
        break;
      case "replay":
        dispatch({ type: "REPLAY", data: msg });
        break;
      case "error":
        dispatch({ type: "ERROR", message: msg.message as string });
        break;
    }
  }, [lastMessage]);

  const actions = useMemo(
    () => ({
      connect,
      disconnect: () => {
        disconnect();
        dispatch({ type: "RESET" });
      },
      attach: (name: string) => send({ cmd: "attach", character: name }),
      detach: () => send({ cmd: "detach" }),
      listCharacters: () => send({ cmd: "list" }),
      getWorld: () => send({ cmd: "world" }),
      getStatus: () => send({ cmd: "status" }),
      getHistory: (count = 20, offset = 0) => send({ cmd: "history", count, offset }),
      getCharacterHistory: (name: string, count = 20) =>
        send({ cmd: "character_history", character: name, count }),
      replay: (tick: number) => send({ cmd: "replay", tick }),
      submitAction: (text: string) => send({ cmd: "action", text }),
      clearError: () => dispatch({ type: "CLEAR_ERROR" }),
    }),
    [connect, disconnect, send]
  );

  return { wsState, game, actions };
}

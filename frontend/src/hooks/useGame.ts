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
  created_at?: string;
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
  paused: boolean;
  tickInterval: number;
  pendingInfluence: { character: string; text: string } | null;
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
  | { type: "PAUSE_STATE"; paused: boolean }
  | { type: "TICK_INTERVAL"; seconds: number }
  | { type: "ERROR"; message: string }
  | { type: "CLEAR_ERROR" }
  | { type: "INFLUENCE_QUEUED"; character: string; text: string }
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
  paused: false,
  tickInterval: 30,
  pendingInfluence: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "WELCOME":
      return { ...initial, world: action.world, characterNames: action.characters };
    case "TICK": {
      // Clear pending influence when tick arrives (it was consumed)
      // Deduplicate - don't add if tick number already exists
      const tickExists = state.ticks.some(t => t.tick === action.data.tick);
      if (tickExists) {
        return { ...state, pendingInfluence: null };
      }
      return { ...state, ticks: [...state.ticks.slice(-100), action.data], pendingInfluence: null };
    }
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
      return {
        ...state,
        status: action.data,
        paused: (action.data as { paused?: boolean }).paused ?? state.paused,
      };
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
          created_at: h.created_at,
        }));
      const merged = [...historyAsTicks, ...state.ticks];
      merged.sort((a, b) => a.tick - b.tick);
      return { ...state, ticks: merged, history: action.ticks };
    }
    case "CHARACTER_HISTORY":
      return { ...state, characterHistory: { name: action.character, ticks: action.ticks } };
    case "REPLAY":
      return { ...state, replayTick: action.data };
    case "PAUSE_STATE":
      return { ...state, paused: action.paused };
    case "TICK_INTERVAL":
      return { ...state, tickInterval: action.seconds };
    case "ERROR":
      return { ...state, error: action.message };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "INFLUENCE_QUEUED":
      return { ...state, pendingInfluence: { character: action.character, text: action.text } };
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
        // Process initial history if included
        if (msg.history && Array.isArray(msg.history)) {
          dispatch({ type: "HISTORY", ticks: msg.history as HistoryTick[] });
        }
        // Process initial tick interval and pause state
        if (typeof msg.tick_interval === "number") {
          dispatch({ type: "TICK_INTERVAL", seconds: msg.tick_interval });
        }
        if (typeof msg.paused === "boolean") {
          dispatch({ type: "PAUSE_STATE", paused: msg.paused });
        }
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
      case "pause_state":
        dispatch({ type: "PAUSE_STATE", paused: msg.paused as boolean });
        break;
      case "tick_interval":
        dispatch({ type: "TICK_INTERVAL", seconds: msg.seconds as number });
        break;
      case "error":
        dispatch({ type: "ERROR", message: msg.message as string });
        break;
      case "influence_queued":
        dispatch({
          type: "INFLUENCE_QUEUED",
          character: msg.character as string,
          text: (msg as Record<string, unknown>).text as string || "",
        });
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
      togglePause: () => send({ cmd: "toggle_pause" }),
      pause: () => send({ cmd: "pause" }),
      resume: () => send({ cmd: "resume" }),
      setTickInterval: (seconds: number) => send({ cmd: "set_tick_interval", seconds }),
      getTickInterval: () => send({ cmd: "get_tick_interval" }),
      clearError: () => dispatch({ type: "CLEAR_ERROR" }),
    }),
    [connect, disconnect, send]
  );

  return { wsState, game, actions };
}

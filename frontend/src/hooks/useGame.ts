import { useEffect, useMemo, useReducer, useRef } from "react";
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
  created_at?: string;
};

type CharHistoryTick = {
  tick: number;
  inner_thoughts?: string;
  action?: string;
  dialogue?: string;
  emotional_state?: string;
};

export type StreamingState = {
  tick: number | null;
  narrator: string;
  characters: Record<string, string>;
  isStreaming: boolean;
  narratorDone: boolean;
  charactersDone: string[];
};

export type Player = {
  player_id: string;
  nickname: string;
  attached_to: string | null;
  ready: boolean;
};

export type TurnState = {
  countdown: number;
  waiting_for: string[];
  all_ready: boolean;
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
  manualMode: boolean;
  pendingInfluence: { character: string; text: string } | null;
  // Director mode
  directorMode: boolean;
  pendingDirectorGuidance: string | null;
  // Streaming
  streaming: StreamingState;
  // Multiplayer
  multiplayer: boolean;
  playerId: string | null;
  nickname: string | null;
  players: Player[];
  turnState: TurnState | null;
};

type Action =
  | { type: "WELCOME"; world: WorldInfo; characters: string[]; multiplayer: boolean }
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
  | { type: "TICK_INTERVAL"; seconds: number; manual: boolean }
  | { type: "ERROR"; message: string }
  | { type: "CLEAR_ERROR" }
  | { type: "INFLUENCE_QUEUED"; character: string; text: string }
  | { type: "RESET" }
  // Director mode
  | { type: "TOGGLE_DIRECTOR_MODE" }
  | { type: "DIRECTOR_QUEUED"; text: string }
  // Streaming
  | { type: "TICK_START"; tick: number }
  | { type: "STREAM_SYNC"; tick: number; narrator: string; characters: Record<string, string> }
  | { type: "STREAM_DONE"; tick: number; source: string }
  // Multiplayer
  | { type: "JOINED"; player_id: string; nickname: string }
  | { type: "PLAYERS"; players: Player[] }
  | { type: "WORLD_LOADED"; world_id: string; name: string; characters: string[] }
  | { type: "TURN_STATE"; countdown: number; waiting_for: string[]; all_ready: boolean };

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
  tickInterval: 0,
  manualMode: true,
  pendingInfluence: null,
  directorMode: false,
  pendingDirectorGuidance: null,
  streaming: {
    tick: null,
    narrator: "",
    characters: {},
    isStreaming: false,
    narratorDone: false,
    charactersDone: [],
  },
  // Multiplayer
  multiplayer: false,
  playerId: null,
  nickname: null,
  players: [],
  turnState: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "WELCOME":
      return { ...initial, world: action.world, characterNames: action.characters, multiplayer: action.multiplayer };
    case "TICK": {
      // Clear pending influence/director and streaming when tick arrives
      // Deduplicate - don't add if tick number already exists
      const tickExists = state.ticks.some(t => t.tick === action.data.tick);
      if (tickExists) {
        return {
          ...state,
          pendingInfluence: null,
          pendingDirectorGuidance: null,
          streaming: { ...initial.streaming },
        };
      }
      return {
        ...state,
        ticks: [...state.ticks.slice(-100), action.data],
        pendingInfluence: null,
        pendingDirectorGuidance: null,
        streaming: { ...initial.streaming },
      };
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
      // Final dedupe pass - keep last occurrence of each tick number
      const seen = new Set<number>();
      const deduped = merged.filter(t => {
        if (seen.has(t.tick)) return false;
        seen.add(t.tick);
        return true;
      });
      return { ...state, ticks: deduped, history: action.ticks };
    }
    case "CHARACTER_HISTORY":
      return { ...state, characterHistory: { name: action.character, ticks: action.ticks } };
    case "REPLAY":
      return { ...state, replayTick: action.data };
    case "PAUSE_STATE":
      return { ...state, paused: action.paused };
    case "TICK_INTERVAL":
      return { ...state, tickInterval: action.seconds, manualMode: action.manual };
    case "ERROR":
      return { ...state, error: action.message };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "INFLUENCE_QUEUED":
      return { ...state, pendingInfluence: { character: action.character, text: action.text } };
    case "TOGGLE_DIRECTOR_MODE":
      return { ...state, directorMode: !state.directorMode };
    case "DIRECTOR_QUEUED":
      return { ...state, pendingDirectorGuidance: action.text };
    case "TICK_START":
      return {
        ...state,
        streaming: {
          tick: action.tick,
          narrator: "",
          characters: {},
          isStreaming: true,
          narratorDone: false,
          charactersDone: [],
        },
      };
    case "STREAM_SYNC":
      // Throttled sync from ref - replace entire streaming content (preserve done states)
      if (state.streaming.tick !== action.tick) return state;
      return {
        ...state,
        streaming: {
          ...state.streaming,
          narrator: action.narrator,
          characters: action.characters,
          // Preserve narratorDone and charactersDone
        },
      };
    case "STREAM_DONE":
      // Track which sources are done (narrator or character names)
      if (state.streaming.tick !== action.tick) return state;
      if (action.source === "narrator") {
        return {
          ...state,
          streaming: { ...state.streaming, narratorDone: true },
        };
      } else {
        // Character done
        return {
          ...state,
          streaming: {
            ...state.streaming,
            charactersDone: [...state.streaming.charactersDone, action.source],
          },
        };
      }
    case "JOINED":
      return { ...state, playerId: action.player_id, nickname: action.nickname };
    case "PLAYERS":
      return { ...state, players: action.players };
    case "WORLD_LOADED":
      return {
        ...state,
        world: {
          world_id: action.world_id,
          world_name: action.name,
        },
        characterNames: action.characters,
        ticks: [],
        history: [],
      };
    case "TURN_STATE":
      return {
        ...state,
        turnState: {
          countdown: action.countdown,
          waiting_for: action.waiting_for,
          all_ready: action.all_ready,
        },
      };
    case "RESET":
      return initial;
    default:
      return state;
  }
}

export function useGame(wsUrl: string) {
  const { state: wsState, lastMessage, connect, send, disconnect, setOnMessage } = useWebSocket(wsUrl);
  const [game, dispatch] = useReducer(reducer, initial);

  // Use ref for streaming accumulation - updates are throttled to avoid React batching all at once
  const streamingRef = useRef<{
    tick: number | null;
    narrator: string;
    characters: Record<string, string>;
    dirty: boolean;
  }>({
    tick: null,
    narrator: "",
    characters: {},
    dirty: false,
  });

  // Throttled UI updates for streaming (every 250ms for smoother chunked appearance)
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const ref = streamingRef.current;
        if (ref && ref.dirty && ref.tick !== null) {
          ref.dirty = false;
          dispatch({
            type: "STREAM_SYNC",
            tick: ref.tick,
            narrator: ref.narrator || "",
            characters: ref.characters ? { ...ref.characters } : {},
          });
        }
      } catch (e) {
        console.error("Streaming sync error:", e);
      }
    }, 250);
    return () => clearInterval(interval);
  }, []);

  // Process messages synchronously via callback (for streaming)
  useEffect(() => {
    setOnMessage((msg: ServerMessage) => {
      // Handle streaming messages - accumulate in ref, mark dirty for throttled sync
      if (msg.type === "tick_start") {
        streamingRef.current = {
          tick: msg.tick as number,
          narrator: "",
          characters: {},
          dirty: false,
        };
        dispatch({ type: "TICK_START", tick: msg.tick as number });
      } else if (msg.type === "stream_delta") {
        const tick = msg.tick as number;
        const source = msg.source as string;
        const delta = msg.delta as string;
        if (streamingRef.current.tick === tick) {
          if (source === "narrator") {
            streamingRef.current.narrator += delta;
          } else {
            streamingRef.current.characters[source] =
              (streamingRef.current.characters[source] || "") + delta;
          }
          streamingRef.current.dirty = true;
        }
      } else if (msg.type === "stream_done") {
        // Final sync before marking done
        if (streamingRef.current.tick !== null) {
          dispatch({
            type: "STREAM_SYNC",
            tick: streamingRef.current.tick,
            narrator: streamingRef.current.narrator,
            characters: { ...streamingRef.current.characters },
          });
        }
        dispatch({
          type: "STREAM_DONE",
          tick: msg.tick as number,
          source: msg.source as string,
        });
      }
    });

    return () => setOnMessage(null);
  }, [setOnMessage]);

  // Process other incoming messages via lastMessage
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as ServerMessage;

    // Skip streaming messages (handled above)
    if (msg.type === "tick_start" || msg.type === "stream_delta" || msg.type === "stream_done") {
      return;
    }

    switch (msg.type) {
      case "welcome":
        dispatch({
          type: "WELCOME",
          world: msg.world as WorldInfo,
          characters: msg.characters as string[],
          multiplayer: (msg.multiplayer as boolean) ?? false,
        });
        // Process initial history if included
        if (msg.history && Array.isArray(msg.history)) {
          dispatch({ type: "HISTORY", ticks: msg.history as HistoryTick[] });
        }
        // Process initial tick interval and pause state
        if (typeof msg.tick_interval === "number") {
          dispatch({ type: "TICK_INTERVAL", seconds: msg.tick_interval, manual: msg.manual === true });
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
        dispatch({ type: "TICK_INTERVAL", seconds: msg.seconds as number, manual: msg.manual === true });
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
      case "director_queued":
        dispatch({
          type: "DIRECTOR_QUEUED",
          text: (msg as Record<string, unknown>).text as string || "",
        });
        break;
      case "joined":
        dispatch({
          type: "JOINED",
          player_id: msg.player_id as string,
          nickname: msg.nickname as string,
        });
        break;
      case "players":
        dispatch({ type: "PLAYERS", players: msg.players as Player[] });
        break;
      case "world_loaded":
        dispatch({
          type: "WORLD_LOADED",
          world_id: msg.world_id as string,
          name: msg.name as string,
          characters: msg.characters as string[],
        });
        break;
      case "turn_state":
        dispatch({
          type: "TURN_STATE",
          countdown: msg.countdown as number,
          waiting_for: msg.waiting_for as string[],
          all_ready: msg.all_ready as boolean,
        });
        break;
      // tick_start, stream_delta, stream_done handled synchronously above
    }
  }, [lastMessage]);

  const actions = useMemo(
    () => ({
      connect,
      disconnect: () => {
        disconnect();
        dispatch({ type: "RESET" });
      },
      // Multiplayer
      join: (nickname: string) => send({ cmd: "join", nickname }),
      attach: (name: string) => send({ cmd: "attach", character: name }),
      detach: () => send({ cmd: "detach" }),
      ready: () => send({ cmd: "ready" }),
      listCharacters: () => send({ cmd: "list" }),
      getWorld: () => send({ cmd: "world" }),
      getStatus: () => send({ cmd: "status" }),
      getHistory: (count = 20, offset = 0) => send({ cmd: "history", count, offset }),
      getCharacterHistory: (name: string, count = 20) =>
        send({ cmd: "character_history", character: name, count }),
      replay: (tick: number) => send({ cmd: "replay", tick }),
      submitAction: (text: string, autoReady = false) => {
        send({ cmd: "action", text });
        if (autoReady) {
          send({ cmd: "ready" });
        }
      },
      togglePause: () => send({ cmd: "toggle_pause" }),
      pause: () => send({ cmd: "pause" }),
      resume: () => send({ cmd: "resume" }),
      setTickInterval: (seconds: number) => send({ cmd: "set_tick_interval", seconds }),
      getTickInterval: () => send({ cmd: "get_tick_interval" }),
      triggerTick: () => send({ cmd: "tick" }),
      clearError: () => dispatch({ type: "CLEAR_ERROR" }),
      // Director mode
      toggleDirectorMode: () => dispatch({ type: "TOGGLE_DIRECTOR_MODE" }),
      submitDirectorGuidance: (text: string, autoReady = false) => {
        send({ cmd: "director", text });
        if (autoReady) {
          send({ cmd: "ready" });
        }
      },
    }),
    [connect, disconnect, send]
  );

  return { wsState, game, actions };
}

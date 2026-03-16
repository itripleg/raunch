import { useEffect, useMemo, useReducer, useRef } from "react";
import { useWebSocket, type ServerMessage } from "./useWebSocket";

export type CharacterInfo = {
  species?: string;
  emotional_state?: string;
  location?: string;
};

export type CharacterPage = {
  action?: string;
  dialogue?: string;
  emotional_state?: string;
  inner_thoughts?: string;
  desires_update?: string;
};

export type PageData = {
  page: number;
  narration: string;
  events: string[];
  characters: Record<string, CharacterPage>;
  attached_to: string | null;
  created_at?: string;
};

export type WorldInfo = {
  world_id?: string;
  world_name?: string;
  created_at?: string;
  page_count?: number;
  world_time?: string;
  mood?: string;
  multiplayer?: boolean;
};

type HistoryPage = {
  page: number;
  narration: string;
  events: string[];
  world_time?: string;
  mood?: string;
  characters?: Record<string, CharacterPage>;
  created_at?: string;
};

type CharHistoryPage = {
  page: number;
  inner_thoughts?: string;
  action?: string;
  dialogue?: string;
  emotional_state?: string;
};

export type StreamingState = {
  page: number | null;
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
  pages: PageData[];
  history: HistoryPage[];
  characterHistory: { name: string; pages: CharHistoryPage[] } | null;
  replayPage: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
  error: string | null;
  paused: boolean;
  pageInterval: number;
  manualMode: boolean;
  pendingInfluence: { character: string; text: string } | null;
  // Director mode
  directorMode: boolean;
  pendingDirectorGuidance: string | null;
  // Streaming
  streaming: StreamingState;
  // Non-streaming page generation
  pageGenerating: number | null;
  // Multiplayer
  multiplayer: boolean;
  playerId: string | null;
  nickname: string | null;
  players: Player[];
  turnState: TurnState | null;
};

type Action =
  | { type: "WELCOME"; world: WorldInfo; characters: string[]; multiplayer: boolean }
  | { type: "PAGE"; data: PageData }
  | { type: "ATTACHED"; character: string }
  | { type: "DETACHED" }
  | { type: "CHARACTERS"; characters: Record<string, CharacterInfo> }
  | { type: "WORLD"; snapshot: Record<string, unknown> }
  | { type: "STATUS"; data: Record<string, unknown> }
  | { type: "HISTORY"; pages: HistoryPage[] }
  | { type: "CHARACTER_HISTORY"; character: string; pages: CharHistoryPage[] }
  | { type: "REPLAY"; data: Record<string, unknown> }
  | { type: "PAUSE_STATE"; paused: boolean }
  | { type: "PAGE_INTERVAL"; seconds: number; manual: boolean }
  | { type: "ERROR"; message: string }
  | { type: "CLEAR_ERROR" }
  | { type: "INFLUENCE_QUEUED"; character: string; text: string }
  | { type: "RESET" }
  // Director mode
  | { type: "TOGGLE_DIRECTOR_MODE" }
  | { type: "DIRECTOR_QUEUED"; text: string }
  // Streaming
  | { type: "PAGE_START"; page: number }
  | { type: "STREAM_SYNC"; page: number; narrator: string; characters: Record<string, string> }
  | { type: "STREAM_DONE"; page: number; source: string }
  // Non-streaming progressive updates
  | { type: "PAGE_GENERATING"; page: number }
  | { type: "NARRATOR_READY"; page: number; narration: string; mood: string; created_at: string }
  | { type: "CHARACTER_READY"; page: number; character: string; data: Record<string, unknown> }
  // Multiplayer
  | { type: "JOINED"; player_id: string; nickname: string }
  | { type: "PLAYERS"; players: Player[] }
  | { type: "WORLD_LOADED"; world_id: string; name: string; characters: string[] }
  | { type: "TURN_STATE"; countdown: number; waiting_for: string[]; all_ready: boolean }
  // Debug/Mock mode
  | { type: "INJECT_MOCK_PAGE" };

const initial: State = {
  world: null,
  characterNames: [],
  characterDetails: {},
  attachedTo: null,
  pages: [],
  history: [],
  characterHistory: null,
  replayPage: null,
  status: null,
  error: null,
  paused: false,
  pageInterval: 0,
  manualMode: true,
  pendingInfluence: null,
  directorMode: false,
  pendingDirectorGuidance: null,
  streaming: {
    page: null,
    narrator: "",
    characters: {},
    isStreaming: false,
    narratorDone: false,
    charactersDone: [],
  },
  pageGenerating: null,
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
    case "PAGE": {
      // Clear pending influence/director and streaming when page arrives
      const existingIndex = state.pages.findIndex(p => p.page === action.data.page);
      if (existingIndex !== -1) {
        // Update existing partial page with full data (characters, etc.)
        const updatedPages = [...state.pages];
        updatedPages[existingIndex] = {
          ...updatedPages[existingIndex],
          ...action.data,
          // Merge characters - full page has all character data
          characters: action.data.characters,
        };
        return {
          ...state,
          pages: updatedPages,
          pendingInfluence: null,
          pendingDirectorGuidance: null,
          streaming: { ...initial.streaming },
          pageGenerating: null,
        };
      }
      // Add new page, ensuring no duplicates
      const newPages = [...state.pages.slice(-100), action.data];
      const seen = new Set<number>();
      const deduped = newPages.filter(p => {
        if (seen.has(p.page)) return false;
        seen.add(p.page);
        return true;
      });
      return {
        ...state,
        pages: deduped,
        pendingInfluence: null,
        pendingDirectorGuidance: null,
        streaming: { ...initial.streaming },
        pageGenerating: null,
      };
    }
    case "PAGE_GENERATING":
      // Non-streaming mode: page generation started
      return { ...state, pageGenerating: action.page };
    case "NARRATOR_READY": {
      // Add partial page with just narration (non-streaming mode)
      // This allows typewriter to start before characters are done
      // Check if page already exists (avoid duplicates)
      const existingNarrIdx = state.pages.findIndex(p => p.page === action.page);
      if (existingNarrIdx !== -1) {
        // Update existing page with narration
        const updatedPages = [...state.pages];
        updatedPages[existingNarrIdx] = {
          ...updatedPages[existingNarrIdx],
          narration: action.narration,
          created_at: action.created_at,
        };
        return {
          ...state,
          pages: updatedPages,
          pageGenerating: null,
        };
      }
      const partialPage: PageData = {
        page: action.page,
        narration: action.narration,
        events: [],
        characters: {},
        attached_to: state.attachedTo,
        created_at: action.created_at,
      };
      return {
        ...state,
        pages: [...state.pages.slice(-100), partialPage],
        pendingInfluence: null,
        pendingDirectorGuidance: null,
        pageGenerating: null, // Clear - page content is now arriving
      };
    }
    case "CHARACTER_READY": {
      // Add character to existing page (non-streaming mode)
      const pageIndex = state.pages.findIndex(p => p.page === action.page);
      if (pageIndex === -1) return state; // Page not found
      const updatedPages = [...state.pages];
      updatedPages[pageIndex] = {
        ...updatedPages[pageIndex],
        characters: {
          ...updatedPages[pageIndex].characters,
          [action.character]: action.data,
        },
      };
      return { ...state, pages: updatedPages };
    }
    case "ATTACHED":
      // Also exit director mode when attaching (prevents panel close/reopen)
      return { ...state, attachedTo: action.character, directorMode: false };
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
      // Convert history pages to PageData, merging with existing live pages
      // History has full character data from DB; live pages may have partial data
      // (only attached character's inner_thoughts). We need to merge, not replace.
      const existingPageMap = new Map(state.pages.map(p => [p.page, p]));

      const historyAsPages: PageData[] = action.pages.map(h => {
        const existing = existingPageMap.get(h.page);
        const historyCharacters = (h.characters || {}) as Record<string, CharacterPage>;

        if (existing) {
          // Merge: history has full data, existing may have partial
          // For each character, prefer history data (has inner_thoughts from DB)
          // but keep any live data that might be more recent
          const mergedCharacters: Record<string, CharacterPage> = { ...historyCharacters };
          for (const [name, liveData] of Object.entries(existing.characters)) {
            if (!mergedCharacters[name]) {
              mergedCharacters[name] = liveData;
            } else {
              // History has full data, but merge in case live has something newer
              mergedCharacters[name] = {
                ...mergedCharacters[name],
                ...liveData,
                // Prefer history's inner_thoughts if live doesn't have it
                inner_thoughts: liveData.inner_thoughts || mergedCharacters[name].inner_thoughts,
              };
            }
          }
          return {
            ...existing,
            narration: h.narration || existing.narration,
            events: h.events || existing.events,
            characters: mergedCharacters,
            created_at: h.created_at || existing.created_at,
          };
        }

        return {
          page: h.page,
          narration: h.narration || "",
          events: h.events || [],
          characters: historyCharacters,
          attached_to: null,
          created_at: h.created_at,
        };
      });

      // Merge with any pages that weren't in history (shouldn't happen normally)
      const historyPageNums = new Set(action.pages.map(h => h.page));
      const nonHistoryPages = state.pages.filter(p => !historyPageNums.has(p.page));
      const merged = [...historyAsPages, ...nonHistoryPages];
      merged.sort((a, b) => a.page - b.page);

      // Deduplicate by page number (keep first occurrence)
      const seen = new Set<number>();
      const deduped = merged.filter(p => {
        if (seen.has(p.page)) return false;
        seen.add(p.page);
        return true;
      });

      return { ...state, pages: deduped, history: action.pages };
    }
    case "CHARACTER_HISTORY":
      return { ...state, characterHistory: { name: action.character, pages: action.pages } };
    case "REPLAY":
      return { ...state, replayPage: action.data };
    case "PAUSE_STATE":
      return { ...state, paused: action.paused };
    case "PAGE_INTERVAL":
      return { ...state, pageInterval: action.seconds, manualMode: action.manual };
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
    case "PAGE_START":
      return {
        ...state,
        streaming: {
          page: action.page,
          narrator: "",
          characters: {},
          isStreaming: true,
          narratorDone: false,
          charactersDone: [],
        },
      };
    case "STREAM_SYNC":
      // Throttled sync from ref - replace entire streaming content (preserve done states)
      if (state.streaming.page !== action.page) return state;
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
      if (state.streaming.page !== action.page) return state;
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
        pages: [],
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
    case "INJECT_MOCK_PAGE": {
      // Generate mock page for UI debugging without AI calls
      const nextPageNum = state.pages.length > 0
        ? Math.max(...state.pages.map(p => p.page)) + 1
        : 1;
      const mockNarrations = [
        `The morning sun cast long shadows across the cobblestone streets as *tension* filled the air. "We need to talk," she said, her voice barely above a whisper. The market bustled around them, oblivious to the **intensity** building between the two figures.`,
        `Rain drummed against the windowpane as they sat in silence. The fire crackled softly, casting dancing shadows on the walls. "I never meant for things to end this way," he murmured, staring into the flames. She reached out, her fingers brushing against his hand.`,
        `The tavern was crowded tonight, filled with laughter and the clinking of mugs. But in the corner booth, a different conversation was taking place. "The map shows a passage through the mountains," she said, ***urgently*** tapping the parchment. "But we'll need supplies."`,
        `Moonlight filtered through the canopy as they made their way through the forest. Every snap of a twig made them freeze. "Do you hear that?" she whispered. The sound came again—closer this time. Something was following them.`,
      ];
      const mockDialogues = [
        "I've been thinking about what you said, and... maybe you're right.",
        "This isn't over. Not by a long shot.",
        "You always know exactly what to say, don't you?",
        "I'll meet you at midnight. Don't be late.",
        "Perhaps there's another way. Let me think...",
      ];
      const mockCharacters = state.characterNames.length > 0
        ? state.characterNames
        : ["Elena", "Marcus"];

      const mockPage: PageData = {
        page: nextPageNum,
        narration: mockNarrations[nextPageNum % mockNarrations.length],
        events: ["[Mock event for debugging]"],
        characters: Object.fromEntries(
          mockCharacters.map((name, i) => [
            name,
            {
              dialogue: mockDialogues[(nextPageNum + i) % mockDialogues.length],
              action: "shifts thoughtfully",
              emotional_state: "contemplative",
              inner_thoughts: "I wonder what will happen next...",
            }
          ])
        ),
        attached_to: state.attachedTo,
        created_at: new Date().toISOString(),
      };

      return {
        ...state,
        pages: [...state.pages.slice(-100), mockPage],
        world: state.world || { world_name: "Mock World (Debug Mode)", world_id: "mock-debug" },
        characterNames: mockCharacters,
        pageGenerating: null,
      };
    }
    default:
      return state;
  }
}

export function useGame(apiUrl: string, bookId?: string | null) {
  const { state: wsState, lastMessage, connect, send, disconnect, setOnMessage, url: _url } = useWebSocket(apiUrl, bookId);
  const [game, dispatch] = useReducer(reducer, initial);

  // Use ref for streaming accumulation - updates are throttled to avoid React batching all at once
  const streamingRef = useRef<{
    page: number | null;
    narrator: string;
    characters: Record<string, string>;
    dirty: boolean;
  }>({
    page: null,
    narrator: "",
    characters: {},
    dirty: false,
  });

  // Throttled UI updates for streaming (every 250ms for smoother chunked appearance)
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const ref = streamingRef.current;
        if (ref && ref.dirty && ref.page !== null) {
          ref.dirty = false;
          dispatch({
            type: "STREAM_SYNC",
            page: ref.page,
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

  // Process messages synchronously via callback (for streaming AND welcome)
  useEffect(() => {
    setOnMessage((msg: ServerMessage) => {
      // Handle welcome message synchronously to avoid race condition
      if (msg.type === "welcome") {
        console.log("[useGame] WELCOME received, dispatching...");
        dispatch({
          type: "WELCOME",
          world: msg.world as WorldInfo,
          characters: msg.characters as string[],
          multiplayer: ((msg.world as WorldInfo & { multiplayer?: boolean })?.multiplayer) ?? false,
        });
        if (msg.history && Array.isArray(msg.history)) {
          console.log("[useGame] WELCOME has history, dispatching HISTORY with", msg.history.length, "pages");
          dispatch({ type: "HISTORY", pages: msg.history as HistoryPage[] });
        }
        if (typeof msg.page_interval === "number") {
          dispatch({ type: "PAGE_INTERVAL", seconds: msg.page_interval, manual: msg.manual === true });
        }
        if (typeof msg.paused === "boolean") {
          dispatch({ type: "PAUSE_STATE", paused: msg.paused });
        }
        return;
      }
      // Handle streaming messages - accumulate in ref, mark dirty for throttled sync
      if (msg.type === "page_start") {
        streamingRef.current = {
          page: msg.page as number,
          narrator: "",
          characters: {},
          dirty: false,
        };
        dispatch({ type: "PAGE_START", page: msg.page as number });
      } else if (msg.type === "stream_delta") {
        const page = msg.page as number;
        const source = msg.source as string;
        const delta = msg.delta as string;
        if (streamingRef.current.page === page) {
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
        if (streamingRef.current.page !== null) {
          dispatch({
            type: "STREAM_SYNC",
            page: streamingRef.current.page,
            narrator: streamingRef.current.narrator,
            characters: { ...streamingRef.current.characters },
          });
        }
        dispatch({
          type: "STREAM_DONE",
          page: msg.page as number,
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

    console.log("[useGame] Processing message:", msg.type, msg);

    // Skip messages handled in sync callback
    if (msg.type === "page_start" || msg.type === "stream_delta" || msg.type === "stream_done" || msg.type === "welcome") {
      return;
    }

    switch (msg.type) {
      case "page":
        console.log("[useGame] Dispatching PAGE action:", msg);
        dispatch({ type: "PAGE", data: msg as unknown as PageData });
        break;
      case "page_generating":
        // Non-streaming mode: page generation started (show intermission)
        dispatch({ type: "PAGE_GENERATING", page: msg.page as number });
        break;
      case "narrator_ready":
        // Non-streaming mode: narrator finished, show narration before characters are done
        console.log("[useGame] Dispatching NARRATOR_READY:", msg.page, "narration length:", (msg.narration as string)?.length);
        dispatch({
          type: "NARRATOR_READY",
          page: msg.page as number,
          narration: msg.narration as string,
          mood: (msg.mood as string) || "",
          created_at: (msg.created_at as string) || new Date().toISOString(),
        });
        break;
      case "character_ready":
        // Non-streaming mode: character finished, add to page
        dispatch({
          type: "CHARACTER_READY",
          page: msg.page as number,
          character: msg.character as string,
          data: msg.data as Record<string, unknown>,
        });
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
        dispatch({ type: "HISTORY", pages: msg.pages as HistoryPage[] });
        break;
      case "character_history":
        dispatch({
          type: "CHARACTER_HISTORY",
          character: msg.character as string,
          pages: msg.pages as CharHistoryPage[],
        });
        break;
      case "replay":
        dispatch({ type: "REPLAY", data: msg });
        break;
      case "pause_state":
        dispatch({ type: "PAUSE_STATE", paused: msg.paused as boolean });
        break;
      case "page_interval":
        dispatch({ type: "PAGE_INTERVAL", seconds: msg.seconds as number, manual: msg.manual === true });
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
      case "debug":
        // Dispatch custom event for DebugPanel to receive
        window.dispatchEvent(new CustomEvent("raunch-debug-data", { detail: msg }));
        break;
      // page_start, stream_delta, stream_done handled synchronously above
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
      replay: (page: number) => send({ cmd: "replay", page }),
      submitAction: (text: string, autoReady = false) => {
        send({ cmd: "action", text });
        if (autoReady) {
          send({ cmd: "ready" });
        }
      },
      togglePause: () => send({ cmd: "toggle_pause" }),
      pause: () => send({ cmd: "pause" }),
      resume: () => send({ cmd: "resume" }),
      setPageInterval: (seconds: number) => send({ cmd: "set_page_interval", seconds }),
      getPageInterval: () => send({ cmd: "get_page_interval" }),
      triggerPage: () => send({ cmd: "page" }),
      clearError: () => dispatch({ type: "CLEAR_ERROR" }),
      reset: () => dispatch({ type: "RESET" }),
      // Director mode
      toggleDirectorMode: () => dispatch({ type: "TOGGLE_DIRECTOR_MODE" }),
      submitDirectorGuidance: (text: string, autoReady = false) => {
        send({ cmd: "director", text });
        if (autoReady) {
          send({ cmd: "ready" });
        }
      },
      // Debug
      fetchDebug: (limit = 50) => send({ cmd: "debug", limit, include_raw: true }),
      injectMockPage: () => dispatch({ type: "INJECT_MOCK_PAGE" }),
      // Raw send for custom commands
      sendCommand: (cmd: string, data?: Record<string, unknown>) => send({ cmd, ...data }),
    }),
    [connect, disconnect, send]
  );

  return { wsState, game, actions };
}

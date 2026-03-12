import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { TickData, StreamingState, TurnState, Player } from "@/hooks/useGame";
import { CharacterPanel } from "./CharacterPanel";
import { TickFeed } from "./TickFeed";
import { Sidebar } from "./Sidebar";
import { ActionBar } from "./ActionBar";
import { TurnStateUI } from "./TurnStateUI";

type GameState = {
  world: Record<string, unknown> | null;
  characterNames: string[];
  characterDetails: Record<string, Record<string, unknown>>;
  attachedTo: string | null;
  ticks: TickData[];
  history: unknown[];
  characterHistory: { name: string; ticks: unknown[] } | null;
  replayTick: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
  error: string | null;
  paused?: boolean;
  tickInterval?: number;
  manualMode?: boolean;
  pendingInfluence?: { character: string; text: string } | null;
  directorMode?: boolean;
  pendingDirectorGuidance?: string | null;
  streaming?: StreamingState;
  // Multiplayer
  turnState?: TurnState | null;
  nickname?: string | null;
  players?: Player[];
};

type Actions = {
  connect: () => void;
  disconnect: () => void;
  attach: (name: string) => void;
  detach: () => void;
  listCharacters: () => void;
  getWorld: () => void;
  getStatus: () => void;
  getHistory: (count?: number, offset?: number) => void;
  getCharacterHistory: (name: string, count?: number) => void;
  replay: (tick: number) => void;
  submitAction: (text: string) => void;
  clearError: () => void;
  togglePause?: () => void;
  setTickInterval?: (seconds: number) => void;
  triggerTick?: () => void;
  toggleDirectorMode?: () => void;
  submitDirectorGuidance?: (text: string) => void;
  ready?: () => void;
};

type Props = {
  game: GameState;
  actions: Actions;
};

export function GameLayout({ game, actions }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [autoScroll, _setAutoScroll] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [focusedTickNum, setFocusedTickNum] = useState<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Initialize focused tick to latest when ticks first load
  useEffect(() => {
    if (game.ticks.length > 0 && focusedTickNum === null) {
      setFocusedTickNum(game.ticks[game.ticks.length - 1].tick);
    }
  }, [game.ticks.length, focusedTickNum]);

  // Get the character data for the focused tick
  const focusedTickData = useMemo(() => {
    if (!focusedTickNum || !game.attachedTo) return null;
    const tick = game.ticks.find(t => t.tick === focusedTickNum);
    return tick?.characters[game.attachedTo] ?? null;
  }, [focusedTickNum, game.ticks, game.attachedTo]);

  // Fallback to latest tick if no focus
  const latestTick = game.ticks[game.ticks.length - 1];
  const displayedCharacterData = focusedTickData ?? latestTick?.characters[game.attachedTo ?? ""];

  // Fetch character list and recent history on mount
  useEffect(() => {
    actions.listCharacters();
    actions.getHistory(20);
  }, [actions]);

  // Check if user is near bottom of scroll
  const handleScroll = useCallback(() => {
    if (feedRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 150;
      setIsNearBottom(nearBottom);
    }
  }, []);

  // Handle tick focus changes from scroll position
  const handleTickFocus = useCallback((tickNum: number) => {
    setFocusedTickNum(tickNum);
  }, []);

  // Smart auto-scroll: only if user is near bottom AND autoScroll is on
  useEffect(() => {
    if (autoScroll && isNearBottom && feedRef.current) {
      // Smooth scroll to bottom after a small delay for animation
      const timer = setTimeout(() => {
        feedRef.current?.scrollTo({
          top: feedRef.current.scrollHeight,
          behavior: "smooth"
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [game.ticks.length, autoScroll, isNearBottom]);

  return (
    <div className="h-screen relative bg-background overflow-hidden">
      {/* Top bar - fixed, transparent with blur to see content through */}
      <header className="absolute top-0 inset-x-0 h-12 flex items-center justify-between px-4 bg-background/30 backdrop-blur-xl z-20 after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-gradient-to-b after:from-background/50 after:to-transparent after:pointer-events-none after:backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <h1 className="text-sm font-bold tracking-wider text-primary">RAUNCH</h1>
          <span className="text-xs text-muted-foreground">
            {(game.world as Record<string, unknown>)?.world_name as string ?? ""}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Tick interval selector */}
          {actions.setTickInterval && (
            <select
              value={game.tickInterval ?? 0}
              onChange={(e) => actions.setTickInterval?.(parseInt(e.target.value))}
              className="bg-muted/50 text-muted-foreground text-xs px-2 py-1 rounded border-none outline-none cursor-pointer hover:bg-muted"
              title="Tick interval"
            >
              <option value={0}>Manual</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>1m</option>
              <option value={120}>2m</option>
              <option value={300}>5m</option>
              <option value={600}>10m</option>
              <option value={1800}>30m</option>
              <option value={3600}>1h</option>
            </select>
          )}

          {/* Manual: Next button / Auto: Pause/Resume button - same position */}
          {game.manualMode ? (
            actions.triggerTick && (
              <button
                onClick={actions.triggerTick}
                disabled={game.streaming?.isStreaming}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Next
              </button>
            )
          ) : (
            actions.togglePause && (
              <button
                onClick={actions.togglePause}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                  game.paused
                    ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {game.paused ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Resume
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                    Pause
                  </>
                )}
              </button>
            )
          )}

          {/* Status LED with hover tooltip */}
          <div className="relative group">
            <span
              className={`block w-2.5 h-2.5 rounded-full shadow-sm cursor-default transition-colors ${
                game.paused
                  ? "bg-amber-500 shadow-amber-500/30"
                  : game.manualMode
                  ? "bg-sky-400 shadow-sky-400/30"
                  : "bg-emerald-500 shadow-emerald-500/50 animate-pulse"
              }`}
            />
            <div className="absolute right-0 top-full mt-2 px-2 py-1 bg-popover border border-border rounded text-xs text-popover-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              {game.paused ? "Simulation paused" : game.manualMode ? "Manual mode" : "Auto-advancing"}
              {!game.manualMode && game.tickInterval && ` · ${game.tickInterval}s intervals`}
            </div>
          </div>

          {/* Hidden disconnect button - kept for future remote server features */}
          {false && (
            <button
              onClick={actions.disconnect}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>
      </header>

      {/* Main content - full height, content scrolls under header */}
      <div className="flex h-full overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 256, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden shrink-0 h-full"
            >
              <Sidebar
                game={game}
                actions={actions}
                onClose={() => setSidebarOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center: Tick feed */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div
            ref={feedRef}
            className="flex-1 overflow-y-auto scroll-smooth pt-14"
            onScroll={handleScroll}
          >
            <TickFeed
              ticks={game.ticks}
              attachedTo={game.attachedTo}
              autoScroll={autoScroll && isNearBottom}
              focusedTick={focusedTickNum}
              onTickFocus={handleTickFocus}
              containerRef={feedRef}
              streaming={game.streaming}
            />
          </div>

          {/* Action bar - influence whisper or director mode */}
          <ActionBar
            onSubmitInfluence={actions.submitAction}
            onSubmitDirector={actions.submitDirectorGuidance ?? (() => {})}
            attachedTo={game.attachedTo}
            directorMode={game.directorMode ?? false}
            pendingDirectorGuidance={game.pendingDirectorGuidance}
          />

          {/* Turn state indicator - shows waiting players and countdown */}
          <TurnStateUI
            turnState={game.turnState ? {
              timeout: game.turnState.countdown,
              waitingFor: game.turnState.waiting_for,
              allReady: game.turnState.all_ready,
              playerCount: game.players?.length ?? 0,
              turnStartedAt: null,
            } : null}
            myNickname={game.nickname ?? null}
            isMyReady={game.nickname ? !game.turnState?.waiting_for.includes(game.nickname) : true}
            onReady={actions.ready}
          />
        </main>

        {/* Right panel: attached character - synced with scroll */}
        <AnimatePresence initial={false}>
          {game.attachedTo && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden shrink-0 h-full"
            >
              <CharacterPanel
                name={game.attachedTo}
                data={displayedCharacterData}
                pendingInfluence={
                  game.pendingInfluence?.character === game.attachedTo
                    ? game.pendingInfluence.text
                    : null
                }
                streamingText={
                  game.streaming?.isStreaming
                    ? game.streaming.characters[game.attachedTo]
                    : undefined
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Error toast */}
      {game.error && (
        <div
          className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg text-sm shadow-lg cursor-pointer animate-in fade-in slide-in-from-bottom-2"
          onClick={actions.clearError}
        >
          {game.error}
        </div>
      )}
    </div>
  );
}

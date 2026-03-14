import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { TickData, StreamingState, TurnState, Player } from "@/hooks/useGame";
import { CharacterPanel } from "./CharacterPanel";
import { DirectorPanel } from "./DirectorPanel";
import { TickFeed } from "./TickFeed";
import { Sidebar } from "./Sidebar";
import { ActionBar } from "./ActionBar";
import { TurnStateUI } from "./TurnStateUI";
import { PlayerPresence } from "./PlayerPresence";
import { DebugPanel } from "./DebugPanel";

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
  multiplayer?: boolean;
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
  sendCommand?: (cmd: string, data?: Record<string, unknown>) => void;
};

type Props = {
  game: GameState;
  actions: Actions;
  onAddCharacter?: () => void;
};

export function GameLayout({ game, actions, onAddCharacter }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(true); // Start open by default
  const [characterPanelOpen, setCharacterPanelOpen] = useState(true); // Start open by default
  const [autoScroll, _setAutoScroll] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [focusedTickNum, setFocusedTickNum] = useState<number | null>(null);
  const [previewCharacter, setPreviewCharacter] = useState<string | null>(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
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

  // Determine which character to display: preview > attached
  const displayedCharacterName = previewCharacter ?? game.attachedTo;

  // Wide mode when at most one panel is open (narrow only when both are open)
  const hasSidebarOpen = sidebarOpen;
  const hasRightPanelOpen = !!(game.attachedTo || previewCharacter || game.directorMode);
  const wideMode = !(hasSidebarOpen && hasRightPanelOpen);

  // Get the focused tick data
  const focusedTick = useMemo(() => {
    if (focusedTickNum) {
      return game.ticks.find(t => t.tick === focusedTickNum) ?? null;
    }
    return latestTick ?? null;
  }, [focusedTickNum, game.ticks, latestTick]);

  // Get character data for the displayed character at the focused tick
  const displayedCharacterData = useMemo(() => {
    if (!displayedCharacterName) return undefined;
    return focusedTick?.characters[displayedCharacterName] ?? undefined;
  }, [displayedCharacterName, focusedTick]);

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

  // Open character panel on mobile when attaching to a character
  const handleCharacterAttached = useCallback(() => {
    // Check if we're on mobile (lg breakpoint is 1024px)
    if (window.innerWidth < 1024) {
      setCharacterPanelOpen(true);
      setSidebarOpen(false); // Close sidebar when opening character panel
    }
  }, []);

  // Preview a character (hover on desktop, tap on mobile)
  const handlePreviewCharacter = useCallback((name: string | null) => {
    setPreviewCharacter(name);
  }, []);

  // Tap on character name (mobile) - preview and open panel
  const handleTapCharacter = useCallback((name: string) => {
    if (window.innerWidth < 1024) {
      setPreviewCharacter(name);
      setCharacterPanelOpen(true);
    }
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
      <header className="absolute top-0 inset-x-0 h-12 flex items-center justify-between px-3 sm:px-4 bg-background/30 backdrop-blur-xl z-20 after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-gradient-to-b after:from-background/50 after:to-transparent after:pointer-events-none after:backdrop-blur-sm">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Sidebar toggle - always visible */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 -ml-1.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <h1 className="text-sm font-bold tracking-wider text-primary">RAUNCH</h1>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {(game.world as Record<string, unknown>)?.world_name as string ?? ""}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Player presence indicator - only in multiplayer */}
          {game.multiplayer && game.players && game.players.length > 0 && (
            <PlayerPresence
              players={game.players}
              myPlayerId={game.players.find(p => p.nickname === game.nickname)?.player_id ?? null}
            />
          )}

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
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                  game.paused
                    ? "text-amber-400 hover:text-amber-300"
                    : "text-muted-foreground hover:text-foreground"
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

          {/* Debug button */}
          <button
            onClick={() => setDebugPanelOpen(true)}
            className="p-1.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="Debug Panel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h.01M8.5 3H7a2 2 0 0 0-2 2v1.5M15.5 3H17a2 2 0 0 1 2 2v1.5M8.5 21H7a2 2 0 0 1-2-2v-1.5M15.5 21H17a2 2 0 0 0 2-2v-1.5M3 8.5V7a2 2 0 0 1 2-2h1.5M21 8.5V7a2 2 0 0 0-2-2h-1.5M3 15.5V17a2 2 0 0 0 2 2h1.5M21 15.5V17a2 2 0 0 1-2 2h-1.5M12 12h.01" />
            </svg>
          </button>

          {/* Status LED with hover tooltip - desktop only */}
          <div className="relative group hidden sm:block">
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

          {/* Right panel toggle - mobile only, shown when attached or director mode */}
          {(game.attachedTo || game.directorMode) && (
            <button
              onClick={() => setCharacterPanelOpen(!characterPanelOpen)}
              className={`lg:hidden p-1.5 -mr-1.5 transition-colors ${
                game.directorMode
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-label={game.directorMode ? "Toggle director panel" : "Toggle character panel"}
            >
              {game.directorMode ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 11l18-5v12L3 13v-2z" />
                  <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </button>
          )}

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
        {/* Sidebar - Desktop: inline, Mobile: overlay */}
        {/* Desktop sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 256, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="hidden lg:block overflow-hidden shrink-0 h-full"
            >
              <Sidebar
                game={game}
                actions={actions}
                onClose={() => setSidebarOpen(false)}
                onCharacterAttached={handleCharacterAttached}
                onAddCharacter={onAddCharacter}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <div className="lg:hidden fixed inset-0 z-40">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setSidebarOpen(false)}
              />
              {/* Panel */}
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="absolute left-0 top-0 h-full w-[280px] max-w-[85vw]"
              >
                <Sidebar
                  game={game}
                  actions={actions}
                  onClose={() => setSidebarOpen(false)}
                  onCharacterAttached={handleCharacterAttached}
                />
              </motion.div>
            </div>
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
              onHoverCharacter={handlePreviewCharacter}
              onTapCharacter={handleTapCharacter}
              wideMode={wideMode}
              mood={(game.world as Record<string, unknown>)?.mood as string}
            />
          </div>

          {/* Action bar - influence whisper or director mode */}
          <ActionBar
            onSubmitInfluence={actions.submitAction}
            onSubmitDirector={actions.submitDirectorGuidance ?? (() => {})}
            attachedTo={game.attachedTo}
            directorMode={game.directorMode ?? false}
            pendingDirectorGuidance={game.pendingDirectorGuidance}
            wideMode={wideMode}
          />

          {/* Turn state indicator - only in multiplayer */}
          {game.multiplayer && (
            <TurnStateUI
              turnState={game.turnState ? {
                timeout: 60,
                waitingFor: game.turnState.waiting_for,
                allReady: game.turnState.all_ready,
                playerCount: game.players?.length ?? 0,
                turnStartedAt: Date.now() - (60 - game.turnState.countdown) * 1000,
              } : null}
              myNickname={game.nickname ?? null}
              isMyReady={game.nickname ? !game.turnState?.waiting_for.includes(game.nickname) : true}
              onReady={actions.ready}
            />
          )}
        </main>

        {/* Right panel: attached character - synced with scroll */}
        {/* Desktop right panel - Director or Character */}
        <AnimatePresence initial={false}>
          {(game.directorMode || game.attachedTo || previewCharacter) && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="hidden lg:block overflow-hidden shrink-0 h-full"
            >
              {game.directorMode ? (
                <DirectorPanel
                  tickData={focusedTick}
                  pendingGuidance={game.pendingDirectorGuidance}
                />
              ) : (
                <CharacterPanel
                  name={displayedCharacterName!}
                  data={displayedCharacterData}
                  isPreview={!!previewCharacter}
                  pendingInfluence={
                    game.pendingInfluence?.character === displayedCharacterName
                      ? game.pendingInfluence.text
                      : null
                  }
                  streamingText={
                    game.streaming?.isStreaming && displayedCharacterName
                      ? game.streaming.characters[displayedCharacterName]
                      : undefined
                  }
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile right panel overlay - Director or Character */}
        <AnimatePresence>
          {characterPanelOpen && (game.directorMode || displayedCharacterName) && (
            <div className="lg:hidden fixed inset-0 z-40">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => {
                  setCharacterPanelOpen(false);
                  setPreviewCharacter(null);
                }}
              />
              {/* Panel */}
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="absolute right-0 top-0 h-full w-[320px] max-w-[90vw]"
              >
                {game.directorMode ? (
                  <DirectorPanel
                    tickData={focusedTick}
                    pendingGuidance={game.pendingDirectorGuidance}
                    onClose={() => setCharacterPanelOpen(false)}
                  />
                ) : (
                  <CharacterPanel
                    name={displayedCharacterName!}
                    data={displayedCharacterData}
                    isPreview={!!previewCharacter}
                    pendingInfluence={
                      game.pendingInfluence?.character === displayedCharacterName
                        ? game.pendingInfluence.text
                        : null
                    }
                    streamingText={
                      game.streaming?.isStreaming
                        ? game.streaming.characters[displayedCharacterName!]
                        : undefined
                    }
                    onClose={() => {
                      setCharacterPanelOpen(false);
                      setPreviewCharacter(null);
                    }}
                  />
                )}
              </motion.div>
            </div>
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

      {/* Debug panel */}
      <DebugPanel
        isOpen={debugPanelOpen}
        onClose={() => setDebugPanelOpen(false)}
        sendCommand={actions.sendCommand ?? (() => {})}
      />
    </div>
  );
}

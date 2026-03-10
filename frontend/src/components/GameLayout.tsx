import { useEffect, useRef, useState } from "react";
import type { TickData } from "@/hooks/useGame";
import { CharacterPanel } from "./CharacterPanel";
import { TickFeed } from "./TickFeed";
import { Sidebar } from "./Sidebar";
import { ActionBar } from "./ActionBar";

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
};

type Props = {
  game: GameState;
  actions: Actions;
};

export function GameLayout({ game, actions }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  const latestTick = game.ticks[game.ticks.length - 1];

  // Fetch character list and recent history on mount
  useEffect(() => {
    actions.listCharacters();
    actions.getHistory(20);
  }, [actions]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [game.ticks]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-border/50 bg-card/50 backdrop-blur-sm shrink-0">
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

        <div className="flex items-center gap-4">
          {game.attachedTo && (
            <span className="text-xs">
              Attached to{" "}
              <span className="text-primary font-medium">{game.attachedTo}</span>
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">Live</span>
          </div>
          <button
            onClick={actions.disconnect}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <Sidebar
            game={game}
            actions={actions}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        {/* Center: Tick feed */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div ref={feedRef} className="flex-1 overflow-y-auto">
            <TickFeed ticks={game.ticks} attachedTo={game.attachedTo} />
          </div>

          {/* Action bar */}
          <ActionBar onSubmit={actions.submitAction} />
        </main>

        {/* Right panel: attached character */}
        {game.attachedTo && latestTick && (
          <CharacterPanel
            name={game.attachedTo}
            data={latestTick.characters[game.attachedTo]}
            onDetach={actions.detach}
          />
        )}
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

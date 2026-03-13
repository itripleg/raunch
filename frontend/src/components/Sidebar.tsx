import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type Props = {
  game: {
    world: Record<string, unknown> | null;
    characterNames: string[];
    characterDetails: Record<string, Record<string, unknown>>;
    attachedTo: string | null;
    directorMode?: boolean;
  };
  actions: {
    attach: (name: string) => void;
    detach: () => void;
    listCharacters: () => void;
    getHistory: (count?: number) => void;
    getCharacterHistory: (name: string, count?: number) => void;
    toggleDirectorMode?: () => void;
  };
  onClose: () => void;
};

export function Sidebar({ game, actions, onClose }: Props) {
  const world = game.world as Record<string, unknown> | null;

  return (
    <aside className="min-w-[256px] h-full border-r border-border/50 bg-card/20 flex flex-col shrink-0 pt-12 overflow-hidden">
      {/* World info */}
      <div className="p-4 space-y-2 group">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            World
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors lg:hidden"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {world && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{world.world_name as string}</p>
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>Time: {world.world_time as string ?? "?"}</div>
              <div>Mood: {world.mood as string ?? "?"}</div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60">
                Tick: {world.tick_count as number ?? "?"}
              </div>
            </div>
          </div>
        )}
      </div>

      <Separator className="bg-border/30" />

      {/* Characters */}
      <div className="p-4 pb-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          Characters
        </h2>
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-1.5 pb-4">
          {/* Narrator - special entry for director mode */}
          <button
            onClick={() => {
              // If in director mode, exit it. Otherwise enter it (and detach from any character)
              if (game.directorMode) {
                actions.toggleDirectorMode?.();
              } else {
                if (game.attachedTo) actions.detach();
                actions.toggleDirectorMode?.();
              }
            }}
            className={`w-full text-left p-2.5 rounded-lg transition-all duration-200 group ${
              game.directorMode
                ? "bg-amber-500/15 border border-amber-500/30"
                : "hover:bg-secondary/50 border border-transparent"
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full shrink-0 ${game.directorMode ? "bg-amber-400 animate-pulse" : "bg-muted-foreground/30"}`} />
              <span className={`text-sm font-medium ${game.directorMode ? "text-amber-400" : "text-foreground/80 group-hover:text-foreground"}`}>
                Narrator
              </span>
              {/* Megaphone icon */}
              <svg
                className={`w-3 h-3 ml-auto ${game.directorMode ? "text-amber-400/60" : "text-muted-foreground/40"}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 11l18-5v12L3 13v-2z" />
                <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
              </svg>
            </div>
            <div className="ml-4 mt-1 text-[10px] text-muted-foreground">
              <div className="truncate">Direct the scene</div>
            </div>
            {game.directorMode && (
              <div className="ml-4 mt-1.5">
                <span className="text-[10px] text-amber-400/60 opacity-0 group-hover:opacity-100 transition-opacity">
                  Click to deselect
                </span>
              </div>
            )}
          </button>

          <Separator className="bg-border/20 my-2" />

          {game.characterNames.map((name) => {
            const info = game.characterDetails[name];
            const isAttached = name === game.attachedTo;

            return (
              <button
                key={name}
                onClick={() => {
                  if (isAttached) {
                    actions.detach();
                  } else {
                    // Exit director mode when attaching to a character
                    if (game.directorMode) actions.toggleDirectorMode?.();
                    actions.attach(name);
                  }
                }}
                className={`w-full text-left p-2.5 rounded-lg transition-all duration-200 group ${
                  isAttached
                    ? "bg-primary/15 border border-primary/30"
                    : "hover:bg-secondary/50 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${isAttached ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                  <span className={`text-sm font-medium ${isAttached ? "text-primary" : "text-foreground/80 group-hover:text-foreground"}`}>
                    {name}
                  </span>
                </div>
                {info && (
                  <div className="ml-4 mt-1 text-[10px] text-muted-foreground space-y-0.5">
                    {info.species && !["?", "unknown"].includes(String(info.species).toLowerCase()) ? (
                      <div className="truncate">{String(info.species)}</div>
                    ) : null}
                    {info.emotional_state ? (
                      <div className="text-amber-400/60 italic truncate">{String(info.emotional_state)}</div>
                    ) : null}
                  </div>
                )}
                {isAttached && (
                  <div className="ml-4 mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] text-primary/60 opacity-0 group-hover:opacity-100 transition-opacity">
                      Click to detach
                    </span>
                    {typeof world?.tick_count === "number" && (
                      <span className="text-[9px] font-mono text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity">
                        tick {world.tick_count}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>

    </aside>
  );
}

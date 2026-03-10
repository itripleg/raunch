import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

type Props = {
  game: {
    world: Record<string, unknown> | null;
    characterNames: string[];
    characterDetails: Record<string, Record<string, unknown>>;
    attachedTo: string | null;
  };
  actions: {
    attach: (name: string) => void;
    detach: () => void;
    listCharacters: () => void;
    getHistory: (count?: number) => void;
    getCharacterHistory: (name: string, count?: number) => void;
  };
  onClose: () => void;
};

export function Sidebar({ game, actions, onClose }: Props) {
  const world = game.world as Record<string, unknown> | null;

  return (
    <aside className="w-64 border-r border-border/50 bg-card/20 flex flex-col shrink-0">
      {/* World info */}
      <div className="p-4 space-y-2">
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
            <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
              <span>Time: {world.world_time as string ?? "?"}</span>
              <span>Tick: {world.tick_count as number ?? "?"}</span>
              <span className="col-span-2">Mood: {world.mood as string ?? "?"}</span>
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
          {game.characterNames.map((name) => {
            const info = game.characterDetails[name];
            const isAttached = name === game.attachedTo;

            return (
              <button
                key={name}
                onClick={() => isAttached ? actions.detach() : actions.attach(name)}
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
                  <div className="ml-4 mt-1 text-[11px] text-muted-foreground space-y-0.5">
                    {info.species ? <div>{String(info.species)}</div> : null}
                    {info.emotional_state ? (
                      <div className="text-amber-400/60 italic">{String(info.emotional_state)}</div>
                    ) : null}
                    {info.location ? <div>@ {String(info.location)}</div> : null}
                  </div>
                )}
                {isAttached && (
                  <span className="ml-4 mt-1 text-[10px] text-primary/60 block">
                    Click to detach
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>

      <Separator className="bg-border/30" />

      {/* Quick actions */}
      <div className="p-3 space-y-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs h-8"
          onClick={() => actions.getHistory(30)}
        >
          View History
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs h-8"
          onClick={actions.listCharacters}
        >
          Refresh Characters
        </Button>
      </div>
    </aside>
  );
}

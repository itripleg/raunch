import type { CharacterTick } from "@/hooks/useGame";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type Props = {
  name: string;
  data?: CharacterTick;
  onDetach: () => void;
};

export function CharacterPanel({ name, data, onDetach }: Props) {
  return (
    <aside className="w-80 border-l border-border/50 bg-card/30 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm text-primary">{name}</h3>
            <p className="text-xs text-muted-foreground">Inner thoughts</p>
          </div>
          <button
            onClick={onDetach}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
          >
            Detach
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {data ? (
            <>
              {/* Emotional state */}
              {data.emotional_state && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Emotional State
                  </label>
                  <p className="text-sm mt-1 text-amber-400/80 italic">
                    {data.emotional_state}
                  </p>
                </div>
              )}

              <Separator className="bg-border/30" />

              {/* Inner thoughts */}
              {data.inner_thoughts && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Inner Thoughts
                  </label>
                  <p className="text-sm mt-1 text-foreground/80 leading-relaxed italic">
                    {data.inner_thoughts}
                  </p>
                </div>
              )}

              <Separator className="bg-border/30" />

              {/* Action */}
              {data.action && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Action
                  </label>
                  <p className="text-sm mt-1 text-foreground/70">
                    {data.action}
                  </p>
                </div>
              )}

              {/* Desires update */}
              {data.desires_update && (
                <>
                  <Separator className="bg-border/30" />
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Desires
                    </label>
                    <p className="text-sm mt-1 text-primary/70 italic">
                      {data.desires_update}
                    </p>
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Waiting for next tick...</p>
          )}
        </div>
      </ScrollArea>

      {/* Glow indicator */}
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-pulse-glow" />
    </aside>
  );
}

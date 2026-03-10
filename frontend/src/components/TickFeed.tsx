import type { TickData } from "@/hooks/useGame";
import { Badge } from "@/components/ui/badge";

type Props = {
  ticks: TickData[];
  attachedTo: string | null;
};

export function TickFeed({ ticks, attachedTo }: Props) {
  if (ticks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Waiting for the world to tick...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-4 space-y-6">
      {ticks.map((tick, i) => (
        <TickEntry key={`${tick.tick}-${i}`} tick={tick} attachedTo={attachedTo} />
      ))}
    </div>
  );
}

function TickEntry({ tick, attachedTo }: { tick: TickData; attachedTo: string | null }) {
  return (
    <article className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-500">
      {/* Tick header */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary/70">
          Tick {tick.tick}
        </Badge>
        {tick.events.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {tick.events.map((evt, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {evt}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Narration */}
      <div className="text-sm leading-relaxed text-foreground/90 pl-2 border-l-2 border-primary/20 whitespace-pre-line">
        {tick.narration}
      </div>

      {/* Character activity */}
      <div className="space-y-2 pl-2">
        {Object.entries(tick.characters).map(([name, data]) => {
          if (!data) return null;
          const isAttached = name === attachedTo;

          return (
            <div key={name} className="space-y-1">
              {/* Dialogue */}
              {data.dialogue && (
                <div className="flex items-start gap-2">
                  <span className={`text-xs font-medium shrink-0 ${isAttached ? "text-primary" : "text-jade"}`}>
                    {name}:
                  </span>
                  <span className="text-sm text-emerald-400/90 italic">
                    "{data.dialogue}"
                  </span>
                </div>
              )}

              {/* Action (only for non-attached, narrator handles the rest) */}
              {!isAttached && data.action && (
                <div className="text-xs text-muted-foreground/60 pl-4">
                  *{data.action}*
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

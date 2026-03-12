import { motion, AnimatePresence } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { TickData } from "@/hooks/useGame";

type Props = {
  tickData?: TickData | null;
  pendingGuidance?: string | null;
  onClose?: () => void;
};

export function DirectorPanel({ tickData, pendingGuidance, onClose }: Props) {
  const characters = tickData?.characters ? Object.entries(tickData.characters) : [];
  const events = tickData?.events ?? [];

  return (
    <aside className="min-w-[280px] sm:min-w-[320px] h-full border-l border-border/50 bg-card/80 lg:bg-card/30 flex flex-col shrink-0 pt-12 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-amber-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 11l18-5v12L3 13v-2z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
            <h3 className="font-semibold text-sm text-amber-400">Scene</h3>
            {tickData && (
              <span className="text-[10px] font-mono text-muted-foreground/50">
                #{tickData.tick}
              </span>
            )}
          </div>
          {/* Close button - mobile only */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 -mr-1.5 text-muted-foreground hover:text-foreground transition-colors lg:hidden"
              aria-label="Close panel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Snapshot at this moment</p>
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={tickData?.tick ?? "empty"}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="p-4 space-y-4"
          >
            {/* Pending guidance */}
            {pendingGuidance && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <label className="text-[9px] uppercase tracking-wider text-amber-400/70">
                  Queued Guidance
                </label>
                <p className="text-xs mt-1 text-amber-400/90 italic">
                  "{pendingGuidance}"
                </p>
              </div>
            )}

            {/* Events */}
            {events.length > 0 && (
              <div>
                <label className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  Events
                </label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {events.map((evt, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">
                      {evt}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {events.length > 0 && characters.length > 0 && (
              <Separator className="bg-border/30" />
            )}

            {/* All characters at this tick */}
            {characters.length > 0 && (
              <div className="space-y-3">
                <label className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  Characters
                </label>
                {characters.map(([name, data]) => (
                  <div key={name} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                      <span className="text-xs font-medium text-foreground/90">{name}</span>
                    </div>
                    {data && (
                      <div className="ml-3.5 space-y-1">
                        {data.emotional_state && (
                          <p className="text-[10px] text-amber-400/70 italic">
                            {data.emotional_state}
                          </p>
                        )}
                        {data.action && (
                          <p className="text-[10px] text-muted-foreground/70 leading-snug">
                            {data.action}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!tickData && (
              <p className="text-xs text-muted-foreground/60 italic">
                Waiting for scene data...
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </ScrollArea>
    </aside>
  );
}

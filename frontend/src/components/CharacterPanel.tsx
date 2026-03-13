import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { CharacterTick } from "@/hooks/useGame";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type Props = {
  name: string;
  data?: CharacterTick;
  pendingInfluence?: string | null;
  streamingText?: string;
  onClose?: () => void;
  isPreview?: boolean;
};

/** Extract inner_thoughts from partial JSON stream */
function extractThoughtsFromStream(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  try {
    const match = raw.match(/"inner_thoughts"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
    if (match && match[1]) {
      return match[1]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  } catch {
    // Regex failed
  }
  return "";
}

export function CharacterPanel({ name, data, pendingInfluence, streamingText, onClose, isPreview }: Props) {
  const streamingThoughts = useMemo(
    () => extractThoughtsFromStream(streamingText || ""),
    [streamingText]
  );

  return (
    <aside className="min-w-[320px] h-full border-l border-border/50 bg-card/30 flex flex-col shrink-0 pt-12 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className={`font-semibold text-sm ${isPreview ? "text-muted-foreground" : "text-primary"}`}>
              {name}
            </h3>
            {isPreview && (
              <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">
                preview
              </span>
            )}
            {/* Influence badge - shows pending whisper */}
            {pendingInfluence && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="relative group/badge"
            >
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] bg-amber-500/20 text-amber-400 cursor-help">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                queued
              </span>
              <div className="absolute left-0 top-full mt-1.5 px-2 py-1.5 bg-popover border border-border rounded text-[10px] text-popover-foreground max-w-56 opacity-0 group-hover/badge:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg break-words">
                <span className="italic text-amber-400/80">"{pendingInfluence}"</span>
              </div>
              </motion.div>
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
        <p className="text-xs text-muted-foreground mt-1">Inner thoughts</p>
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-4">
          <AnimatePresence mode="wait">
            {data ? (
              <motion.div
                key="current"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="space-y-3"
              >
                {/* Emotional state */}
                {data.emotional_state && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                  >
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      Emotional State
                    </label>
                    <p className="text-xs mt-0.5 text-amber-400/80 italic break-words">
                      {data.emotional_state}
                    </p>
                  </motion.div>
                )}

                <Separator className="bg-border/30" />

                {/* Inner thoughts */}
                {data.inner_thoughts && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 }}
                  >
                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      Inner Thoughts
                    </label>
                    <motion.p
                      className="text-xs mt-0.5 text-foreground/80 leading-relaxed italic break-words"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.4 }}
                    >
                      {data.inner_thoughts}
                    </motion.p>
                  </motion.div>
                )}

                {/* Action - subtle, compact */}
                {data.action && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25 }}
                    className="pt-2"
                  >
                    <p className="text-[10px] text-muted-foreground/60 italic break-words leading-snug">
                      {data.action}
                    </p>
                  </motion.div>
                )}

                {/* Desires update */}
                {data.desires_update && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.35 }}
                  >
                    <Separator className="bg-border/30" />
                    <div className="mt-3">
                      <label className="text-[9px] uppercase tracking-wider text-muted-foreground">
                        Desires
                      </label>
                      <p className="text-xs mt-0.5 text-primary/70 italic break-words">
                        {data.desires_update}
                      </p>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ) : streamingThoughts ? (
              <motion.div
                key="streaming"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                <div>
                  <label className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    Inner Thoughts
                  </label>
                  <div className="text-xs mt-0.5 text-foreground/80 leading-relaxed italic break-words">
                    <span>{streamingThoughts}</span>
                    <motion.span
                      className="inline-block w-0.5 h-3 bg-amber-400/60 ml-0.5 align-middle"
                      animate={{ opacity: [1, 1, 0, 0] }}
                      transition={{ duration: 0.8, repeat: Infinity, times: [0, 0.45, 0.5, 1] }}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-muted-foreground"
              >
                Waiting for next tick...
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>

    </aside>
  );
}

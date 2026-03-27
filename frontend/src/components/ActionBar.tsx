import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";

type Props = {
  onSubmitInfluence: (text: string) => void;
  onSubmitDirector: (text: string) => void;
  attachedTo?: string | null;
  directorMode: boolean;
  pendingInfluence?: { character: string; text: string } | null;
  pendingDirectorGuidance?: string | null;
  isStreaming?: boolean;
  wideMode?: boolean;
  onNextPage?: () => void;
};

function firstName(name: string): string {
  return name.split(/[\s,]+/)[0];
}

export function ActionBar({
  onSubmitInfluence,
  onSubmitDirector,
  attachedTo,
  directorMode,
  pendingInfluence,
  pendingDirectorGuidance,
  isStreaming,
  wideMode,
  onNextPage,
}: Props) {
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(false);

  const prevInfluenceRef = useRef<string | null>(null);
  const justSubmittedRef = useRef<string | null>(null);
  useEffect(() => {
    const influenceText = pendingInfluence?.text ?? null;
    if (influenceText && influenceText !== prevInfluenceRef.current) {
      if (influenceText !== justSubmittedRef.current) {
        setValue(influenceText);
      }
      justSubmittedRef.current = null;
    }
    prevInfluenceRef.current = influenceText;
  }, [pendingInfluence]);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    let submitted = false;
    if (directorMode) {
      onSubmitDirector(text);
      submitted = true;
    } else if (attachedTo) {
      justSubmittedRef.current = text;
      onSubmitInfluence(text);
      submitted = true;
    }
    if (submitted) {
      setValue("");
      setFlash(true);
    }
  }, [value, directorMode, attachedTo, onSubmitInfluence, onSubmitDirector]);

  useEffect(() => {
    if (flash) {
      const timer = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(timer);
    }
  }, [flash]);

  if (!directorMode && !attachedTo) return null;

  const isDirector = directorMode;
  const shortName = attachedTo ? firstName(attachedTo) : "";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`border-t border-border/30 bg-card/20 px-3 py-2 sm:py-3 shrink-0 transition-colors ${
          flash ? (isDirector ? "bg-amber-500/10" : "bg-primary/10") : ""
        }`}
      >
        <div className={`mx-auto flex items-center gap-1.5 sm:gap-2 transition-all duration-300 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}>
          {/* Input with inline label */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={
                isDirector
                  ? "Direct the scene..."
                  : `Whisper to ${shortName}...`
              }
              className={`w-full pl-3 pr-3 py-2 sm:py-2.5 bg-secondary/30 border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 transition-all ${
                isDirector
                  ? "border-amber-500/20 focus:ring-amber-500/30 focus:border-amber-500/30"
                  : "border-border/30 focus:ring-primary/30 focus:border-primary/20"
              }`}
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!value.trim() && !pendingInfluence && !pendingDirectorGuidance}
            className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all disabled:opacity-30 shrink-0 ${
              isDirector
                ? "bg-amber-500/80 hover:bg-amber-500 text-black"
                : "bg-primary/80 hover:bg-primary text-primary-foreground"
            }`}
          >
            {isDirector ? "Direct" : "Whisper"}
          </button>

          {/* Next page - mobile only */}
          {onNextPage && (
            <button
              onClick={onNextPage}
              disabled={isStreaming}
              className="lg:hidden p-2 rounded-lg text-muted-foreground/40 hover:text-primary/70 bg-secondary/30 border border-border/20 transition-all disabled:opacity-20 shrink-0"
              aria-label="Next page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
        </div>

        {/* Pending indicator — compact single line */}
        <AnimatePresence>
          {(isDirector ? pendingDirectorGuidance : pendingInfluence) && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className={`mx-auto mt-1.5 text-[10px] text-muted-foreground/40 italic truncate transition-all duration-300 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}
            >
              {isDirector
                ? `Directing: "${pendingDirectorGuidance}"`
                : `Whispering to ${firstName(pendingInfluence!.character)}: "${pendingInfluence!.text}"`
              }
            </motion.p>
          )}
        </AnimatePresence>

        {/* Streaming indicator */}
        <AnimatePresence>
          {isStreaming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`mx-auto mt-1.5 flex items-center gap-1.5 transition-all duration-300 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}
            >
              <div className="flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full bg-primary/50"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground/30">generating...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

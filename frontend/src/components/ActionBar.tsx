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
};

export function ActionBar({
  onSubmitInfluence,
  onSubmitDirector,
  attachedTo,
  directorMode,
  pendingInfluence,
  pendingDirectorGuidance,
  isStreaming,
  wideMode,
}: Props) {
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(false);

  // Populate input with pending influence text so user can see/edit it
  const prevInfluenceRef = useRef<string | null>(null);
  useEffect(() => {
    const influenceText = pendingInfluence?.text ?? null;
    if (influenceText && influenceText !== prevInfluenceRef.current) {
      setValue(influenceText);
    }
    prevInfluenceRef.current = influenceText;
  }, [pendingInfluence]);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text) return;

    // Only clear and flash if we actually submitted something
    let submitted = false;
    if (directorMode) {
      onSubmitDirector(text);
      submitted = true;
    } else if (attachedTo) {
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

  // Show bar in either mode (director OR attached to character)
  if (!directorMode && !attachedTo) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`border-t border-border/50 bg-card/30 p-3 shrink-0 transition-colors ${
          flash ? (directorMode ? "bg-amber-500/10" : "bg-primary/10") : ""
        }`}
      >
        <div className={`mx-auto flex gap-2 transition-all duration-300 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}>
          {/* Mode indicator icon */}
          <div
            className={`px-3 py-2.5 rounded-lg flex items-center ${
              directorMode
                ? "bg-amber-500/20 text-amber-400"
                : "bg-primary/20 text-primary"
            }`}
          >
            {directorMode ? (
              // Director icon (megaphone)
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 11l18-5v12L3 13v-2z" />
                <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
              </svg>
            ) : (
              // Whisper icon (speech bubble)
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            )}
          </div>

          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={
              directorMode
                ? "Direct the scene... (e.g., 'make it rain', 'introduce tension')"
                : `Whisper to ${attachedTo}...`
            }
            className={`flex-1 px-4 py-2.5 bg-secondary/50 border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 transition-all ${
              directorMode
                ? "border-amber-500/30 focus:ring-amber-500/50 focus:border-amber-500/40"
                : "border-border/50 focus:ring-primary/50 focus:border-primary/30"
            }`}
          />

          <button
            onClick={handleSubmit}
            disabled={!value.trim()}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-30 ${
              directorMode
                ? "bg-amber-500/80 hover:bg-amber-500 text-black hover:shadow-[0_0_20px_oklch(0.7_0.15_80_/_0.3)]"
                : "bg-primary/80 hover:bg-primary text-primary-foreground hover:shadow-[0_0_20px_oklch(0.65_0.22_340_/_0.2)]"
            }`}
          >
            {directorMode ? "Direct" : "Whisper"}
          </button>
        </div>

        {/* Pending guidance indicator */}
        {pendingDirectorGuidance && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className={`mx-auto mt-2 text-xs text-amber-400/70 italic transition-all duration-300 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}
          >
            Queued: "{pendingDirectorGuidance}" — takes effect next page
          </motion.div>
        )}

        {/* Characters responding indicator */}
        <AnimatePresence>
          {isStreaming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`mx-auto mt-2 flex items-center gap-2 transition-all duration-300 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}
            >
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full bg-primary/50"
                    animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground/40">characters responding...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

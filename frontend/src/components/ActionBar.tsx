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
}: Props) {
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(false);

  // prevInfluenceRef tracks the last seen pendingInfluence text so we can detect
  // when the parent sets a genuinely new pending whisper (e.g. another character
  // was tapped) and pre-populate the input with that suggested text.
  const prevInfluenceRef = useRef<string | null>(null);
  // justSubmittedRef records the text the user just sent so we can skip
  // re-populating the input if the parent echoes the same text back as
  // pendingInfluence — without this guard, submitting would immediately
  // refill the input with the text the user already sent.
  const justSubmittedRef = useRef<string | null>(null);
  useEffect(() => {
    const influenceText = pendingInfluence?.text ?? null;
    if (influenceText && influenceText !== prevInfluenceRef.current) {
      // Only pre-populate when the incoming text differs from what we just
      // submitted; avoids fighting the user's cleared input after a send.
      if (influenceText !== justSubmittedRef.current) {
        setValue(influenceText);
      }
      justSubmittedRef.current = null;
    }
    prevInfluenceRef.current = influenceText;
  }, [pendingInfluence]);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    // Intentionally allows blank submit when there is a pending whisper/direction —
    // the backend interprets an empty whisper/director command as a clear request
    // and responds with influence_cleared / director_cleared WS messages.
    let submitted = false;
    if (directorMode) {
      onSubmitDirector(text);
      submitted = true;
    } else if (attachedTo) {
      // Record what we're about to send so the useEffect above can skip
      // re-populating the input when the parent reflects it back as pending.
      justSubmittedRef.current = text;
      onSubmitInfluence(text);
      submitted = true;
    }
    if (submitted) {
      // Submitting with an empty string is intentional: it lets the user
      // clear a pending whisper or director guidance without sending new text.
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

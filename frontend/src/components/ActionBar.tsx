import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

type Props = {
  onSubmit: (text: string) => void;
  attachedTo?: string | null;
};

export function ActionBar({ onSubmit, attachedTo }: Props) {
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(false);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text || !attachedTo) return;
    onSubmit(text);
    setValue("");
    setFlash(true);
  }, [value, onSubmit, attachedTo]);

  useEffect(() => {
    if (flash) {
      const timer = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(timer);
    }
  }, [flash]);

  // Only show when attached
  if (!attachedTo) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={`border-t border-border/50 bg-card/30 p-3 shrink-0 transition-colors ${flash ? "bg-primary/10" : ""}`}
      >
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={`Whisper to ${attachedTo}... (influences their next action)`}
            className="flex-1 px-4 py-2.5 bg-secondary/50 border border-border/50 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/30 transition-all"
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="px-4 py-2.5 bg-primary/80 hover:bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:hover:bg-primary/80 hover:shadow-[0_0_20px_oklch(0.65_0.22_340_/_0.2)]"
          >
            Whisper
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

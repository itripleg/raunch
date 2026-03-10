import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { TickData } from "@/hooks/useGame";
import { Badge } from "@/components/ui/badge";

/** Format timestamp elegantly - relative for recent, time for older */
function formatTimestamp(timestamp?: string | number): string {
  if (!timestamp) return "";

  const date = typeof timestamp === "string"
    ? new Date(timestamp.includes("T") ? timestamp : timestamp + "Z")
    : new Date(timestamp);

  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  // Relative time for recent
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;

  // Time format for older
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Kink/intensity words that should pulse with color
const INTENSITY_WORDS: Record<string, "hot" | "warm" | "primal"> = {
  // Primal/breeding (deep rose/red)
  breed: "primal", breeding: "primal", bred: "primal", impregnate: "primal",
  pregnant: "primal", fertility: "primal", fertile: "primal", womb: "primal",
  seed: "primal", knocked: "primal", belly: "primal", swollen: "primal",
  // Hot/crude (warm amber)
  cock: "hot", cunt: "hot", pussy: "hot", fuck: "hot", fucking: "hot",
  fucked: "hot", cum: "hot", cumming: "hot", dick: "hot", tits: "hot",
  ass: "hot", slut: "hot", whore: "hot", hole: "hot", wet: "hot",
  dripping: "hot", throb: "hot", throbbing: "hot", ache: "hot", aching: "hot",
  // Warm/sensual (soft coral)
  moan: "warm", moaning: "warm", gasp: "warm", gasping: "warm",
  shudder: "warm", tremble: "warm", trembling: "warm", quiver: "warm",
  pleasure: "warm", desire: "warm", need: "warm", wanting: "warm",
  desperate: "warm", hunger: "warm", hungry: "warm", bury: "warm",
  deep: "warm", deeper: "warm", tight: "warm", spread: "warm",
};

// Actual color values for animation (Tailwind can't be animated)
const INTENSITY_COLORS = {
  primal: "#fb7185", // rose-400
  hot: "#fbbf24",    // amber-400
  warm: "#fdba74cc", // orange-300/80
};

/** Parse text into segments: plain text, dialogue, and intensity words */
function parseNarration(text: string) {
  const segments: Array<
    | { type: "text"; content: string }
    | { type: "dialogue"; content: string }
    | { type: "intensity"; content: string; level: "hot" | "warm" | "primal" }
  > = [];

  // First, split by dialogue quotes
  const dialogueRegex = /(["""])((?:[^"""])*?)(["""])/g;
  let lastIndex = 0;
  let match;

  while ((match = dialogueRegex.exec(text)) !== null) {
    // Process text before dialogue
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      segments.push(...parseIntensityWords(beforeText));
    }
    // Add dialogue segment
    segments.push({ type: "dialogue", content: match[0] });
    lastIndex = match.index + match[0].length;
  }

  // Process remaining text
  if (lastIndex < text.length) {
    segments.push(...parseIntensityWords(text.slice(lastIndex)));
  }

  return segments;
}

// Grammar words that intensify when paired with crude words
const PRONOUNS = new Set([
  'her', 'his', 'my', 'your', 'me', 'him', 'them', 'she', 'he', 'i', 'you',
  'hers', 'herself', 'himself', 'myself', 'yourself', 'themselves',
]);
const PREPOSITIONS = new Set([
  'inside', 'into', 'in', 'on', 'against', 'beneath', 'under', 'over',
  'through', 'between', 'around', 'behind', 'onto', 'upon', 'within',
]);

/** Parse plain text for intensity phrases (crude word + surrounding grammar) */
function parseIntensityWords(text: string) {
  const segments: Array<
    | { type: "text"; content: string }
    | { type: "intensity"; content: string; level: "hot" | "warm" | "primal" }
  > = [];

  // Build pattern: (prep)? (pron)? INTENSITY (pron|prep)? (pron)?
  const intensityWordPattern = Object.keys(INTENSITY_WORDS).join('|');
  const pronPattern = Array.from(PRONOUNS).join('|');
  const prepPattern = Array.from(PREPOSITIONS).join('|');

  // Match intensity phrases with optional surrounding grammar
  const phraseRegex = new RegExp(
    `\\b(?:(${prepPattern})\\s+)?(?:(${pronPattern})\\s+)?(${intensityWordPattern})(?:\\s+(${pronPattern}|${prepPattern}))?(?:\\s+(${pronPattern}))?\\b`,
    'gi'
  );

  let lastIndex = 0;
  let match;

  while ((match = phraseRegex.exec(text)) !== null) {
    const [fullMatch, prep, pronBefore, intensityWord, afterWord, pronAfter] = match;
    const level = INTENSITY_WORDS[intensityWord.toLowerCase()];

    if (level) {
      // Add text before this phrase
      if (match.index > lastIndex) {
        segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
      }
      // Add the full intensity phrase
      segments.push({ type: "intensity", content: fullMatch, level });
      lastIndex = match.index + fullMatch.length;
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  } else if (segments.length === 0) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

/** Animated intensity word that pulses to color after delay */
function IntensityWord({ word, level, delay }: { word: string; level: "hot" | "warm" | "primal"; delay: number }) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimate(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <motion.span
      initial={{ color: "inherit" }}
      animate={{ color: animate ? INTENSITY_COLORS[level] : "inherit" }}
      transition={{ duration: 2.5, ease: [0.4, 0, 0.2, 1] }}
      style={{ display: "inline" }}
    >
      {word}
    </motion.span>
  );
}

/** Highlights dialogue and animates intensity words */
function NarrationText({ text, isNew = false }: { text: string; isNew?: boolean }) {
  const segments = useMemo(() => parseNarration(text), [text]);

  // Calculate reading-based delays
  // ~200 words per minute relaxed reading = ~300ms per word
  // Add extra pause to let eyes settle first
  const baseDelay = isNew ? 3000 : 0;
  const msPerChar = 25; // Relaxed reading pace (~240 wpm)

  // Track character position for reading-time estimation
  let charPosition = 0;

  return (
    <>
      {segments.map((seg, i) => {
        const segmentStart = charPosition;
        charPosition += seg.content.length;

        if (seg.type === "dialogue") {
          return (
            <span key={i} className="text-emerald-400/50 italic">
              {seg.content}
            </span>
          );
        } else if (seg.type === "intensity") {
          // Delay based on when reader would reach this word
          const readingDelay = segmentStart * msPerChar;
          const delay = baseDelay + readingDelay;
          return (
            <IntensityWord key={i} word={seg.content} level={seg.level} delay={delay} />
          );
        } else {
          return <span key={i}>{seg.content}</span>;
        }
      })}
    </>
  );
}

type Props = {
  ticks: TickData[];
  attachedTo: string | null;
  autoScroll?: boolean;
  focusedTick?: number | null;
  onTickFocus?: (tickNum: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
};

export function TickFeed({ ticks, attachedTo, autoScroll = false, focusedTick, onTickFocus, containerRef }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const tickRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [newestTick, setNewestTick] = useState<number | null>(null);

  // Track the newest tick for animation purposes
  useEffect(() => {
    if (ticks.length > 0) {
      const latest = ticks[ticks.length - 1].tick;
      setNewestTick(latest);
    }
  }, [ticks]);

  // Register tick element refs
  const setTickRef = useCallback((tickNum: number, el: HTMLElement | null) => {
    if (el) {
      tickRefs.current.set(tickNum, el);
    } else {
      tickRefs.current.delete(tickNum);
    }
  }, []);

  // Find which tick is most centered in the viewport
  useEffect(() => {
    const container = containerRef?.current;
    if (!container || !onTickFocus) return;

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;

      let closestTick: number | null = null;
      let closestDistance = Infinity;

      tickRefs.current.forEach((el, tickNum) => {
        const rect = el.getBoundingClientRect();
        const elCenter = rect.top + rect.height / 2;
        const distance = Math.abs(elCenter - containerCenter);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestTick = tickNum;
        }
      });

      if (closestTick !== null) {
        onTickFocus(closestTick);
      }
    };

    // Initial check
    handleScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, onTickFocus, ticks.length]);

  // Only auto-scroll if enabled
  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [ticks.length, autoScroll]);

  if (ticks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <motion.div
            className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full mx-auto"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-muted-foreground text-sm">Waiting for the world to tick...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-4 space-y-6">
      <AnimatePresence mode="popLayout">
        {ticks.map((tick) => (
          <TickEntry
            key={tick.tick}
            tick={tick}
            attachedTo={attachedTo}
            isFocused={focusedTick === tick.tick}
            isNew={tick.tick === newestTick}
            setRef={(el) => setTickRef(tick.tick, el)}
          />
        ))}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}

type TickEntryProps = {
  tick: TickData;
  attachedTo: string | null;
  isFocused: boolean;
  isNew: boolean;
  setRef: (el: HTMLElement | null) => void;
};

function TickEntry({ tick, attachedTo, isFocused, isNew, setRef }: TickEntryProps) {
  const localRef = useRef<HTMLElement>(null);
  const [firstRevealDone, setFirstRevealDone] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  // Combine refs
  const handleRef = useCallback((el: HTMLElement | null) => {
    (localRef as React.MutableRefObject<HTMLElement | null>).current = el;
    setRef(el);
  }, [setRef]);

  // Handle first hover to trigger staggered reveal
  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    if (!firstRevealDone && tick.events.length > 0) {
      setIsRevealing(true);
      // Mark reveal done after stagger completes
      const staggerDuration = tick.events.length * 200 + 150;
      setTimeout(() => {
        setFirstRevealDone(true);
        setIsRevealing(false);
      }, staggerDuration);
    }
  }, [firstRevealDone, tick.events.length]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
  }, []);

  return (
    <motion.article
      ref={handleRef}
      layout
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94],
        layout: { duration: 0.3 }
      }}
      className={`space-y-3 transition-all duration-200 ${
        isFocused
          ? "relative before:absolute before:-left-4 before:top-0 before:bottom-0 before:w-1 before:bg-primary before:rounded-full"
          : ""
      }`}
    >
      {/* Timestamp header */}
      <motion.div
        className="flex items-center gap-2"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        <span
          className={`text-[10px] font-mono transition-colors duration-200 cursor-default ${
            isFocused ? "text-primary/80" : "text-muted-foreground/60"
          }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {formatTimestamp(tick.created_at)}
        </span>
        {tick.events.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {tick.events.map((evt, i) => (
              <motion.div
                key={i}
                initial={false}
                animate={{
                  opacity: isHovering ? 1 : 0,
                  scale: isHovering ? 1 : 0.95,
                }}
                transition={{
                  duration: 0.12,
                  // Stagger only on first reveal, instant after
                  delay: isRevealing ? i * 0.2 : 0,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <Badge variant="secondary" className="text-[10px]">
                  {evt}
                </Badge>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Narration with highlighted dialogue and intensity words */}
      <motion.div
        className="text-sm leading-relaxed text-foreground/90 pl-2 border-l-2 border-primary/20 whitespace-pre-line"
        initial={{ opacity: 0, x: -5 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <NarrationText text={tick.narration} isNew={isNew} />
      </motion.div>

      {/* Character dialogue (main character only - NPCs are in narration) */}
      <div className="space-y-2 pl-2">
        {Object.entries(tick.characters).map(([name, data]) => {
          if (!data?.dialogue) return null;
          const isAttached = name === attachedTo;

          // Only show attached character's dialogue here (NPCs handled by narrator)
          if (!isAttached) return null;

          return (
            <div key={name} className="flex items-start gap-2">
              <span className="text-xs text-muted-foreground shrink-0">
                {name}:
              </span>
              <span className="text-sm italic text-emerald-400">
                "{data.dialogue}"
              </span>
            </div>
          );
        })}
      </div>
    </motion.article>
  );
}

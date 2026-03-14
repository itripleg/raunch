import { useRef, useEffect, useCallback, useMemo, useState, Fragment } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { TickData, StreamingState } from "@/hooks/useGame";
import { Badge } from "@/components/ui/badge";

// ═══════════════════════════════════════════════════════════════════════════
// PREMIUM NARRATION FEED - Immersive storytelling experience
// ═══════════════════════════════════════════════════════════════════════════

/** Extract character fields from raw unparsed JSON */
function extractCharacterFromRaw(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;

  // If data is already parsed, return as-is
  if (data.inner_thoughts || data.action || data.dialogue) {
    return data;
  }

  // Check for raw field that needs parsing
  const raw = data.raw as string | undefined;
  if (!raw || typeof raw !== "string") return data;

  const extracted: Record<string, unknown> = { ...data };

  try {
    let text = raw;
    if (text.includes("```json")) text = text.split("```json")[1] || text;
    if (text.includes("```")) text = text.split("```")[0] || text;

    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      const parsed = JSON.parse(text.slice(first, last + 1));
      Object.assign(extracted, parsed);
    }
  } catch {
    // Regex fallback
    const extractField = (field: string): string | undefined => {
      const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s"));
      return match?.[1]?.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    };
    extracted.inner_thoughts = extractField("inner_thoughts");
    extracted.action = extractField("action");
    extracted.dialogue = extractField("dialogue");
    extracted.emotional_state = extractField("emotional_state");
  }

  return extracted;
}

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

// Glow effects for intensity words (used in text-shadow)
const INTENSITY_GLOW = {
  primal: "0 0 12px rgba(251, 113, 133, 0.6), 0 0 24px rgba(251, 113, 133, 0.3)",
  hot: "0 0 10px rgba(251, 191, 36, 0.5), 0 0 20px rgba(251, 191, 36, 0.25)",
  warm: "0 0 8px rgba(253, 186, 116, 0.4)",
};

// Mood-based accent colors for atmosphere
const MOOD_COLORS: Record<string, { border: string; glow: string }> = {
  anticipation: { border: "border-rose-500/30", glow: "shadow-rose-500/20" },
  tension: { border: "border-amber-500/30", glow: "shadow-amber-500/20" },
  passion: { border: "border-pink-500/40", glow: "shadow-pink-500/30" },
  desire: { border: "border-red-400/35", glow: "shadow-red-400/25" },
  tenderness: { border: "border-violet-400/30", glow: "shadow-violet-400/20" },
  climax: { border: "border-rose-400/50", glow: "shadow-rose-400/40" },
  afterglow: { border: "border-amber-300/25", glow: "shadow-amber-300/15" },
  default: { border: "border-primary/20", glow: "" },
};

// Character colors for distinct dialogue styling
const CHARACTER_COLORS = [
  { text: "text-emerald-400", quote: "text-emerald-400/70" },
  { text: "text-violet-400", quote: "text-violet-400/70" },
  { text: "text-amber-400", quote: "text-amber-400/70" },
  { text: "text-cyan-400", quote: "text-cyan-400/70" },
  { text: "text-rose-400", quote: "text-rose-400/70" },
  { text: "text-lime-400", quote: "text-lime-400/70" },
];

// Decorative scene break patterns
const SCENE_BREAKS = [
  "· · ·  ✧  · · ·",
  "─────  ❧  ─────",
  "╌╌╌  ♡  ╌╌╌",
  "·  ·  ·",
];

/** Parse text into segments: plain text, dialogue, and intensity words */
function parseNarration(text: string) {
  const segments: Array<
    | { type: "text"; content: string }
    | { type: "dialogue"; content: string }
    | { type: "intensity"; content: string; level: "hot" | "warm" | "primal" }
  > = [];

  // First, split by dialogue quotes (double quotes only - straight or curly)
  const dialogueRegex = /(["""])((?:[^"""])*?)(["""])/g;
  let lastIndex = 0;
  let match;

  while ((match = dialogueRegex.exec(text)) !== null) {
    // Process text before dialogue
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      segments.push(...parseIntensityWords(beforeText));
    }
    // Add dialogue segment (match[0] is the full match regardless of which alternation)
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
    const [fullMatch, , , intensityWord] = match;
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

/** Animated intensity word that pulses to color with glow after delay */
function IntensityWord({ word, level, delay }: { word: string; level: "hot" | "warm" | "primal"; delay: number }) {
  const [animate, setAnimate] = useState(false);
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    const colorTimer = setTimeout(() => setAnimate(true), delay);
    // Glow comes slightly after color for dramatic effect
    const glowTimer = setTimeout(() => setGlowing(true), delay + 800);
    return () => {
      clearTimeout(colorTimer);
      clearTimeout(glowTimer);
    };
  }, [delay]);

  return (
    <motion.span
      initial={{ color: "inherit" }}
      animate={{
        color: animate ? INTENSITY_COLORS[level] : "inherit",
      }}
      transition={{ duration: 2.5, ease: [0.4, 0, 0.2, 1] }}
      style={{
        display: "inline",
        textShadow: glowing ? INTENSITY_GLOW[level] : "none",
        transition: "text-shadow 1.5s ease-out",
      }}
    >
      {word}
    </motion.span>
  );
}

/** Word-by-word typewriter reveal for new narration */
function TypewriterText({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount < words.length) {
      // Variable timing: faster for short words/spaces, slower for long words
      const currentWord = words[visibleCount] || "";
      const isSpace = /^\s+$/.test(currentWord);
      const baseDelay = isSpace ? 10 : 35;
      const lengthBonus = Math.min(currentWord.length * 3, 30);

      const timer = setTimeout(() => {
        setVisibleCount(visibleCount + 1);
      }, baseDelay + lengthBonus);

      return () => clearTimeout(timer);
    } else if (onComplete) {
      onComplete();
    }
  }, [visibleCount, words, onComplete]);

  return (
    <span>
      {words.slice(0, visibleCount).join("")}
      {visibleCount < words.length && (
        <span
          className="inline-block w-0.5 h-4 bg-primary/60 ml-0.5 align-middle rounded-sm animate-pulse"
        />
      )}
    </span>
  );
}

/** Highlights dialogue and animates intensity words */
function NarrationText({ text, isNew = false, useTypewriter = false }: { text: string; isNew?: boolean; useTypewriter?: boolean }) {
  const segments = useMemo(() => parseNarration(text), [text]);
  const [typewriterComplete, setTypewriterComplete] = useState(!useTypewriter);

  // Calculate reading-based delays
  // ~200 words per minute relaxed reading = ~300ms per word
  // Add extra pause to let eyes settle first
  const baseDelay = isNew ? 3000 : 0;
  const msPerChar = 25; // Relaxed reading pace (~240 wpm)

  // Track character position for reading-time estimation
  let charPosition = 0;

  // Typewriter mode: show raw text first, then apply formatting
  if (useTypewriter && !typewriterComplete) {
    return (
      <TypewriterText
        text={text}
        onComplete={() => setTypewriterComplete(true)}
      />
    );
  }

  return (
    <>
      {segments.map((seg, i) => {
        const segmentStart = charPosition;
        charPosition += seg.content.length;

        if (seg.type === "dialogue") {
          return (
            <motion.span
              key={i}
              initial={useTypewriter ? { opacity: 0.7 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
              className="text-emerald-400/60 italic"
              style={{
                textShadow: "0 0 20px rgba(52, 211, 153, 0.15)",
              }}
            >
              {seg.content}
            </motion.span>
          );
        } else if (seg.type === "intensity") {
          // Delay based on when reader would reach this word
          const readingDelay = segmentStart * msPerChar;
          const delay = useTypewriter ? 500 + i * 100 : baseDelay + readingDelay;
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

/** Get consistent color for a character name */
function getCharacterColor(name: string, allNames: string[]) {
  const index = allNames.indexOf(name);
  return CHARACTER_COLORS[index % CHARACTER_COLORS.length];
}

/** Decorative scene break between major moments */
function SceneBreak({ variant = 0 }: { variant?: number }) {
  const pattern = SCENE_BREAKS[variant % SCENE_BREAKS.length];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex items-center justify-center py-4"
    >
      <span className="text-muted-foreground/30 text-sm tracking-[0.5em] font-light">
        {pattern}
      </span>
    </motion.div>
  );
}

/** Grand opening for the first tick - special treatment */
function OpeningScene({ tick, children }: { tick: TickData; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.2, ease: "easeOut" }}
      className="relative"
    >
      {/* Atmospheric header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3 }}
        className="text-center mb-8 space-y-2"
      >
        <div className="text-xs uppercase tracking-[0.4em] text-primary/50 font-medium">
          Scene One
        </div>
        {tick.events.length > 0 && (
          <div className="flex justify-center gap-2 flex-wrap">
            {tick.events.map((evt, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.15, duration: 0.4 }}
                className="text-[10px] text-muted-foreground/60 px-2 py-0.5 rounded-full border border-muted-foreground/20"
              >
                {evt}
              </motion.span>
            ))}
          </div>
        )}
      </motion.div>

      {/* The actual content with dramatic entrance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.6 }}
      >
        {children}
      </motion.div>

      {/* Decorative flourish after opening */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 1 }}
        className="mt-8"
      >
        <SceneBreak variant={0} />
      </motion.div>
    </motion.div>
  );
}

type Props = {
  ticks: TickData[];
  attachedTo: string | null;
  autoScroll?: boolean;
  focusedTick?: number | null;
  onTickFocus?: (tickNum: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  streaming?: StreamingState;
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
  wideMode?: boolean;
  mood?: string;
};

export function TickFeed({ ticks, attachedTo, autoScroll = false, focusedTick, onTickFocus, containerRef, streaming, onHoverCharacter, onTapCharacter, wideMode, mood = "anticipation" }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const tickRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Track which tick was streamed so we don't re-animate it when finalized
  const streamedTickRef = useRef<number | null>(null);
  if (streaming?.isStreaming && streaming.tick) {
    streamedTickRef.current = streaming.tick;
  }

  // Track newest tick synchronously (not in effect) so isNew works on first render
  const newestTick = useMemo(() => {
    return ticks.length > 0 ? ticks[ticks.length - 1].tick : null;
  }, [ticks]);

  // Get all character names for consistent coloring
  const allCharacterNames = useMemo(() => {
    const names = new Set<string>();
    ticks.forEach(tick => {
      Object.keys(tick.characters).forEach(name => names.add(name));
    });
    return Array.from(names);
  }, [ticks]);

  // Get mood-based styling
  const moodStyle = MOOD_COLORS[mood] || MOOD_COLORS.default;

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

  // Determine if we should show scene breaks (when there's a significant gap or mood change)
  const shouldShowSceneBreak = (index: number) => {
    if (index === 0) return false;
    const current = ticks[index];
    // Show break every 4 ticks or when events indicate a scene change
    const eventIndicatesBreak = current.events.some(e =>
      e.toLowerCase().includes("scene") ||
      e.toLowerCase().includes("later") ||
      e.toLowerCase().includes("transition")
    );
    return eventIndicatesBreak || (index % 4 === 0);
  };

  return (
    <div className={`mx-auto px-4 sm:px-6 py-4 space-y-6 transition-all duration-300 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}>
      <AnimatePresence mode="popLayout">
        {ticks.map((tick, index) => {
          const isFirst = index === 0;
          const isNewest = tick.tick === newestTick;
          const showBreak = shouldShowSceneBreak(index);

          const entry = (
            <TickEntry
              key={tick.tick}
              tick={tick}
              attachedTo={attachedTo}
              isFocused={focusedTick === tick.tick}
              isNew={isNewest}
              isFirst={isFirst}
              wasStreamed={tick.tick === streamedTickRef.current}
              setRef={(el) => setTickRef(tick.tick, el)}
              onHoverCharacter={onHoverCharacter}
              onTapCharacter={onTapCharacter}
              characterNames={allCharacterNames}
              moodStyle={moodStyle}
            />
          );

          // Wrap first tick in OpeningScene for grand entrance
          if (isFirst) {
            return (
              <OpeningScene key={`opening-${tick.tick}`} tick={tick}>
                {entry}
              </OpeningScene>
            );
          }

          return (
            <Fragment key={tick.tick}>
              {showBreak && <SceneBreak variant={index} />}
              {entry}
            </Fragment>
          );
        })}
      </AnimatePresence>

      {/* Currently streaming tick */}
      {streaming?.isStreaming && (
        <StreamingTickEntry streaming={streaming} characterNames={allCharacterNames} />
      )}

      <div ref={endRef} />
    </div>
  );
}

type TickEntryProps = {
  tick: TickData;
  attachedTo: string | null;
  isFocused: boolean;
  isNew: boolean;
  isFirst?: boolean;
  wasStreamed?: boolean;
  setRef: (el: HTMLElement | null) => void;
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
  characterNames: string[];
  moodStyle: { border: string; glow: string };
};

function TickEntry({ tick, attachedTo: _attachedTo, isFocused, isNew, isFirst, wasStreamed, setRef, onHoverCharacter, onTapCharacter, characterNames, moodStyle }: TickEntryProps) {
  const localRef = useRef<HTMLElement>(null);
  const [firstRevealDone, setFirstRevealDone] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  // Use typewriter effect only for newest non-streamed ticks (dramatic reveal)
  const useTypewriter = isNew && !wasStreamed && !isFirst;

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

  // Skip entrance animation if this tick was just streamed (prevents jarring re-render)
  const skipAnimation = wasStreamed;

  return (
    <motion.article
      ref={handleRef}
      layout
      initial={skipAnimation ? false : { opacity: 0, y: 20, scale: 0.98 }}
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
        initial={skipAnimation ? false : { opacity: 0, x: -10 }}
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
        className={`text-sm leading-relaxed text-foreground/90 pl-3 border-l-2 ${moodStyle.border} whitespace-pre-line`}
        initial={skipAnimation ? false : { opacity: 0, x: -5 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <NarrationText
          text={tick.narration}
          isNew={isNew && !skipAnimation}
          useTypewriter={useTypewriter}
        />
      </motion.div>

      {/* Character dialogue (speech) shown here - actions/thoughts go to CharacterPanel */}
      {Object.entries(tick.characters).some(([, rawData]) => {
        const data = extractCharacterFromRaw(rawData as Record<string, unknown>);
        return data?.dialogue;
      }) && (
        <div className="space-y-3 pl-3 mt-4">
          {Object.entries(tick.characters).map(([name, rawData], charIndex) => {
            const data = extractCharacterFromRaw(rawData as Record<string, unknown>);
            if (!data?.dialogue) return null;
            const colors = getCharacterColor(name, characterNames);

            return (
              <motion.div
                key={name}
                initial={skipAnimation ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + charIndex * 0.15, duration: 0.4 }}
                className="text-sm relative"
              >
                {/* Character name with distinct color */}
                <span
                  className={`text-xs font-semibold ${colors.text} hover:brightness-125 cursor-pointer transition-all`}
                  onMouseEnter={() => onHoverCharacter?.(name)}
                  onMouseLeave={() => onHoverCharacter?.(null)}
                  onClick={() => onTapCharacter?.(name)}
                  style={{ textShadow: `0 0 12px currentColor` }}
                >
                  {name}
                </span>

                {/* Dialogue with matching accent and elegant quotes */}
                <span className="text-muted-foreground/50 mx-1">—</span>
                <span className={`italic ${colors.quote}`}>
                  <span className="text-muted-foreground/30 not-italic">"</span>
                  {data.dialogue as string}
                  <span className="text-muted-foreground/30 not-italic">"</span>
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.article>
  );
}

/** Extract narration text from partial or complete JSON stream */
function extractNarrationFromStream(raw: string): string {
  if (!raw || typeof raw !== "string") return "";

  try {
    // Strip markdown code fences (```json ... ``` or just ```)
    let text = raw
      .replace(/^[\s\S]*?```json\s*/i, "")  // Strip everything up to and including ```json
      .replace(/```[\s\S]*$/i, "")           // Strip ``` and everything after
      .trim();

    // If no fences were found, use original
    if (text === raw.trim()) {
      text = raw.trim();
    }

    // Try to parse as complete JSON first (most reliable when narrator is done)
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.narration === "string") {
        return parsed.narration;
      }
    } catch {
      // Not complete JSON yet, fall through to regex
    }

    // Regex for partial JSON: "narration": "content...
    // Use DOTALL-like matching with [\s\S] to handle newlines in pretty-printed JSON
    const match = text.match(/"narration"\s*:\s*"((?:[^"\\]|\\[\s\S])*)(?:"|$)/);
    if (match && match[1]) {
      return match[1]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  } catch {
    // Extraction failed
  }
  return "";
}

/** Extract dialogue from character's streaming JSON */
function extractDialogueFromStream(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    // Try complete JSON parse first
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.dialogue === "string") {
        return parsed.dialogue;
      }
    } catch { /* fall through */ }

    // Regex for partial/complete
    const match = raw.match(/"dialogue"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/);
    if (match && match[1]) {
      return match[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  } catch { /* extraction failed */ }
  return null;
}

/** Enhanced streaming cursor with glow effect */
function StreamingCursor() {
  return (
    <span
      className="inline-block w-0.5 h-4 ml-0.5 align-middle rounded-sm"
      style={{
        background: "linear-gradient(to bottom, hsl(var(--primary)), hsl(var(--primary) / 0.6))",
        animation: "streaming-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        boxShadow: "0 0 12px hsl(var(--primary) / 0.6), 0 0 24px hsl(var(--primary) / 0.3)",
      }}
    />
  );
}

/** Streaming tick entry - smooth word-by-word display */
function StreamingTickEntry({ streaming, characterNames = [] }: { streaming: StreamingState; characterNames?: string[] }) {
  // Defensive checks to prevent crashes
  if (!streaming || !streaming.isStreaming || !streaming.tick) return null;

  // Extract narration continuously
  const cleanNarration = extractNarrationFromStream(streaming.narrator || "");

  // Extract dialogue from completed characters
  const completedDialogues = useMemo(() => {
    const dialogues: Array<{ name: string; dialogue: string }> = [];
    for (const charName of streaming.charactersDone) {
      const rawText = streaming.characters[charName];
      if (rawText) {
        const dialogue = extractDialogueFromStream(rawText);
        if (dialogue) {
          dialogues.push({ name: charName, dialogue });
        }
      }
    }
    return dialogues;
  }, [streaming.charactersDone, streaming.characters]);

  const isNarratorDone = streaming.narratorDone;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-3"
    >
      {/* Header with streaming indicator - enhanced pulsing dots */}
      <div className="flex items-center gap-2">
        {!isNarratorDone ? (
          <div className="flex gap-1.5 items-center">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-lg shadow-primary/50" />
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-lg shadow-primary/40 [animation-delay:200ms]" />
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-lg shadow-primary/30 [animation-delay:400ms]" />
            <span className="text-[10px] text-muted-foreground/40 ml-2 uppercase tracking-wider">
              narrating
            </span>
          </div>
        ) : (
          <span className="text-[10px] font-mono text-muted-foreground/60">
            just now
          </span>
        )}
      </div>

      {/* Narration - with color formatting and enhanced cursor */}
      {cleanNarration && (
        <div className="text-sm leading-relaxed text-foreground/90 pl-3 border-l-2 border-primary/30 whitespace-pre-wrap">
          <NarrationText text={cleanNarration} isNew={false} />
          {!isNarratorDone && <StreamingCursor />}
        </div>
      )}

      {/* Character dialogue - shown as each completes with character colors */}
      {completedDialogues.length > 0 && (
        <div className="space-y-3 pl-3 mt-4">
          {completedDialogues.map(({ name, dialogue }) => {
            const colors = getCharacterColor(name, characterNames);
            return (
              <motion.div
                key={name}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="text-sm"
              >
                <span
                  className={`text-xs font-semibold ${colors.text}`}
                  style={{ textShadow: `0 0 12px currentColor` }}
                >
                  {name}
                </span>
                <span className="text-muted-foreground/50 mx-1">—</span>
                <span className={`italic ${colors.quote}`}>
                  <span className="text-muted-foreground/30 not-italic">"</span>
                  {dialogue}
                  <span className="text-muted-foreground/30 not-italic">"</span>
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Still processing characters indicator */}
      {streaming.narratorDone && streaming.charactersDone.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 pl-3 mt-3"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-pulse shadow-sm shadow-violet-400/30" />
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">
            characters responding...
          </span>
        </motion.div>
      )}
    </motion.article>
  );
}

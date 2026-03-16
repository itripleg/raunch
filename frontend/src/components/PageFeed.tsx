import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { PageData, StreamingState } from "@/hooks/useGame";

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

  let date: Date;
  if (typeof timestamp === "string") {
    // Ensure UTC parsing: add Z if ISO format without explicit timezone
    let ts = timestamp;
    if (ts.includes("T") && !/[Z+-]/.test(ts.slice(-6))) {
      ts = ts + "Z";
    } else if (!ts.includes("T")) {
      ts = ts.replace(" ", "T") + "Z";
    }
    date = new Date(ts);
  } else {
    date = new Date(timestamp);
  }

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

// Intensity levels based on asterisk markers from narrator
// *warm* = sensual, **hot** = crude, ***primal*** = breeding
type IntensityLevel = "warm" | "hot" | "primal";

// Static colors for intensity phrases (no animation needed for old pages)
const INTENSITY_STYLES: Record<IntensityLevel, string> = {
  warm: "text-orange-300/90",
  hot: "text-amber-400",
  primal: "text-rose-400",
};

// Glow effects for intensity phrases
const INTENSITY_GLOW: Record<IntensityLevel, string> = {
  warm: "0 0 8px rgba(253, 186, 116, 0.4)",
  hot: "0 0 10px rgba(251, 191, 36, 0.5)",
  primal: "0 0 12px rgba(251, 113, 133, 0.6)",
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

type NarrationSegment =
  | { type: "text"; content: string }
  | { type: "dialogue"; content: string }
  | { type: "dialogue-intensity"; content: string; level: IntensityLevel }
  | { type: "intensity"; content: string; level: IntensityLevel };

/** Parse text for intensity markers only */
function parseIntensity(text: string, isDialogue: boolean): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  const intensityRegex = /(\*{1,3})([^*]+?)\1/g;
  let lastIndex = 0;
  let match;

  while ((match = intensityRegex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({
        type: isDialogue ? "dialogue" : "text",
        content: text.slice(lastIndex, match.index)
      });
    }

    const asterisks = match[1];
    const content = match[2];
    const level: IntensityLevel = asterisks.length === 3 ? "primal" : asterisks.length === 2 ? "hot" : "warm";
    segments.push({
      type: isDialogue ? "dialogue-intensity" : "intensity",
      content,
      level
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: isDialogue ? "dialogue" : "text",
      content: text.slice(lastIndex)
    });
  }

  return segments;
}

/** Parse text into segments: plain text, dialogue, and intensity-marked phrases */
function parseNarration(text: string): NarrationSegment[] {
  const segments: NarrationSegment[] = [];

  // First pass: split by dialogue quotes
  const dialogueRegex = /(["""])([^"""]*?)(["""])/g;
  let lastIndex = 0;
  let match;

  while ((match = dialogueRegex.exec(text)) !== null) {
    // Parse text before dialogue for intensity
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      segments.push(...parseIntensity(beforeText, false));
    }

    // Parse dialogue content for intensity (include the quotes in output)
    const openQuote = match[1];
    const dialogueContent = match[2];
    const closeQuote = match[3];

    // Add opening quote as dialogue
    segments.push({ type: "dialogue", content: openQuote });
    // Parse inner content for intensity markers
    segments.push(...parseIntensity(dialogueContent, true));
    // Add closing quote as dialogue
    segments.push({ type: "dialogue", content: closeQuote });

    lastIndex = match.index + match[0].length;
  }

  // Parse remaining text for intensity
  if (lastIndex < text.length) {
    segments.push(...parseIntensity(text.slice(lastIndex), false));
  }

  // Handle empty input
  if (segments.length === 0 && text) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

/** Intensity phrase - static colored text with optional glow */
function IntensityPhrase({ content, level, animate = false }: { content: string; level: IntensityLevel; animate?: boolean }) {
  const [visible, setVisible] = useState(!animate);

  useEffect(() => {
    if (animate) {
      // Small delay before revealing for new pages
      const timer = setTimeout(() => setVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, [animate]);

  return (
    <span
      className={`${INTENSITY_STYLES[level]} transition-all duration-500 ${visible ? "opacity-100" : "opacity-60"}`}
      style={{ textShadow: visible ? INTENSITY_GLOW[level] : "none" }}
    >
      {content}
    </span>
  );
}

/** Sequences character dialogues one at a time */
function CharacterDialogueSequence({
  characters,
  useTypewriter,
  characterNames,
  onHoverCharacter,
  onTapCharacter,
}: {
  characters: Record<string, unknown>;
  useTypewriter: boolean;
  characterNames: string[];
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
}) {
  const entries = Object.entries(characters);
  const [completedCount, setCompletedCount] = useState(useTypewriter ? 0 : entries.length);

  // Reset when characters change
  useEffect(() => {
    if (!useTypewriter) {
      setCompletedCount(entries.length);
    }
  }, [entries.length, useTypewriter]);

  const handleComplete = useCallback(() => {
    setCompletedCount(c => c + 1);
  }, []);

  return (
    <div className="space-y-3 pl-3 mt-4">
      <AnimatePresence mode="popLayout">
        {entries.slice(0, completedCount + 1).map(([name, rawData], index) => (
          <CharacterDialogueEntry
            key={name}
            name={name}
            rawData={rawData as Record<string, unknown>}
            useTypewriter={useTypewriter}
            isActive={index === completedCount}
            onComplete={handleComplete}
            characterNames={characterNames}
            onHoverCharacter={onHoverCharacter}
            onTapCharacter={onTapCharacter}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Character dialogue entry with typewriter */
function CharacterDialogueEntry({
  name,
  rawData,
  useTypewriter,
  isActive,
  onComplete,
  characterNames,
  onHoverCharacter,
  onTapCharacter,
}: {
  name: string;
  rawData: Record<string, unknown>;
  useTypewriter: boolean;
  isActive: boolean;
  onComplete?: () => void;
  characterNames: string[];
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
}) {
  const data = extractCharacterFromRaw(rawData);
  if (!data?.dialogue) return null;

  const colors = getCharacterColor(name, characterNames);
  const dialogue = data.dialogue as string;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="text-sm relative cursor-pointer hover:brightness-110 transition-all"
      onMouseEnter={() => onHoverCharacter?.(name)}
      onMouseLeave={() => onHoverCharacter?.(null)}
      onClick={() => onTapCharacter?.(name)}
    >
      {/* Character name with distinct color */}
      <span
        className={`text-xs font-semibold ${colors.text}`}
        style={{ textShadow: `0 0 12px currentColor` }}
      >
        {name}
      </span>

      {/* Dialogue with typewriter */}
      <span className="text-muted-foreground/50 mx-1">—</span>
      <span className={`italic ${colors.quote}`}>
        <span className="text-muted-foreground/30 not-italic">"</span>
        {useTypewriter && isActive ? (
          <TypewriterDialogue text={dialogue} onComplete={onComplete} />
        ) : (
          dialogue
        )}
        <span className="text-muted-foreground/30 not-italic">"</span>
      </span>
    </motion.div>
  );
}

/** Simple character-by-character typewriter for dialogue */
function TypewriterDialogue({
  text,
  onComplete,
  className
}: {
  text: string;
  onComplete?: () => void;
  className?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount < text.length) {
      const timer = setTimeout(() => {
        setVisibleCount(v => v + 1);
      }, 25); // Fast character reveal
      return () => clearTimeout(timer);
    } else if (onComplete) {
      onComplete();
    }
  }, [visibleCount, text.length, onComplete]);

  return (
    <span className={className}>
      {text.slice(0, visibleCount)}
      {visibleCount < text.length && (
        <span className="animate-pulse">▌</span>
      )}
    </span>
  );
}

/** Word-by-word typewriter reveal that preserves formatting */
function TypewriterNarration({
  segments,
  onComplete
}: {
  segments: NarrationSegment[];
  onComplete?: () => void;
}) {
  // Flatten segments into words while preserving their type/styling
  const words = useMemo(() => {
    const result: Array<{
      word: string;
      type: NarrationSegment["type"];
      level?: IntensityLevel;
    }> = [];

    for (const seg of segments) {
      const segWords = seg.content.split(/(\s+)/);
      for (const word of segWords) {
        if (word) {
          result.push({
            word,
            type: seg.type,
            level: "level" in seg ? seg.level : undefined,
          });
        }
      }
    }
    return result;
  }, [segments]);

  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount < words.length) {
      const currentWord = words[visibleCount]?.word || "";
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
      {words.slice(0, visibleCount).map((item, i) => {
        if (item.type === "dialogue") {
          return (
            <span
              key={i}
              className="text-emerald-400/60 italic"
              style={{ textShadow: "0 0 20px rgba(52, 211, 153, 0.15)" }}
            >
              {item.word}
            </span>
          );
        } else if (item.type === "dialogue-intensity" && item.level) {
          // Both dialogue styling AND intensity color
          return (
            <span
              key={i}
              className={`italic ${INTENSITY_STYLES[item.level]}`}
              style={{ textShadow: INTENSITY_GLOW[item.level] }}
            >
              {item.word}
            </span>
          );
        } else if (item.type === "intensity" && item.level) {
          return (
            <span
              key={i}
              className={INTENSITY_STYLES[item.level]}
              style={{ textShadow: INTENSITY_GLOW[item.level] }}
            >
              {item.word}
            </span>
          );
        }
        return <span key={i}>{item.word}</span>;
      })}
      {visibleCount < words.length && (
        <span className="inline-block w-0.5 h-4 bg-primary/60 ml-0.5 align-middle rounded-sm animate-pulse" />
      )}
    </span>
  );
}

/** Highlights dialogue and intensity-marked phrases */
function NarrationText({ text, isNew = false, useTypewriter = false, onComplete }: { text: string; isNew?: boolean; useTypewriter?: boolean; onComplete?: () => void }) {
  const segments = useMemo(() => parseNarration(text), [text]);

  // Static mode: signal complete on mount (must be before early return to follow hooks rules)
  useEffect(() => {
    if (!useTypewriter) {
      onComplete?.();
    }
  }, [useTypewriter, onComplete]);

  // Typewriter mode: reveal with formatting preserved
  if (useTypewriter) {
    return (
      <TypewriterNarration
        segments={segments}
        onComplete={onComplete}
      />
    );
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "dialogue") {
          return (
            <span
              key={i}
              className="text-emerald-400/60 italic"
              style={{ textShadow: "0 0 20px rgba(52, 211, 153, 0.15)" }}
            >
              {seg.content}
            </span>
          );
        } else if (seg.type === "dialogue-intensity") {
          // Both dialogue styling AND intensity color
          return (
            <span
              key={i}
              className={`italic ${INTENSITY_STYLES[seg.level]}`}
              style={{ textShadow: INTENSITY_GLOW[seg.level] }}
            >
              {seg.content}
            </span>
          );
        } else if (seg.type === "intensity") {
          return (
            <IntensityPhrase
              key={i}
              content={seg.content}
              level={seg.level}
              animate={isNew}
            />
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

/** Page header with page number */
function PageHeader({ pageNum, isFirst }: { pageNum: number; isFirst: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: isFirst ? 0.8 : 0.4, delay: isFirst ? 0.3 : 0 }}
      className="text-center mb-6"
    >
      <div className="text-xs uppercase tracking-[0.4em] text-primary/50 font-medium">
        Page {pageNum === 1 ? "One" : pageNum === 2 ? "Two" : pageNum === 3 ? "Three" : pageNum}
      </div>
    </motion.div>
  );
}

/** Grand opening for the first page - simple fade in */
function OpeningScene({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

// Special messages for the very first page - make it feel magical
const FIRST_PAGE_MESSAGES = [
  "Opening the book...",
  "The story stirs to life...",
  "Your adventure begins...",
  "The first words appear...",
  "A new tale unfolds...",
  "The Library awakens...",
];

// Witty loading messages for the intermission - cycles through these
const INTERMISSION_MESSAGES = [
  "Summoning the muse...",
  "The narrator clears their throat...",
  "Characters are warming up backstage...",
  "Consulting the oracle of plot...",
  "Weaving narrative threads...",
  "Setting the mood lighting...",
  "The stage manager signals ready...",
  "Dramatic tension building...",
  "Cue the atmosphere...",
  "Almost time for your scene...",
  "The ink is flowing...",
  "Words are finding their places...",
];

/** Theatrical intermission while waiting for page generation */
function PageIntermission({ pageNum }: { pageNum: number }) {
  const [phase, setPhase] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [dots, setDots] = useState(1);

  // Format page number as word for low numbers
  const pageWord = pageNum === 1 ? "One" : pageNum === 2 ? "Two" : pageNum === 3 ? "Three" :
                   pageNum === 4 ? "Four" : pageNum === 5 ? "Five" : pageNum === 6 ? "Six" :
                   pageNum === 7 ? "Seven" : pageNum === 8 ? "Eight" : pageNum === 9 ? "Nine" :
                   pageNum === 10 ? "Ten" : String(pageNum);

  // Animate dots
  useEffect(() => {
    const dotTimer = setInterval(() => {
      setDots(d => (d % 3) + 1);
    }, 400);
    return () => clearInterval(dotTimer);
  }, []);

  // Choose message set based on whether this is the first page
  const messages = pageNum === 1 ? FIRST_PAGE_MESSAGES : INTERMISSION_MESSAGES;

  // Cycle through messages
  useEffect(() => {
    const messageTimer = setInterval(() => {
      setMessageIndex(i => (i + 1) % messages.length);
    }, 2800);
    return () => clearInterval(messageTimer);
  }, [messages.length]);

  // Phase progression: 0 -> 1 -> 2
  // Phase 0: 0-6s - Initial fade in, first message
  // Phase 1: 6-14s - Message cycling, decorative elements appear
  // Phase 2: 14s+ - More atmosphere, building anticipation
  useEffect(() => {
    const phase1 = setTimeout(() => setPhase(1), 6000);
    const phase2 = setTimeout(() => setPhase(2), 14000);

    return () => {
      clearTimeout(phase1);
      clearTimeout(phase2);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.8 }}
      className="space-y-8 py-8"
    >
      {/* Page header - fades in immediately */}
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.3 }}
        className="text-center"
      >
        <div className="text-xs uppercase tracking-[0.4em] text-primary/40 font-medium">
          {pageNum === 1 ? "The Beginning" : `Page ${pageWord}`}
        </div>
      </motion.div>

      {/* Decorative placeholder "page" */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.5 }}
        className="relative"
      >
        {/* Faux content lines - simulating where text will appear */}
        <div className="space-y-3 pl-3 border-l-2 border-primary/10">
          {[0.7, 0.9, 0.5, 0.8, 0.6].map((width, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{
                opacity: phase >= 1 ? [0.1, 0.15, 0.1] : 0.08,
                x: 0
              }}
              transition={{
                duration: 0.5,
                delay: 1 + i * 0.15,
                opacity: { duration: 2, repeat: Infinity, ease: "easeInOut" }
              }}
              className="h-3 bg-muted-foreground/10 rounded"
              style={{ width: `${width * 100}%` }}
            />
          ))}
        </div>

        {/* Floating decorative elements - appear in phase 1+ */}
        <AnimatePresence>
          {phase >= 1 && (
            <>
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 0.3, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
                className="absolute -right-2 top-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-transparent blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 0.2, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="absolute -left-4 bottom-2 w-6 h-6 rounded-full bg-gradient-to-br from-amber-400/20 to-transparent blur-sm"
              />
            </>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Loading message - centered, elegant */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.5 }}
        className="text-center space-y-4"
      >
        <AnimatePresence mode="wait">
          <motion.p
            key={messageIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 0.6, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="text-sm text-muted-foreground/70 italic"
          >
            {messages[messageIndex]}
          </motion.p>
        </AnimatePresence>

        {/* Animated dots indicator */}
        <div className="flex justify-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              animate={{
                scale: i < dots ? 1 : 0.6,
                opacity: i < dots ? 0.8 : 0.3,
              }}
              transition={{ duration: 0.2 }}
              className="w-1.5 h-1.5 rounded-full bg-primary/60"
            />
          ))}
        </div>
      </motion.div>

      {/* Phase 2+: Additional atmospheric elements */}
      <AnimatePresence>
        {phase >= 2 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="flex justify-center"
          >
            <span className="text-muted-foreground/20 text-xs tracking-[0.3em]">
              · · · ✧ · · ·
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Phase 3 "Ready" message removed - not needed */}

      {/* Scene break footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 1 ? 0.5 : 0.2 }}
        transition={{ duration: 1, delay: 2.5 }}
      >
        <SceneBreak variant={pageNum} />
      </motion.div>
    </motion.div>
  );
}

/** Wrapper for intermission - scrolls into view once when mounted */
function IntermissionWrapper({ pageNum }: { pageNum: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  // Scroll intermission into view once when it appears
  useEffect(() => {
    if (hasScrolled.current) return;
    hasScrolled.current = true;

    const timer = setTimeout(() => {
      if (ref.current) {
        ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="min-h-[200px]"
      data-intermission="true"
    >
      <PageIntermission pageNum={pageNum} />
    </motion.div>
  );
}

type Props = {
  pages: PageData[];
  attachedTo: string | null;
  autoScroll?: boolean;
  focusedPage?: number | null;
  onPageFocus?: (pageNum: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  streaming?: StreamingState;
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
  wideMode?: boolean;
  mood?: string;
  waitingForPage?: boolean;
  nextPageNum?: number;
};

export function PageFeed({ pages, attachedTo, autoScroll = false, focusedPage, onPageFocus, containerRef, streaming, onHoverCharacter, onTapCharacter, wideMode, mood = "anticipation", waitingForPage = false, nextPageNum = 1 }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Track newest page synchronously (not in effect) so isNew works on first render
  const newestPage = useMemo(() => {
    return pages.length > 0 ? pages[pages.length - 1].page : null;
  }, [pages]);

  // Get all character names for consistent coloring
  const allCharacterNames = useMemo(() => {
    const names = new Set<string>();
    pages.forEach(pageItem => {
      Object.keys(pageItem.characters).forEach(name => names.add(name));
    });
    return Array.from(names);
  }, [pages]);

  // Get mood-based styling
  const moodStyle = MOOD_COLORS[mood] || MOOD_COLORS.default;

  // Register page element refs
  const setPageRef = useCallback((pageNum: number, el: HTMLElement | null) => {
    if (el) {
      console.log("[PageFeed] Setting ref for page:", pageNum);
      pageRefs.current.set(pageNum, el);
    } else {
      console.log("[PageFeed] Removing ref for page:", pageNum);
      pageRefs.current.delete(pageNum);
    }
  }, []);

  // Find which page is most centered in the viewport
  useEffect(() => {
    const container = containerRef?.current;
    if (!container || !onPageFocus) return;

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;

      let closestPage: number | null = null;
      let closestDistance = Infinity;

      // Query all page elements by data-page attribute
      const pageElements = container.querySelectorAll('[data-page]');
      pageElements.forEach((el) => {
        const pageNum = parseInt(el.getAttribute('data-page') || '0', 10);
        if (!pageNum) return;

        const rect = el.getBoundingClientRect();
        const elCenter = rect.top + rect.height / 2;
        const distance = Math.abs(elCenter - containerCenter);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = pageNum;
        }
      });

      if (closestPage !== null) {
        onPageFocus(closestPage);
      }
    };

    // Initial check after DOM settles
    const initialTimer = setTimeout(handleScroll, 100);

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(initialTimer);
      container.removeEventListener("scroll", handleScroll);
    };
  }, [containerRef, onPageFocus, pages.length]);

  // Debug: check for duplicate page numbers
  useEffect(() => {
    const pageNums = pages.map(p => p.page);
    const duplicates = pageNums.filter((num, idx) => pageNums.indexOf(num) !== idx);
    if (duplicates.length > 0) {
      console.error("[PageFeed] DUPLICATE PAGE NUMBERS:", duplicates, "All pages:", pageNums);
    }
  }, [pages]);

  // Scroll to last page on initial load
  const hasScrolledOnLoad = useRef(false);
  useEffect(() => {
    if (hasScrolledOnLoad.current || pages.length === 0) return;

    // Wait for DOM and animations to settle
    const timer = setTimeout(() => {
      const lastPageNum = pages[pages.length - 1]?.page;
      if (!lastPageNum) return;

      let el = document.querySelector(`[data-page="${lastPageNum}"]`) as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        hasScrolledOnLoad.current = true;
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [pages.length]);

  // Auto-scroll: scroll new page into view after delay
  const lastPageCount = useRef(pages.length);
  useEffect(() => {
    // No pages yet - just track count
    if (pages.length === 0) {
      lastPageCount.current = 0;
      return;
    }

    // Page count didn't increase - no scroll needed
    if (pages.length <= lastPageCount.current) {
      lastPageCount.current = pages.length;
      return;
    }

    const newestPageNum = pages[pages.length - 1]?.page;
    lastPageCount.current = pages.length;

    if (!newestPageNum) return;

    // Mark that we've handled initial load if this is first pages
    if (!hasScrolledOnLoad.current) {
      hasScrolledOnLoad.current = true;
    }

    const timer = setTimeout(() => {
      let el = pageRefs.current.get(newestPageNum);
      if (!el) {
        el = document.querySelector(`[data-page="${newestPageNum}"]`) as HTMLElement;
      }
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [pages.length]);

  // Empty state - show centered "Your story awaits" when no pages and not waiting
  if (pages.length === 0 && !waitingForPage && !streaming?.isStreaming) {
    return (
      <div className="h-full flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-6 max-w-md px-6"
        >
          <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary/60">
              <path d="M12 6.25278V19.2528M12 6.25278C10.8321 5.47686 9.24649 5 7.5 5C5.75351 5 4.16789 5.47686 3 6.25278V19.2528C4.16789 18.4769 5.75351 18 7.5 18C9.24649 18 10.8321 18.4769 12 19.2528M12 6.25278C13.1679 5.47686 14.7535 5 16.5 5C18.2465 5 19.8321 5.47686 21 6.25278V19.2528C19.8321 18.4769 18.2465 18 16.5 18C14.7535 18 13.1679 18.4769 12 19.2528" />
            </svg>
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-medium text-foreground/80">Your story awaits</h3>
            <p className="text-sm text-muted-foreground/60">
              Press <span className="text-primary/70 font-medium">Begin</span> to turn the first page
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  // Main render: pages + intermission (all in same container to avoid CLS)
  return (
    <div className={`mx-auto px-4 sm:px-6 py-4 space-y-6 ${wideMode ? "max-w-5xl" : "max-w-3xl"}`}>
      <AnimatePresence mode="popLayout">
        {pages.map((pageItem, index) => {
          const isFirst = index === 0;
          const isNewest = pageItem.page === newestPage;
          const isLast = index === pages.length - 1;

          const content = (
            <>
              <PageHeader pageNum={pageItem.page} isFirst={isFirst} />
              <PageEntry
                pageItem={pageItem}
                attachedTo={attachedTo}
                isFocused={focusedPage === pageItem.page}
                isNew={isNewest}
                onHoverCharacter={onHoverCharacter}
                onTapCharacter={onTapCharacter}
                characterNames={allCharacterNames}
                moodStyle={moodStyle}
              />
              {!isLast && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: isFirst ? 2 : 0.5, duration: 0.6 }}
                  className="mt-8"
                >
                  <SceneBreak variant={index} />
                </motion.div>
              )}
            </>
          );

          // Wrap first page in OpeningScene for grand entrance animation
          if (isFirst) {
            return (
              <OpeningScene key={`page-${pageItem.page}`}>
                <div
                  data-page={pageItem.page}
                  ref={(el) => setPageRef(pageItem.page, el)}
                  className="min-h-[250px]"
                >
                  {content}
                </div>
              </OpeningScene>
            );
          }

          return (
            <div
              key={`page-${pageItem.page}`}
              data-page={pageItem.page}
              ref={(el) => setPageRef(pageItem.page, el)}
              className="min-h-[250px]"
            >
              {content}
            </div>
          );
        })}
      </AnimatePresence>

      {/* Intermission while waiting for generation - fixed height container to prevent CLS */}
      <AnimatePresence mode="wait">
        {waitingForPage && !streaming?.isStreaming && (
          <IntermissionWrapper key="intermission" pageNum={nextPageNum} />
        )}
      </AnimatePresence>

      {/* Currently streaming page */}
      {streaming?.isStreaming && (
        <StreamingPageEntry streaming={streaming} characterNames={allCharacterNames} />
      )}

      <div ref={endRef} />
    </div>
  );
}

type PageEntryProps = {
  pageItem: PageData;
  attachedTo: string | null;
  isFocused: boolean;
  isNew: boolean;
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
  characterNames: string[];
  moodStyle: { border: string; glow: string };
};

/** Check if a timestamp is within the last N seconds */
function isRecentTimestamp(timestamp?: string | number, maxAgeSeconds = 60): boolean {
  if (!timestamp) return false;
  let date: Date;
  if (typeof timestamp === "string") {
    // Ensure UTC parsing: add Z if ISO format without explicit timezone
    // Backend sends "2026-03-16T10:30:00" (UTC but no Z suffix)
    let ts = timestamp;
    if (ts.includes("T") && !/[Z+-]/.test(ts.slice(-6))) {
      ts = ts + "Z";
    } else if (!ts.includes("T")) {
      ts = ts.replace(" ", "T") + "Z";
    }
    date = new Date(ts);
  } else {
    date = new Date(timestamp);
  }
  if (isNaN(date.getTime())) return false;
  const diffMs = Date.now() - date.getTime();
  return diffMs < maxAgeSeconds * 1000;
}

function PageEntry({ pageItem, attachedTo: _attachedTo, isFocused, isNew, onHoverCharacter, onTapCharacter, characterNames, moodStyle }: PageEntryProps) {
  // Use typewriter for recent pages (created < 1 min ago)
  const useTypewriter = isNew && isRecentTimestamp(pageItem.created_at, 60);

  // Track narration completion for skip-on-double-click feature
  const [narrationComplete, setNarrationComplete] = useState(!useTypewriter);

  // Allow skipping typewriter with double-click
  const [typewriterSkipped, setTypewriterSkipped] = useState(false);
  const handleDoubleClick = useCallback(() => {
    if (useTypewriter && !narrationComplete) {
      setTypewriterSkipped(true);
      setNarrationComplete(true);
    }
  }, [useTypewriter, narrationComplete]);

  return (
    <div
      className={`space-y-3 ${
        isFocused
          ? "relative before:absolute before:-left-4 before:top-0 before:bottom-0 before:w-1 before:bg-primary before:rounded-full"
          : ""
      }`}
    >
      {/* Timestamp header */}
      <div className="flex items-center gap-2 group/timestamp">
        {/* Short timestamp, hover for full */}
        <span
          className={`text-[10px] font-mono transition-colors duration-200 cursor-default ${
            isFocused ? "text-primary/80" : "text-muted-foreground/60"
          }`}
          title={pageItem.created_at ? new Date(pageItem.created_at).toLocaleString() : undefined}
        >
          <span className="group-hover/timestamp:hidden">{formatTimestamp(pageItem.created_at)}</span>
          <span className="hidden group-hover/timestamp:inline text-muted-foreground/80">
            {pageItem.created_at ? new Date(pageItem.created_at).toLocaleString() : ""}
          </span>
        </span>
      </div>

      {/* Narration with highlighted dialogue and intensity words */}
      {/* Double-click to skip typewriter animation */}
      <div
        className={`text-sm leading-relaxed text-foreground/90 pl-3 border-l-2 ${moodStyle.border} whitespace-pre-line cursor-text`}
        onDoubleClick={handleDoubleClick}
        title={useTypewriter && !narrationComplete ? "Double-click to skip animation" : undefined}
      >
        <NarrationText
          text={pageItem.narration}
          isNew={useTypewriter}
          useTypewriter={useTypewriter && !typewriterSkipped}
          onComplete={() => setNarrationComplete(true)}
        />
      </div>

      {/* Character dialogue - wait for narration, then sequence one at a time */}
      {Object.keys(pageItem.characters).length > 0 && (narrationComplete || !useTypewriter) && (
        <CharacterDialogueSequence
          characters={pageItem.characters}
          useTypewriter={useTypewriter && !typewriterSkipped}
          characterNames={characterNames}
          onHoverCharacter={onHoverCharacter}
          onTapCharacter={onTapCharacter}
        />
      )}

      {/* Events removed - viewable in director panel */}
    </div>
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

/** Streaming page entry - smooth word-by-word display */
function StreamingPageEntry({ streaming, characterNames = [] }: { streaming: StreamingState; characterNames?: string[] }) {
  // Defensive checks to prevent crashes
  if (!streaming || !streaming.isStreaming || !streaming.page) return null;

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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
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

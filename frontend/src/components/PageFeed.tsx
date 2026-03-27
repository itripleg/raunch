import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { PageData } from "@/hooks/useGame";
import { parseTimestamp, extractCharacterFromRaw } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
// PREMIUM NARRATION FEED - Immersive storytelling experience
// ═══════════════════════════════════════════════════════════════════════════

/** Format timestamp elegantly - relative for recent, time for older */
function formatTimestamp(timestamp?: string | number): string {
  if (!timestamp) return "";

  const date = parseTimestamp(timestamp);
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

// Page number words for display
const PAGE_WORDS: Record<number, string> = {
  1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
  6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten",
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

// Character colors — bright neon names, matching tinted dialogue
const CHARACTER_COLORS = [
  { text: "text-fuchsia-400", quote: "text-fuchsia-400/60" },
  { text: "text-cyan-400", quote: "text-cyan-400/60" },
  { text: "text-amber-300", quote: "text-amber-300/60" },
  { text: "text-violet-400", quote: "text-violet-400/60" },
  { text: "text-rose-400", quote: "text-rose-400/60" },
  { text: "text-lime-300", quote: "text-lime-300/60" },
  { text: "text-orange-400", quote: "text-orange-400/60" },
  { text: "text-sky-400", quote: "text-sky-400/60" },
];

// Decorative scene break patterns
const SCENE_BREAKS = [
  "✦",
  "◆",
  "✧",
  "❖",
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

/** Renders all character dialogues (appear together after narration completes) */
function CharacterDialogueSequence({
  characters,
  characterNames,
  onHoverCharacter,
  onTapCharacter,
}: {
  characters: Record<string, unknown>;
  characterNames: string[];
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
}) {
  const entries = Object.entries(characters);

  return (
    <div className="space-y-3 pl-3 mt-4">
      <AnimatePresence mode="popLayout">
        {entries.map(([name, rawData]) => (
          <CharacterDialogueEntry
            key={name}
            name={name}
            rawData={rawData as Record<string, unknown>}
            characterNames={characterNames}
            onHoverCharacter={onHoverCharacter}
            onTapCharacter={onTapCharacter}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Character dialogue entry */
function CharacterDialogueEntry({
  name,
  rawData,
  characterNames,
  onHoverCharacter,
  onTapCharacter,
}: {
  name: string;
  rawData: Record<string, unknown>;
  characterNames: string[];
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
}) {
  const data = extractCharacterFromRaw(rawData);
  const colors = getCharacterColor(name, characterNames);
  let dialogue = data?.dialogue as string | undefined;

  // If no explicit dialogue, extract quoted speech from action text
  if (!dialogue && data?.action) {
    const action = data.action as string;
    // Match single or double quoted speech
    const match = action.match(/["'\u2018\u2019\u201C\u201D]([^"'\u2018\u2019\u201C\u201D]{2,})["'\u2018\u2019\u201C\u201D]/);
    if (match) dialogue = match[1];
  }

  if (!dialogue) return null;

  // Clean up dialogue: if it contains embedded quotes with action beats
  // (e.g. '"Janus," Maven breathes'), extract just the first spoken line
  // and trim leading/trailing quote marks the LLM included
  dialogue = dialogue.replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, "").trim();

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
  const glyph = SCENE_BREAKS[variant % SCENE_BREAKS.length];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex items-center justify-center gap-3 py-4"
    >
      <motion.div
        animate={{ opacity: [0.15, 0.3, 0.15] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="h-px w-12 bg-gradient-to-r from-transparent to-primary/30"
      />
      <motion.span
        animate={{ opacity: [0.3, 0.55, 0.3] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="text-primary/40 text-[10px]"
      >
        {glyph}
      </motion.span>
      <motion.div
        animate={{ opacity: [0.15, 0.3, 0.15] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="h-px w-12 bg-gradient-to-l from-transparent to-primary/30"
      />
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
        {pageNum === 1 ? "The Beginning" : `Page ${PAGE_WORDS[pageNum] ?? pageNum}`}
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

  const pageWord = PAGE_WORDS[pageNum] ?? String(pageNum);

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
  bookId?: string;
  focusedPage?: number | null;
  onPageFocus?: (pageNum: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
  wideMode?: boolean;
  mood?: string;
  waitingForPage?: boolean;
  onBegin?: () => void;
  nextPageNum?: number;
  onTapBorder?: () => void;
};

export function PageFeed({ pages, bookId, focusedPage, onPageFocus, containerRef, onHoverCharacter, onTapCharacter, wideMode, mood = "anticipation", waitingForPage = false, nextPageNum = 1, onBegin, onTapBorder }: Props) {
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const storageKey = bookId ? `raunch-last-page-${bookId}` : null;

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
      pageRefs.current.set(pageNum, el);
    } else {
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

  // Persist focused page to localStorage
  useEffect(() => {
    if (focusedPage && storageKey) {
      try { localStorage.setItem(storageKey, String(focusedPage)); } catch { /* ignore */ }
    }
  }, [focusedPage, storageKey]);

  // Scroll to saved page on initial load (or last page if no saved position)
  const hasScrolledOnLoad = useRef(false);
  useEffect(() => {
    if (hasScrolledOnLoad.current || pages.length === 0) return;

    const timer = setTimeout(() => {
      let targetPage: number | null = null;

      // Try to restore saved position
      if (storageKey) {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) targetPage = parseInt(saved, 10);
        } catch { /* ignore */ }
      }

      // Fall back to last page
      if (!targetPage || !pages.some(p => p.page === targetPage)) {
        targetPage = pages[pages.length - 1]?.page ?? null;
      }

      if (targetPage) {
        const el = document.querySelector(`[data-page="${targetPage}"]`) as HTMLElement;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          hasScrolledOnLoad.current = true;
        }
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [pages.length, storageKey]);

  // When new page replaces intermission, lock scroll to prevent jarring jump
  const prevPageCountRef2 = useRef(pages.length);
  useEffect(() => {
    if (pages.length > prevPageCountRef2.current && pages.length > 0) {
      // New page just arrived — scroll to it after DOM settles
      const newestPageNum = pages[pages.length - 1].page;
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-page="${newestPageNum}"]`) as HTMLElement;
        if (el) {
          // Use instant scroll to avoid the jarring "catch-up" animation
          el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
        }
      });
    }
    prevPageCountRef2.current = pages.length;
  }, [pages.length]);

  // Auto-scroll to intermission when page generation starts,
  // but only if the last page is currently visible (user hasn't scrolled away)
  const intermissionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!waitingForPage || pages.length === 0) return;

    const lastPageNum = pages[pages.length - 1]?.page;
    if (!lastPageNum) return;

    // Check if last page is in view
    const lastEl = pageRefs.current.get(lastPageNum)
      ?? document.querySelector(`[data-page="${lastPageNum}"]`) as HTMLElement | null;
    if (lastEl) {
      const container = containerRef?.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = lastEl.getBoundingClientRect();
        const isVisible = elRect.bottom > containerRect.top && elRect.top < containerRect.bottom;
        if (!isVisible) return; // User scrolled away, don't auto-scroll
      }
    }

    // Small delay for the intermission element to mount
    const timer = setTimeout(() => {
      intermissionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    return () => clearTimeout(timer);
  }, [waitingForPage, containerRef, pages.length]);

  // Empty state - show centered "Your story awaits" when no pages and not waiting
  if (pages.length === 0 && !waitingForPage) {
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
              Press{" "}
              {onBegin ? (
                <button
                  onClick={onBegin}
                  className="inline-flex items-center gap-1 text-primary/70 font-medium hover:text-primary transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Begin
                </button>
              ) : (
                <span className="text-primary/70 font-medium">Begin</span>
              )}{" "}
              to turn the first page
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
                isFocused={focusedPage === pageItem.page}
                isNew={isNewest}
                onHoverCharacter={onHoverCharacter}
                onTapCharacter={onTapCharacter}
                characterNames={allCharacterNames}
                moodStyle={moodStyle}
                onTapBorder={onTapBorder}
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

      {/* Intermission while waiting for generation */}
      <AnimatePresence>
        {waitingForPage && (
          <motion.div
            ref={intermissionRef}
            key="intermission-wrap"
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <IntermissionWrapper key="intermission" pageNum={nextPageNum} />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

type PageEntryProps = {
  pageItem: PageData;
  isFocused: boolean;
  isNew: boolean;
  onHoverCharacter?: (name: string | null) => void;
  onTapCharacter?: (name: string) => void;
  characterNames: string[];
  moodStyle: { border: string; glow: string };
  onTapBorder?: () => void;
};

/** Check if a timestamp is within the last N seconds */
function isRecentTimestamp(timestamp?: string | number, maxAgeSeconds = 60): boolean {
  if (!timestamp) return false;
  const date = parseTimestamp(timestamp);
  if (isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < maxAgeSeconds * 1000;
}

function PageEntry({ pageItem, isFocused, isNew, onHoverCharacter, onTapCharacter, characterNames, moodStyle, onTapBorder }: PageEntryProps) {
  // Use typewriter for recent pages (created < 30s ago)
  const useTypewriter = isNew && isRecentTimestamp(pageItem.created_at, 30);

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
      <div className="relative">
        {/* Mobile-only: tap the left border to open sidebar */}
        {onTapBorder && (
          <button
            onClick={onTapBorder}
            className="lg:hidden absolute left-0 top-0 bottom-0 w-4 -ml-1 z-10"
            aria-label="Open sidebar"
          />
        )}
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
      </div>

      {/* Character dialogue - wait for narration to finish, then show */}
      {(narrationComplete || !useTypewriter) && (
        <>
          {Object.keys(pageItem.characters).length > 0 && (
            <CharacterDialogueSequence
              characters={pageItem.characters}
              characterNames={characterNames}
              onHoverCharacter={onHoverCharacter}
              onTapCharacter={onTapCharacter}
            />
          )}
          {/* Characters still thinking — show subtle loading for each */}
          {isNew && (() => {
            const responded = new Set(Object.keys(pageItem.characters));
            const pending = characterNames.filter(n => !responded.has(n));
            if (pending.length === 0) return null;
            return (
              <div className="space-y-2 pl-3 mt-3">
                {pending.map(name => {
                  const colors = getCharacterColor(name, characterNames);
                  return (
                    <motion.div
                      key={`pending-${name}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2"
                    >
                      <span className={`text-xs font-semibold ${colors.text}`} style={{ opacity: 0.4 }}>
                        {name}
                      </span>
                      <div className="flex gap-0.5">
                        {[0, 1, 2].map(i => (
                          <motion.span
                            key={i}
                            className={`w-1 h-1 rounded-full ${colors.text.replace('text-', 'bg-')}`}
                            style={{ opacity: 0.4 }}
                            animate={{ opacity: [0.2, 0.6, 0.2] }}
                            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

    </div>
  );
}


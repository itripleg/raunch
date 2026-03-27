import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useAnimation } from "motion/react";
import { useMockMode } from "../context/MockMode";
import {
  ArrowLeft,
  Sparkles,
  Wand2,
  Dice5,
  Copy,
  ClipboardPaste,
  Save,
  Check,
  ChevronDown,
  X,
  User,
  Users,
  MapPin,
  Flame,
  Heart,
  FileJson,
  Eye,
  BookOpen,
} from "lucide-react";

type WizardOptions = {
  settings: string[];
  pairings: string[];
  kinks: string[];
  vibes: string[];
};

type Character = {
  name: string;
  species?: string;
  personality?: string;
  appearance?: string;
  desires?: string;
  backstory?: string;
  kinks?: string;
};

type GeneratedScenario = {
  scenario_name: string;
  setting: string;
  premise: string;
  themes: string[];
  opening_situation: string;
  characters: Character[];
  saved_to?: string;
};

type Props = {
  apiUrl: string;
  librarianId: string | null;
  onBack: () => void;
  onSaved?: () => void;
  onStartBook?: (scenarioId: string) => void;
  isAdmin?: boolean;
};

// Mock data for development
const MOCK_OPTIONS: WizardOptions = {
  settings: ["Enchanted Forest", "Space Station", "Victorian Mansion", "Underground Club", "Desert Oasis", "Pirate Ship"],
  pairings: ["M/F", "M/M", "F/F", "Multi", "Solo"],
  kinks: ["Romance", "Power Play", "Forbidden", "Voyeurism", "Slow Burn", "Body Worship", "Rivals to Lovers"],
  vibes: ["Steamy", "Tender", "Dark", "Playful", "Intense", "Dreamy"],
};

const MOCK_RESULT: GeneratedScenario = {
  scenario_name: "Midnight Bloom at the Crimson Garden",
  setting: "A secret garden hidden behind a Victorian greenhouse, where rare night-blooming flowers release intoxicating pollen under the full moon.",
  premise: "Two rival botanists, each seeking the legendary Midnight Orchid for their own reasons, find themselves locked inside the greenhouse after hours. As the rare flowers bloom and fill the air with their heady fragrance, academic rivalry gives way to something far more primal. The orchid's pollen is said to dissolve inhibitions — but perhaps it merely reveals what was always there, buried beneath layers of professional courtesy and stolen glances across lecture halls.",
  themes: ["Rivals to Lovers", "Forbidden Desire", "Intoxication", "Academic Rivalry", "Surrender"],
  opening_situation: "The greenhouse door clicks shut behind you with a sound that feels far too final. Through the fogged glass panels, moonlight streams in silver ribbons across beds of impossible flowers. Dr. Ashworth is already here — you can see their silhouette between the towering ferns, notebook in hand, completely absorbed. They haven't noticed you yet. The first Midnight Orchid is beginning to unfurl its crimson petals, and with it comes a scent like warm honey and thunderstorms.",
  characters: [
    {
      name: "Dr. Morgan Ashworth",
      species: "Human",
      personality: "Brilliant, competitive, and devastatingly composed — until they're not. Known for sharp wit in peer reviews and an infuriating habit of being right. Beneath the academic armor lies someone who hasn't been touched in far too long.",
      appearance: "Tall with dark curly hair perpetually escaping a loose bun. Wire-rimmed glasses, ink-stained fingers, a crisp white shirt that's come slightly untucked. Eyes the color of aged whiskey.",
      desires: "To be seen as more than a mind. To let go of control, just once, with someone who can match them intellectually and overwhelm them physically.",
      backstory: "Youngest tenured professor at the Royal Botanical Institute. Published three groundbreaking papers on nocturnal pollination, all of which directly contradicted your research.",
    },
    {
      name: "You",
      species: "Human",
      personality: "Equally brilliant, more impulsive, with a reputation for fieldwork that borders on reckless. You've clashed with Ashworth at every conference for three years, and every argument left you thinking about them for weeks after.",
      appearance: "Sun-weathered from years of field research. Strong hands, easy smile, a leather journal stuffed with pressed flowers.",
      desires: "To finally break through Ashworth's composure. To discover if the tension between you is truly just academic.",
      backstory: "Independent researcher funded by a private grant. Your discovery of the greenhouse's location was supposed to be your triumph — until you found Ashworth already inside.",
    },
  ],
  saved_to: "mock-scenario-001",
};

// Floating particle component for magical ambience
function MagicParticle({ delay, drift }: { delay: number; drift: number }) {
  return (
    <motion.div
      className="absolute w-1 h-1 rounded-full bg-primary/40"
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: [0, 0.8, 0],
        scale: [0, 1.5, 0],
        y: [-20, -100],
        x: [0, drift],
      }}
      transition={{
        duration: 3,
        delay,
        repeat: Infinity,
        ease: "easeOut",
      }}
    />
  );
}



// Typewriter text animation for headers
function TypewriterText({ text, delay = 0, className = "" }: { text: string; delay?: number; className?: string }) {
  const [displayedText, setDisplayedText] = useState("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const startTimer = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(startTimer);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayedText(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, 40);
    return () => clearInterval(interval);
  }, [started, text]);

  return (
    <span className={className}>
      {displayedText}
      {started && displayedText.length < text.length && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity }}
          className="inline-block w-[2px] h-[1em] bg-primary/60 ml-0.5 align-middle"
        />
      )}
    </span>
  );
}

// Shimmer skeleton placeholder
function ShimmerSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {[...Array(lines)].map((_, i) => (
        <div
          key={i}
          className="h-3 rounded-md bg-gradient-to-r from-secondary/80 via-secondary/40 to-secondary/80 animate-shimmer"
          style={{ width: i === lines - 1 ? "60%" : "100%", animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// Wizard quips — themed per section, then random filler
const SECTION_QUIPS = {
  premise: [
    "Setting the scene...",
    "Crafting the premise...",
    "Building the world...",
  ],
  opening: [
    "Writing the opening act...",
    "Now THIS is raunchy",
    "The spice must flow",
  ],
  themes: [
    "Picking the juicy themes...",
    "Channeling pure filth",
    "I won't kink shame...",
  ],
  characters: [
    "Sculpting the cast...",
    "Giving them personality...",
    "Oh my, that's creative",
  ],
  filler: [
    "Even I'm blushing",
    "Chef's kiss",
    "This one's going in the vault",
    "No judgment here...",
    "Consulting the ancient scrolls",
    "Brewing something wicked",
    "Degeneracy loading...",
    "I'm outdoing myself",
    "Hold onto your knickers",
    "Almost too good",
  ],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildQuipSequence(): string[] {
  // 1 random quip per section (0s, 5s, 10s, 15s, 20s intervals)
  const sequence = [
    pickRandom(SECTION_QUIPS.premise),
    pickRandom(SECTION_QUIPS.opening),
    pickRandom(SECTION_QUIPS.themes),
    pickRandom(SECTION_QUIPS.characters),
  ];
  // Then shuffle filler for variety after all skeletons are up
  const shuffledFiller = [...SECTION_QUIPS.filler].sort(() => Math.random() - 0.5);
  return [...sequence, ...shuffledFiller];
}

function WizardQuips() {
  const [index, setIndex] = useState(0);
  const [quips] = useState(() => buildQuipSequence());

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % quips.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [quips]);

  return (
    <div className="flex items-center justify-center gap-3 h-14">
      <motion.div
        animate={{ rotate: [0, 10, -10, 0], y: [0, -3, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <Wand2 className="w-5 h-5 text-primary/60" />
      </motion.div>
      <AnimatePresence mode="wait">
        <motion.p
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4 }}
          className="text-sm text-muted-foreground/70 italic"
        >
          {quips[index]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// Expandable text block for long content
function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 300;

  return (
    <div className="relative">
      <p className={`${className} ${!expanded && isLong ? "line-clamp-4" : ""}`}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary/70 hover:text-primary mt-1 transition-colors"
        >
          {expanded ? "Show less" : "Show more..."}
        </button>
      )}
    </div>
  );
}

// Chip component for kinks and vibes
function SelectableChip({
  label,
  selected,
  onClick,
  variant = "default",
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  variant?: "default" | "vibe";
}) {
  const baseClass =
    "relative px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer select-none overflow-hidden";
  const selectedClass =
    variant === "vibe"
      ? "bg-gradient-to-r from-amber-500/90 to-orange-500/90 text-black shadow-lg shadow-amber-500/25"
      : "bg-gradient-to-r from-primary/90 to-[oklch(0.55_0.2_320)] text-white shadow-lg shadow-primary/25";
  const unselectedClass =
    "bg-secondary/80 text-foreground/70 hover:bg-secondary hover:text-foreground border border-border/50 hover:border-border";

  return (
    <motion.button
      onClick={onClick}
      className={`${baseClass} ${selected ? selectedClass : unselectedClass}`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      layout
    >
      {selected && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2 }}
        />
      )}
      <span className="relative z-10">{label}</span>
    </motion.button>
  );
}

// Character card with expanded details
function CharacterCard({
  character,
  index,
}: {
  character: Character;
  index: number;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.4, ease: "easeOut" }}
      className="group relative"
    >
      {/* Card glow effect */}
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/10 via-transparent to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl" />

      <div className="relative bg-gradient-to-br from-card/90 to-card/70 backdrop-blur-sm border border-border/50 rounded-xl p-4 hover:border-primary/30 transition-all duration-300">
        {/* Character header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-violet-500/30 flex items-center justify-center border border-primary/20">
              <span className="text-sm font-bold text-primary">
                {character.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm">
                {character.name}
              </h4>
              {character.species && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {character.species}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <motion.div
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </button>
        </div>

        {/* Personality preview */}
        {character.personality && (
          <p className="text-xs text-muted-foreground mb-2">
            {character.personality}
          </p>
        )}

        {/* Expanded content */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 pt-2 border-t border-border/30">
                {character.appearance && (
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                      Appearance
                    </span>
                    <p className="text-xs text-foreground/80 mt-0.5">
                      {character.appearance}
                    </p>
                  </div>
                )}
                {character.desires && (
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-amber-400/70 flex items-center gap-1">
                      <Heart className="w-2.5 h-2.5" /> Desires
                    </span>
                    <p className="text-xs text-amber-400/80 mt-0.5 italic">
                      {character.desires}
                    </p>
                  </div>
                )}
                {character.backstory && (
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                      Backstory
                    </span>
                    <p className="text-xs text-foreground/80 mt-0.5">
                      {character.backstory}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function WizardPage({ apiUrl, librarianId, onBack, onSaved, onStartBook, isAdmin }: Props) {
  const { mockMode } = useMockMode();
  const [options, setOptions] = useState<WizardOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedScenario | null>(null);

  // Form state
  const [selectedSetting, setSelectedSetting] = useState<string>("");
  const [customSetting, setCustomSetting] = useState<string>("");
  const [selectedPairings, setSelectedPairings] = useState<string[]>([]);
  const [selectedKinks, setSelectedKinks] = useState<string[]>([]);
  const [customKinks, setCustomKinks] = useState<string>("");
  const [selectedVibe, setSelectedVibe] = useState<string>("");
  const [customVibe, setCustomVibe] = useState<string>("");
  const [customPrefs, setCustomPrefs] = useState("");
  const [numChars, setNumChars] = useState(2);
  const [multiplayer, setMultiplayer] = useState(false);
  const [language, setLanguage] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [settingOpen, setSettingOpen] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);
  const settingRef = useRef<HTMLDivElement>(null);
  const diceControls = useAnimation();
  const maxChars = isAdmin ? 5 : 3;

  // Hold-to-roll refs
  const rollingRef = useRef(false);
  const rollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollFrameRef = useRef(0);

  // Start rolling — called on mousedown/touchstart
  const startRolling = () => {
    if (!options || rolling) return;
    setRolling(true);
    rollingRef.current = true;
    rollFrameRef.current = 0;

    // Shuffle option order for a fresh feel each roll
    setOptions({
      settings: shuffle(options.settings),
      pairings: shuffle(options.pairings),
      kinks: shuffle(options.kinks),
      vibes: shuffle(options.vibes),
    });

    // Continuous dice spin while held
    diceControls.start({
      rotate: [0, 360],
      transition: { duration: 0.4, ease: "linear", repeat: Infinity },
    });

    const settingOptions = options.settings;
    const pairingOptions = options.pairings;
    const kinkOptions = options.kinks;
    const vibeOptions = options.vibes;

    // Rapidly cycle all categories while button is held
    rollIntervalRef.current = setInterval(() => {
      const f = rollFrameRef.current++;
      setSelectedSetting(settingOptions[f % settingOptions.length]);
      const pIdx = f % pairingOptions.length;
      setSelectedPairings([pairingOptions[pIdx], pairingOptions[(pIdx + 3) % pairingOptions.length]]);
      const kIdx = f % kinkOptions.length;
      setSelectedKinks([kinkOptions[kIdx], kinkOptions[(kIdx + 2) % kinkOptions.length], kinkOptions[(kIdx + 5) % kinkOptions.length]]);
      setSelectedVibe(vibeOptions[f % vibeOptions.length]);
    }, 60);
  };

  // Stop rolling — called on mouseup/touchend, triggers eased deceleration
  const stopRolling = async () => {
    if (!rollingRef.current || !options) return;
    rollingRef.current = false;

    // Stop the rapid cycling
    if (rollIntervalRef.current) {
      clearInterval(rollIntervalRef.current);
      rollIntervalRef.current = null;
    }

    // Scroll to setting section so user sees what was picked
    setTimeout(() => {
      settingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);

    // Pick final values
    const finalSetting = options.settings[Math.floor(Math.random() * options.settings.length)];
    const finalPairings = [...options.pairings].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
    const finalKinks = [...options.kinks].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 3));
    const finalVibe = options.vibes[Math.floor(Math.random() * options.vibes.length)];
    // Dice deceleration
    diceControls.stop();
    diceControls.start({
      rotate: [0, 360, 540],
      scale: [1, 1.2, 1],
      transition: { duration: 1.5, ease: "easeOut" },
    });

    const settingOptions = options.settings;
    const pairingOptions = options.pairings;
    const kinkOptions = options.kinks;
    const vibeOptions = options.vibes;

    // Ease function: quadratic ease-out
    const baseTick = 60;
    const easedDelay = (i: number, total: number) => {
      const t = i / total;
      return baseTick + (t * t) * 350;
    };

    const runReel = (
      total: number,
      onTick: (i: number) => void,
      onDone: () => void,
    ) => new Promise<void>((resolve) => {
      let i = 0;
      const next = () => {
        if (i >= total) { onDone(); resolve(); return; }
        onTick(i);
        i++;
        setTimeout(next, easedDelay(i, total));
      };
      next();
    });

    const stagger = 300;

    const reels = [
      new Promise<void>(r => setTimeout(() => {
        runReel(8,
          (i) => setSelectedSetting(settingOptions[(rollFrameRef.current + i) % settingOptions.length]),
          () => { setSelectedSetting(finalSetting); setCustomSetting(""); }
        ).then(r);
      }, 0)),
      new Promise<void>(r => setTimeout(() => {
        runReel(10,
          (i) => {
            const idx = (rollFrameRef.current + i) % pairingOptions.length;
            setSelectedPairings([pairingOptions[idx], pairingOptions[(idx + 3) % pairingOptions.length]]);
          },
          () => setSelectedPairings(finalPairings),
        ).then(r);
      }, stagger)),
      new Promise<void>(r => setTimeout(() => {
        runReel(12,
          (i) => {
            const idx = (rollFrameRef.current + i) % kinkOptions.length;
            setSelectedKinks([kinkOptions[idx], kinkOptions[(idx + 2) % kinkOptions.length], kinkOptions[(idx + 5) % kinkOptions.length]]);
          },
          () => { setSelectedKinks(finalKinks); setCustomKinks(""); },
        ).then(r);
      }, stagger * 2)),
      new Promise<void>(r => setTimeout(() => {
        runReel(14,
          (i) => setSelectedVibe(vibeOptions[(rollFrameRef.current + i) % vibeOptions.length]),
          () => { setSelectedVibe(finalVibe); setCustomVibe(""); },
        ).then(r);
      }, stagger * 3)),
    ];

    await Promise.all(reels);
    setRolling(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
    };
  }, []);

  // Shuffle array helper
  const shuffle = <T,>(arr: T[]): T[] => {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // Fetch options on mount and shuffle them
  useEffect(() => {
    if (mockMode) {
      setOptions({
        settings: shuffle(MOCK_OPTIONS.settings),
        pairings: shuffle(MOCK_OPTIONS.pairings),
        kinks: shuffle(MOCK_OPTIONS.kinks),
        vibes: shuffle(MOCK_OPTIONS.vibes),
      });
      return;
    }
    setLoading(true);
    fetch(`${apiUrl}/api/v1/wizard/options`)
      .then((r) => r.json())
      .then((data: WizardOptions) => {
        setOptions({
          settings: shuffle(data.settings || []),
          pairings: shuffle(data.pairings || []),
          kinks: shuffle(data.kinks || []),
          vibes: shuffle(data.vibes || []),
        });
      })
      .catch((e) => setError(`Failed to load options: ${e.message}`))
      .finally(() => setLoading(false));
  }, [apiUrl, mockMode]);

  const togglePairing = (pairing: string) => {
    setSelectedPairings((prev) =>
      prev.includes(pairing) ? prev.filter((p) => p !== pairing) : [...prev, pairing]
    );
  };

  const toggleKink = (kink: string) => {
    setSelectedKinks((prev) =>
      prev.includes(kink) ? prev.filter((k) => k !== kink) : [...prev, kink]
    );
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    setRawJson("");

    // Scroll to skeleton result area immediately
    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    // Mock mode — fake delay then return mock data
    if (mockMode) {
      await new Promise((r) => setTimeout(r, 8000));
      setResult(MOCK_RESULT);
      setRawJson(JSON.stringify(MOCK_RESULT, null, 2));
      setGenerating(false);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return;
    }

    const finalSetting = customSetting.trim() || selectedSetting || null;
    const finalVibe = customVibe.trim() || selectedVibe || null;
    const customKinksList = customKinks
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const finalKinks = [...selectedKinks, ...customKinksList];

    try {
      const res = await fetch(`${apiUrl}/api/v1/wizard/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setting: finalSetting,
          pairings: selectedPairings.length > 0 ? selectedPairings : null,
          kinks: finalKinks,
          vibe: finalVibe,
          preferences: [customPrefs, multiplayer ? "This is a multiplayer scenario where multiple human players can join" : null].filter(Boolean).join(". ") || null,
          num_characters: numChars,
          save: false,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Generation failed");
      }

      const data = await res.json();
      data.multiplayer = multiplayer;
      if (language.trim()) {
        data.language = language.trim();
      }
      setResult(data);
      setRawJson(JSON.stringify(data, null, 2));

      // Auto-save immediately so the scenario isn't lost
      if (librarianId) {
        try {
          const saveRes = await fetch(`${apiUrl}/api/v1/scenarios`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Librarian-ID": librarianId,
            },
            body: JSON.stringify({
              name: data.scenario_name || "Untitled Scenario",
              description: data.premise,
              setting: data.setting,
              data: data,
              public: false,
            }),
          });
          if (saveRes.ok) {
            const saved = await saveRes.json();
            setResult({ ...data, saved_to: saved.id });
          }
        } catch {
          // Auto-save failed silently — user can still manually save
        }
      }

      // Scroll to result
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  };

  const saveScenario = async () => {
    if (!librarianId) {
      setError("Please log in to save scenarios");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const scenario = JSON.parse(rawJson);
      const res = await fetch(`${apiUrl}/api/v1/scenarios`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Librarian-ID": librarianId,
        },
        body: JSON.stringify({
          name: scenario.scenario_name || "Untitled Scenario",
          description: scenario.premise,
          setting: scenario.setting,
          data: scenario,
          public: false,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Save failed");
      }
      const data = await res.json();
      setResult({ ...scenario, saved_to: data.id });
      // Navigate to scenario selector so user can see their saved scenario
      onSaved?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(rawJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-6">
          {/* Animated wizard icon */}
          <motion.div
            animate={{ rotate: [0, 10, -10, 0], y: [0, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="relative mx-auto w-16 h-16"
          >
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl" />
            <div className="relative w-16 h-16 bg-gradient-to-br from-primary/30 to-violet-500/30 rounded-full flex items-center justify-center border border-primary/30">
              <Wand2 className="w-7 h-7 text-primary" />
            </div>
          </motion.div>
          <div>
            <p className="text-muted-foreground text-sm">
              Gathering spell components...
            </p>
            <motion.div
              className="mt-3 h-1 w-32 mx-auto bg-secondary rounded-full overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-violet-500"
                animate={{ x: ["-100%", "100%"] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.div>
          </div>
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-1 mx-auto"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !options) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-12 h-12 mx-auto bg-destructive/10 rounded-full flex items-center justify-center">
            <X className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground">
            Make sure the API server is running
          </p>
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-1 mx-auto"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-[150px] translate-x-1/3 -translate-y-1/3" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-violet-500/[0.03] rounded-full blur-[120px] -translate-x-1/3 translate-y-1/3" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Header — sticky so back/roll are always reachable */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 sm:mb-12 sticky top-0 z-40 bg-background/80 backdrop-blur-xl -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 sm:py-0 sm:bg-transparent sm:backdrop-blur-none"
        >
          <div className="flex items-start gap-4">
            <button
              onClick={onBack}
              className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-secondary/50"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  {/* Animated wizard icon */}
                  <div className="relative">
                    <motion.div
                      className="absolute inset-0 bg-primary/30 rounded-lg blur-md"
                      animate={{ opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 3, repeat: Infinity }}
                    />
                    <div className="relative w-10 h-10 bg-gradient-to-br from-primary/30 to-violet-500/30 rounded-lg flex items-center justify-center border border-primary/30">
                      <Wand2 className="w-5 h-5 text-primary" />
                    </div>
                  </div>
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-primary via-[oklch(0.7_0.2_350)] to-primary bg-clip-text text-transparent">
                      Smut Wizard
                    </h1>
                    <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
                      Conjure deliciously depraved scenarios
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.header>

        {/* Roll the Dice — between header and form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-6 flex justify-center"
        >
          <motion.button
            onMouseDown={startRolling}
            onMouseUp={stopRolling}
            onMouseLeave={() => { if (rollingRef.current) stopRolling(); }}
            onTouchStart={startRolling}
            onTouchEnd={stopRolling}
            disabled={generating || !options}
            className="relative group px-5 py-2.5 bg-gradient-to-r from-violet-500/80 to-primary/80 hover:from-violet-500 hover:to-primary text-white rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center gap-2 select-none text-sm"
          >
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-violet-500 to-primary opacity-0 group-hover:opacity-50 blur-xl transition-opacity" />
            <span className="relative flex items-center gap-2">
              <motion.span animate={diceControls}><Dice5 className="w-4 h-4" /></motion.span>
              {rolling ? "Rolling..." : "Roll the Dice"}
            </span>
          </motion.button>
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="space-y-8"
        >
          {/* Characters & Mode — first section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="relative"
          >
            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500/50 via-emerald-500/20 to-transparent rounded-full" />
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Cast
              </h2>
            </div>

            <div className="flex flex-col gap-4">
              {/* Person icons */}
              <div className="flex items-end justify-center gap-1.5 h-14">
                <AnimatePresence mode="popLayout">
                  {multiplayer
                    ? [0, 1, 2, 3, 4].map((i) => (
                        <motion.div
                          key={`mp-${i}`}
                          initial={{ scale: 0, opacity: 0, y: 10 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ scale: 0, opacity: 0, y: 10 }}
                          transition={{ type: "spring", stiffness: 500, damping: 25, delay: i * 0.05 }}
                        >
                          <User
                            className={`w-10 h-10 ${
                              i === 2
                                ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                                : "text-pink-400/50 drop-shadow-[0_0_6px_rgba(236,72,153,0.2)]"
                            }`}
                            strokeWidth={1.5}
                          />
                        </motion.div>
                      ))
                    : [...Array(numChars)].map((_, i) => (
                        <motion.div
                          key={`solo-${i}`}
                          initial={{ scale: 0, opacity: 0, y: 10 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ scale: 0, opacity: 0, y: 10 }}
                          transition={{ type: "spring", stiffness: 500, damping: 25, delay: i * 0.05 }}
                        >
                          <User className="w-10 h-10 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]" strokeWidth={1.5} />
                        </motion.div>
                      ))
                  }
                </AnimatePresence>
              </div>

              {/* Number buttons — only in solo mode */}
              {!multiplayer && (
                <div className="flex items-center justify-center gap-2">
                  {Array.from({ length: maxChars }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => setNumChars(n)}
                      className={`w-10 h-10 rounded-lg text-sm font-semibold transition-all ${
                        numChars === n
                          ? "bg-emerald-500/30 border-2 border-emerald-400 text-emerald-300 shadow-lg shadow-emerald-500/10"
                          : "bg-secondary/30 border border-border/40 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}

              {/* In multiplayer, show single "1" button (locked) */}
              {multiplayer && (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-10 h-10 rounded-lg text-sm font-semibold bg-emerald-500/30 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center">
                    1
                  </div>
                </div>
              )}

              {/* Mode toggle: Solo / Multiplayer */}
              <div className="flex gap-2">
                <button
                  onClick={() => setMultiplayer(false)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                    !multiplayer
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-secondary/20 border-border/30 text-muted-foreground/60 hover:border-border/50 hover:text-muted-foreground"
                  }`}
                >
                  <User className="w-4 h-4" />
                  Solo
                </button>
                <button
                  onClick={() => setMultiplayer(true)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                    multiplayer
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-secondary/20 border-border/30 text-muted-foreground/60 hover:border-border/50 hover:text-muted-foreground"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Multiplayer
                </button>
              </div>

              {/* Language input — admin only while debugging */}
              {isAdmin && (
                <div className="mt-4">
                  <label className="text-xs text-muted-foreground/70 mb-1.5 block">
                    Language (optional)
                  </label>
                  <input
                    type="text"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    placeholder="English, Japanese, Pirate Speak, Elvish..."
                    className="w-full bg-secondary/50 border border-border/50 rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                  <p className="text-xs text-muted-foreground/50 mt-1.5">
                    Output narration in any language or style
                  </p>
                </div>
              )}
            </div>
          </motion.section>

          {/* Setting Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="relative"
          >
            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/50 via-primary/20 to-transparent rounded-full" />
            <div ref={settingRef} className="flex items-center gap-2 mb-3 scroll-mt-20">
              <MapPin className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Setting
              </h2>
            </div>

            {/* Custom dropdown */}
            <div className="relative mb-3">
              <button
                onClick={() => setSettingOpen(!settingOpen)}
                className="w-full flex items-center justify-between bg-secondary/50 hover:bg-secondary/70 border border-border/50 hover:border-border rounded-xl px-4 py-3 text-sm transition-all"
              >
                <span
                  className={
                    selectedSetting ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {selectedSetting || "Choose a setting or write your own..."}
                </span>
                <motion.div
                  animate={{ rotate: settingOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </motion.div>
              </button>

              <AnimatePresence>
                {settingOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute z-50 mt-2 w-full max-h-60 overflow-auto bg-card border border-border rounded-xl shadow-2xl shadow-black/30"
                  >
                    {options?.settings.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setSelectedSetting(s);
                          setCustomSetting("");
                          setSettingOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-secondary/70 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                          selectedSetting === s
                            ? "bg-primary/10 text-primary"
                            : "text-foreground/80"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <input
              type="text"
              value={customSetting}
              onChange={(e) => {
                setCustomSetting(e.target.value);
                if (e.target.value) setSelectedSetting("");
              }}
              placeholder="Or describe your own setting..."
              className="w-full bg-secondary/30 border border-border/30 hover:border-border/50 focus:border-primary/50 rounded-xl px-4 py-3 text-sm transition-all outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50"
            />
          </motion.section>

          {/* Pairings Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
            className="relative"
          >
            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-rose-500/50 via-rose-500/20 to-transparent rounded-full" />
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Pairings
              </h2>
              {selectedPairings.length > 0 && (
                <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full">
                  {selectedPairings.length} selected
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {options?.pairings?.map((p) => (
                <SelectableChip
                  key={p}
                  label={p}
                  selected={selectedPairings.includes(p)}
                  onClick={() => togglePairing(p)}
                />
              ))}
            </div>
          </motion.section>

          {/* Kinks Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26 }}
            className="relative"
          >
            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/50 via-primary/20 to-transparent rounded-full" />
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Kinks & Themes
              </h2>
              {selectedKinks.length > 0 && (
                <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full">
                  {selectedKinks.length} selected
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {options?.kinks.map((k) => (
                <SelectableChip
                  key={k}
                  label={k}
                  selected={selectedKinks.includes(k)}
                  onClick={() => toggleKink(k)}
                />
              ))}
            </div>

            <input
              type="text"
              value={customKinks}
              onChange={(e) => setCustomKinks(e.target.value)}
              placeholder="Add custom kinks (comma-separated)..."
              className="w-full bg-secondary/30 border border-border/30 hover:border-border/50 focus:border-primary/50 rounded-xl px-4 py-3 text-sm transition-all outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50"
            />
          </motion.section>

          {/* Vibe Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.30 }}
            className="relative"
          >
            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-500/50 via-amber-500/20 to-transparent rounded-full" />
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Vibe & Tone
              </h2>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {options?.vibes.map((v) => (
                <SelectableChip
                  key={v}
                  label={v}
                  selected={selectedVibe === v}
                  onClick={() => {
                    setSelectedVibe(selectedVibe === v ? "" : v);
                    if (selectedVibe !== v) setCustomVibe("");
                  }}
                  variant="vibe"
                />
              ))}
            </div>

            <input
              type="text"
              value={customVibe}
              onChange={(e) => {
                setCustomVibe(e.target.value);
                if (e.target.value) setSelectedVibe("");
              }}
              placeholder="Or describe your desired vibe..."
              className="w-full bg-secondary/30 border border-border/30 hover:border-border/50 focus:border-amber-500/50 rounded-xl px-4 py-3 text-sm transition-all outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-muted-foreground/50"
            />
          </motion.section>

          {/* Custom Preferences */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34 }}
            className="relative"
          >
            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-violet-500/50 via-violet-500/20 to-transparent rounded-full" />
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Special Requests
              </h2>
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                Optional
              </span>
            </div>

            <textarea
              value={customPrefs}
              onChange={(e) => setCustomPrefs(e.target.value)}
              placeholder="Any specific requests, character types, situations, or fantasies you'd like to see..."
              className="w-full bg-secondary/30 border border-border/30 hover:border-border/50 focus:border-violet-500/50 rounded-xl px-4 py-3 text-sm transition-all outline-none focus:ring-2 focus:ring-violet-500/20 placeholder:text-muted-foreground/50 h-28 resize-none"
            />
          </motion.section>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="flex gap-3 pt-4"
          >
            {/* Cast the Spell */}
            <motion.button
              onClick={generate}
              disabled={generating}
              className="relative flex-1 group py-4 bg-gradient-to-r from-primary to-[oklch(0.55_0.2_320)] hover:from-primary/90 hover:to-[oklch(0.5_0.2_320)] text-white rounded-xl font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-primary/25 overflow-hidden"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              {/* Shimmer effect */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                initial={{ x: "-100%" }}
                animate={generating ? { x: ["-100%", "100%"] } : {}}
                transition={{
                  duration: 1.5,
                  repeat: generating ? Infinity : 0,
                  ease: "linear",
                }}
              />
              <span className="relative flex items-center justify-center gap-2">
                {generating ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Sparkles className="w-5 h-5" />
                    </motion.div>
                    Conjuring...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    Cast the Spell
                  </>
                )}
              </span>
              {/* Floating particles when generating */}
              {generating && (
                <div className="absolute inset-0 flex items-center justify-center">
                  {[...Array(6)].map((_, i) => (
                    <MagicParticle key={i} delay={i * 0.3} drift={(i % 2 === 0 ? 1 : -1) * (10 + i * 5)} />
                  ))}
                </div>
              )}
            </motion.button>

            <motion.button
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  const parsed = JSON.parse(text);
                  setResult(parsed);
                  setRawJson(JSON.stringify(parsed, null, 2));
                  setShowRaw(true);
                  setError(null);
                } catch {
                  setError("Clipboard doesn't contain valid JSON");
                }
              }}
              className="px-5 py-4 bg-secondary/50 hover:bg-secondary border border-border/50 hover:border-border text-foreground/80 hover:text-foreground rounded-xl font-medium transition-all flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <ClipboardPaste className="w-5 h-5" />
              <span className="hidden sm:inline">Paste</span>
            </motion.button>
          </motion.div>

          {/* Error display */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-xl"
              >
                <X className="w-4 h-4 text-destructive shrink-0" />
                <p className="text-destructive text-sm">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Result — shown during generation (skeleton) and after (filled) */}
        <AnimatePresence>
          {(generating || result) && (
            <motion.div
              ref={resultRef}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="mt-12 relative scroll-mt-20"
            >
              {/* Result glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5 rounded-2xl blur-3xl" />

              <div className="relative bg-gradient-to-br from-card/95 to-card/80 backdrop-blur-sm border border-border/50 rounded-2xl overflow-hidden">
                {/* Result header */}
                <div className="p-4 sm:p-6 border-b border-border/30">
                  {result ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5 }}
                      className="space-y-3"
                    >
                      <div>
                        <motion.h2
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4 }}
                          className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent"
                        >
                          {result.scenario_name}
                        </motion.h2>
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.2, duration: 0.3 }}
                          className="text-muted-foreground text-xs mt-1 flex items-center gap-1"
                        >
                          <MapPin className="w-3 h-3" />
                          {result.setting}
                        </motion.p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Save button */}
                        {result.saved_to ? (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-medium border border-emerald-500/30">
                            <Check className="w-3.5 h-3.5" /> Saved
                          </span>
                        ) : (
                          <button
                            onClick={saveScenario}
                            disabled={saving}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                          >
                            {saving ? (
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{
                                  duration: 1,
                                  repeat: Infinity,
                                  ease: "linear",
                                }}
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </motion.div>
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            {saving ? "Saving" : "Save"}
                          </button>
                        )}

                        {/* Play button — desktop only, mobile gets it at the bottom */}
                        {result.saved_to && onStartBook && (
                          <button
                            onClick={() => onStartBook(result.saved_to!)}
                            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-primary/80 hover:bg-primary text-white rounded-lg text-xs font-medium transition-all"
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                            Play
                          </button>
                        )}

                        {/* JSON toggle — admin only */}
                        {isAdmin && (
                          <button
                            onClick={() => setShowRaw(!showRaw)}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                              showRaw
                                ? "bg-primary/20 text-primary border border-primary/30"
                                : "bg-secondary/30 text-muted-foreground/50 hover:text-muted-foreground border border-border/30 hover:border-border/50"
                            }`}
                          >
                            {showRaw ? (
                              <><Eye className="w-3 h-3" /> Pretty</>
                            ) : (
                              <><FileJson className="w-3 h-3" /> JSON</>
                            )}
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                      className="space-y-3"
                    >
                      <div>
                        <div className="h-7 w-64 max-w-full rounded-lg bg-gradient-to-r from-secondary/80 via-secondary/40 to-secondary/80 animate-shimmer" style={{ backgroundSize: "200% 100%" }} />
                        <div className="h-3 w-32 mt-2 rounded bg-gradient-to-r from-secondary/60 via-secondary/30 to-secondary/60 animate-shimmer" style={{ backgroundSize: "200% 100%" }} />
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Result content */}
                <div className="p-5 sm:p-6">
                  {generating && !result ? (
                    /* Skeleton state — progressive reveal during generation */
                    <div className="space-y-8">
                      {/* Wizard quips — rolling commentary */}
                      <WizardQuips />

                      {/* Premise skeleton */}
                      <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 5, duration: 0.5 }}
                      >
                        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                          <TypewriterText text="Premise" delay={5000} />
                        </h3>
                        <ShimmerSkeleton lines={3} />
                      </motion.div>

                      {/* Opening Scene skeleton */}
                      <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 10, duration: 0.5 }}
                      >
                        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                          <TypewriterText text="Opening Scene" delay={10000} />
                        </h3>
                        <div className="relative pl-4 border-l-2 border-primary/20">
                          <ShimmerSkeleton lines={4} />
                        </div>
                      </motion.div>

                      {/* Themes skeleton */}
                      <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 15, duration: 0.5 }}
                      >
                        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                          <TypewriterText text="Themes" delay={15000} />
                        </h3>
                        <div className="flex gap-2">
                          {[...Array(4)].map((_, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 15.5 + i * 0.2 }}
                              className="h-6 w-16 rounded-lg bg-gradient-to-r from-secondary/80 via-secondary/40 to-secondary/80 animate-shimmer"
                              style={{ backgroundSize: "200% 100%" }}
                            />
                          ))}
                        </div>
                      </motion.div>

                      {/* Characters skeleton */}
                      <motion.div
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 20, duration: 0.5 }}
                      >
                        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                          <Users className="w-3.5 h-3.5" />
                          <TypewriterText text="Characters" delay={20000} />
                        </h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[...Array(numChars)].map((_, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 20, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{ delay: 20.5 + i * 0.8, duration: 0.4 }}
                              className="bg-gradient-to-br from-card/90 to-card/70 border border-border/50 rounded-xl p-4"
                            >
                              <div className="flex items-center gap-2 mb-3">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-violet-500/20 animate-shimmer" style={{ backgroundSize: "200% 100%" }} />
                                <div className="h-4 w-24 rounded bg-gradient-to-r from-secondary/80 via-secondary/40 to-secondary/80 animate-shimmer" style={{ backgroundSize: "200% 100%" }} />
                              </div>
                              <ShimmerSkeleton lines={2} />
                            </motion.div>
                          ))}
                        </div>
                      </motion.div>
                    </div>
                  ) : result ? (
                    <AnimatePresence mode="wait">
                      {showRaw ? (
                        <motion.div
                          key="raw"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="space-y-3"
                        >
                          <div className="flex gap-2">
                            <button
                              onClick={copyToClipboard}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/70 hover:bg-secondary text-xs rounded-lg transition-colors"
                            >
                              {copied ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  Copy
                                </>
                              )}
                            </button>
                            <button
                              onClick={async () => {
                                const text = await navigator.clipboard.readText();
                                setRawJson(text);
                                try {
                                  setResult(JSON.parse(text));
                                } catch {
                                  // Invalid JSON while editing
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/70 hover:bg-secondary text-xs rounded-lg transition-colors"
                            >
                              <ClipboardPaste className="w-3.5 h-3.5" />
                              Paste
                            </button>
                          </div>

                          <textarea
                            value={rawJson}
                            onChange={(e) => {
                              setRawJson(e.target.value);
                              try {
                                const parsed = JSON.parse(e.target.value);
                                setResult({ ...parsed, saved_to: undefined });
                              } catch {
                                // Invalid JSON while typing
                              }
                            }}
                            className="w-full bg-background/50 border border-border/30 rounded-xl p-4 text-xs font-mono h-[50vh] resize-none outline-none focus:border-primary/30 transition-colors"
                            spellCheck={false}
                          />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="pretty"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="space-y-6"
                        >
                          {/* Premise */}
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1, duration: 0.4 }}
                          >
                            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                              Premise
                            </h3>
                            <ExpandableText
                              text={result.premise}
                              className="text-sm text-foreground/90 leading-relaxed"
                            />
                          </motion.div>

                          {/* Opening */}
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3, duration: 0.4 }}
                          >
                            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                              Opening Scene
                            </h3>
                            <div className="relative pl-4 border-l-2 border-primary/30">
                              <ExpandableText
                                text={result.opening_situation}
                                className="text-sm text-foreground/80 italic leading-relaxed"
                              />
                            </div>
                          </motion.div>

                          {/* Themes */}
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5, duration: 0.4 }}
                          >
                            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                              Themes
                            </h3>
                            <div className="flex flex-wrap gap-1.5">
                              {result.themes.map((t, i) => (
                                <motion.span
                                  key={i}
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ delay: 0.6 + i * 0.05 }}
                                  className="px-2.5 py-1 bg-secondary/70 rounded-lg text-xs text-foreground/70"
                                >
                                  {t}
                                </motion.span>
                              ))}
                            </div>
                          </motion.div>

                          {/* Characters */}
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.7, duration: 0.4 }}
                          >
                            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                              <Users className="w-3.5 h-3.5" />
                              Characters ({result.characters.length})
                            </h3>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {result.characters.map((char, i) => (
                                <CharacterCard
                                  key={char.name}
                                  character={char}
                                  index={i}
                                />
                              ))}
                            </div>
                          </motion.div>

                          {/* Play button — mobile only, prominent at bottom */}
                          {result.saved_to && onStartBook && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.9, duration: 0.4 }}
                              className="sm:hidden pt-2"
                            >
                              <button
                                onClick={() => onStartBook(result.saved_to!)}
                                className="w-full py-3 bg-gradient-to-r from-primary to-[oklch(0.55_0.2_320)] text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/25"
                              >
                                <BookOpen className="w-5 h-5" />
                                Start Playing
                              </button>
                            </motion.div>
                          )}

                          {/* Saved indicator */}
                          {result.saved_to && (
                            <motion.p
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: 1.0 }}
                              className="text-xs text-muted-foreground pt-2 border-t border-border/30"
                            >
                              Saved as:{" "}
                              <code className="px-1.5 py-0.5 bg-secondary/50 rounded text-primary/80">
                                {result.saved_to}
                              </code>
                            </motion.p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  ) : null}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

type CharacterData = {
  name: string;
  species: string;
  personality: string;
  appearance: string;
  desires: string;
  backstory: string;
};

type NPCInfo = {
  name: string;
  description?: string;
  species?: string;
  personality?: string;
  appearance?: string;
  desires?: string;
  backstory?: string;
};

type RememberedCharacter = {
  name: string;
  appearances: number;
  last_seen_page?: number;
  emotional_state?: string;
  personality?: string;
  sample_dialogue?: string[];
  sample_actions?: string[];
};

type Props = {
  apiUrl: string;
  onCharacterAdded: (char: CharacterData) => void;
  onClose: () => void;
  existingCharacters: string[];
  npcs?: NPCInfo[];
};

// Match NPC by name (case-insensitive, first name match)
function findMatchingNPC(name: string, npcs: NPCInfo[]): NPCInfo | null {
  if (!name.trim() || !npcs.length) return null;

  const searchName = name.trim().toLowerCase();

  for (const npc of npcs) {
    const npcName = npc.name.toLowerCase();
    // Exact match (case-insensitive)
    if (npcName === searchName) return npc;
    // First name match (e.g., "Jake" matches "Jake Morrison")
    if (npcName.startsWith(searchName + " ")) return npc;
    // User typed full name, NPC has first name only
    if (searchName.startsWith(npcName + " ")) return npc;
  }

  return null;
}

const SPECIES_SUGGESTIONS = [
  "Human",
  "Elf",
  "Half-Elf",
  "Orc",
  "Demon",
  "Angel",
  "Vampire",
  "Werewolf",
  "Dragon-blooded",
  "Succubus",
  "Incubus",
  "Fae",
  "Nymph",
  "Satyr",
  "Centaur",
  "Mermaid",
  "Alien",
  "Android",
  "Shapeshifter",
];

const PERSONALITY_SUGGESTIONS = [
  "Bold and dominant",
  "Shy but curious",
  "Seductive and manipulative",
  "Innocent and naive",
  "Wild and untamed",
  "Cold and calculating",
  "Warm and nurturing",
  "Playful and mischievous",
  "Stoic but passionate",
  "Submissive and eager",
];

export function CharacterWizard({ apiUrl, onCharacterAdded, onClose, existingCharacters, npcs: propNpcs = [] }: Props) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [npcs, setNpcs] = useState<NPCInfo[]>(propNpcs);
  const [remembered, setRemembered] = useState<RememberedCharacter[]>([]);

  // Fetch NPCs, potential characters, and remembered characters from API on mount
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch world data (scenario NPCs + remembered)
        const worldRes = await fetch(`${apiUrl}/api/v1/world`);
        if (worldRes.ok) {
          const data = await worldRes.json();
          const allNpcs: NPCInfo[] = [];

          if (data.npcs && Array.isArray(data.npcs)) {
            allNpcs.push(...data.npcs);
          }

          // Also fetch potential characters (narrator-detected NPCs)
          try {
            const potentialRes = await fetch(`${apiUrl}/api/v1/potential-characters`);
            if (potentialRes.ok) {
              const potentialData = await potentialRes.json();
              if (Array.isArray(potentialData)) {
                for (const pc of potentialData) {
                  // Only add if not already in npcs list
                  if (!allNpcs.some(n => n.name.toLowerCase() === pc.name.toLowerCase())) {
                    allNpcs.push({
                      name: pc.name,
                      description: pc.description,
                    });
                  }
                }
              }
            }
          } catch {
            // Potential characters endpoint failed, continue with scenario NPCs
          }

          setNpcs(allNpcs);

          if (data.remembered && Array.isArray(data.remembered)) {
            setRemembered(data.remembered);
          }
        }
      } catch {
        // Silently fail - character data is optional
      }
    }
    fetchData();
  }, [apiUrl]);

  const [char, setChar] = useState<CharacterData>({
    name: "",
    species: "",
    personality: "",
    appearance: "",
    desires: "",
    backstory: "",
  });

  // Check if name matches an existing true character (case-insensitive)
  const existingCharacterMatch = useMemo((): string | null => {
    const searchName = char.name.trim().toLowerCase();
    if (searchName.length < 2) return null;

    for (const existing of existingCharacters) {
      const existingLower = existing.toLowerCase();
      if (existingLower === searchName ||
          existingLower.startsWith(searchName + " ") ||
          searchName.startsWith(existingLower + " ")) {
        return existing;
      }
    }
    return null;
  }, [char.name, existingCharacters]);

  // Check for NPC or remembered character match when name changes
  // Only if NOT already a true character
  const currentMatch = useMemo((): { type: "npc" | "remembered"; data: NPCInfo | RememberedCharacter } | null => {
    // Don't suggest promotion if already a true character
    if (existingCharacterMatch) return null;

    // First check NPCs (structured data)
    const npcMatch = findMatchingNPC(char.name, npcs);
    if (npcMatch) {
      return { type: "npc", data: npcMatch };
    }

    // Then check remembered characters (from story history)
    const searchName = char.name.trim().toLowerCase();
    if (searchName.length < 2) return null;

    for (const rem of remembered) {
      const remName = rem.name.toLowerCase();
      if (remName === searchName ||
          remName.startsWith(searchName + " ") ||
          searchName.startsWith(remName + " ")) {
        return { type: "remembered", data: rem };
      }
    }
    return null;
  }, [char.name, npcs, remembered, existingCharacterMatch]);

  // Track if we auto-filled from NPC
  const [autoFilledFrom, setAutoFilledFrom] = useState<string | null>(null);

  const updateField = useCallback((field: keyof CharacterData, value: string) => {
    setChar(prev => ({ ...prev, [field]: value }));
    setError(null);
    // Reset auto-fill state when name changes
    if (field === "name") {
      setAutoFilledFrom(null);
    }
  }, []);

  // Auto-fill from NPC or remembered character when match is detected
  useEffect(() => {
    if (currentMatch && step === 0 && !autoFilledFrom) {
      if (currentMatch.type === "npc") {
        const npc = currentMatch.data as NPCInfo;
        setChar(prev => ({
          ...prev,
          species: npc.species || prev.species,
          personality: npc.personality || npc.description || prev.personality,
          appearance: npc.appearance || prev.appearance,
          desires: npc.desires || prev.desires,
          backstory: npc.backstory || prev.backstory,
        }));
        setAutoFilledFrom(npc.name);
      } else {
        // Remembered character - build personality from their history
        const rem = currentMatch.data as RememberedCharacter;
        const personalityParts: string[] = [];
        if (rem.emotional_state) {
          personalityParts.push(rem.emotional_state);
        }
        if (rem.personality) {
          personalityParts.push(rem.personality);
        }
        setChar(prev => ({
          ...prev,
          personality: personalityParts.join(". ") || prev.personality,
          // We don't have species/appearance/etc for remembered characters
        }));
        setAutoFilledFrom(rem.name);
      }
    }
  }, [currentMatch, step, autoFilledFrom]);

  const canProceed = useCallback(() => {
    switch (step) {
      case 0: return char.name.trim().length > 0;
      case 1: return char.species.trim().length > 0;
      case 2: return char.personality.trim().length > 0;
      case 3: return char.appearance.trim().length > 0;
      case 4: return char.desires.trim().length > 0;
      case 5: return char.backstory.trim().length > 0;
      default: return false;
    }
  }, [step, char]);

  const handleNext = useCallback(() => {
    // Case-insensitive duplicate check
    const nameLower = char.name.trim().toLowerCase();
    const isDuplicate = existingCharacters.some(
      existing => existing.toLowerCase() === nameLower
    );
    if (step === 0 && isDuplicate) {
      setError("A character with this name already exists");
      return;
    }
    if (step < 5) {
      setStep(step + 1);
    }
  }, [step, char.name, existingCharacters]);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(char),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to add character");
      }

      onCharacterAdded(char);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add character");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, char, onCharacterAdded]);

  const steps = [
    {
      title: "Name",
      field: "name" as const,
      placeholder: "Enter character name...",
      suggestions: null,
    },
    {
      title: "Species",
      field: "species" as const,
      placeholder: "What are they?",
      suggestions: SPECIES_SUGGESTIONS,
    },
    {
      title: "Personality",
      field: "personality" as const,
      placeholder: "How do they behave?",
      suggestions: PERSONALITY_SUGGESTIONS,
    },
    {
      title: "Appearance",
      field: "appearance" as const,
      placeholder: "Describe their physical appearance...",
      suggestions: null,
    },
    {
      title: "Desires",
      field: "desires" as const,
      placeholder: "What do they want? What drives them?",
      suggestions: null,
    },
    {
      title: "Backstory",
      field: "backstory" as const,
      placeholder: "Brief history or background...",
      suggestions: null,
    },
  ];

  const currentStep = steps[step];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-card border border-border rounded-xl p-6 max-w-md w-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-primary">Create Character</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress */}
        <div className="flex gap-1 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              {currentStep.title}
            </label>

            {currentStep.field === "backstory" || currentStep.field === "appearance" ? (
              <textarea
                value={char[currentStep.field]}
                onChange={e => updateField(currentStep.field, e.target.value)}
                placeholder={currentStep.placeholder}
                rows={4}
                className="w-full px-4 py-3 bg-secondary/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                autoFocus
              />
            ) : (
              <input
                type="text"
                value={char[currentStep.field]}
                onChange={e => updateField(currentStep.field, e.target.value)}
                placeholder={currentStep.placeholder}
                className="w-full px-4 py-3 bg-secondary/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter" && canProceed()) {
                    e.preventDefault();
                    if (step < 5) handleNext();
                    else handleSubmit();
                  }
                }}
              />
            )}

            {/* Already exists warning */}
            {step === 0 && existingCharacterMatch && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 p-3 rounded-lg border bg-destructive/10 border-destructive/20"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <span>Character already exists</span>
                </div>
                <p className="mt-1.5 text-[11px] text-destructive/70">
                  "{existingCharacterMatch}" is already a true character in this scenario.
                </p>
              </motion.div>
            )}

            {/* NPC/Remembered character promotion indicator */}
            {step === 0 && !existingCharacterMatch && autoFilledFrom && currentMatch && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-3 p-3 rounded-lg border ${
                  currentMatch.type === "remembered"
                    ? "bg-amber-500/10 border-amber-500/20"
                    : "bg-purple-500/10 border-purple-500/20"
                }`}
              >
                <div className={`flex items-center gap-2 text-xs font-medium ${
                  currentMatch.type === "remembered" ? "text-amber-400" : "text-purple-400"
                }`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {currentMatch.type === "remembered" ? (
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    ) : (
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11l2 2 4-4" />
                    )}
                  </svg>
                  <span>
                    {currentMatch.type === "remembered"
                      ? "Character from story"
                      : "Promote NPC to character"}
                  </span>
                </div>
                <p className={`mt-1.5 text-[11px] ${
                  currentMatch.type === "remembered" ? "text-amber-400/70" : "text-purple-400/70"
                }`}>
                  {currentMatch.type === "remembered"
                    ? `Appeared ${(currentMatch.data as RememberedCharacter).appearances} times. Promoting to true character enables inner thoughts.`
                    : "This NPC exists in the scenario. Promoting them to a true character lets you read their inner thoughts."}
                </p>
              </motion.div>
            )}

            {/* Suggestions */}
            {currentStep.suggestions && (
              <div className="flex flex-wrap gap-2 mt-3">
                {currentStep.suggestions.slice(0, 8).map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => updateField(currentStep.field, suggestion)}
                    className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                      char[currentStep.field] === suggestion
                        ? "bg-primary/20 border-primary/50 text-primary"
                        : "bg-secondary/30 border-border/50 text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Error */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-destructive text-sm mt-4"
          >
            {error}
          </motion.p>
        )}


        {/* Actions */}
        <div className="flex justify-between mt-6">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {step > 0 ? "Back" : "Cancel"}
          </button>

          {step < 5 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-30 hover:bg-primary/90 transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canProceed() || loading}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-30 hover:bg-primary/90 transition-colors"
            >
              {loading ? "Creating..." : "Create Character"}
            </button>
          )}
        </div>

        {/* Preview */}
        {step === 5 && char.name && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-6 p-4 bg-secondary/30 rounded-lg border border-border/50"
          >
            <h3 className="text-sm font-semibold text-primary">{char.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">{char.species}</p>
            <p className="text-xs text-foreground/70 mt-2 line-clamp-2">{char.personality}</p>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}

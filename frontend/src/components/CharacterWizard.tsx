import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

type CharacterData = {
  name: string;
  species: string;
  personality: string;
  appearance: string;
  desires: string;
  backstory: string;
};

type Props = {
  apiUrl: string;
  onCharacterAdded: (char: CharacterData) => void;
  onClose: () => void;
  existingCharacters: string[];
  playerNickname?: string;
  isInitialSetup?: boolean;
};

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

export function CharacterWizard({ apiUrl, onCharacterAdded, onClose, existingCharacters, playerNickname, isInitialSetup }: Props) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [char, setChar] = useState<CharacterData>({
    name: playerNickname || "",
    species: "",
    personality: "",
    appearance: "",
    desires: "",
    backstory: "",
  });

  const updateField = useCallback((field: keyof CharacterData, value: string) => {
    setChar(prev => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

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
    if (step === 0 && existingCharacters.includes(char.name.trim())) {
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

  // For initial setup, render full-screen; otherwise modal overlay
  const containerClass = isInitialSetup
    ? "min-h-screen bg-background flex items-center justify-center p-4"
    : "fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={containerClass}
      onClick={isInitialSetup ? undefined : onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-card border border-border rounded-xl p-4 sm:p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-primary">
              {isInitialSetup ? "Create Your Character" : "Create Character"}
            </h2>
            {isInitialSetup && (
              <p className="text-xs text-muted-foreground mt-1">
                Who will you be in this world?
              </p>
            )}
          </div>
          {!isInitialSetup && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
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

            {/* Suggestions */}
            {currentStep.suggestions && (
              <div className="flex flex-wrap gap-2 mt-3">
                {currentStep.suggestions.slice(0, 8).map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => updateField(currentStep.field, suggestion)}
                    className={`px-2.5 sm:px-2 py-1.5 sm:py-1 text-sm sm:text-xs rounded-full border transition-colors ${
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
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2.5 sm:py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          ) : !isInitialSetup ? (
            <button
              onClick={onClose}
              className="px-4 py-2.5 sm:py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          ) : (
            <div /> // Empty div for spacing in initial setup
          )}

          {step < 5 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className="px-6 py-2.5 sm:py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-30 hover:bg-primary/90 transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canProceed() || loading}
              className="px-6 py-2.5 sm:py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-30 hover:bg-primary/90 transition-colors"
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

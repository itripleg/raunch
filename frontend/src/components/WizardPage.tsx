import { useState, useEffect } from "react";
import { motion } from "motion/react";

type WizardOptions = {
  settings: string[];
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

const API_BASE = "http://localhost:8000";

export function WizardPage() {
  const [options, setOptions] = useState<WizardOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedScenario | null>(null);

  // Form state
  const [selectedSetting, setSelectedSetting] = useState<string>("");
  const [customSetting, setCustomSetting] = useState<string>("");
  const [selectedKinks, setSelectedKinks] = useState<string[]>([]);
  const [customKinks, setCustomKinks] = useState<string>("");
  const [selectedVibe, setSelectedVibe] = useState<string>("");
  const [customVibe, setCustomVibe] = useState<string>("");
  const [customPrefs, setCustomPrefs] = useState("");
  const [numChars, setNumChars] = useState(3);
  const [showRaw, setShowRaw] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [saving, setSaving] = useState(false);

  // Random roll - preselect a mix
  const randomRoll = () => {
    if (!options) return;
    setSelectedSetting(options.settings[Math.floor(Math.random() * options.settings.length)]);
    setCustomSetting("");
    // Pick 2-4 random kinks
    const shuffled = [...options.kinks].sort(() => Math.random() - 0.5);
    setSelectedKinks(shuffled.slice(0, 2 + Math.floor(Math.random() * 3)));
    setCustomKinks("");
    setSelectedVibe(options.vibes[Math.floor(Math.random() * options.vibes.length)]);
    setCustomVibe("");
    setNumChars(1 + Math.floor(Math.random() * 4)); // 1-4 chars
  };

  // Fetch options on mount
  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/v1/wizard/options`)
      .then((r) => r.json())
      .then(setOptions)
      .catch((e) => setError(`Failed to load options: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

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

    // Combine preset + custom values
    const finalSetting = customSetting.trim() || selectedSetting || null;
    const finalVibe = customVibe.trim() || selectedVibe || null;
    const customKinksList = customKinks
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const finalKinks = [...selectedKinks, ...customKinksList];

    try {
      const res = await fetch(`${API_BASE}/api/v1/wizard/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setting: finalSetting,
          kinks: finalKinks,
          vibe: finalVibe,
          preferences: customPrefs || null,
          num_characters: numChars,
          save: false, // Never auto-save
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Generation failed");
      }

      const data = await res.json();
      setResult(data);
      setRawJson(JSON.stringify(data, null, 2));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  };

  const saveScenario = async () => {
    setSaving(true);
    setError(null);
    try {
      const scenario = JSON.parse(rawJson);
      const res = await fetch(`${API_BASE}/api/v1/scenarios/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawJson,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Save failed");
      }
      const data = await res.json();
      setResult({ ...scenario, saved_to: data.saved_to });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading wizard options...</p>
      </div>
    );
  }

  if (error && !options) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <p className="text-sm text-muted-foreground">
            Make sure the API server is running on port 8000
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-primary">Smut Wizard</h1>
          <button
            onClick={randomRoll}
            disabled={generating || !options}
            className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            🎲 Roll
          </button>
        </div>
        <p className="text-muted-foreground mb-8">
          Generate depraved scenarios for your interactive fiction
        </p>

        {/* Form */}
        <div className="space-y-6 mb-8">
          {/* Setting */}
          <div>
            <label className="block text-sm font-medium mb-2">Setting</label>
            <select
              value={selectedSetting}
              onChange={(e) => {
                setSelectedSetting(e.target.value);
                if (e.target.value) setCustomSetting("");
              }}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm mb-2"
            >
              <option value="">Pick a preset or type your own...</option>
              {options?.settings.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={customSetting}
              onChange={(e) => {
                setCustomSetting(e.target.value);
                if (e.target.value) setSelectedSetting("");
              }}
              placeholder="Or describe your own setting..."
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Kinks */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Kinks / Themes ({selectedKinks.length} selected)
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {options?.kinks.map((k) => (
                <button
                  key={k}
                  onClick={() => toggleKink(k)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                    selectedKinks.includes(k)
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary hover:bg-secondary/80"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customKinks}
              onChange={(e) => setCustomKinks(e.target.value)}
              placeholder="Add custom kinks (comma-separated)..."
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Vibe */}
          <div>
            <label className="block text-sm font-medium mb-2">Vibe / Tone</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {options?.vibes.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setSelectedVibe(selectedVibe === v ? "" : v);
                    if (selectedVibe !== v) setCustomVibe("");
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                    selectedVibe === v
                      ? "bg-amber-500 text-black"
                      : "bg-secondary hover:bg-secondary/80"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customVibe}
              onChange={(e) => {
                setCustomVibe(e.target.value);
                if (e.target.value) setSelectedVibe("");
              }}
              placeholder="Or describe your own vibe..."
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Custom Preferences */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Custom Preferences (optional)
            </label>
            <textarea
              value={customPrefs}
              onChange={(e) => setCustomPrefs(e.target.value)}
              placeholder="Any specific requests, character types, situations..."
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm h-24 resize-none"
            />
          </div>

          {/* Num Characters */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Number of Characters: {numChars}
            </label>
            <input
              type="range"
              min={1}
              max={5}
              value={numChars}
              onChange={(e) => setNumChars(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={generate}
              disabled={generating}
              className="flex-1 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate"}
            </button>
            <button
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
              className="px-4 py-3 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg font-medium transition-colors"
            >
              Paste
            </button>
          </div>

          {error && (
            <p className="text-destructive text-sm text-center">{error}</p>
          )}
        </div>

        {/* Result */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-lg p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-bold text-primary">
                {result.scenario_name}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    showRaw
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary hover:bg-secondary/80"
                  }`}
                >
                  {showRaw ? "Pretty" : "Raw"}
                </button>
                {result.saved_to ? (
                  <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">
                    Saved
                  </span>
                ) : (
                  <button
                    onClick={saveScenario}
                    disabled={saving}
                    className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                )}
              </div>
            </div>

            {showRaw ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(rawJson)}
                    className="text-xs px-2 py-1 bg-secondary hover:bg-secondary/80 rounded"
                  >
                    Copy
                  </button>
                  <button
                    onClick={async () => {
                      const text = await navigator.clipboard.readText();
                      setRawJson(text);
                      try {
                        setResult(JSON.parse(text));
                      } catch {
                        // Invalid JSON, that's ok - they can fix it
                      }
                    }}
                    className="text-xs px-2 py-1 bg-secondary hover:bg-secondary/80 rounded"
                  >
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
                  className="w-full bg-secondary/50 rounded-lg p-4 text-xs font-mono h-[50vh] resize-none"
                  spellCheck={false}
                />
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">
                    Setting
                  </h3>
                  <p className="text-sm">{result.setting}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">
                    Premise
                  </h3>
                  <p className="text-sm">{result.premise}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">
                    Opening
                  </h3>
                  <p className="text-sm italic">{result.opening_situation}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">
                    Themes
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {result.themes.map((t, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-secondary rounded text-xs"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">
                    Characters ({result.characters.length})
                  </h3>
                  <div className="space-y-3">
                    {result.characters.map((char, i) => (
                      <div
                        key={i}
                        className="bg-secondary/50 rounded-lg p-3 space-y-1"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-primary">
                            {char.name}
                          </span>
                          {char.species && (
                            <span className="text-xs text-muted-foreground">
                              ({char.species})
                            </span>
                          )}
                        </div>
                        {char.personality && (
                          <p className="text-xs text-muted-foreground">
                            {char.personality}
                          </p>
                        )}
                        {char.appearance && (
                          <p className="text-xs">{char.appearance}</p>
                        )}
                        {char.desires && (
                          <p className="text-xs text-amber-400/80 italic">
                            Desires: {char.desires}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {result.saved_to && (
                  <p className="text-xs text-muted-foreground">
                    Saved to: <code>{result.saved_to}</code>
                  </p>
                )}
              </>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

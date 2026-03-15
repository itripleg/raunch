import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft } from "lucide-react";

type Scenario = {
  file: string;
  name: string;
  setting?: string;
  characters: number;
  themes: string[];
};

type Props = {
  apiUrl: string;
  onScenarioLoaded: () => void;
  onBack?: () => void;
};

export function ScenarioSelector({ apiUrl, onScenarioLoaded, onBack }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingWorld, setLoadingWorld] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch scenarios on mount
  useEffect(() => {
    fetchScenarios();
  }, [apiUrl]);

  const fetchScenarios = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/scenarios`);
      if (!response.ok) {
        throw new Error("Failed to fetch scenarios");
      }
      const data = await response.json();
      setScenarios(data);
      // Auto-select first scenario if available
      if (data.length > 0 && !selectedScenario) {
        setSelectedScenario(data[0].file);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scenarios");
    } finally {
      setLoading(false);
    }
  };

  const handleRollRandom = async () => {
    setRolling(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/scenarios/roll`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to generate scenario");
      }
      // Refresh the scenario list after rolling
      await fetchScenarios();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate scenario");
    } finally {
      setRolling(false);
    }
  };

  const handleLoadScenario = async () => {
    if (!selectedScenario) return;

    setLoadingWorld(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/world/load`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario: selectedScenario }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to load scenario");
      }
      onScenarioLoaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scenario");
      setLoadingWorld(false);
    }
  };

  const selectedScenarioData = scenarios.find((s) => s.file === selectedScenario);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Ambient background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-[oklch(0.08_0.03_340)]" />
        <motion.div
          className="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full bg-primary/[0.03] blur-[150px]"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.4, 0.6, 0.4],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-violet-500/[0.02] blur-[120px]"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            scale: [1.05, 1, 1.05],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6">
        {/* Back button */}
        {onBack && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            onClick={onBack}
            className="absolute top-6 left-6 p-2 text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </motion.button>
        )}

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-8"
        >
          <h2 className="text-3xl font-bold tracking-tight text-foreground/90">
            select scenario
          </h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="text-muted-foreground/60 text-base mt-2"
          >
            choose a scenario to begin
          </motion.p>
        </motion.div>

        {/* Scenario List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-h-96 overflow-y-auto mb-6 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex justify-center py-8"
              >
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-primary/50"
                      animate={{
                        opacity: [0.2, 0.8, 0.2],
                        scale: [0.9, 1.1, 0.9],
                      }}
                      transition={{
                        duration: 1.8,
                        repeat: Infinity,
                        delay: i * 0.25,
                        ease: "easeInOut",
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            ) : scenarios.length === 0 ? (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center text-muted-foreground/50 text-base py-8"
              >
                no scenarios available
              </motion.p>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {scenarios.map((scenario, index) => (
                  <motion.button
                    key={scenario.file}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.4 }}
                    onClick={() => setSelectedScenario(scenario.file)}
                    className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-300 ${
                      selectedScenario === scenario.file
                        ? "border-primary/40 bg-primary/[0.05] shadow-[0_0_20px_oklch(0.65_0.22_340_/_0.08)]"
                        : "border-border/30 bg-card/30 hover:border-border/50 hover:bg-card/50"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-medium text-foreground/90 truncate">
                          {scenario.name}
                        </p>
                        {scenario.setting && (
                          <p className="text-sm text-muted-foreground/60 mt-1.5 line-clamp-2">
                            {scenario.setting}
                          </p>
                        )}
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <span className="text-sm text-muted-foreground/50">
                          {scenario.characters} character{scenario.characters !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    {scenario.themes.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {scenario.themes.slice(0, 4).map((theme) => (
                          <span
                            key={theme}
                            className="text-xs px-2.5 py-1 rounded-full bg-border/20 text-muted-foreground/60"
                          >
                            {theme}
                          </span>
                        ))}
                        {scenario.themes.length > 4 && (
                          <span className="text-xs text-muted-foreground/40">
                            +{scenario.themes.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-xs text-destructive/70 mb-4"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex flex-col sm:flex-row gap-4 w-full"
        >
          {/* Roll Random Button */}
          <motion.button
            onClick={handleRollRandom}
            disabled={rolling}
            className="flex-1 px-8 py-3 text-base text-muted-foreground/70 hover:text-muted-foreground border border-border/30 hover:border-border/50 rounded-full transition-all duration-500 disabled:opacity-50 disabled:cursor-not-allowed"
            whileHover={{ scale: rolling ? 1 : 1.02 }}
            whileTap={{ scale: rolling ? 1 : 0.98 }}
          >
            {rolling ? "rolling..." : "roll random"}
          </motion.button>

          {/* Start Button */}
          <motion.button
            onClick={handleLoadScenario}
            disabled={!selectedScenario || loadingWorld}
            className="flex-1 px-8 py-3 text-base text-primary/80 hover:text-primary border border-primary/20 hover:border-primary/40 rounded-full transition-all duration-500 hover:shadow-[0_0_30px_oklch(0.65_0.22_340_/_0.12)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
            whileHover={{ scale: !selectedScenario || loadingWorld ? 1 : 1.02 }}
            whileTap={{ scale: !selectedScenario || loadingWorld ? 1 : 0.98 }}
          >
            {loadingWorld ? "loading..." : "start"}
          </motion.button>
        </motion.div>

        {/* Selected Scenario Info */}
        <AnimatePresence>
          {selectedScenarioData && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="text-xs text-muted-foreground/40 mt-4 text-center"
            >
              {selectedScenarioData.name} • {selectedScenarioData.characters} character
              {selectedScenarioData.characters !== 1 ? "s" : ""}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

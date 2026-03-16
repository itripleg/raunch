import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Trash2, Plus, Sparkles, Wand2 } from "lucide-react";

type Scenario = {
  file?: string;  // For file-based scenarios
  id?: string;    // For DB scenarios
  name: string;
  setting?: string;
  characters: number;
  themes: string[];
  source: "file" | "db";
  public?: boolean;
  owner_id?: string;
};

type Props = {
  apiUrl: string;
  librarianId: string | null;
  onScenarioSelected: (scenario: string) => void;
  isLoading?: boolean;
  onBack?: () => void;
  onOpenWizard?: () => void;
  initialTab?: "my" | "public";
};

export function ScenarioSelector({ apiUrl, librarianId, onScenarioSelected, isLoading, onBack, onOpenWizard, initialTab }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"my" | "public">(initialTab ?? "public");

  // Helper to get unique identifier for a scenario
  const getScenarioId = (scenario: Scenario) => scenario.file || scenario.id || "";

  useEffect(() => {
    fetchScenarios();
  }, [apiUrl, librarianId]);

  const fetchScenarios = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch public scenarios
      const response = await fetch(`${apiUrl}/api/v1/scenarios`);
      if (!response.ok) throw new Error("Failed to fetch scenarios");
      const data: Scenario[] = await response.json();

      // Also fetch user's own private scenarios if logged in
      let allScenarios = [...data];
      if (librarianId) {
        try {
          const mineResponse = await fetch(`${apiUrl}/api/v1/scenarios/mine`, {
            headers: { "X-Librarian-ID": librarianId },
          });
          if (mineResponse.ok) {
            const mine = await mineResponse.json();
            // mine returns ScenarioResponse shape — map to Scenario and deduplicate
            const existingIds = new Set(data.map((s) => s.id).filter(Boolean));
            for (const s of mine) {
              if (!existingIds.has(s.id)) {
                allScenarios.push({
                  id: s.id,
                  name: s.name,
                  setting: s.setting,
                  characters: s.data?.characters?.length ?? 0,
                  themes: s.data?.themes ?? [],
                  source: "db" as const,
                  public: s.public,
                  owner_id: s.owner_id,
                });
              }
            }
          }
        } catch {
          // Non-fatal — private scenarios just won't show
        }
      }

      setScenarios(allScenarios);

      // Auto-select first non-test scenario
      const visible = allScenarios.filter((s: Scenario) => {
        const id = s.file || s.id || "";
        return !id.startsWith("test_");
      });
      if (visible.length > 0 && !selectedScenario) {
        const firstId = visible[0].file || visible[0].id || "";
        setSelectedScenario(firstId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scenarios");
    } finally {
      setLoading(false);
    }
  };


  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // First generate the scenario
      const wizardResponse = await fetch(`${apiUrl}/api/v1/wizard/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ save: false, num_characters: 3 }),
      });
      if (!wizardResponse.ok) throw new Error("Failed to generate scenario");
      const scenarioData = await wizardResponse.json();

      // Save to database as user scenario
      if (librarianId) {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Librarian-ID": librarianId,
        };
        const saveResponse = await fetch(`${apiUrl}/api/v1/scenarios`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: scenarioData.scenario_name,
            description: scenarioData.premise,
            setting: scenarioData.setting,
            data: scenarioData,
            public: false,
          }),
        });
        if (!saveResponse.ok) {
          const errorData = await saveResponse.json().catch(() => ({}));
          throw new Error(errorData.detail || "Failed to save scenario");
        }
      }

      await fetchScenarios();
      // Switch to "My Scenarios" tab
      setActiveTab("my");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate scenario");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (scenarioId: string) => {
    setDeleting(scenarioId);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (librarianId) {
        headers["X-Librarian-ID"] = librarianId;
      }
      const response = await fetch(`${apiUrl}/api/v1/scenarios/${encodeURIComponent(scenarioId)}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to delete scenario");
      }
      // Clear selection if we deleted the selected scenario
      if (selectedScenario === scenarioId) {
        setSelectedScenario(null);
      }
      await fetchScenarios();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete scenario");
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  const handlePlay = () => {
    if (!selectedScenario) return;
    onScenarioSelected(selectedScenario);
  };

  // Filter scenarios by tab and visibility
  const myScenarios = scenarios.filter((s) => {
    const id = getScenarioId(s);
    return !id.startsWith("test_") && s.source === "db" && s.owner_id === librarianId;
  });
  const publicScenarios = scenarios.filter((s) => {
    const id = getScenarioId(s);
    return !id.startsWith("test_") && (s.source === "file" || (s.source === "db" && s.public));
  });

  const visibleScenarios = activeTab === "my" ? myScenarios : publicScenarios;
  const selectedData = scenarios.find((s) => getScenarioId(s) === selectedScenario);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-[oklch(0.08_0.03_340)]" />
        <motion.div
          className="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full bg-primary/[0.03] blur-[150px]"
          animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6">
        {onBack && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
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
          transition={{ duration: 1.2 }}
          className="text-center mb-6"
        >
          <h2 className="text-3xl font-bold tracking-tight text-foreground/90">scenarios</h2>
          <p className="text-muted-foreground/60 text-base mt-2">select or create a scenario</p>
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="w-full flex gap-2 mb-4"
        >
          <button
            onClick={() => setActiveTab("public")}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === "public"
                ? "bg-primary/10 text-primary border border-primary/30"
                : "bg-card/30 text-muted-foreground/70 border border-border/30 hover:border-border/50"
            }`}
          >
            Public Scenarios
          </button>
          <button
            onClick={() => setActiveTab("my")}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === "my"
                ? "bg-primary/10 text-primary border border-primary/30"
                : "bg-card/30 text-muted-foreground/70 border border-border/30 hover:border-border/50"
            }`}
          >
            My Scenarios
          </button>
        </motion.div>

        {/* Create Buttons */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="w-full mb-4 flex gap-2"
        >
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-primary/30 hover:border-primary/50 rounded-xl text-primary/70 hover:text-primary transition-all disabled:opacity-50"
          >
            {generating ? (
              <>
                <Sparkles className="w-4 h-4 animate-pulse" />
                generating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                quick generate
              </>
            )}
          </button>
          {onOpenWizard && (
            <button
              onClick={onOpenWizard}
              disabled={generating}
              className="flex items-center justify-center gap-2 px-4 py-3 border border-amber-500/30 hover:border-amber-500/50 rounded-xl text-amber-500/70 hover:text-amber-500 transition-all disabled:opacity-50"
              title="Open Smut Wizard for custom scenario creation"
            >
              <Wand2 className="w-4 h-4" />
              <span className="hidden sm:inline">wizard</span>
            </button>
          )}
        </motion.div>

        {/* Scenario List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="w-full h-80 overflow-y-auto mb-6"
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="loading" className="flex justify-center py-8">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-primary/50"
                      animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.9, 1.1, 0.9] }}
                      transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.25 }}
                    />
                  ))}
                </div>
              </motion.div>
            ) : visibleScenarios.length === 0 ? (
              <motion.p key="empty" className="text-center text-muted-foreground/50 py-8">
                no scenarios available — generate one above
              </motion.p>
            ) : (
              <motion.div key="list" className="space-y-2">
                {visibleScenarios.map((scenario, index) => {
                  const scenarioId = getScenarioId(scenario);
                  const isDeleting = deleting === scenarioId;
                  const isConfirming = confirmDelete === scenarioId;

                  return (
                    <motion.div
                      key={scenarioId}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`relative group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                        selectedScenario === scenarioId
                          ? "border-primary/40 bg-primary/[0.05]"
                          : "border-border/30 bg-card/30 hover:border-border/50"
                      }`}
                    >
                      {/* Main content - clickable */}
                      <button
                        onClick={() => setSelectedScenario(scenarioId)}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="text-base font-medium text-foreground/90 truncate">
                          {scenario.name}
                        </p>
                        {scenario.setting && (
                          <p className="text-sm text-muted-foreground/60 mt-1 line-clamp-1">
                            {scenario.setting}
                          </p>
                        )}
                      </button>

                      {/* Character count */}
                      <span className="text-xs text-muted-foreground/50 flex-shrink-0">
                        {scenario.characters}
                      </span>

                      {/* Delete button - only show for user's own DB scenarios */}
                      {scenario.source === "db" && scenario.owner_id === librarianId && (
                        <div className="flex-shrink-0">
                          {isConfirming ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleDelete(scenarioId)}
                                disabled={isDeleting}
                                className="px-2 py-1 text-xs bg-destructive/20 text-destructive rounded hover:bg-destructive/30 disabled:opacity-50"
                              >
                                {isDeleting ? "..." : "yes"}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1 text-xs bg-muted/50 text-muted-foreground rounded hover:bg-muted"
                              >
                                no
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(scenarioId)}
                              className="p-1.5 text-muted-foreground/30 hover:text-destructive/70 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-destructive/70 mb-4"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Start Button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          onClick={handlePlay}
          disabled={!selectedScenario || isLoading}
          className="w-full max-w-xs px-8 py-3 text-base text-primary/80 hover:text-primary border border-primary/20 hover:border-primary/40 rounded-full transition-all hover:shadow-[0_0_30px_oklch(0.65_0.22_340_/_0.12)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "loading..." : "start"}
        </motion.button>

        {selectedData && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-muted-foreground/40 mt-4 text-center"
          >
            {selectedData.name} • {selectedData.characters} character{selectedData.characters !== 1 ? "s" : ""}
          </motion.p>
        )}
      </div>
    </div>
  );
}

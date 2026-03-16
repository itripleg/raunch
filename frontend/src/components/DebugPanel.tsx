import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
// import { ScrollArea } from "@/components/ui/scroll-area";

type DebugStats = {
  total_pages: number;
  total_character_pages: number;
  refusals: number;
  successfully_parsed: number;
};

type CharacterPageDebug = {
  id: number;
  page: number;
  character_name: string;
  inner_thoughts: string | null;
  action: string | null;
  dialogue: string | null;
  emotional_state: string | null;
  desires_update: string | null;
  created_at: string;
  is_refusal: boolean;
  parse_error: string | null;
  has_extracted_data: boolean;
  raw_json?: Record<string, unknown>;
};

type PageDebug = {
  id: number;
  page: number;
  narration: string;
  events: string[];
  world_time: string;
  mood: string;
  created_at: string;
};

type DebugData = {
  world_id: string;
  pages: PageDebug[];
  character_pages: CharacterPageDebug[];
  stats: DebugStats;
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

type PotentialCharacter = {
  name: string;
  description?: string;
  first_page: number;
  times_mentioned: number;
};

type NPCData = {
  scenarioNpcs: NPCInfo[];
  potentialCharacters: PotentialCharacter[];
  trueCharacters: string[];
};

type ApiResult = {
  endpoint: string;
  status: "loading" | "success" | "error";
  data?: unknown;
  error?: string;
  timestamp: Date;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
  bookId?: string;
  apiUrl: string;
};

export function DebugPanel({ isOpen, onClose, sendCommand, bookId, apiUrl }: Props) {
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [npcData, setNpcData] = useState<NPCData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "pages" | "characters" | "npcs" | "api">("overview");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [apiResults, setApiResults] = useState<ApiResult[]>([]);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string>("milk_money");

  const fetchDebugData = useCallback(() => {
    console.log("[DebugPanel] Fetching debug data...");
    setLoading(true);
    sendCommand("debug", { limit: 50, include_raw: true });
  }, [sendCommand]);

  const fetchNpcData = useCallback(async () => {
    try {
      const [worldRes, potentialRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/world`),
        fetch(`${apiUrl}/api/v1/potential-characters`).catch(() => null),
      ]);

      const data: NPCData = {
        scenarioNpcs: [],
        potentialCharacters: [],
        trueCharacters: [],
      };

      if (worldRes.ok) {
        const worldData = await worldRes.json();
        data.scenarioNpcs = worldData.npcs || [];
        data.trueCharacters = worldData.characters || [];
      }

      if (potentialRes?.ok) {
        data.potentialCharacters = await potentialRes.json();
      }

      setNpcData(data);
    } catch (err) {
      console.error("[DebugPanel] Failed to fetch NPC data:", err);
    }
  }, [apiUrl]);

  // API testing functions
  const addApiResult = (result: ApiResult) => {
    setApiResults((prev) => [result, ...prev].slice(0, 20)); // Keep last 20 results
  };

  const testApi = useCallback(
    async (
      endpoint: string,
      method: "GET" | "POST" | "DELETE" = "GET",
      body?: Record<string, unknown>
    ) => {
      const result: ApiResult = {
        endpoint: `${method} ${endpoint}`,
        status: "loading",
        timestamp: new Date(),
      };
      addApiResult(result);

      try {
        const librarianId = localStorage.getItem("librarianId") || "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Librarian-ID": librarianId,
        };
        const options: RequestInit = { method, headers };
        if (body) {
          options.body = JSON.stringify(body);
        }
        const res = await fetch(`${apiUrl}${endpoint}`, options);
        const data = await res.json();
        addApiResult({
          ...result,
          status: res.ok ? "success" : "error",
          data,
          error: res.ok ? undefined : `HTTP ${res.status}`,
        });
      } catch (err) {
        addApiResult({
          ...result,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [apiUrl]
  );

  const fetchScenarios = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/scenarios`);
      if (res.ok) {
        const data = await res.json();
        setScenarios(data.map((s: { name: string }) => s.name));
      }
    } catch (err) {
      console.error("[DebugPanel] Failed to fetch scenarios:", err);
    }
  }, [apiUrl]);

  // Fetch scenarios on mount
  useEffect(() => {
    if (isOpen) {
      fetchScenarios();
    }
  }, [isOpen, fetchScenarios]);

  // Log when data arrives
  useEffect(() => {
    if (debugData) {
      console.log("[DebugPanel] Debug data received:", debugData.stats);
    }
  }, [debugData]);

  // Listen for debug response via custom event from useGame
  useEffect(() => {
    const handleDebugData = (e: Event) => {
      const customEvent = e as CustomEvent<DebugData>;
      setDebugData(customEvent.detail);
      setLoading(false);
    };

    window.addEventListener("raunch-debug-data", handleDebugData);
    return () => {
      window.removeEventListener("raunch-debug-data", handleDebugData);
    };
  }, []);

  useEffect(() => {
    if (isOpen && !debugData) {
      fetchDebugData();
    }
    if (isOpen && !npcData) {
      fetchNpcData();
    }
  }, [isOpen, debugData, npcData, fetchDebugData, fetchNpcData]);

  const toggleExpand = (key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="absolute inset-4 lg:inset-8 bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-foreground">Debug Panel</h2>
              {debugData && (
                <span className="text-xs text-muted-foreground">
                  World: {debugData.world_id}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  fetchDebugData();
                  fetchNpcData();
                }}
                disabled={loading}
                className="px-3 py-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border px-4 bg-muted/10">
            {(["overview", "pages", "characters", "npcs", "api"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6">
              {loading && !debugData ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : activeTab === "api" ? (
                <ApiTab
                  scenarios={scenarios}
                  selectedScenario={selectedScenario}
                  setSelectedScenario={setSelectedScenario}
                  testApi={testApi}
                  apiResults={apiResults}
                  sendCommand={sendCommand}
                  bookId={bookId}
                />
              ) : !debugData ? (
                <div className="text-center py-12 text-muted-foreground">
                  No debug data available
                </div>
              ) : activeTab === "npcs" ? (
                <NpcsTab npcData={npcData} expandedItems={expandedItems} toggleExpand={toggleExpand} />
              ) : activeTab === "overview" ? (
                <OverviewTab stats={debugData.stats} characterPages={debugData.character_pages} />
              ) : activeTab === "pages" ? (
                <PagesTab pages={debugData.pages} expandedItems={expandedItems} toggleExpand={toggleExpand} />
              ) : (
                <CharacterPagesTab
                  characterPages={debugData.character_pages}
                  expandedItems={expandedItems}
                  toggleExpand={toggleExpand}
                />
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function OverviewTab({ stats, characterPages }: { stats: DebugStats; characterPages: CharacterPageDebug[] }) {
  const refusalRate = stats.total_character_pages > 0
    ? ((stats.refusals / stats.total_character_pages) * 100).toFixed(1)
    : "0";

  // Group issues by type
  const refusals = characterPages.filter((cp) => cp.is_refusal);
  const parseErrors = characterPages.filter((cp) => cp.parse_error);
  const missingData = characterPages.filter((cp) => !cp.has_extracted_data && !cp.is_refusal);

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Pages" value={stats.total_pages} />
        <StatCard label="Character Responses" value={stats.total_character_pages} />
        <StatCard
          label="Successfully Parsed"
          value={stats.successfully_parsed}
          variant="success"
        />
        <StatCard
          label="Refusals"
          value={stats.refusals}
          subtext={`${refusalRate}%`}
          variant={stats.refusals > 0 ? "warning" : "default"}
        />
      </div>

      {/* Issues Summary */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Recent Issues</h3>

        {refusals.length === 0 && parseErrors.length === 0 && missingData.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-muted/20 rounded-lg p-4">
            No issues detected in recent data
          </div>
        ) : (
          <div className="space-y-3">
            {refusals.slice(0, 5).map((cp) => (
              <IssueCard
                key={`refusal-${cp.id}`}
                type="refusal"
                page={cp.page}
                character={cp.character_name}
                message={cp.raw_json?.raw as string || "Content refusal"}
              />
            ))}
            {parseErrors.slice(0, 3).map((cp) => (
              <IssueCard
                key={`parse-${cp.id}`}
                type="parse_error"
                page={cp.page}
                character={cp.character_name}
                message={cp.parse_error || "Unknown parse error"}
              />
            ))}
            {missingData.slice(0, 3).map((cp) => (
              <IssueCard
                key={`missing-${cp.id}`}
                type="missing"
                page={cp.page}
                character={cp.character_name}
                message="No data extracted from response"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  variant = "default",
}: {
  label: string;
  value: number;
  subtext?: string;
  variant?: "default" | "success" | "warning" | "error";
}) {
  const variantClasses = {
    default: "bg-muted/20",
    success: "bg-green-500/10 border-green-500/20",
    warning: "bg-amber-500/10 border-amber-500/20",
    error: "bg-red-500/10 border-red-500/20",
  };

  const textClasses = {
    default: "text-foreground",
    success: "text-green-400",
    warning: "text-amber-400",
    error: "text-red-400",
  };

  return (
    <div className={`rounded-lg border border-border p-4 ${variantClasses[variant]}`}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold ${textClasses[variant]}`}>
        {value}
        {subtext && <span className="text-sm font-normal ml-2 opacity-70">{subtext}</span>}
      </p>
    </div>
  );
}

function IssueCard({
  type,
  page,
  character,
  message,
}: {
  type: "refusal" | "parse_error" | "missing";
  page: number;
  character: string;
  message: string;
}) {
  const typeConfig = {
    refusal: {
      icon: "🚫",
      label: "Content Refusal",
      className: "border-amber-500/30 bg-amber-500/5",
    },
    parse_error: {
      icon: "⚠️",
      label: "Parse Error",
      className: "border-red-500/30 bg-red-500/5",
    },
    missing: {
      icon: "❓",
      label: "Missing Data",
      className: "border-muted-foreground/30 bg-muted/10",
    },
  };

  const config = typeConfig[type];

  return (
    <div className={`rounded-lg border p-3 ${config.className}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-foreground">{config.label}</span>
            <span className="text-[10px] text-muted-foreground">
              Page {page} - {character}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{message.slice(0, 150)}...</p>
        </div>
      </div>
    </div>
  );
}

function PagesTab({
  pages,
  expandedItems,
  toggleExpand,
}: {
  pages: PageDebug[];
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {pages.map((pageItem) => {
        const key = `page-${pageItem.id}`;
        const isExpanded = expandedItems.has(key);

        return (
          <div key={key} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleExpand(key)}
              className="w-full px-4 py-3 flex items-center justify-between bg-muted/10 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-primary">#{pageItem.page}</span>
                <span className="text-xs text-muted-foreground">{pageItem.world_time}</span>
                <span className="text-xs text-amber-400/70">{pageItem.mood}</span>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`transform transition-transform ${isExpanded ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-3 border-t border-border bg-card/50">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Narration
                      </label>
                      <p className="text-sm text-foreground/80 mt-1">{pageItem.narration}</p>
                    </div>
                    {pageItem.events.length > 0 && (
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Events
                        </label>
                        <ul className="mt-1 space-y-1">
                          {pageItem.events.map((event, i) => (
                            <li key={i} className="text-xs text-muted-foreground">
                              - {event}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground/60">
                      DB ID: {pageItem.id} | Created: {pageItem.created_at}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function CharacterPagesTab({
  characterPages,
  expandedItems,
  toggleExpand,
}: {
  characterPages: CharacterPageDebug[];
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {characterPages.map((cp) => {
        const key = `char-${cp.id}`;
        const isExpanded = expandedItems.has(key);

        return (
          <div
            key={key}
            className={`border rounded-lg overflow-hidden ${
              cp.is_refusal
                ? "border-amber-500/30"
                : cp.parse_error
                ? "border-red-500/30"
                : !cp.has_extracted_data
                ? "border-muted-foreground/30"
                : "border-border"
            }`}
          >
            <button
              onClick={() => toggleExpand(key)}
              className="w-full px-4 py-3 flex items-center justify-between bg-muted/10 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-primary">#{cp.page}</span>
                <span className="text-sm font-medium text-foreground">{cp.character_name}</span>
                {cp.is_refusal && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">
                    REFUSAL
                  </span>
                )}
                {cp.parse_error && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">
                    PARSE ERROR
                  </span>
                )}
                {!cp.has_extracted_data && !cp.is_refusal && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground rounded">
                    NO DATA
                  </span>
                )}
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`transform transition-transform ${isExpanded ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-3 border-t border-border bg-card/50">
                    {/* Extracted Fields */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <FieldDisplay label="Inner Thoughts" value={cp.inner_thoughts} />
                      <FieldDisplay label="Action" value={cp.action} />
                      <FieldDisplay label="Dialogue" value={cp.dialogue} />
                      <FieldDisplay label="Emotional State" value={cp.emotional_state} />
                      <FieldDisplay label="Desires Update" value={cp.desires_update} />
                    </div>

                    {/* Raw JSON */}
                    {cp.raw_json && (
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Raw JSON
                        </label>
                        <pre className="mt-1 p-3 text-xs bg-muted/30 rounded-lg overflow-x-auto text-muted-foreground font-mono">
                          {JSON.stringify(cp.raw_json, null, 2)}
                        </pre>
                      </div>
                    )}

                    {cp.parse_error && (
                      <div className="p-2 bg-red-500/10 rounded text-xs text-red-400">
                        Parse Error: {cp.parse_error}
                      </div>
                    )}

                    <div className="text-[10px] text-muted-foreground/60">
                      DB ID: {cp.id} | Created: {cp.created_at}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function FieldDisplay({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <p className={`text-xs mt-0.5 ${value ? "text-foreground/80" : "text-muted-foreground/50 italic"}`}>
        {value || "null"}
      </p>
    </div>
  );
}

function ApiTab({
  scenarios,
  selectedScenario,
  setSelectedScenario,
  testApi,
  apiResults,
  sendCommand,
  bookId,
}: {
  scenarios: string[];
  selectedScenario: string;
  setSelectedScenario: (s: string) => void;
  testApi: (endpoint: string, method?: "GET" | "POST" | "DELETE", body?: Record<string, unknown>) => Promise<void>;
  apiResults: ApiResult[];
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
  bookId?: string;
}) {
  const [pageIntervalInput, setPageIntervalInput] = useState("30");

  return (
    <div className="space-y-6">
      {/* REST API Commands */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          REST API Endpoints
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <ApiButton
            label="Get Scenarios"
            description="GET /api/v1/scenarios"
            onClick={() => testApi("/api/v1/scenarios")}
          />
          <ApiButton
            label="Wizard Options"
            description="GET /api/v1/wizard/options"
            onClick={() => testApi("/api/v1/wizard/options")}
          />
          <ApiButton
            label="List Books"
            description="GET /api/v1/books"
            onClick={() => testApi("/api/v1/books")}
          />
        </div>

        {/* Book-specific endpoints */}
        {bookId && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Current Book:</span>
              <span className="text-xs font-mono text-primary">{bookId}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              <ApiButton
                label="Get Book"
                description={`GET /api/v1/books/${bookId}`}
                onClick={() => testApi(`/api/v1/books/${bookId}`)}
              />
              <ApiButton
                label="List Characters"
                description={`GET /api/v1/books/${bookId}/characters`}
                onClick={() => testApi(`/api/v1/books/${bookId}/characters`)}
              />
              <ApiButton
                label="Get Pages"
                description={`GET /api/v1/books/${bookId}/pages`}
                onClick={() => testApi(`/api/v1/books/${bookId}/pages`)}
              />
              <ApiButton
                label="Pause Book"
                description={`POST /api/v1/books/${bookId}/pause`}
                onClick={() => testApi(`/api/v1/books/${bookId}/pause`, "POST")}
              />
              <ApiButton
                label="Resume Book"
                description={`POST /api/v1/books/${bookId}/resume`}
                onClick={() => testApi(`/api/v1/books/${bookId}/resume`, "POST")}
              />
              <ApiButton
                label="Trigger Page"
                description={`POST /api/v1/books/${bookId}/page`}
                onClick={() => testApi(`/api/v1/books/${bookId}/page`, "POST")}
              />
            </div>
          </div>
        )}

        {/* Create/Close Book */}
        <div className="mt-4 p-3 border border-border rounded-lg bg-muted/10">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">Create Book:</span>
            <select
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value)}
              className="px-2 py-1 text-xs bg-background border border-border rounded"
            >
              {scenarios.length === 0 ? (
                <option value="milk_money">milk_money</option>
              ) : (
                scenarios.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => testApi("/api/v1/books", "POST", { scenario: selectedScenario })}
              className="px-3 py-1 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded transition-colors"
            >
              Create Book
            </button>
            {bookId && (
              <button
                onClick={() => testApi(`/api/v1/books/${bookId}`, "DELETE")}
                className="px-3 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors"
              >
                Close Book
              </button>
            )}
          </div>
        </div>
      </div>

      {/* WebSocket Commands */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          WebSocket Commands
          <span className="text-[10px] text-muted-foreground font-normal">(via sendCommand)</span>
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <WsButton
            label="Trigger Page"
            cmd="page"
            onClick={() => sendCommand("page")}
          />
          <WsButton
            label="Toggle Pause"
            cmd="toggle_pause"
            onClick={() => sendCommand("toggle_pause")}
          />
          <WsButton
            label="Get Status"
            cmd="status"
            onClick={() => sendCommand("status")}
          />
          <WsButton
            label="Get History"
            cmd="history"
            onClick={() => sendCommand("history", { count: 20 })}
          />
          <WsButton
            label="List Characters"
            cmd="list"
            onClick={() => sendCommand("list")}
          />
          <WsButton
            label="Get World"
            cmd="world"
            onClick={() => sendCommand("world")}
          />
          <WsButton
            label="Get Page Interval"
            cmd="get_page_interval"
            onClick={() => sendCommand("get_page_interval")}
          />
          <WsButton
            label="Debug Info"
            cmd="debug"
            onClick={() => sendCommand("debug", { limit: 50, include_raw: true })}
          />
        </div>

        {/* Set Page Interval */}
        <div className="mt-4 p-3 border border-border rounded-lg bg-muted/10">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Set Page Interval:</span>
            <input
              type="number"
              value={pageIntervalInput}
              onChange={(e) => setPageIntervalInput(e.target.value)}
              className="w-20 px-2 py-1 text-xs bg-background border border-border rounded"
              placeholder="seconds"
            />
            <button
              onClick={() => sendCommand("set_page_interval", { seconds: parseInt(pageIntervalInput) || 30 })}
              className="px-3 py-1 text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded transition-colors"
            >
              Set
            </button>
            <span className="text-[10px] text-muted-foreground">(0 = manual mode)</span>
          </div>
        </div>
      </div>

      {/* Results Log */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          Results Log
          {apiResults.length > 0 && (
            <span className="text-[10px] text-muted-foreground font-normal">({apiResults.length} entries)</span>
          )}
        </h3>
        {apiResults.length === 0 ? (
          <div className="text-xs text-muted-foreground/50 italic p-4 border border-border rounded-lg bg-muted/10">
            No API calls yet. Click a button above to test.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {apiResults.map((result, i) => (
              <ApiResultCard key={`${result.timestamp.getTime()}-${i}`} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ApiButton({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="p-3 text-left border border-border rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors"
    >
      <span className="text-sm font-medium text-foreground block">{label}</span>
      <span className="text-[10px] text-muted-foreground font-mono">{description}</span>
    </button>
  );
}

function WsButton({
  label,
  cmd,
  onClick,
}: {
  label: string;
  cmd: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="p-2 text-left border border-purple-500/20 rounded-lg bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
    >
      <span className="text-xs font-medium text-foreground block">{label}</span>
      <span className="text-[10px] text-purple-400/70 font-mono">{cmd}</span>
    </button>
  );
}

function ApiResultCard({ result }: { result: ApiResult }) {
  const [expanded, setExpanded] = useState(false);
  const statusColors = {
    loading: "border-blue-500/30 bg-blue-500/5",
    success: "border-green-500/30 bg-green-500/5",
    error: "border-red-500/30 bg-red-500/5",
  };
  const statusIcons = {
    loading: "⏳",
    success: "✅",
    error: "❌",
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${statusColors[result.status]}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{statusIcons[result.status]}</span>
          <span className="text-xs font-mono text-foreground">{result.endpoint}</span>
          {result.error && (
            <span className="text-[10px] text-red-400">{result.error}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {result.timestamp.toLocaleTimeString()}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transform transition-transform text-muted-foreground ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>
      <AnimatePresence>
        {expanded && result.data !== undefined && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <pre className="p-3 text-[10px] bg-black/20 text-muted-foreground font-mono overflow-x-auto border-t border-border/50">
              {JSON.stringify(result.data as object, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NpcsTab({
  npcData,
  expandedItems,
  toggleExpand,
}: {
  npcData: NPCData | null;
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  if (!npcData) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading NPC data...
      </div>
    );
  }

  // Categorize characters:
  // - Scenario Defined: in trueCharacters AND has data in scenarioNpcs
  // - Promoted: in trueCharacters but NOT in scenarioNpcs (came from potential)
  // - Mentioned: in potentialCharacters (not yet promoted)

  const scenarioNpcNames = new Set(npcData.scenarioNpcs.map(n => n.name.toLowerCase()));

  const scenarioDefined = npcData.trueCharacters.filter(name =>
    scenarioNpcNames.has(name.toLowerCase())
  );
  const promoted = npcData.trueCharacters.filter(name =>
    !scenarioNpcNames.has(name.toLowerCase())
  );
  const mentioned = npcData.potentialCharacters;

  // Get scenario data for a character
  const getScenarioData = (name: string) =>
    npcData.scenarioNpcs.find(n => n.name.toLowerCase() === name.toLowerCase());

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-primary/20 p-4 bg-primary/10">
          <p className="text-xs text-muted-foreground mb-1">Scenario Defined</p>
          <p className="text-2xl font-bold text-primary">{scenarioDefined.length}</p>
          <p className="text-[10px] text-primary/60 mt-1">can read thoughts</p>
        </div>
        <div className="rounded-lg border border-purple-500/20 p-4 bg-purple-500/10">
          <p className="text-xs text-muted-foreground mb-1">Promoted</p>
          <p className="text-2xl font-bold text-purple-400">{promoted.length}</p>
          <p className="text-[10px] text-purple-400/60 mt-1">can read thoughts</p>
        </div>
        <div className="rounded-lg border border-amber-500/20 p-4 bg-amber-500/10">
          <p className="text-xs text-muted-foreground mb-1">Mentioned</p>
          <p className="text-2xl font-bold text-amber-400">{mentioned.length}</p>
          <p className="text-[10px] text-amber-400/60 mt-1">not promoted yet</p>
        </div>
      </div>

      {/* Scenario Defined Characters */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary" />
          Scenario Defined
          <span className="text-[10px] text-muted-foreground font-normal">(from scenario file, can read thoughts)</span>
        </h3>
        {scenarioDefined.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">None</p>
        ) : (
          <div className="space-y-2">
            {scenarioDefined.map((name) => {
              const key = `scenario-${name}`;
              const isExpanded = expandedItems.has(key);
              const data = getScenarioData(name);

              return (
                <div key={key} className="border border-primary/20 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleExpand(key)}
                    className="w-full px-4 py-3 flex items-center justify-between bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-primary">{name}</span>
                      {data?.species && (
                        <span className="text-xs text-muted-foreground">{data.species}</span>
                      )}
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`transform transition-transform text-muted-foreground ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <AnimatePresence>
                    {isExpanded && data && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-2 border-t border-primary/20 bg-card/50">
                          <FieldDisplay label="Species" value={data.species || null} />
                          <FieldDisplay label="Personality" value={data.personality || null} />
                          <FieldDisplay label="Appearance" value={data.appearance || null} />
                          <FieldDisplay label="Desires" value={data.desires || null} />
                          <FieldDisplay label="Backstory" value={data.backstory || null} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Promoted Characters */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          Promoted
          <span className="text-[10px] text-muted-foreground font-normal">(was mentioned, now true character)</span>
        </h3>
        {promoted.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">None promoted yet</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {promoted.map((name) => (
              <span
                key={name}
                className="px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm text-purple-400"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Mentioned Characters (not yet promoted) */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          Mentioned
          <span className="text-[10px] text-muted-foreground font-normal">(detected by narrator, not promoted)</span>
        </h3>
        {mentioned.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">None detected yet</p>
        ) : (
          <div className="space-y-2">
            {mentioned.map((pc) => {
              const key = `mentioned-${pc.name}`;
              const isExpanded = expandedItems.has(key);

              return (
                <div key={key} className="border border-amber-500/20 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleExpand(key)}
                    className="w-full px-4 py-3 flex items-center justify-between bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-amber-400">{pc.name}</span>
                      <span className="text-xs text-muted-foreground">
                        page {pc.first_page}
                      </span>
                      {pc.times_mentioned > 1 && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">
                          x{pc.times_mentioned}
                        </span>
                      )}
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`transform transition-transform text-muted-foreground ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-2 border-t border-amber-500/20 bg-card/50">
                          <FieldDisplay label="Description" value={pc.description || null} />
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">First Page</label>
                              <p className="text-xs text-foreground/80 mt-0.5">{pc.first_page}</p>
                            </div>
                            <div>
                              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Times Mentioned</label>
                              <p className="text-xs text-foreground/80 mt-0.5">{pc.times_mentioned}</p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

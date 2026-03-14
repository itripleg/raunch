import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";

type DebugStats = {
  total_ticks: number;
  total_character_ticks: number;
  refusals: number;
  successfully_parsed: number;
};

type CharacterTickDebug = {
  id: number;
  tick: number;
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

type TickDebug = {
  id: number;
  tick: number;
  narration: string;
  events: string[];
  world_time: string;
  mood: string;
  created_at: string;
};

type DebugData = {
  world_id: string;
  ticks: TickDebug[];
  character_ticks: CharacterTickDebug[];
  stats: DebugStats;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
};

export function DebugPanel({ isOpen, onClose, sendCommand }: Props) {
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "ticks" | "characters">("overview");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const fetchDebugData = useCallback(() => {
    console.log("[DebugPanel] Fetching debug data...");
    setLoading(true);
    sendCommand("debug", { limit: 50, include_raw: true });
  }, [sendCommand]);

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
  }, [isOpen, debugData, fetchDebugData]);

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
                onClick={fetchDebugData}
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
            {(["overview", "ticks", "characters"] as const).map((tab) => (
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
          <ScrollArea className="flex-1">
            <div className="p-6">
              {loading && !debugData ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : !debugData ? (
                <div className="text-center py-12 text-muted-foreground">
                  No debug data available
                </div>
              ) : activeTab === "overview" ? (
                <OverviewTab stats={debugData.stats} characterTicks={debugData.character_ticks} />
              ) : activeTab === "ticks" ? (
                <TicksTab ticks={debugData.ticks} expandedItems={expandedItems} toggleExpand={toggleExpand} />
              ) : (
                <CharacterTicksTab
                  characterTicks={debugData.character_ticks}
                  expandedItems={expandedItems}
                  toggleExpand={toggleExpand}
                />
              )}
            </div>
          </ScrollArea>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function OverviewTab({ stats, characterTicks }: { stats: DebugStats; characterTicks: CharacterTickDebug[] }) {
  const refusalRate = stats.total_character_ticks > 0
    ? ((stats.refusals / stats.total_character_ticks) * 100).toFixed(1)
    : "0";

  // Group issues by type
  const refusals = characterTicks.filter((ct) => ct.is_refusal);
  const parseErrors = characterTicks.filter((ct) => ct.parse_error);
  const missingData = characterTicks.filter((ct) => !ct.has_extracted_data && !ct.is_refusal);

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Ticks" value={stats.total_ticks} />
        <StatCard label="Character Responses" value={stats.total_character_ticks} />
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
            {refusals.slice(0, 5).map((ct) => (
              <IssueCard
                key={`refusal-${ct.id}`}
                type="refusal"
                tick={ct.tick}
                character={ct.character_name}
                message={ct.raw_json?.raw as string || "Content refusal"}
              />
            ))}
            {parseErrors.slice(0, 3).map((ct) => (
              <IssueCard
                key={`parse-${ct.id}`}
                type="parse_error"
                tick={ct.tick}
                character={ct.character_name}
                message={ct.parse_error || "Unknown parse error"}
              />
            ))}
            {missingData.slice(0, 3).map((ct) => (
              <IssueCard
                key={`missing-${ct.id}`}
                type="missing"
                tick={ct.tick}
                character={ct.character_name}
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
  tick,
  character,
  message,
}: {
  type: "refusal" | "parse_error" | "missing";
  tick: number;
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
              Tick {tick} - {character}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{message.slice(0, 150)}...</p>
        </div>
      </div>
    </div>
  );
}

function TicksTab({
  ticks,
  expandedItems,
  toggleExpand,
}: {
  ticks: TickDebug[];
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {ticks.map((tick) => {
        const key = `tick-${tick.id}`;
        const isExpanded = expandedItems.has(key);

        return (
          <div key={key} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleExpand(key)}
              className="w-full px-4 py-3 flex items-center justify-between bg-muted/10 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-primary">#{tick.tick}</span>
                <span className="text-xs text-muted-foreground">{tick.world_time}</span>
                <span className="text-xs text-amber-400/70">{tick.mood}</span>
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
                      <p className="text-sm text-foreground/80 mt-1">{tick.narration}</p>
                    </div>
                    {tick.events.length > 0 && (
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Events
                        </label>
                        <ul className="mt-1 space-y-1">
                          {tick.events.map((event, i) => (
                            <li key={i} className="text-xs text-muted-foreground">
                              - {event}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground/60">
                      DB ID: {tick.id} | Created: {tick.created_at}
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

function CharacterTicksTab({
  characterTicks,
  expandedItems,
  toggleExpand,
}: {
  characterTicks: CharacterTickDebug[];
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {characterTicks.map((ct) => {
        const key = `char-${ct.id}`;
        const isExpanded = expandedItems.has(key);

        return (
          <div
            key={key}
            className={`border rounded-lg overflow-hidden ${
              ct.is_refusal
                ? "border-amber-500/30"
                : ct.parse_error
                ? "border-red-500/30"
                : !ct.has_extracted_data
                ? "border-muted-foreground/30"
                : "border-border"
            }`}
          >
            <button
              onClick={() => toggleExpand(key)}
              className="w-full px-4 py-3 flex items-center justify-between bg-muted/10 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono font-bold text-primary">#{ct.tick}</span>
                <span className="text-sm font-medium text-foreground">{ct.character_name}</span>
                {ct.is_refusal && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">
                    REFUSAL
                  </span>
                )}
                {ct.parse_error && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">
                    PARSE ERROR
                  </span>
                )}
                {!ct.has_extracted_data && !ct.is_refusal && (
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
                      <FieldDisplay label="Inner Thoughts" value={ct.inner_thoughts} />
                      <FieldDisplay label="Action" value={ct.action} />
                      <FieldDisplay label="Dialogue" value={ct.dialogue} />
                      <FieldDisplay label="Emotional State" value={ct.emotional_state} />
                      <FieldDisplay label="Desires Update" value={ct.desires_update} />
                    </div>

                    {/* Raw JSON */}
                    {ct.raw_json && (
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Raw JSON
                        </label>
                        <pre className="mt-1 p-3 text-xs bg-muted/30 rounded-lg overflow-x-auto text-muted-foreground font-mono">
                          {JSON.stringify(ct.raw_json, null, 2)}
                        </pre>
                      </div>
                    )}

                    {ct.parse_error && (
                      <div className="p-2 bg-red-500/10 rounded text-xs text-red-400">
                        Parse Error: {ct.parse_error}
                      </div>
                    )}

                    <div className="text-[10px] text-muted-foreground/60">
                      DB ID: {ct.id} | Created: {ct.created_at}
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

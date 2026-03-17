import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  BookOpen,
  Users,
  SlidersHorizontal,
  Bug,
  RefreshCw,
  Play,
  Pause,
  SkipForward,
  Clock,
  ChevronDown,
  Activity,
  AlertTriangle,
  Zap,
  Eye,
  MessageSquare,
  Heart,
  Sparkles,
  Send,
  Terminal,
  Shield,
  RotateCcw,
  Globe,
} from "lucide-react";

type RouteInfo = {
  method: string;
  path: string;
  name: string | null;
};

// ─── Types ───────────────────────────────────────────────────────────────────

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

type AuthInfo = {
  isAuthenticated: boolean;
  userEmail?: string;
  userName?: string;
  accessToken?: string | null;
  librarianId?: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
  bookId?: string;
  apiUrl: string;
  authInfo?: AuthInfo;
  onSelectBook?: (bookId: string) => void;
};

// ─── Dev mode check ──────────────────────────────────────────────────────────

const DEV_MODE =
  import.meta.env.VITE_DEV_MODE === "true" ||
  import.meta.env.VITE_LOCAL_DEMO === "true" ||
  import.meta.env.DEV;

// ─── Tab definitions ─────────────────────────────────────────────────────────

type UserTab = "story" | "characters" | "controls";
type DevTab = "debug";
type Tab = UserTab | DevTab;

const USER_TABS: { id: UserTab; label: string; icon: typeof BookOpen }[] = [
  { id: "story", label: "Story", icon: BookOpen },
  { id: "characters", label: "Characters", icon: Users },
  { id: "controls", label: "Controls", icon: SlidersHorizontal },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export function UserDashboard({ isOpen, onClose, sendCommand, bookId, apiUrl, authInfo, onSelectBook }: Props) {
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [npcData, setNpcData] = useState<NPCData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    try { const v = localStorage.getItem("raunch_dash_tab"); if (v) return v as Tab; } catch {}
    return "story";
  });
  const setActiveTabPersist = (tab: Tab) => {
    setActiveTab(tab);
    try { localStorage.setItem("raunch_dash_tab", tab); } catch {}
  };
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Debug tab state
  const [apiResults, setApiResults] = useState<ApiResult[]>([]);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string>("milk_money");

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchDebugData = useCallback(() => {
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
    } catch {
      // Silently fail — compat endpoints may not be running
      setNpcData({ scenarioNpcs: [], potentialCharacters: [], trueCharacters: [] });
    }
  }, [apiUrl]);

  const addApiResult = (result: ApiResult) => {
    setApiResults((prev) => [result, ...prev].slice(0, 20));
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
        let librarianId = authInfo?.librarianId || "";
        if (!librarianId) {
          try {
            const host = new URL(apiUrl).host;
            librarianId = localStorage.getItem(`raunch_librarian_id_${host}`) || "";
          } catch { /* ignore */ }
        }
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Librarian-ID": librarianId,
        };
        const options: RequestInit = { method, headers };
        if (body) options.body = JSON.stringify(body);
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
    [apiUrl, authInfo?.librarianId]
  );

  const fetchScenarios = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/scenarios`);
      if (res.ok) {
        const data = await res.json();
        setScenarios(data.map((s: { name: string }) => s.name));
      }
    } catch { /* ignore */ }
  }, [apiUrl]);

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) fetchScenarios();
  }, [isOpen, fetchScenarios]);

  useEffect(() => {
    const handleDebugData = (e: Event) => {
      const customEvent = e as CustomEvent<DebugData>;
      setDebugData(customEvent.detail);
      setLoading(false);
    };
    window.addEventListener("raunch-debug-data", handleDebugData);
    return () => window.removeEventListener("raunch-debug-data", handleDebugData);
  }, []);

  useEffect(() => {
    if (isOpen && bookId && !debugData) fetchDebugData();
    if (isOpen && !npcData) fetchNpcData();
  }, [isOpen, bookId, debugData, npcData, fetchDebugData, fetchNpcData]);

  const toggleExpand = (key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  if (!isOpen) return null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="absolute inset-4 lg:inset-8 bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-gradient-to-r from-muted/30 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground tracking-tight">Dashboard</h2>
                <p className="text-[11px] text-muted-foreground/80 font-mono">
                  {bookId
                    ? debugData ? `${debugData.stats.total_pages} pages written` : "connected"
                    : "no scenario active"
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { if (bookId) fetchDebugData(); fetchNpcData(); }}
                disabled={loading}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded-lg transition-all disabled:opacity-40"
                title="Refresh data"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded-lg transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Tabs ───────────────────────────────────────────────────── */}
          <div className="flex border-b border-border/40 px-2 bg-muted/5">
            {USER_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTabPersist(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                  activeTab === id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground/70 hover:text-foreground hover:border-border"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}

            {DEV_MODE && (
              <>
                <div className="flex-1" />
                <button
                  onClick={() => setActiveTabPersist("debug")}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                    activeTab === "debug"
                      ? "border-amber-500 text-amber-400"
                      : "border-transparent text-muted-foreground/60 hover:text-amber-400/70 hover:border-amber-500/30"
                  }`}
                >
                  <Bug className="w-3.5 h-3.5" />
                  Debug
                </button>
              </>
            )}
          </div>

          {/* ── Content ────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6">
              {/* No book empty state for story/characters/controls */}
              {!bookId && activeTab !== "debug" ? (
                <NoBookState
                  apiUrl={apiUrl}
                  authInfo={authInfo}
                  onOpenDebug={DEV_MODE ? () => setActiveTabPersist("debug") : undefined}
                  onSelectBook={onSelectBook}
                />
              ) : (
                <>
                  {activeTab === "story" && (
                    <StoryTab
                      pages={debugData?.pages}
                      loading={loading && !debugData}
                      expandedItems={expandedItems}
                      toggleExpand={toggleExpand}
                    />
                  )}

                  {activeTab === "characters" && (
                    <CharactersTab
                      npcData={npcData}
                      characterPages={debugData?.character_pages}
                      expandedItems={expandedItems}
                      toggleExpand={toggleExpand}
                    />
                  )}

                  {activeTab === "controls" && (
                    <ControlsTab
                      sendCommand={sendCommand}
                      bookId={bookId}
                      testApi={testApi}
                    />
                  )}

                  {activeTab === "debug" && DEV_MODE && (
                    <DebugTab
                      debugData={debugData}
                      npcData={npcData}
                      loading={loading}
                      expandedItems={expandedItems}
                      toggleExpand={toggleExpand}
                      apiResults={apiResults}
                      scenarios={scenarios}
                      selectedScenario={selectedScenario}
                      setSelectedScenario={setSelectedScenario}
                      testApi={testApi}
                      sendCommand={sendCommand}
                      bookId={bookId}
                      authInfo={authInfo}
                      apiUrl={apiUrl}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}

// Backwards compatibility alias
export { UserDashboard as DebugPanel };

// ─── No Book State ───────────────────────────────────────────────────────────

type BookSummary = {
  id: string;
  bookmark: string;
  scenario_name: string;
  created_at: string;
  page_count?: number;
};

function NoBookState({
  apiUrl,
  authInfo,
  onOpenDebug,
  onSelectBook,
}: {
  apiUrl: string;
  authInfo?: AuthInfo;
  onOpenDebug?: () => void;
  onSelectBook?: (bookId: string) => void;
}) {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);

  useEffect(() => {
    async function fetchBooks() {
      setLoadingBooks(true);
      try {
        let librarianId = authInfo?.librarianId || "";
        if (!librarianId) {
          try {
            const host = new URL(apiUrl).host;
            librarianId = localStorage.getItem(`raunch_librarian_id_${host}`) || "";
          } catch { /* ignore */ }
        }
        const res = await fetch(`${apiUrl}/api/v1/books`, {
          headers: {
            "Content-Type": "application/json",
            "X-Librarian-ID": librarianId,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setBooks(data);
        }
      } catch { /* ignore */ }
      setLoadingBooks(false);
    }
    fetchBooks();
  }, [apiUrl, authInfo?.librarianId]);

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <BookOpen className="w-12 h-12 text-muted-foreground/20 mb-5" />
      <h3 className="text-lg font-medium text-foreground/80 mb-2">No scenario active</h3>
      <p className="text-sm text-muted-foreground/70 max-w-sm mb-8">
        Select a scenario from the main dashboard, or pick an existing book below.
      </p>

      {/* Existing books */}
      {loadingBooks ? (
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      ) : books.length > 0 ? (
        <div className="w-full max-w-md space-y-2">
          <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">Your Books</p>
          {books.map((book) => (
            <button
              key={book.id}
              onClick={() => {
                if (onSelectBook) {
                  onSelectBook(book.id);
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border/40 bg-muted/5 hover:bg-muted/15 hover:border-border transition-all text-left"
            >
              <div>
                <p className="text-sm font-medium text-foreground/90">{book.scenario_name}</p>
                <p className="text-[11px] text-muted-foreground/60 font-mono">{book.bookmark}</p>
              </div>
              <div className="text-right">
                {book.page_count != null && (
                  <p className="text-xs text-muted-foreground/70">{book.page_count} pages</p>
                )}
                <p className="text-[10px] text-muted-foreground/50">
                  {new Date(book.created_at).toLocaleDateString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/60 italic">No books found. Start a new scenario from the main dashboard.</p>
      )}

      {onOpenDebug && (
        <button
          onClick={onOpenDebug}
          className="mt-8 px-4 py-2 text-sm bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors"
        >
          Open Debug Panel
        </button>
      )}
    </div>
  );
}

// ─── Story Tab ───────────────────────────────────────────────────────────────

function StoryTab({
  pages,
  loading,
  expandedItems,
  toggleExpand,
}: {
  pages?: PageDebug[];
  loading: boolean;
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!pages || pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BookOpen className="w-10 h-10 text-muted-foreground/20 mb-4" />
        <p className="text-sm text-muted-foreground/80">No pages written yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">The story will appear here as it unfolds</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground/70">{pages.length} pages</p>
      </div>

      {pages.map((page) => {
        const key = `story-${page.id}`;
        const isExpanded = expandedItems.has(key);

        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-border/40 rounded-xl overflow-hidden bg-muted/5 hover:border-border/60 transition-colors"
          >
            <button
              onClick={() => toggleExpand(key)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono font-bold text-primary/80 bg-primary/5 px-2 py-0.5 rounded">
                  {page.page}
                </span>
                <div className="flex items-center gap-3">
                  {page.world_time && (
                    <span className="text-xs text-muted-foreground/70 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {page.world_time}
                    </span>
                  )}
                  {page.mood && (
                    <span className="text-xs text-amber-400/70 italic">{page.mood}</span>
                  )}
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground/60 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              />
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
                  <div className="px-5 pb-5 pt-0 space-y-3">
                    <div className="h-px bg-border/30" />
                    <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                      {page.narration}
                    </p>
                    {page.events.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {page.events.map((event, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-primary/5 text-primary/80 border border-primary/10"
                          >
                            {event}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Characters Tab ──────────────────────────────────────────────────────────

function CharactersTab({
  npcData,
  characterPages,
  expandedItems,
  toggleExpand,
}: {
  npcData: NPCData | null;
  characterPages?: CharacterPageDebug[];
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
}) {
  if (!npcData) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const scenarioNpcNames = new Set(npcData.scenarioNpcs.map((n) => n.name.toLowerCase()));
  const activeCharacters = npcData.trueCharacters;
  const mentioned = npcData.potentialCharacters;

  const getScenarioData = (name: string) =>
    npcData.scenarioNpcs.find((n) => n.name.toLowerCase() === name.toLowerCase());

  // Get latest emotional state for a character from debug data
  const getLatestState = (name: string) => {
    if (!characterPages) return null;
    const pages = characterPages
      .filter((cp) => cp.character_name === name && !cp.is_refusal && cp.has_extracted_data)
      .sort((a, b) => b.page - a.page);
    return pages[0] || null;
  };

  return (
    <div className="space-y-8">
      {/* Active Characters */}
      {activeCharacters.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-primary/80" />
            <h3 className="text-sm font-semibold text-foreground/80">Active Characters</h3>
            <span className="text-xs text-muted-foreground/60">{activeCharacters.length}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {activeCharacters.map((name) => {
              const key = `char-${name}`;
              const isExpanded = expandedItems.has(key);
              const scenarioData = getScenarioData(name);
              const latestState = getLatestState(name);
              const isFromScenario = scenarioNpcNames.has(name.toLowerCase());

              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border border-border/40 rounded-xl overflow-hidden bg-muted/5"
                >
                  <button
                    onClick={() => toggleExpand(key)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                        {name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{name}</p>
                        <p className="text-[11px] text-muted-foreground/70">
                          {scenarioData?.species || (isFromScenario ? "Scenario character" : "Emerged in story")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {latestState?.emotional_state && (
                        <span className="text-[10px] text-amber-400/80 italic max-w-[120px] truncate">
                          {latestState.emotional_state}
                        </span>
                      )}
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-muted-foreground/60 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
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
                        <div className="px-4 pb-4 pt-0 space-y-3">
                          <div className="h-px bg-border/30" />

                          {/* Scenario data */}
                          {scenarioData && (
                            <div className="space-y-2">
                              {scenarioData.personality && (
                                <CharField icon={Eye} label="Personality" value={scenarioData.personality} />
                              )}
                              {scenarioData.appearance && (
                                <CharField icon={Users} label="Appearance" value={scenarioData.appearance} />
                              )}
                              {scenarioData.desires && (
                                <CharField icon={Heart} label="Desires" value={scenarioData.desires} />
                              )}
                              {scenarioData.backstory && (
                                <CharField icon={BookOpen} label="Backstory" value={scenarioData.backstory} />
                              )}
                            </div>
                          )}

                          {/* Latest state from gameplay */}
                          {latestState && (
                            <div className="space-y-2 pt-2">
                              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-medium">
                                Latest Activity (Page {latestState.page})
                              </p>
                              {latestState.inner_thoughts && (
                                <CharField icon={Eye} label="Thoughts" value={latestState.inner_thoughts} />
                              )}
                              {latestState.action && (
                                <CharField icon={Zap} label="Action" value={latestState.action} />
                              )}
                              {latestState.dialogue && (
                                <CharField icon={MessageSquare} label="Dialogue" value={latestState.dialogue} />
                              )}
                            </div>
                          )}

                          {!scenarioData && !latestState && (
                            <p className="text-xs text-muted-foreground/60 italic">No details available yet</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mentioned Characters */}
      {mentioned.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-400/70" />
            <h3 className="text-sm font-semibold text-foreground/80">Mentioned in Story</h3>
            <span className="text-xs text-muted-foreground/60">not yet promoted</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {mentioned.map((pc) => (
              <div
                key={pc.name}
                className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15 text-sm"
                title={pc.description || `First mentioned on page ${pc.first_page}`}
              >
                <span className="text-amber-400/70">{pc.name}</span>
                {pc.times_mentioned > 1 && (
                  <span className="text-[10px] text-amber-400/65 ml-1.5">x{pc.times_mentioned}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeCharacters.length === 0 && mentioned.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="w-10 h-10 text-muted-foreground/20 mb-4" />
          <p className="text-sm text-muted-foreground/80">No characters yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Characters will appear as the story begins</p>
        </div>
      )}
    </div>
  );
}

function CharField({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <Icon className="w-3 h-3 text-muted-foreground/50 mt-1 flex-shrink-0" />
      <div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
        <p className="text-xs text-foreground/85 leading-relaxed">{value}</p>
      </div>
    </div>
  );
}

// ─── Controls Tab ────────────────────────────────────────────────────────────

function ControlsTab({
  sendCommand,
  bookId,
  testApi,
}: {
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
  bookId?: string;
  testApi: (endpoint: string, method?: "GET" | "POST" | "DELETE", body?: Record<string, unknown>) => Promise<void>;
}) {
  const [pageInterval, setPageInterval] = useState("30");
  const [isPaused, setIsPaused] = useState(false);

  const handleTogglePause = () => {
    sendCommand("toggle_pause");
    setIsPaused((p) => !p);
  };

  return (
    <div className="space-y-8 max-w-lg">
      {/* Playback Controls */}
      <div>
        <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center gap-2">
          <Play className="w-4 h-4 text-primary/80" />
          Playback
        </h3>

        <div className="flex gap-3">
          <button
            onClick={handleTogglePause}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
              isPaused
                ? "bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
            }`}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isPaused ? "Resume" : "Pause"}
          </button>

          <button
            onClick={() => sendCommand("page")}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-primary/30 bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-all"
          >
            <SkipForward className="w-4 h-4" />
            Next Page
          </button>
        </div>
      </div>

      {/* Page Interval */}
      <div>
        <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary/80" />
          Pacing
        </h3>

        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-muted/5">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground/80 block mb-1.5">Page interval (seconds)</label>
            <input
              type="number"
              value={pageInterval}
              onChange={(e) => setPageInterval(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary/50 focus:outline-none transition-colors"
              placeholder="30"
              min="0"
            />
            <p className="text-[10px] text-muted-foreground/60 mt-1">Set to 0 for manual page turns only</p>
          </div>
          <button
            onClick={() => sendCommand("set_page_interval", { seconds: parseInt(pageInterval) || 30 })}
            className="px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors self-end"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary/80" />
          Quick Actions
        </h3>

        <div className="grid grid-cols-2 gap-2">
          <ControlButton label="Get Status" icon={Activity} onClick={() => sendCommand("status")} />
          <ControlButton label="Refresh World" icon={RefreshCw} onClick={() => sendCommand("world")} />
          <ControlButton label="List Characters" icon={Users} onClick={() => sendCommand("list")} />
          <ControlButton label="View History" icon={BookOpen} onClick={() => sendCommand("history", { count: 20 })} />
          {bookId && (
            <>
              <ControlButton
                label="Pause via API"
                icon={Pause}
                onClick={() => testApi(`/api/v1/books/${bookId}/pause`, "POST")}
              />
              <ControlButton
                label="Resume via API"
                icon={Play}
                onClick={() => testApi(`/api/v1/books/${bookId}/resume`, "POST")}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlButton({ label, icon: Icon, onClick }: { label: string; icon: typeof Play; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/40 bg-muted/5 text-sm text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/20 transition-all"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ─── Debug Tab (dev only) ────────────────────────────────────────────────────

function DebugTab({
  debugData,
  npcData: _npcData,
  loading,
  expandedItems,
  toggleExpand,
  apiResults,
  scenarios,
  selectedScenario,
  setSelectedScenario,
  testApi,
  sendCommand,
  bookId,
  authInfo,
  apiUrl,
}: {
  debugData: DebugData | null;
  npcData: NPCData | null;
  loading: boolean;
  expandedItems: Set<string>;
  toggleExpand: (key: string) => void;
  apiResults: ApiResult[];
  scenarios: string[];
  selectedScenario: string;
  setSelectedScenario: (s: string) => void;
  testApi: (endpoint: string, method?: "GET" | "POST" | "DELETE", body?: Record<string, unknown>) => Promise<void>;
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
  bookId?: string;
  authInfo?: AuthInfo;
  apiUrl: string;
}) {
  void _npcData;
  type DebugSubTab = "overview" | "raw-pages" | "raw-chars" | "api" | "auth";
  const [debugSubTab, setDebugSubTab] = useState<DebugSubTab>(() => {
    try { const v = localStorage.getItem("raunch_dash_debug_tab"); if (v) return v as DebugSubTab; } catch {}
    return "overview";
  });
  const setDebugSubTabPersist = (tab: DebugSubTab) => {
    setDebugSubTab(tab);
    try { localStorage.setItem("raunch_dash_debug_tab", tab); } catch {}
  };
  const [pageIntervalInput, setPageIntervalInput] = useState("30");
  const [discoveredRoutes, setDiscoveredRoutes] = useState<RouteInfo[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Auto-discover API routes
  useEffect(() => {
    async function fetchRoutes() {
      setRoutesLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/v1/routes`);
        if (res.ok) {
          const data = await res.json();
          setDiscoveredRoutes(data.routes || []);
        }
      } catch { /* ignore */ }
      setRoutesLoading(false);
    }
    fetchRoutes();
  }, [apiUrl]);

  // Reset scenario handler
  const handleReset = async () => {
    if (!bookId) return;
    setResetting(true);
    try {
      let librarianId = authInfo?.librarianId || "";
      if (!librarianId) {
        try {
          const host = new URL(apiUrl).host;
          librarianId = localStorage.getItem(`raunch_librarian_id_${host}`) || "";
        } catch { /* ignore */ }
      }
      const res = await fetch(`${apiUrl}/api/v1/books/${bookId}/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Librarian-ID": librarianId,
        },
      });
      if (res.ok) {
        setResetConfirm(false);
        // Force reconnect to get fresh state
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`Reset failed: ${data.detail || res.status}`);
      }
    } catch (err) {
      alert(`Reset error: ${err}`);
    } finally {
      setResetting(false);
    }
  };

  // Group discovered routes by prefix
  const routeGroups = discoveredRoutes.reduce<Record<string, RouteInfo[]>>((acc, route) => {
    // Skip the routes endpoint itself and health
    if (route.path === "/api/v1/routes" || route.path === "/health") return acc;

    // Group by first path segment after /api/v1/
    const match = route.path.match(/^\/api\/v1\/(\w+)/);
    const group = match ? match[1] : "other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(route);
    return acc;
  }, {});

  // Replace {book_id} placeholder with actual bookId for clickable routes
  const resolveRoute = (path: string): string => {
    if (bookId) return path.replace("{book_id}", bookId);
    return path;
  };

  const methodColors: Record<string, string> = {
    GET: "text-green-400 bg-green-500/10",
    POST: "text-blue-400 bg-blue-500/10",
    PUT: "text-amber-400 bg-amber-500/10",
    DELETE: "text-red-400 bg-red-500/10",
    PATCH: "text-purple-400 bg-purple-500/10",
  };

  if (loading && !debugData) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  // If no debug data and not loading, default to API sub-tab which works without a book
  const effectiveSubTab = (!debugData && (debugSubTab === "overview" || debugSubTab === "raw-pages" || debugSubTab === "raw-chars"))
    ? "api"
    : debugSubTab;

  return (
    <div className="space-y-4">
      {/* Reset Scenario Button */}
      {bookId && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-red-500/20 bg-red-500/5">
          <RotateCcw className="w-4 h-4 text-red-400/60 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-red-400/80">Reset Scenario</p>
            <p className="text-[10px] text-muted-foreground/60">Wipes all pages and restarts the orchestrator from scratch</p>
          </div>
          {!resetConfirm ? (
            <button
              onClick={() => setResetConfirm(true)}
              className="px-3 py-1.5 text-xs bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 transition-colors"
            >
              Reset
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                disabled={resetting}
                className="px-3 py-1.5 text-xs bg-red-500/30 text-red-300 rounded-lg hover:bg-red-500/40 transition-colors disabled:opacity-50"
              >
                {resetting ? "Resetting..." : "Confirm"}
              </button>
              <button
                onClick={() => setResetConfirm(false)}
                className="px-3 py-1.5 text-xs bg-muted/20 text-muted-foreground rounded-lg hover:bg-muted/30 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Debug sub-tabs */}
      <div className="flex gap-1 p-1 bg-muted/10 rounded-lg border border-amber-500/10 w-fit">
        {(["overview", "raw-pages", "raw-chars", "api", "auth"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setDebugSubTabPersist(tab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              effectiveSubTab === tab
                ? "bg-amber-500/20 text-amber-400"
                : "text-muted-foreground/70 hover:text-muted-foreground"
            }`}
          >
            {tab === "raw-pages" ? "Raw Pages" : tab === "raw-chars" ? "Raw Chars" : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview sub-tab */}
      {effectiveSubTab === "overview" && debugData && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <DebugStatCard label="Total Pages" value={debugData.stats.total_pages} />
            <DebugStatCard label="Char Responses" value={debugData.stats.total_character_pages} />
            <DebugStatCard label="Parsed OK" value={debugData.stats.successfully_parsed} variant="success" />
            <DebugStatCard
              label="Refusals"
              value={debugData.stats.refusals}
              variant={debugData.stats.refusals > 0 ? "warning" : "default"}
            />
          </div>

          {/* Issues */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">Issues</h4>
            {(() => {
              const refusals = debugData.character_pages.filter((cp) => cp.is_refusal);
              const parseErrors = debugData.character_pages.filter((cp) => cp.parse_error);
              if (refusals.length === 0 && parseErrors.length === 0) {
                return <p className="text-xs text-muted-foreground/60">No issues</p>;
              }
              return (
                <div className="space-y-1.5">
                  {refusals.slice(0, 5).map((cp) => (
                    <div key={`r-${cp.id}`} className="text-xs px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15 text-amber-400/70">
                      Page {cp.page} - {cp.character_name}: refusal
                    </div>
                  ))}
                  {parseErrors.slice(0, 3).map((cp) => (
                    <div key={`p-${cp.id}`} className="text-xs px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/15 text-red-400/70">
                      Page {cp.page} - {cp.character_name}: {cp.parse_error}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="text-[10px] text-muted-foreground/50 font-mono">
            World ID: {debugData.world_id}
          </div>
        </div>
      )}

      {/* Raw Pages sub-tab */}
      {effectiveSubTab === "raw-pages" && debugData && (
        <div className="space-y-2">
          {debugData.pages.map((p) => {
            const key = `dbg-page-${p.id}`;
            const isExpanded = expandedItems.has(key);
            return (
              <div key={key} className="border border-border/30 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleExpand(key)}
                  className="w-full px-4 py-2 flex items-center justify-between bg-muted/5 hover:bg-muted/10 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono font-bold text-primary/85">#{p.page}</span>
                    <span className="text-muted-foreground/70">{p.world_time}</span>
                    <span className="text-amber-400/65">{p.mood}</span>
                  </div>
                  <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 py-3 border-t border-border/20 space-y-2 text-xs">
                        <p className="text-foreground/85 whitespace-pre-wrap">{p.narration}</p>
                        <p className="text-[10px] text-muted-foreground/50 font-mono">ID: {p.id} | {p.created_at}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* Raw Character Pages sub-tab */}
      {effectiveSubTab === "raw-chars" && debugData && (
        <div className="space-y-2">
          {debugData.character_pages.map((cp) => {
            const key = `dbg-char-${cp.id}`;
            const isExpanded = expandedItems.has(key);
            return (
              <div key={key} className={`border rounded-lg overflow-hidden ${
                cp.is_refusal ? "border-amber-500/20" : cp.parse_error ? "border-red-500/20" : "border-border/30"
              }`}>
                <button
                  onClick={() => toggleExpand(key)}
                  className="w-full px-4 py-2 flex items-center justify-between bg-muted/5 hover:bg-muted/10 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono font-bold text-primary/85">#{cp.page}</span>
                    <span className="text-foreground/85">{cp.character_name}</span>
                    {cp.is_refusal && <span className="px-1.5 py-0.5 text-[9px] bg-amber-500/15 text-amber-400 rounded">REFUSAL</span>}
                    {cp.parse_error && <span className="px-1.5 py-0.5 text-[9px] bg-red-500/15 text-red-400 rounded">PARSE ERR</span>}
                  </div>
                  <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 py-3 border-t border-border/20 space-y-2 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <div><span className="text-muted-foreground/60">Thoughts:</span> <span className="text-foreground/80">{cp.inner_thoughts || "—"}</span></div>
                          <div><span className="text-muted-foreground/60">Action:</span> <span className="text-foreground/80">{cp.action || "—"}</span></div>
                          <div><span className="text-muted-foreground/60">Dialogue:</span> <span className="text-foreground/80">{cp.dialogue || "—"}</span></div>
                          <div><span className="text-muted-foreground/60">Emotion:</span> <span className="text-foreground/80">{cp.emotional_state || "—"}</span></div>
                        </div>
                        {cp.raw_json && (
                          <pre className="p-2 text-[10px] bg-black/20 text-muted-foreground/70 font-mono rounded overflow-x-auto">
                            {JSON.stringify(cp.raw_json, null, 2)}
                          </pre>
                        )}
                        <p className="text-[10px] text-muted-foreground/50 font-mono">ID: {cp.id} | {cp.created_at}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* API Tester sub-tab — two-column: routes left, results right */}
      {effectiveSubTab === "api" && (
        <ApiSubTab
          routeGroups={routeGroups}
          routesLoading={routesLoading}
          discoveredRoutes={discoveredRoutes}
          resolveRoute={resolveRoute}
          methodColors={methodColors}
          bookId={bookId}
          testApi={testApi}
          sendCommand={sendCommand}
          scenarios={scenarios}
          selectedScenario={selectedScenario}
          setSelectedScenario={setSelectedScenario}
          apiResults={apiResults}
          pageIntervalInput={pageIntervalInput}
          setPageIntervalInput={setPageIntervalInput}
          apiUrl={apiUrl}
        />
      )}

      {/* Auth sub-tab */}
      {effectiveSubTab === "auth" && (
        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
            <Shield className="w-3 h-3" /> Auth State
          </h4>
          <div className="space-y-2 text-xs">
            <AuthRow label="Authenticated" value={authInfo?.isAuthenticated ? "Yes" : "No"} />
            <AuthRow label="Email" value={authInfo?.userEmail || "—"} />
            <AuthRow label="Name" value={authInfo?.userName || "—"} />
            <AuthRow label="Librarian ID" value={authInfo?.librarianId || "—"} mono />
            <AuthRow label="Access Token" value={authInfo?.accessToken ? `${authInfo.accessToken.slice(0, 20)}...` : "—"} mono />
            <AuthRow label="API URL" value={apiUrl} mono />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── API Sub-Tab (two-column layout) ─────────────────────────────────────────

function ApiSubTab({
  routeGroups,
  routesLoading,
  discoveredRoutes,
  resolveRoute,
  methodColors,
  bookId,
  testApi,
  sendCommand,
  scenarios,
  selectedScenario,
  setSelectedScenario,
  apiResults,
  pageIntervalInput,
  setPageIntervalInput,
}: {
  routeGroups: Record<string, RouteInfo[]>;
  routesLoading: boolean;
  discoveredRoutes: RouteInfo[];
  resolveRoute: (path: string) => string;
  methodColors: Record<string, string>;
  bookId?: string;
  testApi: (endpoint: string, method?: "GET" | "POST" | "DELETE", body?: Record<string, unknown>) => Promise<void>;
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
  scenarios: string[];
  selectedScenario: string;
  setSelectedScenario: (s: string) => void;
  apiResults: ApiResult[];
  pageIntervalInput: string;
  setPageIntervalInput: (s: string) => void;
  apiUrl: string;
}) {
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({});
  const [bodyInput, setBodyInput] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<{ method: string; path: string } | null>(null);
  const [wsResults, setWsResults] = useState<ApiResult[]>([]);
  const [wsCommands, setWsCommands] = useState<{ cmd: string; desc: string; params?: Record<string, string> }[]>([]);
  const [wsParamInputs, setWsParamInputs] = useState<Record<string, Record<string, string>>>({});

  // Listen for WS messages via custom event from useGame
  useEffect(() => {
    const handleWsMessage = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!msg?.type) return;
      setWsResults((prev) => [{
        endpoint: `WS ← ${msg.type}`,
        status: "success" as const,
        data: msg,
        timestamp: new Date(),
      }, ...prev].slice(0, 30));
    };
    window.addEventListener("raunch-ws-message", handleWsMessage);
    return () => window.removeEventListener("raunch-ws-message", handleWsMessage);
  }, []);

  // Fetch WS commands from backend
  useEffect(() => {
    async function fetchWsCommands() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/ws/commands`);
        if (res.ok) {
          const data = await res.json();
          setWsCommands(data.commands || []);
        }
      } catch { /* ignore */ }
    }
    fetchWsCommands();
  }, [apiUrl]);

  // Combined results: REST + WS interleaved by time
  const allResults = [...apiResults, ...wsResults]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 30);

  // Extract param placeholders from a path
  const getParams = (path: string): string[] => {
    const matches = path.match(/\{(\w+)\}/g);
    return matches ? matches.map((m) => m.slice(1, -1)) : [];
  };

  // Resolve a path with user-provided params
  const resolveWithParams = (path: string): string => {
    let resolved = resolveRoute(path); // first apply auto book_id
    for (const [key, value] of Object.entries(paramInputs)) {
      if (value) resolved = resolved.replace(`{${key}}`, encodeURIComponent(value));
    }
    return resolved;
  };

  const handleRouteClick = (route: RouteInfo) => {
    setSelectedRoute(route);

    // Resolve with both auto book_id and user-typed params
    const resolved = resolveWithParams(route.path);
    const stillUnresolved = resolved.includes("{");

    if (stillUnresolved) {
      // Has unfilled params — just select it, user needs to fill inputs first
      return;
    }

    // Execute
    let body: Record<string, unknown> | undefined;
    if (route.method === "POST" || route.method === "PUT") {
      try { body = bodyInput ? JSON.parse(bodyInput) : undefined; } catch { /* ignore */ }
    }
    testApi(resolved, route.method as "GET" | "POST" | "DELETE", body);
  };

  return (
    <div className="grid grid-cols-2 gap-6 min-h-[500px]">
      {/* Left column — routes + WS commands */}
      <div className="space-y-4 overflow-y-auto max-h-[70vh] pr-2">
        {/* REST routes header */}
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          <h4 className="text-xs font-semibold text-foreground/90">API Endpoints</h4>
          {routesLoading && <span className="animate-spin w-3 h-3 border border-muted-foreground/50 border-t-muted-foreground rounded-full" />}
          <span className="text-[10px] text-muted-foreground/60">{discoveredRoutes.length} routes</span>
        </div>

        {/* Route groups */}
        {Object.entries(routeGroups).map(([group, routes]) => (
          <div key={group}>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-1 pl-1">
              {group}
            </p>
            <div className="space-y-0.5">
              {routes.map((route) => {
                const resolved = resolveRoute(route.path);
                const hasUnresolved = resolved.includes("{");
                const isSelected = selectedRoute?.method === route.method && selectedRoute?.path === route.path;

                // Split path into segments, some editable
                const segments = resolved.split(/(\{[^}]+\})/);

                return (
                  <div
                    key={`${route.method}-${route.path}`}
                    onClick={() => handleRouteClick(route)}
                    className={`w-full px-3 py-1.5 flex items-center gap-2 rounded-lg text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/15 border border-transparent"
                    }`}
                    title={`${route.method} ${route.path}${route.name ? ` — ${route.name}` : ""}`}
                  >
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${methodColors[route.method] || "text-muted-foreground bg-muted/10"}`}>
                      {route.method}
                    </span>
                    <span className="text-[11px] font-mono flex items-center flex-1 min-w-0 overflow-hidden">
                      {segments.map((seg, i) => {
                        const paramMatch = seg.match(/^\{(\w+)\}$/);
                        if (paramMatch) {
                          const param = paramMatch[1];
                          return (
                            <input
                              key={i}
                              type="text"
                              value={paramInputs[param] || ""}
                              onChange={(e) => {
                                e.stopPropagation();
                                setParamInputs((p) => ({ ...p, [param]: e.target.value }));
                                setSelectedRoute(route);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              placeholder={param}
                              className="inline-block w-20 px-1.5 py-0 text-[11px] font-mono bg-amber-500/10 border border-amber-500/30 rounded text-amber-300 placeholder:text-amber-400/40 focus:border-amber-400 focus:outline-none mx-0.5"
                            />
                          );
                        }
                        return (
                          <span key={i} className="text-foreground/90 whitespace-nowrap">{seg}</span>
                        );
                      })}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRouteClick(route); }}
                      className={`text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 transition-colors ${
                        hasUnresolved
                          ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                          : "text-primary bg-primary/10 hover:bg-primary/20"
                      }`}
                    >
                      {hasUnresolved ? "run" : "run"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {discoveredRoutes.length === 0 && !routesLoading && (
          <p className="text-xs text-muted-foreground/60 italic">No routes discovered. Is the backend running?</p>
        )}

        {/* Body input for POST/PUT */}
        {selectedRoute && (selectedRoute.method === "POST" || selectedRoute.method === "PUT") && (
          <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
            <p className="text-[10px] font-semibold text-foreground/80">
              Request Body for {selectedRoute.method} {selectedRoute.path}
            </p>
            <textarea
              value={bodyInput}
              onChange={(e) => setBodyInput(e.target.value)}
              placeholder='{"key": "value"}'
              rows={3}
              className="w-full px-2 py-1.5 text-xs font-mono bg-background border border-border rounded focus:border-primary/50 focus:outline-none resize-y"
            />
          </div>
        )}

        {/* Quick actions */}
        <div className="p-3 rounded-lg border border-border/30 bg-muted/5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground/70">Create Book:</span>
            <select
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value)}
              className="px-2 py-1 text-xs bg-background border border-border rounded"
            >
              {scenarios.length === 0 ? <option value="milk_money">milk_money</option> :
                scenarios.map((s) => <option key={s} value={s}>{s}</option>)
              }
            </select>
            <button
              onClick={() => testApi("/api/v1/books", "POST", { scenario: selectedScenario })}
              className="px-2 py-1 text-xs bg-green-500/15 text-green-400 rounded hover:bg-green-500/25 transition-colors"
            >
              Create
            </button>
            {bookId && (
              <>
                <button
                  onClick={() => testApi(`/api/v1/books/${bookId}`, "DELETE")}
                  className="px-2 py-1 text-xs bg-red-500/15 text-red-400 rounded hover:bg-red-500/25 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => testApi(`/api/v1/books/${bookId}/reset`, "POST")}
                  className="px-2 py-1 text-xs bg-amber-500/15 text-amber-400 rounded hover:bg-amber-500/25 transition-colors"
                >
                  Reset
                </button>
              </>
            )}
          </div>
        </div>

        {/* WebSocket commands — auto-discovered */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Send className="w-3.5 h-3.5 text-purple-400" />
            <h4 className="text-xs font-semibold text-foreground/90">WebSocket Commands</h4>
            <span className="text-[10px] text-muted-foreground/60">{wsCommands.length} commands</span>
          </div>
          <div className="space-y-1">
            {wsCommands.map(({ cmd, desc, params }) => {
              const hasParams = params && Object.keys(params).length > 0;
              const cmdParams = wsParamInputs[cmd] || {};

              return (
                <div
                  key={cmd}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-purple-500/15 bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
                >
                  <button
                    onClick={() => {
                      const data: Record<string, unknown> = {};
                      if (params) {
                        for (const [key, type] of Object.entries(params)) {
                          const val = cmdParams[key];
                          if (val) {
                            data[key] = type.startsWith("int") ? parseInt(val) || 0
                              : type.startsWith("bool") ? val === "true"
                              : val;
                          }
                        }
                      }
                      sendCommand(cmd, Object.keys(data).length > 0 ? data : undefined);
                    }}
                    className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors flex-shrink-0"
                  >
                    {cmd}
                  </button>
                  <span className="text-[10px] text-muted-foreground/70 flex-1 truncate" title={desc}>
                    {desc}
                  </span>
                  {hasParams && Object.entries(params).map(([key, type]) => (
                    <input
                      key={key}
                      type={type.startsWith("int") ? "number" : "text"}
                      value={cmdParams[key] || ""}
                      onChange={(e) => setWsParamInputs((prev) => ({
                        ...prev,
                        [cmd]: { ...(prev[cmd] || {}), [key]: e.target.value },
                      }))}
                      placeholder={key}
                      className="w-20 px-1.5 py-0.5 text-[10px] font-mono bg-purple-500/10 border border-purple-500/25 rounded text-purple-300 placeholder:text-purple-400/30 focus:border-purple-400 focus:outline-none"
                      title={`${key}: ${type}`}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {wsCommands.length === 0 && (
            <p className="text-xs text-muted-foreground/60 italic">Loading commands...</p>
          )}
        </div>

        {/* Close Book */}
        {bookId && (
          <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-red-400/90">Close Book</p>
              <p className="text-[10px] text-muted-foreground/60 font-mono">{bookId}</p>
            </div>
            <button
              onClick={() => testApi(`/api/v1/books/${bookId}`, "DELETE")}
              className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Right column — results log */}
      <div className="flex flex-col border-l border-border/30 pl-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-foreground/90">Results</h4>
          {allResults.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60">
              {apiResults.length} REST + {wsResults.length} WS
            </span>
          )}
        </div>
        {allResults.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-muted-foreground/70 italic text-center">
              Click a route or WS command.<br />Results appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 overflow-y-auto flex-1 max-h-[65vh]">
            {allResults.map((result, i) => (
              <ApiResultRow key={`${result.timestamp.getTime()}-${i}`} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Debug helper components ─────────────────────────────────────────────────

function DebugStatCard({ label, value, variant = "default" }: { label: string; value: number; variant?: "default" | "success" | "warning" }) {
  const colors = {
    default: "bg-muted/10 border-border/30",
    success: "bg-green-500/5 border-green-500/15",
    warning: "bg-amber-500/5 border-amber-500/15",
  };
  const textColors = { default: "text-foreground", success: "text-green-400", warning: "text-amber-400" };

  return (
    <div className={`rounded-lg border p-3 ${colors[variant]}`}>
      <p className="text-[10px] text-muted-foreground/70 mb-0.5">{label}</p>
      <p className={`text-xl font-bold ${textColors[variant]}`}>{value}</p>
    </div>
  );
}


function ApiResultRow({ result }: { result: ApiResult }) {
  const [expanded, setExpanded] = useState(false);
  const colors = { loading: "border-blue-500/20", success: "border-green-500/20", error: "border-red-500/20" };
  const dots = { loading: "bg-blue-400", success: "bg-green-400", error: "bg-red-400" };

  return (
    <div className={`border rounded-lg overflow-hidden ${colors[result.status]}`}>
      <button onClick={() => setExpanded(!expanded)} className="w-full px-3 py-1.5 flex items-center justify-between text-left hover:bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${dots[result.status]}`} />
          <span className="text-[10px] font-mono text-foreground/80">{result.endpoint}</span>
          {result.error && <span className="text-[9px] text-red-400/60">{result.error}</span>}
        </div>
        <span className="text-[9px] text-muted-foreground/50">{result.timestamp.toLocaleTimeString()}</span>
      </button>
      {expanded && result.data !== undefined && (
        <pre className="px-3 py-2 text-[9px] bg-black/20 text-muted-foreground/60 font-mono overflow-x-auto border-t border-border/20">
          {JSON.stringify(result.data as object, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AuthRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/10">
      <span className="text-muted-foreground/70">{label}</span>
      <span className={`text-foreground/85 ${mono ? "font-mono text-[10px]" : ""}`}>{value}</span>
    </div>
  );
}

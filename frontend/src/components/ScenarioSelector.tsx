import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Trash2,
  Plus,
  Sparkles,
  Wand2,
  BookOpen,
  Play,
  Clock,
  Users,
  Share2,
  Globe,
  Check,
  Bookmark,
  X,
} from "lucide-react";
import { useMockMode } from "@/context/MockMode";

type Scenario = {
  file?: string;
  id?: string;
  name: string;
  setting?: string;
  characters: number;
  themes: string[];
  source: "file" | "db";
  public?: boolean;
  owner_id?: string;
};

type Book = {
  id: string;
  scenario_name: string;
  bookmark: string;
  page_count: number;
  paused: boolean;
  created_at?: string;
  owner_id?: string;
  role?: string;
  setting?: string;
  characters?: string[];
  mood?: string;
  premise?: string;
  readers?: number;
  private?: boolean;
};

type TabId = "my-books" | "community" | "create";

type Props = {
  apiUrl: string;
  librarianId: string | null;
  onScenarioSelected: (scenario: string) => void;
  onBookSelected?: (bookId: string) => void;
  isLoading?: boolean;
  externalError?: string | null;
  onBack?: () => void;
  onOpenWizard?: () => void;
  initialTab?: "books" | "scenarios";
};

const MOCK_SCENARIOS: Scenario[] = [
  { id: "mock-1", name: "Midnight at the Velvet Lounge", setting: "A dimly lit jazz club in 1920s Paris where the champagne flows freely and the music hides whispered confessions between strangers", characters: 3, themes: ["jazz age", "forbidden romance"], source: "db", public: true },
  { id: "mock-2", name: "The Lighthouse Keeper's Secret", setting: "A remote lighthouse on the Scottish coast, battered by winter storms", characters: 2, themes: ["isolation", "mystery"], source: "db", public: true },
  { id: "mock-3", name: "Roommates with Benefits", setting: "A cramped NYC apartment shared by two grad students who can hear everything through the thin walls", characters: 2, themes: ["modern", "tension"], source: "db", public: false, owner_id: "local-demo-user" },
];

const MOCK_BOOKS: Book[] = [
  { id: "book-1", scenario_name: "Midnight at the Velvet Lounge", bookmark: "JAZZ-0042", page_count: 12, paused: false, owner_id: "local-demo-user", role: "owner", setting: "A dimly lit jazz club in 1920s Paris", characters: ["Josephine", "Marcel", "The Bartender"], mood: "sultry", created_at: "2026-03-25T14:30:00Z", premise: "Two strangers meet at a jazz club in 1920s Paris, drawn together by the music and the forbidden thrill of the night.", readers: 3, private: false },
  { id: "book-2", scenario_name: "The Lighthouse Keeper's Secret", bookmark: "LITE-0007", page_count: 0, paused: false, owner_id: "local-demo-user", role: "owner", setting: "A remote lighthouse on the Scottish coast", characters: ["Callum", "Iris"], created_at: "2026-03-27T09:15:00Z", private: true },
  { id: "book-3", scenario_name: "Roommates with Benefits", bookmark: "ROOM-1234", page_count: 8, paused: false, owner_id: "other-user", role: "reader", setting: "A cramped NYC apartment", characters: ["Alex", "Jordan"], mood: "tense", created_at: "2026-03-26T18:00:00Z" },
];

const MOCK_PUBLIC_BOOKS: Book[] = [
  { id: "public-library", scenario_name: "Cozy Cafe Conversations", bookmark: "LIBR-0001", page_count: 42, paused: false, setting: "A warm corner cafe on a rainy afternoon", characters: ["Barista", "Regular"], mood: "cozy", readers: 7, premise: "A charming cafe where conversations between strangers lead to unexpected connections." },
];

function timeAgo(dateStr: string): string {
  // SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" without timezone
  // Append Z to treat as UTC if no timezone indicator present
  const normalized = dateStr.includes("T") || dateStr.includes("Z") || dateStr.includes("+")
    ? dateStr
    : dateStr.replace(" ", "T") + "Z";
  const ms = Date.now() - new Date(normalized).getTime();
  if (isNaN(ms) || ms < 0) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(normalized).toLocaleDateString();
}

// ── Subcomponents ──────────────────────────────────────────

function CopyableBookmark({ bookmark }: { bookmark: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(bookmark);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors" title="Copy bookmark">
      <Bookmark className="w-3 h-3" />
      {bookmark}
      {copied && <motion.span initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}><Check className="w-3 h-3 text-emerald-400" /></motion.span>}
    </button>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.15em] mb-3">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </h3>
  );
}

function EmptyState({ icon: Icon, message, sub }: { icon: React.ComponentType<{ className?: string }>; message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-14 h-14 rounded-2xl bg-secondary/40 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-foreground/40" />
      </div>
      <p className="text-muted-foreground/60 text-sm">{message}</p>
      {sub && <p className="text-muted-foreground/40 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function ExpandableText({ text, lines = 1 }: { text: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const clampClass = lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : "line-clamp-3";

  return (
    <div>
      <p className={`text-xs text-muted-foreground/60 mt-1 ${!expanded ? clampClass : ""}`}>
        {text}
      </p>
      {text.length > 80 && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[10px] text-primary/50 hover:text-primary/80 mt-0.5 transition-colors"
        >
          {expanded ? "less" : "more..."}
        </button>
      )}
    </div>
  );
}

// Inline delete with auto-revert confirmation
function CardActions({
  onDelete,
  isDeleting,
}: {
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <AnimatePresence mode="wait">
      {confirming ? (
        <motion.button
          key="confirm"
          initial={{ opacity: 0, scale: 0.9, width: 0 }}
          animate={{ opacity: 1, scale: 1, width: "auto" }}
          exit={{ opacity: 0, scale: 0.9, width: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          disabled={isDeleting}
          className="px-3 py-1.5 text-[11px] font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-lg hover:bg-destructive/20 transition-colors whitespace-nowrap overflow-hidden"
        >
          {isDeleting ? "..." : "confirm delete"}
        </motion.button>
      ) : (
        <motion.button
          key="delete"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          className="p-2 text-muted-foreground/30 hover:text-destructive/60 transition-colors rounded-lg hover:bg-destructive/5"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function BookCardExpanded({ book, index, onResume, onDelete, onToggleShare, isLoading, isDeleting, isTogglingShare }: {
  book: Book;
  index: number;
  onResume: () => void;
  onDelete: () => void;
  onToggleShare?: () => void;
  isLoading?: boolean;
  isDeleting: boolean;
  isTogglingShare?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="bg-card/30 hover:bg-card/50 border border-border/20 hover:border-border/40 rounded-2xl transition-all duration-200 overflow-hidden"
    >
      {/* Clickable header area */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-5 pb-3"
      >
        {/* Title + mood */}
        <div className="flex items-center gap-2 mb-1.5">
          {/* Book cover — opens like a real book from the left spine */}
          <div className="relative w-7 h-9 shrink-0" style={{ perspective: "400px" }}>
            {/* Spine (always visible) */}
            <div className="absolute left-0 top-0 w-1 h-full rounded-l-sm bg-primary/30" />
            {/* Cover — rotates from left edge */}
            <motion.div
              animate={{ rotateY: open ? -160 : 0 }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              className="absolute inset-0 rounded-sm bg-gradient-to-r from-primary/25 to-primary/10 border border-primary/15 flex items-center justify-center"
              style={{ transformOrigin: "left center", transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
            >
              <BookOpen className="w-3 h-3 text-primary/50" />
            </motion.div>
            {/* Inside page (revealed when open) */}
            <div className="absolute inset-0 left-1 rounded-r-sm bg-secondary/20 border border-border/10 flex items-center justify-center">
              <div className="w-3 h-0.5 bg-muted-foreground/10 rounded-full" />
              <div className="w-2 h-0.5 bg-muted-foreground/10 rounded-full ml-0.5" />
            </div>
          </div>
          <h3 className="font-medium text-foreground/90 flex-1 min-w-0 truncate">{book.scenario_name}</h3>
          {book.mood && (
            <span className="px-2 py-0.5 text-[10px] rounded-md bg-primary/10 text-primary/70 font-medium shrink-0 italic">
              {book.mood}
            </span>
          )}
        </div>

        {/* Meta row — always visible */}
        <div className="flex items-center gap-3 text-xs flex-wrap ml-8">
          {book.page_count > 0 ? (
            <span className="flex items-center gap-1 text-muted-foreground/50">
              <Clock className="w-3 h-3" />{book.page_count} pages
            </span>
          ) : (
            <span className="text-muted-foreground/40 italic">the beginning</span>
          )}
          <CopyableBookmark bookmark={book.bookmark} />
          {book.created_at && (
            <span className="text-muted-foreground/30">{timeAgo(book.created_at)}</span>
          )}
          {book.readers !== undefined && book.readers > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground/40">
              <Users className="w-3 h-3" />{book.readers}
            </span>
          )}
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-3">
              {/* Setting */}
              {book.setting && (
                <p className="text-xs text-muted-foreground/50 ml-8">{book.setting}</p>
              )}

              {/* Characters */}
              {book.characters && book.characters.length > 0 && (
                <div className="flex items-center gap-1.5 ml-8">
                  <Users className="w-3 h-3 text-muted-foreground/30" />
                  <div className="flex items-center gap-1 flex-wrap">
                    {book.characters.map((name) => (
                      <span key={name} className="px-1.5 py-0.5 text-[10px] rounded-md bg-secondary/40 text-muted-foreground/60">{name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Premise */}
              {book.premise && (
                <div className="ml-8 relative pl-3 border-l-2 border-primary/15">
                  <p className="text-xs text-muted-foreground/40 italic leading-relaxed line-clamp-3">
                    {book.premise}
                  </p>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions — always visible outside the expandable area */}
      <div className="px-5 pb-4 flex items-center gap-2 ml-8">
        <button
          onClick={(e) => { e.stopPropagation(); onResume(); }}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-primary-foreground bg-primary/80 hover:bg-primary rounded-xl transition-all disabled:opacity-50"
        >
          <Play className="w-3 h-3" /> {book.page_count === 0 ? "Start" : "Resume"}
        </button>
        {onToggleShare && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleShare(); }}
            disabled={isTogglingShare}
            className={`p-2 rounded-xl transition-all ${
              !book.private
                ? "text-pink-400 hover:text-pink-300"
                : "text-muted-foreground/25 hover:text-pink-400/60"
            }`}
            title={!book.private ? "Public — click to make private" : "Private — click to share"}
          >
            <Share2 className="w-4 h-4" />
          </button>
        )}
        <CardActions onDelete={onDelete} isDeleting={isDeleting} />
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────

export function ScenarioSelector({
  apiUrl,
  librarianId,
  onScenarioSelected,
  onBookSelected,
  isLoading,
  externalError,
  onBack,
  onOpenWizard,
  initialTab,
}: Props) {
  const { mockMode } = useMockMode();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [publicBooks, setPublicBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(initialTab === "scenarios" ? "create" : "my-books");
  const [bookmarkInput, setBookmarkInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [togglingShare, setTogglingShare] = useState<string | null>(null);

  const getScenarioId = (scenario: Scenario) => scenario.file || scenario.id || "";

  // ── Data fetching ──

  useEffect(() => {
    if (mockMode) {
      setScenarios(MOCK_SCENARIOS);
      setBooks(MOCK_BOOKS);
      setPublicBooks(MOCK_PUBLIC_BOOKS);
      setLoading(false);
      return;
    }
    fetchData();
  }, [apiUrl, librarianId, mockMode]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (librarianId) {
        try { const r = await fetch(`${apiUrl}/api/v1/books`, { headers: { "X-Librarian-ID": librarianId } }); if (r.ok) setBooks(await r.json()); } catch { /* */ }
      }
      try { const r = await fetch(`${apiUrl}/api/v1/books/public`); if (r.ok) setPublicBooks(await r.json()); } catch { /* */ }

      const response = await fetch(`${apiUrl}/api/v1/scenarios`);
      if (!response.ok) throw new Error("Failed to fetch scenarios");
      const data: Scenario[] = await response.json();
      let allScenarios = [...data];
      if (librarianId) {
        try {
          const r = await fetch(`${apiUrl}/api/v1/scenarios/mine`, { headers: { "X-Librarian-ID": librarianId } });
          if (r.ok) {
            const mine = await r.json();
            const existingIds = new Set(data.map((s) => s.id).filter(Boolean));
            for (const s of mine) {
              if (!existingIds.has(s.id)) {
                allScenarios.push({ id: s.id, name: s.name, setting: s.setting, characters: s.data?.characters?.length ?? 0, themes: s.data?.themes ?? [], source: "db", public: s.public, owner_id: s.owner_id });
              }
            }
          }
        } catch { /* */ }
      }
      setScenarios(allScenarios);
      // Don't auto-switch — always default to My Books
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load"); }
    finally { setLoading(false); }
  };

  // ── Handlers ──

  const handleLeaveBook = async (bookId: string) => {
    setDeleting(bookId);
    try {
      const r = await fetch(`${apiUrl}/api/v1/books/${bookId}/leave`, { method: "DELETE", headers: librarianId ? { "X-Librarian-ID": librarianId } : {} });
      if (!r.ok) throw new Error("Failed to leave");
      setBooks(books.filter((b) => b.id !== bookId));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to leave book"); }
    finally { setDeleting(null); }
  };

  const handleJoinByBookmark = async () => {
    if (!bookmarkInput.trim() || !librarianId) return;
    setJoining(true); setError(null);
    try {
      const r = await fetch(`${apiUrl}/api/v1/books/join`, { method: "POST", headers: { "Content-Type": "application/json", "X-Librarian-ID": librarianId }, body: JSON.stringify({ bookmark: bookmarkInput.trim() }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || "Book not found"); }
      const { book_id } = await r.json();
      setBookmarkInput(""); onBookSelected?.(book_id);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to join"); }
    finally { setJoining(false); }
  };

  const handleDeleteBook = async (bookId: string) => {
    setDeleting(bookId);
    try {
      const r = await fetch(`${apiUrl}/api/v1/books/${bookId}`, { method: "DELETE", headers: librarianId ? { "X-Librarian-ID": librarianId } : {} });
      if (!r.ok) throw new Error("Failed to delete");
      setBooks(books.filter((b) => b.id !== bookId));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete"); }
    finally { setDeleting(null); }
  };

  const handleGenerate = async () => {
    setGenerating(true); setError(null);
    try {
      const r = await fetch(`${apiUrl}/api/v1/wizard/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ save: false, num_characters: 2 }) });
      if (!r.ok) throw new Error("Failed to generate");
      const scenarioData = await r.json();
      if (librarianId) {
        const sr = await fetch(`${apiUrl}/api/v1/scenarios`, { method: "POST", headers: { "Content-Type": "application/json", "X-Librarian-ID": librarianId }, body: JSON.stringify({ name: scenarioData.scenario_name, description: scenarioData.premise, setting: scenarioData.setting, data: scenarioData, public: false }) });
        if (!sr.ok) throw new Error("Failed to save");
      }
      await fetchData(); setActiveTab("create");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to generate"); }
    finally { setGenerating(false); }
  };

  const handleDeleteScenario = async (scenarioId: string) => {
    setDeleting(scenarioId);
    try {
      const r = await fetch(`${apiUrl}/api/v1/scenarios/${encodeURIComponent(scenarioId)}`, { method: "DELETE", headers: librarianId ? { "X-Librarian-ID": librarianId } : {} });
      if (!r.ok) throw new Error("Failed to delete");
      await fetchData();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete"); }
    finally { setDeleting(null); }
  };

  const handleToggleBookShare = async (bookId: string) => {
    if (!librarianId) return;
    setTogglingShare(bookId);
    try {
      const r = await fetch(`${apiUrl}/api/v1/books/${bookId}/share`, { method: "PUT", headers: { "X-Librarian-ID": librarianId } });
      if (!r.ok) throw new Error("Failed to update");
      const { private: isPrivate } = await r.json();
      setBooks((prev) => prev.map((b) => b.id === bookId ? { ...b, private: isPrivate } : b));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to update sharing"); }
    finally { setTogglingShare(null); }
  };

  const handleToggleShare = async (scenarioId: string, currentlyPublic: boolean) => {
    if (!librarianId) return;
    setTogglingShare(scenarioId);
    try {
      const r = await fetch(`${apiUrl}/api/v1/scenarios/${scenarioId}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Librarian-ID": librarianId }, body: JSON.stringify({ public: !currentlyPublic }) });
      if (!r.ok) throw new Error("Failed to update");
      setScenarios((prev) => prev.map((s) => s.id === scenarioId ? { ...s, public: !currentlyPublic } : s));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to update sharing"); }
    finally { setTogglingShare(null); }
  };

  // ── Derived data ──

  const ownBooks = books.filter((b) => b.owner_id === librarianId || b.role === "owner");
  const joinedBooks = books.filter((b) => b.owner_id !== librarianId && b.role !== "owner");
  const myScenarios = scenarios.filter((s) => !getScenarioId(s).startsWith("test_") && s.source === "db" && s.owner_id === librarianId);
  const communityScenarios = scenarios.filter((s) => !getScenarioId(s).startsWith("test_") && (s.source === "file" || (s.source === "db" && s.public)));

  const tabs: { id: TabId; icon: React.ComponentType<{ className?: string }>; label: string; count?: number }[] = [
    { id: "my-books", icon: BookOpen, label: "My Books" },
    { id: "community", icon: Globe, label: "Community" },
    { id: "create", icon: Wand2, label: "Create" },
  ];

  // ── Render ──

  return (
    <div className="min-h-screen flex flex-col items-center relative overflow-hidden bg-background">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-[oklch(0.06_0.02_340)]" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-primary/[0.02] blur-[180px]" />
      </div>

      <div className="relative z-10 w-full max-w-2xl px-5 sm:px-8 pt-8 pb-12 flex flex-col min-h-screen">

        {/* Back */}
        {onBack && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onBack} className="self-start -ml-1 mb-6 p-2 text-muted-foreground/40 hover:text-foreground transition-colors rounded-lg hover:bg-secondary/30">
            <ArrowLeft className="w-5 h-5" />
          </motion.button>
        )}

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground/90">library</h2>
          <AnimatePresence mode="wait">
            <motion.p key={activeTab} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2 }} className="text-muted-foreground/50 text-sm mt-1.5">
              {activeTab === "my-books" && "your sessions"}
              {activeTab === "community" && "discover and join"}
              {activeTab === "create" && "craft something new"}
            </motion.p>
          </AnimatePresence>
        </motion.div>

        {/* Tabs */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="flex p-1 bg-secondary/30 rounded-2xl mb-6 border border-border/20">
          {tabs.map(({ id, icon: Icon, label, count }) => (
            <button key={id} onClick={() => setActiveTab(id)} className={`relative flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 ${activeTab === id ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground/80"}`}>
              {activeTab === id && (
                <motion.div layoutId="activeTab" className="absolute inset-0 bg-card/80 rounded-xl border border-border/40 shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {label}
                {count && count > 0 && (
                  <span className={`px-1.5 py-0.5 text-[9px] rounded-full ${activeTab === id ? "bg-primary/20 text-primary" : "bg-secondary/60 text-muted-foreground/50"}`}>{count}</span>
                )}
              </span>
            </button>
          ))}
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {(error || externalError) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
              <div className="px-4 py-3 rounded-xl border border-destructive/20 bg-destructive/5 flex items-center justify-between">
                <p className="text-sm text-destructive/80">{externalError || error}</p>
                <button onClick={() => setError(null)} className="p-1 text-destructive/40 hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-[300px] scrollbar-none">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-center py-16">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-primary/50" animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.9, 1.1, 0.9] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.25 }} />
                  ))}
                </div>
              </motion.div>

            ) : activeTab === "my-books" ? (
              /* ═══════════════ MY BOOKS ═══════════════ */
              <motion.div key="my-books" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {books.length === 0 ? (
                  <div className="py-4">
                    <EmptyState icon={BookOpen} message="No books yet" sub="Browse the Community or Create a new scenario" />
                    <div className="flex gap-2 justify-center mt-2">
                      <button onClick={() => setActiveTab("community")} className="px-4 py-2 text-xs text-primary border border-primary/20 rounded-lg hover:bg-primary/5 transition-all">Community</button>
                      <button onClick={() => setActiveTab("create")} className="px-4 py-2 text-xs text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/5 transition-all">Create</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Stats */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground/50 pb-1">
                      <span>{ownBooks.length} {ownBooks.length === 1 ? "book" : "books"}</span>
                      <span className="w-px h-3 bg-border/30" />
                      <span>{ownBooks.reduce((sum, b) => sum + b.page_count, 0)} total pages</span>
                    </div>
                    {/* Own books */}
                    {ownBooks.length > 0 && ownBooks.map((book, i) => (
                          <BookCardExpanded key={book.id} book={book} index={i} onResume={() => onBookSelected?.(book.id)} onDelete={() => handleDeleteBook(book.id)} onToggleShare={() => handleToggleBookShare(book.id)} isLoading={isLoading} isDeleting={deleting === book.id} isTogglingShare={togglingShare === book.id} />
                        ))}
                  </div>
                )}
              </motion.div>

            ) : activeTab === "community" ? (
              /* ═══════════════ COMMUNITY ═══════════════ */
              <motion.div key="community" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">

                {/* Join by bookmark */}
                <div>
                  <SectionLabel icon={Bookmark}>Join by Bookmark</SectionLabel>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={bookmarkInput}
                      onChange={(e) => setBookmarkInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleJoinByBookmark()}
                      placeholder="ABCD-1234"
                      className="flex-1 px-4 py-2.5 bg-secondary/20 border border-border/20 rounded-xl text-sm font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/10 transition-all"
                    />
                    <button onClick={handleJoinByBookmark} disabled={!bookmarkInput.trim() || joining} className="px-5 py-2.5 text-sm font-medium text-primary bg-primary/10 border border-primary/20 rounded-xl hover:bg-primary/15 transition-all disabled:opacity-40">
                      {joining ? "..." : "Join"}
                    </button>
                  </div>
                </div>

                {/* Joined books */}
                {joinedBooks.length > 0 && (
                  <div>
                    <SectionLabel icon={Users}>Joined Books</SectionLabel>
                    <div className="space-y-2">
                      {joinedBooks.map((book, i) => (
                        <motion.div
                          key={book.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="bg-card/30 hover:bg-card/50 border border-border/20 hover:border-border/40 rounded-xl p-4 transition-all duration-200"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-sm text-foreground/80 truncate">{book.scenario_name}</h3>
                              <div className="flex items-center gap-3 text-xs mt-1">
                                <span className="flex items-center gap-1 text-muted-foreground/50"><Clock className="w-3 h-3" />{book.page_count} pages</span>
                                <CopyableBookmark bookmark={book.bookmark} />
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => onBookSelected?.(book.id)}
                                disabled={isLoading}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground/70 bg-secondary/30 hover:bg-secondary/50 border border-border/20 rounded-xl transition-all disabled:opacity-50"
                              >
                                <Play className="w-3 h-3" /> Resume
                              </button>
                              <CardActions onDelete={() => handleLeaveBook(book.id)} isDeleting={deleting === book.id} />
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shared scenarios */}
                <div>
                  <SectionLabel icon={Share2}>Shared Scenarios</SectionLabel>
                  {communityScenarios.length === 0 ? (
                    <EmptyState icon={Globe} message="No shared scenarios yet" />
                  ) : (
                    <div className="space-y-2">
                      {communityScenarios.map((scenario, i) => {
                        const sid = getScenarioId(scenario);
                        return (
                          <motion.div key={sid} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="bg-card/30 hover:bg-card/50 border border-border/20 hover:border-border/40 rounded-xl p-4 transition-all duration-200">
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-medium text-sm text-foreground/90">{scenario.name}</h3>
                                {scenario.setting && <ExpandableText text={scenario.setting} />}
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-[10px] text-muted-foreground/40">{scenario.characters} chars</span>
                                  {scenario.themes?.slice(0, 3).map((t) => (
                                    <span key={t} className="px-1.5 py-0.5 rounded-md bg-primary/8 text-primary/60 text-[10px]">{t}</span>
                                  ))}
                                </div>
                              </div>
                              <button onClick={() => onScenarioSelected(sid)} disabled={isLoading} className="shrink-0 flex items-center gap-1 px-3 py-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl hover:bg-emerald-500/15 transition-all disabled:opacity-50">
                                <Plus className="w-3 h-3" /> New Book
                              </button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Public Library */}
                {publicBooks.length > 0 && (
                  <div>
                    <SectionLabel icon={BookOpen}>Public Library</SectionLabel>
                    <div className="space-y-2">
                      {publicBooks.map((book, i) => (
                        <motion.div key={book.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="bg-gradient-to-r from-primary/[0.04] to-transparent border border-primary/15 hover:border-primary/30 rounded-xl p-4 transition-all duration-200">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-medium text-sm text-foreground/90">{book.scenario_name}</h3>
                                {book.mood && <span className="px-1.5 py-0.5 text-[9px] rounded-md bg-primary/10 text-primary/60 italic">{book.mood}</span>}
                              </div>
                              {book.setting && <p className="text-xs text-muted-foreground/40 line-clamp-1 mb-1.5">{book.setting}</p>}
                              <div className="flex items-center gap-3 text-xs flex-wrap">
                                <span className="flex items-center gap-1 text-muted-foreground/50"><Clock className="w-3 h-3" />{book.page_count} pages</span>
                                <CopyableBookmark bookmark={book.bookmark} />
                                {book.readers !== undefined && book.readers > 0 && (
                                  <span className="flex items-center gap-1 text-muted-foreground/40"><Users className="w-3 h-3" />{book.readers} readers</span>
                                )}
                              </div>
                              {book.characters && book.characters.length > 0 && (
                                <div className="flex items-center gap-1 mt-2 flex-wrap">
                                  {book.characters.map((name) => (
                                    <span key={name} className="px-1.5 py-0.5 text-[10px] rounded-md bg-secondary/40 text-muted-foreground/50">{name}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button onClick={() => onBookSelected?.(book.id)} disabled={isLoading} className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-xl hover:bg-primary/15 transition-all disabled:opacity-50">
                              <Play className="w-3 h-3" /> Join
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>

            ) : (
              /* ═══════════════ CREATE ═══════════════ */
              <motion.div key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">

                {/* Create actions */}
                <div className="grid grid-cols-2 gap-3">
                  {onOpenWizard && (
                    <button onClick={onOpenWizard} className="flex flex-col items-center gap-2 px-4 py-5 bg-amber-500/[0.06] hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/30 rounded-2xl transition-all group">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <Wand2 className="w-5 h-5 text-amber-400" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-amber-400/90">Smut Wizard</p>
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5">full control</p>
                      </div>
                    </button>
                  )}
                  <button onClick={handleGenerate} disabled={generating} className="flex flex-col items-center gap-2 px-4 py-5 bg-primary/[0.04] hover:bg-primary/[0.08] border border-dashed border-primary/20 hover:border-primary/30 rounded-2xl transition-all disabled:opacity-50 group">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:scale-105 transition-transform">
                      {generating ? <Sparkles className="w-5 h-5 text-primary animate-pulse" /> : <Plus className="w-5 h-5 text-primary/70" />}
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-primary/80">{generating ? "Generating..." : "Quick Generate"}</p>
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">surprise me</p>
                    </div>
                  </button>
                </div>

                {/* My scenarios */}
                <div>
                  <SectionLabel icon={BookOpen}>
                    My Scenarios
                    {myScenarios.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-secondary/60 text-muted-foreground/50">{myScenarios.length}</span>}
                  </SectionLabel>

                  {myScenarios.length === 0 ? (
                    <EmptyState icon={Wand2} message="No scenarios yet" sub="Use the Wizard or Quick Generate above" />
                  ) : (
                    <div className="space-y-2">
                      {myScenarios.map((scenario, i) => {
                        const sid = getScenarioId(scenario);
                        return (
                          <motion.div key={sid} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="bg-card/30 hover:bg-card/50 border border-border/20 hover:border-border/40 rounded-xl p-4 transition-all duration-200">
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-medium text-sm text-foreground/90">{scenario.name}</h3>
                                  {scenario.public && <Globe className="w-3 h-3 text-pink-400/60 shrink-0" />}
                                </div>
                                {scenario.setting && <ExpandableText text={scenario.setting} />}
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-[10px] text-muted-foreground/40">{scenario.characters} chars</span>
                                  {scenario.themes?.slice(0, 3).map((t) => (
                                    <span key={t} className="px-1.5 py-0.5 rounded-md bg-primary/8 text-primary/60 text-[10px]">{t}</span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => handleToggleShare(sid, !!scenario.public)}
                                  disabled={togglingShare === sid}
                                  className={`p-2 rounded-xl transition-all ${scenario.public ? "text-pink-400 hover:text-pink-300" : "text-muted-foreground/25 hover:text-pink-400/60"}`}
                                  title={scenario.public ? "Shared — click to unshare" : "Share to community"}
                                >
                                  <Share2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => onScenarioSelected(sid)} disabled={isLoading} className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl hover:bg-emerald-500/15 transition-all disabled:opacity-50">
                                  <Plus className="w-3 h-3" /> <span className="hidden sm:inline">New Book</span><span className="sm:hidden">Start</span>
                                </button>
                                <CardActions onDelete={() => handleDeleteScenario(sid)} isDeleting={deleting === sid} />
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Book creation loading */}
        <AnimatePresence>
          {isLoading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground/50">
              <motion.span className="w-1.5 h-1.5 rounded-full bg-primary/50" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} />
              creating book...
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

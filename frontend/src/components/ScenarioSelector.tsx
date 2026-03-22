import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Trash2, Plus, Sparkles, Wand2, BookOpen, Play, Clock, FileText, Users, Search } from "lucide-react";
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
};

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
  { id: "mock-1", name: "Midnight at the Velvet Lounge", setting: "A dimly lit jazz club in 1920s Paris", characters: 3, themes: ["jazz age", "forbidden romance"], source: "db", public: true },
  { id: "mock-2", name: "The Lighthouse Keeper's Secret", setting: "A remote lighthouse on the Scottish coast", characters: 2, themes: ["isolation", "mystery"], source: "db", public: true },
  { id: "mock-3", name: "Roommates with Benefits", setting: "A cramped NYC apartment shared by two grad students", characters: 2, themes: ["modern", "tension"], source: "db", public: true },
];

const MOCK_BOOKS: Book[] = [
  { id: "book-1", scenario_name: "Midnight at the Velvet Lounge", bookmark: "JAZZ-42", page_count: 12, paused: false },
  { id: "book-2", scenario_name: "The Lighthouse Keeper's Secret", bookmark: "LITE-7X", page_count: 5, paused: true },
];

const MOCK_PUBLIC_BOOKS: Book[] = [
  { id: "public-library", scenario_name: "Cozy Café Conversations", bookmark: "LIBR-0001", page_count: 42, paused: false },
];

export function ScenarioSelector({
  apiUrl,
  librarianId,
  onScenarioSelected,
  onBookSelected,
  isLoading,
  externalError,
  onBack,
  onOpenWizard,
  initialTab
}: Props) {
  const { mockMode } = useMockMode();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [publicBooks, setPublicBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"books" | "scenarios">(initialTab ?? "books");
  const [scenarioSubTab, setScenarioSubTab] = useState<"my" | "public">("my");
  const [bookmarkInput, setBookmarkInput] = useState("");
  const [joining, setJoining] = useState(false);

  const getScenarioId = (scenario: Scenario) => scenario.file || scenario.id || "";

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
      // Fetch user's books
      if (librarianId) {
        try {
          const booksRes = await fetch(`${apiUrl}/api/v1/books`, {
            headers: { "X-Librarian-ID": librarianId },
          });
          if (booksRes.ok) {
            const booksData = await booksRes.json();
            setBooks(booksData);
          }
        } catch {
          // Non-fatal
        }
      }

      // Fetch public books
      try {
        const publicRes = await fetch(`${apiUrl}/api/v1/books/public`);
        if (publicRes.ok) {
          const publicData = await publicRes.json();
          setPublicBooks(publicData);
        }
      } catch {
        // Non-fatal
      }

      // Fetch scenarios
      const response = await fetch(`${apiUrl}/api/v1/scenarios`);
      if (!response.ok) throw new Error("Failed to fetch scenarios");
      const data: Scenario[] = await response.json();

      let allScenarios = [...data];
      if (librarianId) {
        try {
          const mineResponse = await fetch(`${apiUrl}/api/v1/scenarios/mine`, {
            headers: { "X-Librarian-ID": librarianId },
          });
          if (mineResponse.ok) {
            const mine = await mineResponse.json();
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
          // Non-fatal
        }
      }

      setScenarios(allScenarios);

      // Auto-switch to scenarios tab if no books
      if (books.length === 0 && allScenarios.length > 0) {
        setActiveTab("scenarios");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const handleResumeBook = (bookId: string) => {
    if (onBookSelected) {
      onBookSelected(bookId);
    }
  };

  const handleJoinByBookmark = async () => {
    if (!bookmarkInput.trim() || !librarianId) return;
    setJoining(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/books/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Librarian-ID": librarianId,
        },
        body: JSON.stringify({ bookmark: bookmarkInput.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Book not found");
      }
      const { book_id } = await response.json();
      setBookmarkInput("");
      if (onBookSelected) {
        onBookSelected(book_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join book");
    } finally {
      setJoining(false);
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    setDeleting(bookId);
    try {
      const response = await fetch(`${apiUrl}/api/v1/books/${bookId}`, {
        method: "DELETE",
        headers: librarianId ? { "X-Librarian-ID": librarianId } : {},
      });
      if (!response.ok) throw new Error("Failed to delete");
      setBooks(books.filter(b => b.id !== bookId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete book");
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  const handleNewBook = (scenarioId: string) => {
    onScenarioSelected(scenarioId);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const wizardResponse = await fetch(`${apiUrl}/api/v1/wizard/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ save: false, num_characters: 2 }),
      });
      if (!wizardResponse.ok) throw new Error("Failed to generate scenario");
      const scenarioData = await wizardResponse.json();

      if (librarianId) {
        const saveResponse = await fetch(`${apiUrl}/api/v1/scenarios`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Librarian-ID": librarianId,
          },
          body: JSON.stringify({
            name: scenarioData.scenario_name,
            description: scenarioData.premise,
            setting: scenarioData.setting,
            data: scenarioData,
            public: false,
          }),
        });
        if (!saveResponse.ok) throw new Error("Failed to save scenario");
      }

      await fetchData();
      setActiveTab("scenarios");
      setScenarioSubTab("my");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteScenario = async (scenarioId: string) => {
    setDeleting(scenarioId);
    try {
      const response = await fetch(`${apiUrl}/api/v1/scenarios/${encodeURIComponent(scenarioId)}`, {
        method: "DELETE",
        headers: librarianId ? { "X-Librarian-ID": librarianId } : {},
      });
      if (!response.ok) throw new Error("Failed to delete");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  // Filter scenarios
  const myScenarios = scenarios.filter((s) => {
    const id = getScenarioId(s);
    return !id.startsWith("test_") && s.source === "db" && s.owner_id === librarianId;
  });
  const publicScenarios = scenarios.filter((s) => {
    const id = getScenarioId(s);
    return !id.startsWith("test_") && (s.source === "file" || (s.source === "db" && s.public));
  });
  const visibleScenarios = scenarioSubTab === "my" ? myScenarios : publicScenarios;

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

      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-6 py-8">
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
          className="text-center mb-6"
        >
          <h2 className="text-3xl font-bold tracking-tight text-foreground/90">library</h2>
          <p className="text-muted-foreground/60 text-base mt-2">
            {activeTab === "books" ? "resume a session or start fresh" : "choose a scenario template"}
          </p>
        </motion.div>

        {/* Main Tabs */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="w-full flex gap-2 mb-6"
        >
          <button
            onClick={() => setActiveTab("books")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === "books"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-card/30 text-muted-foreground/70 border border-border/30 hover:border-border/50"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            My Books
            {books.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-primary/20">
                {books.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("scenarios")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === "scenarios"
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-card/30 text-muted-foreground/70 border border-border/30 hover:border-border/50"
            }`}
          >
            <FileText className="w-4 h-4" />
            Scenarios
          </button>
        </motion.div>

        {/* Error */}
        <AnimatePresence>
          {(error || externalError) && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="w-full mb-4 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/5"
            >
              <p className="text-sm text-destructive/90 text-center">{externalError || error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content */}
        <div className="w-full flex-1 overflow-y-auto max-h-[50vh]">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="loading" className="flex justify-center py-12">
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
            ) : activeTab === "books" ? (
              /* BOOKS TAB */
              <motion.div key="books" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                {/* Join by Bookmark */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
                    <input
                      type="text"
                      value={bookmarkInput}
                      onChange={(e) => setBookmarkInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleJoinByBookmark()}
                      placeholder="Enter bookmark (e.g. LIBR-0001)"
                      className="w-full pl-9 pr-3 py-2.5 bg-card/40 border border-border/30 rounded-xl text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <button
                    onClick={handleJoinByBookmark}
                    disabled={!bookmarkInput.trim() || joining}
                    className="px-4 py-2.5 text-sm font-medium text-primary bg-primary/10 border border-primary/30 rounded-xl hover:bg-primary/20 transition-all disabled:opacity-50"
                  >
                    {joining ? "..." : "Join"}
                  </button>
                </div>

                {/* Public Books Section */}
                {publicBooks.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                      <Users className="w-3.5 h-3.5" />
                      Public Library
                    </h3>
                    {publicBooks.map((book, index) => (
                      <motion.div
                        key={book.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="group relative bg-gradient-to-r from-primary/5 to-transparent border border-primary/20 rounded-xl p-4 hover:border-primary/40 transition-all"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-foreground/90 truncate">
                                {book.scenario_name}
                              </h3>
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-primary/20 text-primary">
                                public
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground/50">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {book.page_count} pages
                              </span>
                              <span className="font-mono">{book.bookmark}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleResumeBook(book.id)}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 border border-primary/30 rounded-lg hover:bg-primary/20 transition-all disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Join
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* My Books Section */}
                {books.length > 0 && (
                  <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider pt-2">
                    <BookOpen className="w-3.5 h-3.5" />
                    My Books
                  </h3>
                )}

                {books.length === 0 && publicBooks.length === 0 ? (
                  <div className="text-center py-12">
                    <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground/60 mb-2">No books yet</p>
                    <p className="text-sm text-muted-foreground/40">
                      Start a new book from the Scenarios tab
                    </p>
                    <button
                      onClick={() => setActiveTab("scenarios")}
                      className="mt-4 px-4 py-2 text-sm text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-all"
                    >
                      Browse Scenarios
                    </button>
                  </div>
                ) : books.length === 0 ? null : (
                  books.map((book, index) => (
                    <motion.div
                      key={book.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="group relative bg-card/40 border border-border/30 rounded-xl p-4 hover:border-border/50 transition-all"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-foreground/90 truncate">
                              {book.scenario_name}
                            </h3>
                            {book.paused && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-400">
                                paused
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground/50">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {book.page_count} pages
                            </span>
                            <span className="font-mono">{book.bookmark}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleResumeBook(book.id)}
                            disabled={isLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 border border-primary/30 rounded-lg hover:bg-primary/20 transition-all disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Resume
                          </button>

                          {confirmDelete === book.id ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleDeleteBook(book.id)}
                                disabled={deleting === book.id}
                                className="px-2 py-1.5 text-xs bg-destructive/20 text-destructive rounded hover:bg-destructive/30"
                              >
                                {deleting === book.id ? "..." : "delete"}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1.5 text-xs bg-muted/50 text-muted-foreground rounded hover:bg-muted"
                              >
                                cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(book.id)}
                              className="p-1.5 text-muted-foreground/30 hover:text-destructive/70 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </motion.div>
            ) : (
              /* SCENARIOS TAB */
              <motion.div key="scenarios" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {/* Scenario Sub-tabs */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setScenarioSubTab("my")}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      scenarioSubTab === "my"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground/60 hover:text-muted-foreground"
                    }`}
                  >
                    My Scenarios
                  </button>
                  <button
                    onClick={() => setScenarioSubTab("public")}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      scenarioSubTab === "public"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground/60 hover:text-muted-foreground"
                    }`}
                  >
                    Public
                  </button>
                </div>

                {/* Create Buttons */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed border-primary/30 hover:border-primary/50 rounded-xl text-sm text-primary/70 hover:text-primary transition-all disabled:opacity-50"
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
                      className="flex items-center justify-center gap-2 px-3 py-2.5 border border-amber-500/30 hover:border-amber-500/50 rounded-xl text-sm text-amber-500/70 hover:text-amber-500 transition-all"
                    >
                      <Wand2 className="w-4 h-4" />
                      wizard
                    </button>
                  )}
                </div>

                {/* Scenario List */}
                <div className="space-y-2">
                  {visibleScenarios.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground/50">
                        {scenarioSubTab === "my"
                          ? "No scenarios yet — create one above"
                          : "No public scenarios available"}
                      </p>
                    </div>
                  ) : (
                    visibleScenarios.map((scenario, index) => {
                      const scenarioId = getScenarioId(scenario);
                      const isConfirming = confirmDelete === scenarioId;
                      const isDeleting = deleting === scenarioId;

                      return (
                        <motion.div
                          key={scenarioId}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.03 }}
                          className="group relative bg-card/40 border border-border/30 rounded-xl p-4 hover:border-border/50 transition-all"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-foreground/90 truncate">
                                {scenario.name}
                              </h3>
                              {scenario.setting && (
                                <p className="text-sm text-muted-foreground/60 mt-1 line-clamp-2">
                                  {scenario.setting}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground/50">
                                <span>{scenario.characters} chars</span>
                                {scenario.themes?.slice(0, 2).map(t => (
                                  <span key={t} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary/60">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleNewBook(scenarioId)}
                                disabled={isLoading}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                New Book
                              </button>

                              {scenario.source === "db" && scenario.owner_id === librarianId && (
                                isConfirming ? (
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => handleDeleteScenario(scenarioId)}
                                      disabled={isDeleting}
                                      className="px-2 py-1.5 text-xs bg-destructive/20 text-destructive rounded"
                                    >
                                      {isDeleting ? "..." : "delete"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmDelete(null)}
                                      className="px-2 py-1.5 text-xs bg-muted/50 text-muted-foreground rounded"
                                    >
                                      cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDelete(scenarioId)}
                                    className="p-1.5 text-muted-foreground/30 hover:text-destructive/70 transition-colors opacity-0 group-hover:opacity-100"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Loading indicator for book creation */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 flex items-center gap-2 text-sm text-muted-foreground/60"
          >
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-primary/60"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
            creating book...
          </motion.div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useKindeAuth } from "@kinde-oss/kinde-auth-react";
import { useMockMode } from "@/context/MockMode";

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND CENTER — Unified app-level control panel
// Futuristic design with consolidated admin/debug/control functionality
// ═══════════════════════════════════════════════════════════════════════════════

const ADMIN_EMAIL = "joshua.bell.828@gmail.com";

type TokenInfo = {
  name: string;
  preview: string;
  status: string;
  reset_time?: string;
  active: boolean;
};

type AuthInfo = {
  isAuthenticated: boolean;
  userEmail?: string;
  userName?: string;
  accessToken?: string | null;
  librarianId?: string | null;
};

type Props = {
  apiUrl: string;
  authInfo?: AuthInfo;
  bookId?: string;
  sendCommand?: (cmd: string, data?: Record<string, unknown>) => void;
  onSelectBook?: (bookId: string) => void;
  // Game state for status display
  wsState?: string;
  gamePaused?: boolean;
  gameManualMode?: boolean;
  pageCount?: number;
  characterCount?: number;
  pageInterval?: number;
};

type Section = "status" | "controls" | "tokens" | "console";

// ─── Trigger Button ──────────────────────────────────────────────────────────

export function CommandCenterTrigger({ onClick }: { onClick: () => void }) {
  const { mockMode } = useMockMode();

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1, duration: 0.5 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-4 right-4 z-50 group"
    >
      {/* Button */}
      <div className={`relative w-10 h-10 rounded-full border backdrop-blur-sm flex items-center justify-center transition-all ${
        mockMode
          ? "bg-fuchsia-950/40 border-fuchsia-500/20 group-hover:border-fuchsia-400/40"
          : "bg-primary/5 border-primary/15 group-hover:border-primary/30"
      }`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          className={`transition-colors ${mockMode ? "text-fuchsia-400/60" : "text-primary/40 group-hover:text-primary/60"}`}
        >
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </div>
    </motion.button>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function CommandCenter({ apiUrl, authInfo, bookId, sendCommand, onSelectBook, wsState, gamePaused, gameManualMode, pageCount, characterCount, pageInterval: _pageInterval, onClose }: Props & { isOpen: boolean; onClose: () => void }) {
  const { user, logout } = useKindeAuth();
  const { mockMode, toggleMockMode } = useMockMode();
  const email = authInfo?.userEmail || user?.email;
  const isAdmin = email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
    || import.meta.env.VITE_LOCAL_DEMO === "true";

  const [section, setSection] = useState<Section>(() => {
    try { const v = localStorage.getItem("raunch_cc_tab"); if (v) return v as Section; } catch {}
    return "status";
  });
  const setSectionPersist = (s: Section) => {
    setSection(s);
    try { localStorage.setItem("raunch_cc_tab", s); } catch {}
  };

  // Token vault state
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenValue, setNewTokenValue] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [checkingToken, setCheckingToken] = useState<string | null>(null);

  // OAuth state
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState("");
  const [oauthStatus, setOauthStatus] = useState<"idle" | "waiting" | "exchanging" | "success" | "error">("idle");
  const [oauthMessage, setOauthMessage] = useState("");

  // Controls state
  const [intervalInput, setIntervalInput] = useState("30");
  const [isPaused, setIsPaused] = useState(gamePaused ?? false);

  // Console state
  const [consoleResults, setConsoleResults] = useState<{ cmd: string; time: string; data?: unknown }[]>([]);
  const [wsCommands, setWsCommands] = useState<{ cmd: string; desc: string; params?: Record<string, string> }[]>([]);

  // Book list for no-book state
  const [books, setBooks] = useState<{ id: string; bookmark: string; scenario_name?: string; page_count?: number }[]>([]);

  // ── Token management ───────────────────────────────────────────────────────

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/tokens`);
      if (res.ok) setTokens(await res.json());
    } catch { /* */ }
  }, [apiUrl]);

  useEffect(() => { if (isAdmin) fetchTokens(); }, [isAdmin, fetchTokens]);

  const handleOAuthStart = async () => {
    setOauthStatus("waiting");
    setOauthMessage("");
    setOauthCode("");
    try {
      const res = await fetch(`${apiUrl}/oauth/start`);
      if (!res.ok) { setOauthStatus("error"); setOauthMessage("Failed to start OAuth flow"); return; }
      const data = await res.json();
      setOauthState(data.state);
      window.open(data.auth_url, "_blank");
    } catch { setOauthStatus("error"); setOauthMessage("Failed to start OAuth flow"); }
  };

  const handleOAuthExchange = async () => {
    if (!oauthCode.trim() || !oauthState) return;
    setOauthStatus("exchanging");
    try {
      const res = await fetch(`${apiUrl}/oauth/exchange`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: oauthCode.trim(), state: oauthState }),
      });
      const data = await res.json();
      if (data.success) {
        setOauthStatus("success"); setOauthMessage(data.message);
        setOauthCode(""); setOauthState(null); fetchTokens();
      } else { setOauthStatus("error"); setOauthMessage(data.message); }
    } catch { setOauthStatus("error"); setOauthMessage("Exchange failed"); }
  };

  const handleAddToken = async () => {
    if (!newTokenName.trim() || !newTokenValue.trim()) return;
    setTokenLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/tokens`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTokenName.trim(), token: newTokenValue.trim() }),
      });
      if (res.ok) { setNewTokenName(""); setNewTokenValue(""); fetchTokens(); }
    } catch { /* */ }
    setTokenLoading(false);
  };

  const handleActivateToken = async (name: string) => {
    await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}/activate`, { method: "POST" });
    fetchTokens();
  };

  const handleCheckToken = async (name: string) => {
    setCheckingToken(name);
    await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}/check`, { method: "POST" }).catch(() => {});
    await fetchTokens();
    setCheckingToken(null);
  };

  const handleDeleteToken = async (name: string) => {
    if (!confirm(`Delete token "${name}"?`)) return;
    await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
    fetchTokens();
  };

  // ── Console ────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchWsCommands() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/ws/commands`);
        if (res.ok) { const data = await res.json(); setWsCommands(data.commands || []); }
      } catch { /* */ }
    }
    if (isAdmin) fetchWsCommands();
  }, [apiUrl, isAdmin]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!msg?.type) return;
      setConsoleResults(prev => [{ cmd: `← ${msg.type}`, time: new Date().toLocaleTimeString(), data: msg }, ...prev].slice(0, 30));
    };
    window.addEventListener("raunch-ws-message", handler);
    return () => window.removeEventListener("raunch-ws-message", handler);
  }, []);

  const runCommand = (cmd: string, data?: Record<string, unknown>) => {
    sendCommand?.(cmd, data);
    logResult(`→ ${cmd}`, data);
  };

  const logResult = (cmd: string, data?: unknown) => {
    setConsoleResults(prev => [{ cmd, time: new Date().toLocaleTimeString(), data }, ...prev].slice(0, 30));
  };

  // ── Books ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchBooks() {
      try {
        let librarianId = authInfo?.librarianId || "";
        if (!librarianId) {
          try { const host = new URL(apiUrl).host; librarianId = localStorage.getItem(`raunch_librarian_id_${host}`) || ""; } catch { /* */ }
        }
        const res = await fetch(`${apiUrl}/api/v1/books`, { headers: { "Content-Type": "application/json", "X-Librarian-ID": librarianId } });
        if (res.ok) setBooks(await res.json());
      } catch { /* */ }
    }
    fetchBooks();
  }, [apiUrl, authInfo?.librarianId]);

  // ── Section defs ───────────────────────────────────────────────────────────

  const sections: { id: Section; label: string; adminOnly?: boolean }[] = [
    { id: "status", label: "Status" },
    { id: "controls", label: "Controls" },
    { id: "tokens", label: "Config", adminOnly: true },
    { id: "console", label: "Console", adminOnly: true },
  ];

  const visibleSections = sections.filter(s => !s.adminOnly || isAdmin);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Panel */}
      <motion.div
        initial={{ x: "100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="absolute right-0 top-0 bottom-0 w-full max-w-md flex flex-col"
      >
        {/* Glass panel */}
        <div className="h-full flex flex-col bg-[oklch(0.08_0.01_260)] border-l border-cyan-500/10 shadow-[-20px_0_60px_rgba(0,0,0,0.5)]">

          {/* ─ Header ─────────────────────────────────────────── */}
          <div className="relative px-5 pt-5 pb-4">
            {/* Scan line decoration */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-8 h-8 rounded-lg border border-cyan-500/20 bg-cyan-500/5 flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-400">
                      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                    </svg>
                  </div>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground/90 tracking-wide">
                    {user?.givenName ? `${user.givenName}${user.familyName ? ` ${user.familyName}` : ""}` : authInfo?.userName || "Settings"}
                  </h2>
                  <p className="text-[10px] text-cyan-400/50 font-mono">{email ?? "anonymous"}</p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="p-2 text-muted-foreground/40 hover:text-foreground transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Status pills */}
            <div className="flex items-center gap-2 mt-3">
              <StatusPill
                active={wsState === "connected"}
                label={wsState === "connected" ? "Online" : wsState === "connecting" ? "Connecting" : "Offline"}
                color={wsState === "connected" ? "emerald" : wsState === "connecting" ? "amber" : "red"}
              />
              <button onClick={toggleMockMode}>
                <StatusPill
                  active={mockMode}
                  label={mockMode ? "Mock" : "Live"}
                  color={mockMode ? "fuchsia" : "cyan"}
                  pulse={mockMode}
                />
              </button>
              {isAdmin && (
                <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider bg-amber-500/10 text-amber-400/80 border border-amber-500/20 rounded">
                  Admin
                </span>
              )}
            </div>
          </div>

          {/* ─ Section nav ────────────────────────────────────── */}
          <div className="px-5 flex gap-1">
            {visibleSections.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setSectionPersist(id)}
                className={`relative px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-all rounded-t ${
                  section === id
                    ? "text-cyan-400 bg-cyan-500/5"
                    : "text-muted-foreground/40 hover:text-muted-foreground/70"
                }`}
              >
                {label}
                {section === id && (
                  <motion.div
                    layoutId="cc-tab"
                    className="absolute bottom-0 left-0 right-0 h-px bg-cyan-400/60"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>

          <div className="h-px bg-gradient-to-r from-cyan-500/10 via-cyan-500/20 to-cyan-500/10" />

          {/* ─ Content ────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-5 space-y-4">
              <AnimatePresence mode="wait">
                {section === "status" && (
                  <motion.div key="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                    <StatusSection
                      bookId={bookId}
                      pageCount={pageCount}
                      characterCount={characterCount}
                      gamePaused={gamePaused}
                      gameManualMode={gameManualMode}
                      mockMode={mockMode}
                      books={books}
                      onSelectBook={onSelectBook}
                    />
                  </motion.div>
                )}
                {section === "controls" && (
                  <motion.div key="controls" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                    <ControlsSection
                      sendCommand={sendCommand}
                      runCommand={runCommand}
                      bookId={bookId}
                      isPaused={isPaused}
                      setIsPaused={setIsPaused}
                      intervalInput={intervalInput}
                      setIntervalInput={setIntervalInput}
                    />
                  </motion.div>
                )}
                {section === "tokens" && isAdmin && (
                  <motion.div key="tokens" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                    <TokensSection
                      tokens={tokens}
                      newTokenName={newTokenName}
                      setNewTokenName={setNewTokenName}
                      newTokenValue={newTokenValue}
                      setNewTokenValue={setNewTokenValue}
                      tokenLoading={tokenLoading}
                      checkingToken={checkingToken}
                      handleAddToken={handleAddToken}
                      handleActivateToken={handleActivateToken}
                      handleCheckToken={handleCheckToken}
                      handleDeleteToken={handleDeleteToken}
                      oauthStatus={oauthStatus}
                      oauthCode={oauthCode}
                      setOauthCode={setOauthCode}
                      oauthMessage={oauthMessage}
                      handleOAuthStart={handleOAuthStart}
                      handleOAuthExchange={handleOAuthExchange}
                      handleOAuthCancel={() => { setOauthStatus("idle"); setOauthState(null); setOauthCode(""); setOauthMessage(""); }}
                      wsState={wsState}
                      apiUrl={apiUrl}
                      bookId={bookId}
                      authInfo={authInfo}
                      isAdmin={isAdmin}
                    />
                  </motion.div>
                )}
                {section === "console" && isAdmin && (
                  <motion.div key="console" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                    <ConsoleSection
                      wsCommands={wsCommands}
                      consoleResults={consoleResults}
                      runCommand={runCommand}
                      logResult={logResult}
                      bookId={bookId}
                      apiUrl={apiUrl}
                      authInfo={authInfo}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ─ Footer ─────────────────────────────────────────── */}
          <div className="px-5 py-3 border-t border-cyan-500/10">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-widest">
                Ctrl+Shift+M mock &middot; Esc close
              </span>
              <button
                onClick={() => logout()}
                className="text-[10px] text-muted-foreground/30 hover:text-red-400/70 transition-colors font-mono"
              >
                sign out
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

function StatusPill({ active, label, color, pulse }: { active: boolean; label: string; color: string; pulse?: boolean }) {
  const colors: Record<string, { dot: string; bg: string; text: string; border: string }> = {
    emerald: { dot: "bg-emerald-400", bg: "bg-emerald-500/8", text: "text-emerald-400/80", border: "border-emerald-500/20" },
    amber:   { dot: "bg-amber-400",   bg: "bg-amber-500/8",   text: "text-amber-400/80",   border: "border-amber-500/20" },
    red:     { dot: "bg-red-400",      bg: "bg-red-500/8",     text: "text-red-400/80",     border: "border-red-500/20" },
    fuchsia: { dot: "bg-fuchsia-400",  bg: "bg-fuchsia-500/8", text: "text-fuchsia-400/80", border: "border-fuchsia-500/20" },
    cyan:    { dot: "bg-cyan-400",     bg: "bg-cyan-500/8",    text: "text-cyan-400/80",    border: "border-cyan-500/20" },
  };
  const c = colors[color] || colors.cyan;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${pulse ? "animate-pulse" : ""} ${active ? "" : "opacity-40"}`} />
      {label}
    </div>
  );
}

// ─── Status Section ──────────────────────────────────────────────────────────

function StatusSection({ bookId, pageCount, characterCount, gamePaused, gameManualMode, mockMode, books, onSelectBook }: {
  bookId?: string; pageCount?: number; characterCount?: number;
  gamePaused?: boolean; gameManualMode?: boolean; mockMode: boolean;
  books: { id: string; bookmark: string; scenario_name?: string; page_count?: number }[];
  onSelectBook?: (id: string) => void;
}) {
  const currentBook = books.find(b => b.id === bookId);

  return (
    <div className="space-y-4">
      {/* Current scenario */}
      {bookId && (
        <div>
          <p className="text-sm font-medium text-foreground/80">{currentBook?.scenario_name || "Active Scenario"}</p>
          <p className="text-[10px] font-mono text-muted-foreground/30">{bookId}</p>
        </div>
      )}

      {/* System telemetry */}
      <div className="grid grid-cols-3 gap-2">
        <TelemetryCard label="Pages" value={pageCount ?? 0} />
        <TelemetryCard label="Characters" value={characterCount ?? 0} />
        <TelemetryCard
          label="Mode"
          value={mockMode ? "Mock" : gamePaused ? "Paused" : gameManualMode ? "Manual" : "Auto"}
          textValue
        />
      </div>

      {/* Book list */}
      {books.length > 0 && (
        <DataBlock title="Books">
          {books.map(book => (
            <button
              key={book.id}
              onClick={() => onSelectBook?.(book.id)}
              className={`w-full flex items-center justify-between py-1.5 px-2 -mx-2 rounded transition-colors ${
                book.id === bookId ? "bg-cyan-500/10 text-cyan-400" : "hover:bg-white/[0.02] text-foreground/70"
              }`}
            >
              <div className="min-w-0">
                <span className="text-xs truncate block">{book.scenario_name || "Unnamed"}</span>
                <span className="text-[9px] font-mono text-muted-foreground/25 truncate block">{book.bookmark} · {book.id.slice(0, 8)}</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/40 flex-shrink-0">
                {book.id === bookId ? `${pageCount ?? book.page_count ?? 0}p` : `${book.page_count ?? 0}p`}
              </span>
            </button>
          ))}
        </DataBlock>
      )}
    </div>
  );
}

// ─── Controls Section ────────────────────────────────────────────────────────

function ControlsSection({ sendCommand, runCommand, bookId, isPaused, setIsPaused, intervalInput, setIntervalInput }: {
  sendCommand?: (cmd: string, data?: Record<string, unknown>) => void;
  runCommand: (cmd: string, data?: Record<string, unknown>) => void;
  bookId?: string; isPaused: boolean; setIsPaused: (v: boolean) => void;
  intervalInput: string; setIntervalInput: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Playback */}
      <div className="flex gap-2">
        <ControlBtn
          label={isPaused ? "Resume" : "Pause"}
          icon={isPaused ? "▶" : "⏸"}
          color={isPaused ? "emerald" : "amber"}
          onClick={() => { runCommand("toggle_pause"); setIsPaused(!isPaused); }}
          className="flex-1"
        />
        <ControlBtn
          label="Next"
          icon="⏭"
          color="cyan"
          onClick={() => runCommand("page")}
          className="flex-1"
        />
      </div>

      {/* Pacing */}
      <DataBlock title="Pacing">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={intervalInput}
            onChange={e => setIntervalInput(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-black/30 border border-cyan-500/10 rounded text-foreground/80 focus:border-cyan-500/30 focus:outline-none transition-colors"
            placeholder="30"
            min="0"
          />
          <span className="text-[10px] text-muted-foreground/40">sec</span>
          <button
            onClick={() => runCommand("set_page_interval", { seconds: parseInt(intervalInput) || 30 })}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/20 rounded hover:bg-cyan-500/15 transition-colors"
          >
            Set
          </button>
        </div>
      </DataBlock>

      {/* Quick actions */}
      <DataBlock title="Quick Actions">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: "Status", cmd: "status" },
            { label: "World", cmd: "world" },
            { label: "Characters", cmd: "list" },
            { label: "History", cmd: "history", data: { count: 20 } },
          ].map(({ label, cmd, data }) => (
            <button
              key={cmd}
              onClick={() => runCommand(cmd, data)}
              className="px-3 py-2 text-[10px] font-mono text-muted-foreground/60 bg-white/[0.02] border border-white/[0.04] rounded hover:bg-white/[0.04] hover:text-foreground/70 transition-all"
            >
              {label}
            </button>
          ))}
          {bookId && sendCommand && (
            <>
              <button
                onClick={() => fetch(`${location.protocol}//${location.hostname}:8000/api/v1/books/${bookId}/pause`, { method: "POST" })}
                className="px-3 py-2 text-[10px] font-mono text-amber-400/50 bg-amber-500/5 border border-amber-500/10 rounded hover:bg-amber-500/10 transition-all"
              >
                API Pause
              </button>
              <button
                onClick={() => fetch(`${location.protocol}//${location.hostname}:8000/api/v1/books/${bookId}/resume`, { method: "POST" })}
                className="px-3 py-2 text-[10px] font-mono text-emerald-400/50 bg-emerald-500/5 border border-emerald-500/10 rounded hover:bg-emerald-500/10 transition-all"
              >
                API Resume
              </button>
            </>
          )}
        </div>
      </DataBlock>
    </div>
  );
}

// ─── Tokens Section ──────────────────────────────────────────────────────────

function TokensSection({ tokens, newTokenName, setNewTokenName, newTokenValue, setNewTokenValue, tokenLoading, checkingToken, handleAddToken, handleActivateToken, handleCheckToken, handleDeleteToken, oauthStatus, oauthCode, setOauthCode, oauthMessage, handleOAuthStart, handleOAuthExchange, handleOAuthCancel, wsState, apiUrl, bookId, authInfo, isAdmin }: {
  tokens: TokenInfo[]; newTokenName: string; setNewTokenName: (v: string) => void;
  newTokenValue: string; setNewTokenValue: (v: string) => void;
  tokenLoading: boolean; checkingToken: string | null;
  handleAddToken: () => void; handleActivateToken: (n: string) => void;
  handleCheckToken: (n: string) => void; handleDeleteToken: (n: string) => void;
  oauthStatus: string; oauthCode: string; setOauthCode: (v: string) => void;
  oauthMessage: string; handleOAuthStart: () => void; handleOAuthExchange: () => void; handleOAuthCancel: () => void;
  wsState?: string; apiUrl: string; bookId?: string; authInfo?: AuthInfo; isAdmin: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Identity */}
      <DataBlock title="Identity">
        <DataRow label="Email" value={authInfo?.userEmail || "—"} />
        <DataRow label="Role" value={isAdmin ? "Administrator" : "User"} />
        <DataRow label="Librarian" value={authInfo?.librarianId ? authInfo.librarianId.slice(0, 16) + "…" : "—"} mono />
      </DataBlock>

      {/* Connection */}
      <DataBlock title="Connection">
        <DataRow label="WebSocket" value={wsState ?? "unknown"} mono />
        <DataRow label="API" value={apiUrl} mono />
        <DataRow label="Book" value={bookId ? bookId.slice(0, 16) + "…" : "none"} mono />
      </DataBlock>

      {/* Vault */}
      <DataBlock title={`Token Vault · ${tokens.length}`}>
        {tokens.length === 0 ? (
          <p className="text-[10px] text-muted-foreground/40 font-mono italic">No tokens stored</p>
        ) : (
          <div className="space-y-1">
            {tokens.map(t => (
              <div key={t.name} className={`flex items-center gap-2 py-1.5 px-2 -mx-2 rounded transition-colors ${t.active ? "bg-cyan-500/5" : ""}`}>
                {t.active && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />}
                <span className="text-xs font-medium flex-1 truncate text-foreground/80">{t.name}</span>
                <span className="text-[9px] font-mono text-muted-foreground/30">{t.preview}</span>
                {t.status === "rate_limited" && <span className="text-[9px] text-amber-400/60 font-mono">limited</span>}
                <div className="flex gap-0.5">
                  {!t.active && (
                    <MiniBtn onClick={() => handleActivateToken(t.name)} title="Activate">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                    </MiniBtn>
                  )}
                  <MiniBtn onClick={() => handleCheckToken(t.name)} title="Check" disabled={checkingToken === t.name}>
                    {checkingToken === t.name ? (
                      <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin inline-block" />
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
                    )}
                  </MiniBtn>
                  <MiniBtn onClick={() => handleDeleteToken(t.name)} title="Delete" variant="danger">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </MiniBtn>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add manually */}
        <div className="flex gap-1.5 mt-2 pt-2 border-t border-white/[0.04]">
          <input
            type="text"
            value={newTokenName}
            onChange={e => setNewTokenName(e.target.value)}
            placeholder="Name"
            className="w-16 px-2 py-1 text-[10px] font-mono bg-black/30 border border-white/[0.06] rounded text-foreground/70 focus:border-cyan-500/30 focus:outline-none"
          />
          <input
            type="password"
            value={newTokenValue}
            onChange={e => setNewTokenValue(e.target.value)}
            placeholder="sk-ant-oat..."
            className="flex-1 px-2 py-1 text-[10px] font-mono bg-black/30 border border-white/[0.06] rounded text-foreground/70 focus:border-cyan-500/30 focus:outline-none"
          />
          <button
            onClick={handleAddToken}
            disabled={tokenLoading || !newTokenName || !newTokenValue}
            className="px-2 py-1 text-[10px] font-mono bg-cyan-500/10 text-cyan-400/70 border border-cyan-500/15 rounded disabled:opacity-30 hover:bg-cyan-500/15 transition-colors"
          >
            +
          </button>
        </div>
      </DataBlock>

      {/* OAuth - at the bottom */}
      {oauthStatus === "idle" || oauthStatus === "success" || oauthStatus === "error" ? (
        <div className="space-y-2">
          <button
            onClick={handleOAuthStart}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-600/10 to-orange-600/10 border border-amber-500/20 rounded-lg text-xs text-amber-400/80 hover:border-amber-400/40 transition-colors font-mono"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            Login with Claude Max
          </button>
          {oauthStatus === "success" && <p className="text-[10px] text-emerald-400/80 text-center font-mono">{oauthMessage}</p>}
          {oauthStatus === "error" && <p className="text-[10px] text-red-400/80 text-center font-mono">{oauthMessage}</p>}
        </div>
      ) : (
        <div className="space-y-3 p-3 border border-amber-500/20 rounded-lg bg-amber-500/5">
          <p className="text-[10px] text-amber-400/80 font-mono">Paste the authorization code from the Claude tab:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={oauthCode}
              onChange={e => setOauthCode(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleOAuthExchange()}
              placeholder="Authorization code..."
              autoFocus
              className="flex-1 px-2 py-1.5 text-xs bg-black/30 border border-amber-500/20 rounded font-mono text-foreground/80 focus:border-amber-400/40 focus:outline-none"
            />
            <button
              onClick={handleOAuthExchange}
              disabled={!oauthCode.trim() || oauthStatus === "exchanging"}
              className="px-3 py-1.5 text-xs font-mono bg-amber-500/20 text-amber-400 rounded disabled:opacity-50 hover:bg-amber-500/30 transition-colors"
            >
              {oauthStatus === "exchanging" ? "…" : "Submit"}
            </button>
          </div>
          <button onClick={handleOAuthCancel} className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors font-mono">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Console Section ─────────────────────────────────────────────────────────

type RouteInfo = { method: string; path: string; name: string | null };

function ConsoleSection({ wsCommands, consoleResults, runCommand, logResult, bookId, apiUrl, authInfo }: {
  wsCommands: { cmd: string; desc: string; params?: Record<string, string> }[];
  consoleResults: { cmd: string; time: string; data?: unknown }[];
  runCommand: (cmd: string, data?: Record<string, unknown>) => void;
  logResult: (cmd: string, data?: unknown) => void;
  bookId?: string; apiUrl: string; authInfo?: AuthInfo;
}) {
  const [customCmd, setCustomCmd] = useState("");
  const [expandedResult, setExpandedResult] = useState<number | null>(null);
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({});
  const [bodyInput, setBodyInput] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<RouteInfo | null>(null);
  const [discoveredRoutes, setDiscoveredRoutes] = useState<RouteInfo[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);

  // Discover API routes
  useEffect(() => {
    async function fetchRoutes() {
      setRoutesLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/v1/routes`);
        if (res.ok) { const data = await res.json(); setDiscoveredRoutes(data.routes || []); }
      } catch { /* */ }
      setRoutesLoading(false);
    }
    fetchRoutes();
  }, [apiUrl]);

  const handleCustom = () => {
    if (!customCmd.trim()) return;
    try {
      const parsed = JSON.parse(customCmd);
      if (parsed.type) { runCommand(parsed.type, parsed); }
      else { runCommand(customCmd); }
    } catch {
      runCommand(customCmd);
    }
    setCustomCmd("");
  };

  // REST helper
  const testApi = async (endpoint: string, method: "GET" | "POST" | "DELETE" = "GET", body?: Record<string, unknown>) => {
    try {
      let librarianId = authInfo?.librarianId || "";
      if (!librarianId) {
        try { const host = new URL(apiUrl).host; librarianId = localStorage.getItem(`raunch_librarian_id_${host}`) || ""; } catch { /* */ }
      }
      const headers: Record<string, string> = { "Content-Type": "application/json", "X-Librarian-ID": librarianId };
      const options: RequestInit = { method, headers };
      if (body) options.body = JSON.stringify(body);
      const res = await fetch(`${apiUrl}${endpoint}`, options);
      const data = await res.json();
      setExpandedResult(null);
      return data;
    } catch (err) {
      return { error: String(err) };
    }
  };

  // Resolve route path with bookId and user params
  const resolveRoute = (path: string): string => {
    let resolved = bookId ? path.replace("{book_id}", bookId) : path;
    for (const [key, value] of Object.entries(paramInputs)) {
      if (value) resolved = resolved.replace(`{${key}}`, encodeURIComponent(value));
    }
    return resolved;
  };

  const handleRouteClick = async (route: RouteInfo) => {
    setSelectedRoute(route);
    const resolved = resolveRoute(route.path);
    if (resolved.includes("{")) return; // has unfilled params
    let body: Record<string, unknown> | undefined;
    if (route.method === "POST" || route.method === "PUT") {
      try { body = bodyInput ? JSON.parse(bodyInput) : undefined; } catch { /* */ }
    }
    const data = await testApi(resolved, route.method as "GET" | "POST" | "DELETE", body);
    logResult(`${route.method} ${resolved}`, data);
  };

  // Group routes
  const routeGroups = discoveredRoutes
    .filter(r => r.path !== "/api/v1/routes" && r.path !== "/health")
    .reduce<Record<string, RouteInfo[]>>((acc, route) => {
      const match = route.path.match(/^\/api\/v1\/(\w+)/);
      const group = match ? match[1] : "other";
      if (!acc[group]) acc[group] = [];
      acc[group].push(route);
      return acc;
    }, {});

  const methodColors: Record<string, string> = {
    GET: "text-emerald-400 bg-emerald-500/10",
    POST: "text-blue-400 bg-blue-500/10",
    PUT: "text-amber-400 bg-amber-500/10",
    DELETE: "text-red-400 bg-red-500/10",
  };

  return (
    <div className="space-y-4">
      {/* Command input */}
      <div className="flex gap-1.5">
        <div className="flex-1 relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-cyan-400/30 text-[10px] font-mono">{">"}</span>
          <input
            type="text"
            value={customCmd}
            onChange={e => setCustomCmd(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCustom()}
            placeholder="command or JSON..."
            className="w-full pl-6 pr-2 py-2 text-xs font-mono bg-black/40 border border-cyan-500/10 rounded text-foreground/80 focus:border-cyan-500/30 focus:outline-none transition-colors placeholder:text-muted-foreground/20"
          />
        </div>
        <button
          onClick={handleCustom}
          className="px-3 py-2 text-[10px] font-mono bg-cyan-500/10 text-cyan-400/70 border border-cyan-500/15 rounded hover:bg-cyan-500/15 transition-colors"
        >
          Run
        </button>
      </div>

      {/* Admin Actions */}
      <DataBlock title="Admin">
        <div className="flex flex-wrap gap-1">
          {[
            { label: "Cleanup Invalid Books", endpoint: "/api/v1/admin/cleanup-invalid-books" },
            { label: "Purge All", endpoint: "/api/v1/admin/purge", danger: true },
          ].map(({ label, endpoint, danger }) => (
            <button
              key={endpoint}
              onClick={async () => {
                if (danger && !confirm("This will wipe ALL books, saves, and scenarios. Continue?")) return;
                const data = await testApi(endpoint, "POST", { admin_email: authInfo?.userEmail || "" });
                logResult(`POST ${endpoint}`, data);
              }}
              className={`px-2 py-1 text-[9px] font-mono rounded transition-all ${
                danger
                  ? "bg-red-500/8 text-red-400/60 border border-red-500/15 hover:bg-red-500/15 hover:text-red-400/80"
                  : "bg-amber-500/8 text-amber-400/60 border border-amber-500/15 hover:bg-amber-500/15 hover:text-amber-400/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </DataBlock>

      {/* API Routes with inline params */}
      <DataBlock title={`API Routes · ${discoveredRoutes.length}${routesLoading ? " loading…" : ""}`}>
        <div className="max-h-52 overflow-y-auto space-y-px">
          {Object.entries(routeGroups).map(([group, routes]) => (
            <div key={group}>
              <p className="text-[8px] uppercase tracking-widest text-muted-foreground/20 font-mono mt-2 mb-0.5 first:mt-0">{group}</p>
              {routes.map(route => {
                const resolved = bookId ? route.path.replace("{book_id}", bookId) : route.path;
                const segments = resolved.split(/(\{[^}]+\})/);
                const isSelected = selectedRoute?.method === route.method && selectedRoute?.path === route.path;

                return (
                  <div
                    key={`${route.method}-${route.path}`}
                    className={`flex items-center gap-1.5 px-1.5 py-1 rounded transition-all ${
                      isSelected ? "bg-cyan-500/8 border border-cyan-500/15" : "hover:bg-white/[0.02] border border-transparent"
                    }`}
                  >
                    <span className={`text-[8px] font-mono font-bold px-1 py-0.5 rounded flex-shrink-0 ${methodColors[route.method] || "text-muted-foreground bg-muted/10"}`}>
                      {route.method}
                    </span>
                    <span className="text-[10px] font-mono flex items-center flex-1 min-w-0 overflow-hidden">
                      {segments.map((seg, i) => {
                        const paramMatch = seg.match(/^\{(\w+)\}$/);
                        if (paramMatch) {
                          const param = paramMatch[1];
                          return (
                            <input
                              key={i}
                              type="text"
                              value={paramInputs[param] || ""}
                              onChange={e => { e.stopPropagation(); setParamInputs(p => ({ ...p, [param]: e.target.value })); setSelectedRoute(route); }}
                              onClick={e => e.stopPropagation()}
                              placeholder={param}
                              className="inline-block w-16 px-1 py-0 text-[10px] font-mono bg-amber-500/10 border border-amber-500/20 rounded text-amber-300 placeholder:text-amber-400/30 focus:border-amber-400 focus:outline-none mx-0.5"
                            />
                          );
                        }
                        return <span key={i} className="text-foreground/60 whitespace-nowrap">{seg}</span>;
                      })}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); handleRouteClick(route); }}
                      className="text-[8px] font-mono font-medium px-1.5 py-0.5 rounded text-cyan-400/50 bg-cyan-500/8 hover:bg-cyan-500/15 hover:text-cyan-400/70 transition-colors flex-shrink-0"
                    >
                      run
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Body input for selected POST/PUT route */}
        {selectedRoute && (selectedRoute.method === "POST" || selectedRoute.method === "PUT") && (
          <div className="mt-2 pt-2 border-t border-white/[0.04]">
            <p className="text-[9px] font-mono text-muted-foreground/30 mb-1">Body for {selectedRoute.method} {selectedRoute.path}</p>
            <textarea
              value={bodyInput}
              onChange={e => setBodyInput(e.target.value)}
              placeholder='{"key": "value"}'
              rows={2}
              className="w-full px-2 py-1.5 text-[10px] font-mono bg-black/30 border border-cyan-500/10 rounded text-foreground/70 focus:border-cyan-500/20 focus:outline-none resize-y"
            />
          </div>
        )}
      </DataBlock>

      {/* WS Commands */}
      {wsCommands.length > 0 && (
        <DataBlock title={`WebSocket · ${wsCommands.length}`}>
          <div className="flex flex-wrap gap-1">
            {wsCommands.map(({ cmd, desc }) => (
              <button
                key={cmd}
                onClick={() => runCommand(cmd)}
                title={desc}
                className="px-2 py-1 text-[9px] font-mono bg-purple-500/8 text-purple-400/60 border border-purple-500/15 rounded hover:bg-purple-500/15 hover:text-purple-400/80 transition-all"
              >
                {cmd}
              </button>
            ))}
          </div>
        </DataBlock>
      )}

      {/* Results feed */}
      <DataBlock title="Output">
        {consoleResults.length === 0 ? (
          <p className="text-[10px] font-mono text-muted-foreground/25 italic">No output yet. Run a command above.</p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {consoleResults.map((r, i) => (
              <div key={`${r.time}-${i}`} className="group">
                <button
                  onClick={() => setExpandedResult(expandedResult === i ? null : i)}
                  className="w-full flex items-center gap-2 py-1 px-1 -mx-1 rounded text-left hover:bg-white/[0.02] transition-colors"
                >
                  <span className="text-[9px] font-mono text-muted-foreground/25">{r.time}</span>
                  <span className={`text-[10px] font-mono flex-1 truncate ${
                    r.cmd.startsWith("←") ? "text-purple-400/60" : "text-cyan-400/50"
                  }`}>
                    {r.cmd}
                  </span>
                </button>
                <AnimatePresence>
                  {expandedResult === i && r.data != null && (
                    <motion.pre
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden text-[9px] font-mono text-muted-foreground/40 bg-black/20 rounded px-2 py-1.5 overflow-x-auto"
                    >
                      {String(JSON.stringify(r.data, null, 2))}
                    </motion.pre>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </DataBlock>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared primitives
// ═══════════════════════════════════════════════════════════════════════════════

function TelemetryCard({ label, value, textValue }: { label: string; value: number | string; textValue?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/30 mb-1">{label}</p>
      <p className={`font-mono font-bold ${textValue ? "text-xs text-foreground/60" : "text-lg text-foreground/80"}`}>
        {value}
      </p>
    </div>
  );
}

function DataBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-400/30">{title}</span>
        <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/10 to-transparent" />
      </div>
      <div className="pl-0.5">{children}</div>
    </div>
  );
}

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-[10px]">
      <span className="text-muted-foreground/30 font-mono">{label}</span>
      <span className={`text-foreground/60 ${mono ? "font-mono" : ""} max-w-[200px] truncate`}>{value}</span>
    </div>
  );
}

function ControlBtn({ label, icon, color, onClick, className }: {
  label: string; icon: string; color: string; onClick: () => void; className?: string;
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20 hover:bg-emerald-500/15",
    amber: "bg-amber-500/8 text-amber-400/80 border-amber-500/20 hover:bg-amber-500/15",
    cyan: "bg-cyan-500/8 text-cyan-400/80 border-cyan-500/20 hover:bg-cyan-500/15",
  };

  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-mono transition-all ${colors[color] || colors.cyan} ${className || ""}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function MiniBtn({ onClick, title, children, disabled, variant }: {
  onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean; variant?: "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1 transition-colors disabled:opacity-30 ${
        variant === "danger"
          ? "text-muted-foreground/30 hover:text-red-400/70"
          : "text-muted-foreground/30 hover:text-foreground/60"
      }`}
    >
      {children}
    </button>
  );
}

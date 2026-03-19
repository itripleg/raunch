import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useKindeAuth } from "@kinde-oss/kinde-auth-react";
import { useGame } from "./hooks/useGame";
import { useLibrary } from "./hooks/useLibrary";
import { useMockMode } from "./context/MockMode";
import { SplashScreen } from "./components/SplashScreen";
import { AlphaDashboard } from "./components/AlphaDashboard";
import { FeedbackKanban } from "./components/FeedbackKanban";
import { VotingPolls } from "./components/VotingPolls";
import { AboutPage } from "./components/AboutPage";
import { GameLayout } from "./components/GameLayout";
import { NicknamePrompt } from "./components/NicknamePrompt";
import { CharacterWizard } from "./components/CharacterWizard";
import { WizardPage } from "./components/WizardPage";
import { ScenarioSelector } from "./components/ScenarioSelector";
import { CommandCenter, CommandCenterTrigger } from "./components/CommandCenter";
import { NotFoundPage } from "./components/NotFoundPage";

const NICKNAME_STORAGE_KEY = "raunch_nickname";
const HAS_PLAYED_KEY = "raunch_has_played";

type AppView = "presplash" | "splash" | "dashboard" | "kanban" | "voting" | "about" | "wizard" | "scenario" | "game" | "notfound";

// Smart URL detection for local vs remote/production
function getApiUrl(): string {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.");

  // Check for environment override (set at build time)
  const envApiUrl = import.meta.env.VITE_API_URL;
  if (envApiUrl) {
    return envApiUrl;
  }

  if (isLocal) {
    // Local development - use hardcoded port
    return `http://${hostname}:8000`;
  }

  // Remote/tunneled - assume same host
  return `${protocol}//${hostname}:8000`;
}

const DEFAULT_API_URL = getApiUrl();

// Helper to read nickname from localStorage
function getStoredNickname(): string | null {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Helper to check if nickname has been set (even if empty for anonymous)
function hasStoredNickname(): boolean {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

// Helper to save nickname to localStorage
function setStoredNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

// Helper to check if user has played before
function hasPlayedBefore(): boolean {
  try {
    return localStorage.getItem(HAS_PLAYED_KEY) === "true";
  } catch {
    return false;
  }
}

// Helper to mark user as having played
function setHasPlayed(): void {
  try {
    localStorage.setItem(HAS_PLAYED_KEY, "true");
  } catch {
    // Silently fail if localStorage is unavailable
  }
}


// Error boundary to catch rendering crashes
class ErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; onReset: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("React error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-xl font-bold text-destructive">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset();
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [apiUrl] = useState(DEFAULT_API_URL);

  // LOCAL DEMO MODE: bypass Kinde auth
  const LOCAL_DEMO = import.meta.env.VITE_LOCAL_DEMO === "true";

  // Kinde authentication
  const kindeAuth = useKindeAuth();
  const isAuthenticated = LOCAL_DEMO ? true : kindeAuth.isAuthenticated;
  const authLoading = LOCAL_DEMO ? false : kindeAuth.isLoading;
  const login = kindeAuth.login;
  const register = kindeAuth.register;
  const user = LOCAL_DEMO ? { id: "local-demo-user", email: "joshua.bell.828@gmail.com" } : kindeAuth.user;
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Fetch access token when authenticated
  useEffect(() => {
    if (LOCAL_DEMO) {
      setAccessToken("local-demo-token");
      return;
    }
    if (isAuthenticated && kindeAuth.getToken) {
      kindeAuth.getToken().then((token: string | undefined) => {
        setAccessToken(token || null);
      }).catch((err: Error) => {
        console.error("Failed to get token:", err);
      });
    } else {
      setAccessToken(null);
    }
  }, [isAuthenticated, kindeAuth.getToken, LOCAL_DEMO]);

  const library = useLibrary(apiUrl, accessToken, user?.id);
  const { wsState, game, actions } = useGame(apiUrl, library.currentBook?.book_id);

  // View state — skip presplash if user has played before
  const [view, setView] = useState<AppView>(() => hasPlayedBefore() ? "splash" : "presplash");
  const [showCommandCenter, setShowCommandCenter] = useState(false);

  // Global keyboard shortcuts
  const { toggleMockMode } = useMockMode();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "M") { e.preventDefault(); toggleMockMode(); }
      if (e.key === "Escape" && showCommandCenter) setShowCommandCenter(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleMockMode, showCommandCenter]);

  // Nickname state with localStorage persistence
  const [nickname, setNickname] = useState<string>(() => getStoredNickname() ?? "");
  const [nicknameConfirmed, setNicknameConfirmed] = useState(() => hasStoredNickname());

  // Scenario selection loading state
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  // Which tab to open in ScenarioSelector (reset after use)
  const [scenarioInitialTab, setScenarioInitialTab] = useState<"my" | "public">("my");


  // Character wizard state
  const [showCharacterWizard, setShowCharacterWizard] = useState(false);

  // Game sub-view: connecting vs actual game (scenario selection removed for alpha)
  const [gameSubView, setGameSubView] = useState<"connecting" | "playing">("connecting");

  // Connection timeout: track how long we've been in "connecting" state
  const [connectingTooLong, setConnectingTooLong] = useState(false);
  useEffect(() => {
    if (wsState === "connecting") {
      setConnectingTooLong(false);
      const timer = setTimeout(() => setConnectingTooLong(true), 10000);
      return () => clearTimeout(timer);
    } else {
      setConnectingTooLong(false);
    }
  }, [wsState]);

  // Handle presplash (pre-auth splash) completion
  const handlePresplashComplete = useCallback(() => {
    // Mark as played so presplash never shows again
    setHasPlayed();
    // After presplash, go to login if not authenticated, else dashboard
    if (!isAuthenticated) {
      setView("splash"); // use "splash" as a sentinel meaning "show login"
    } else if (library.currentBook) {
      setGameSubView("connecting");
      setView("game");
    } else {
      setView("dashboard");
    }
  }, [isAuthenticated, library.currentBook]);

  // Handle splash completion - go to dashboard (or game if book exists)
  const handleSplashComplete = useCallback(() => {
    if (library.currentBook) {
      setGameSubView("connecting");
      setView("game");
    } else {
      setView("dashboard");
    }
  }, [library.currentBook]);

  // Handle navigation from dashboard
  const handleNavigate = useCallback((newView: AppView) => {
    if (newView === "game") {
      // Mark that user has played (for skip-to-game on future visits)
      setHasPlayed();
      // If no current book, go to scenario selection first
      if (!library.currentBook) {
        setView("scenario");
        return;
      }
      // WebSocket auto-connects when bookId is set
      setGameSubView("connecting");
    }
    setView(newView);
  }, [library.currentBook]);

  // Handle back to dashboard
  const handleBackToDashboard = useCallback(() => {
    setView("dashboard");
  }, []);

  // Handle character added via wizard
  const handleCharacterAdded = useCallback(() => {
    setShowCharacterWizard(false);
    // Refresh character list
    actions.listCharacters();
  }, [actions]);

  // Handle character deletion
  const handleDeleteCharacter = useCallback(async (name: string) => {
    if (!library.currentBook) {
      throw new Error("No active book");
    }
    try {
      const response = await fetch(`${apiUrl}/api/v1/books/${library.currentBook.book_id}/characters/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to delete character");
      }
      // Refresh character list
      actions.listCharacters();
    } catch (err) {
      console.error("Failed to delete character:", err);
      throw err;
    }
  }, [apiUrl, library.currentBook, actions]);

  // Handle book reset
  const handleResetBook = useCallback(async () => {
    if (!library.currentBook) {
      throw new Error("No active book");
    }
    if (!library.librarianId) {
      throw new Error("No librarian ID");
    }
    try {
      const response = await fetch(`${apiUrl}/api/v1/books/${library.currentBook.book_id}/reset`, {
        method: "POST",
        headers: {
          "X-Librarian-ID": library.librarianId,
        },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to reset book");
      }
      // Disconnect and reconnect to clear local state
      actions.disconnect();
      setGameSubView("connecting");
      // Give websocket time to disconnect
      setTimeout(() => {
        // Reconnect - this will fetch fresh world and character data
        actions.connect();
      }, 500);
    } catch (err) {
      console.error("Failed to reset book:", err);
      throw err;
    }
  }, [apiUrl, library.currentBook, library.librarianId, actions]);

  // Handle scenario selection
  const handleScenarioSelected = useCallback(async (scenario: string) => {
    setScenarioLoading(true);
    setScenarioError(null);
    try {
      const { bookId } = await library.createBook(scenario);
      const book = await library.getBook(bookId);
      library.setCurrentBook(book);
      // Mark that user has played (for skip-to-game on future visits)
      setHasPlayed();
      // WebSocket will auto-connect due to bookId change
      setGameSubView("connecting");
      setView("game");
    } catch (err) {
      console.error("Failed to create book:", err);
      const msg = err instanceof Error ? err.message : "Failed to create book";
      setScenarioError(msg.includes("fetch") ? "Server unreachable — is the backend running?" : msg);
    } finally {
      setScenarioLoading(false);
    }
  }, [library]);

  // Return to dashboard (book keeps running in background)
  const handleStopWorld = useCallback(() => {
    actions.disconnect();
    library.setCurrentBook(null);
    setView("dashboard");
  }, [actions, library]);

  // Derived state - define these early so they can be used in effects
  const isConnected = wsState === "connected";
  const hasBook = library.currentBook !== null;
  const hasWorld = game.world?.world_id !== undefined;
  const isMultiplayer = game.world?.multiplayer === true;
  const needsNicknamePrompt = isMultiplayer && !nicknameConfirmed;

  // Request world and character data when WebSocket connects
  useEffect(() => {
    if (wsState === "connected") {
      // Request world state via WebSocket to sync game.world
      actions.getWorld();
      // Request character list
      actions.listCharacters();
    }
  }, [wsState, actions]);

  // Handle init_failed — stale book ID in localStorage (e.g. server restarted and wiped the book)
  useEffect(() => {
    if (game.error && (game.error.includes("init_failed") || game.error.includes("Failed to initialize"))) {
      console.warn("[App] init_failed detected — clearing stale book and redirecting to scenario selector");
      actions.disconnect();
      library.setCurrentBook(null);
      actions.clearError();
      setView("scenario");
    }
  }, [game.error, actions, library]);

  // Send join command after nickname confirmed (both solo and multiplayer)
  useEffect(() => {
    if (wsState === "connected" && nicknameConfirmed) {
      actions.join(nickname);
    }
  }, [wsState, nicknameConfirmed, nickname, actions]);

  // Update game sub-view when connected and world is loaded
  useEffect(() => {
    if (isConnected && hasWorld && gameSubView === "connecting") {
      setGameSubView("playing");
    }
  }, [isConnected, hasWorld, gameSubView]);

  // In solo mode, auto-confirm nickname (skip the prompt)
  useEffect(() => {
    if (isConnected && hasWorld && !isMultiplayer && !nicknameConfirmed) {
      // Solo mode: auto-confirm with stored or empty nickname
      setNicknameConfirmed(true);
    }
  }, [isConnected, hasWorld, isMultiplayer, nicknameConfirmed]);

  // Handle nickname submission
  const handleNicknameSubmit = (submittedNickname: string) => {
    setNickname(submittedNickname);
    setStoredNickname(submittedNickname);
    setNicknameConfirmed(true);
  };


  // Show presplash unconditionally (before auth)
  if (view === "presplash") {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="presplash"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <SplashScreen
            onComplete={handlePresplashComplete}
            showIntro={true}
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  // Show loading while auth is initializing (after presplash)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex gap-1.5 justify-center">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full bg-primary/50"
                animate={{
                  opacity: [0.2, 0.8, 0.2],
                  scale: [0.9, 1.1, 0.9],
                }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  delay: i * 0.2,
                }}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated (after presplash)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-8 p-8 max-w-md">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Welcome to Raunch</h1>
            <p className="text-muted-foreground">
              Sign in to start your adventure
            </p>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => login()}
              className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => register()}
              className="w-full px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors"
            >
              Create Account
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            By signing in, you confirm you are 18+ years old
          </p>
        </div>
      </div>
    );
  }

  // Render based on view state
  return (
    <>
      <AnimatePresence mode="wait">
        {view === "splash" && (
          <motion.div
            key="splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <SplashScreen
              onComplete={handleSplashComplete}
              showIntro={false}
            />
          </motion.div>
        )}

        {view === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <AlphaDashboard
              onNavigate={handleNavigate}
              isAdmin={isAuthenticated}
              onOpenSettings={() => setShowCommandCenter(true)}
              apiUrl={apiUrl}
              userEmail={user?.email}
              hasActiveBook={library.currentBook !== null}
              activeBookName={library.currentBook?.scenario}
            />
          </motion.div>
        )}

        {view === "kanban" && (
          <motion.div
            key="kanban"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <FeedbackKanban
              onBack={handleBackToDashboard}
              isAdmin={isAuthenticated}
              apiUrl={apiUrl}
              userEmail={user?.email}
            />
          </motion.div>
        )}

        {view === "voting" && (
          <motion.div
            key="voting"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <VotingPolls
              onBack={handleBackToDashboard}
              isAdmin={isAuthenticated}
              apiUrl={apiUrl}
              userEmail={user?.email}
            />
          </motion.div>
        )}

        {view === "about" && (
          <motion.div
            key="about"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <AboutPage
              onBack={handleBackToDashboard}
              isAdmin={isAuthenticated}
              apiUrl={apiUrl}
            />
          </motion.div>
        )}

        {view === "wizard" && (
          <motion.div
            key="wizard"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <WizardPage
              onBack={handleBackToDashboard}
              apiUrl={apiUrl}
              librarianId={library.librarianId}
              onSaved={() => {
                setScenarioInitialTab("my");
                setView("scenario");
              }}
            />
          </motion.div>
        )}

        {view === "scenario" && (
          <motion.div
            key="scenario"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <ScenarioSelector
              apiUrl={apiUrl}
              librarianId={library.librarianId}
              onScenarioSelected={handleScenarioSelected}
              isLoading={scenarioLoading}
              externalError={scenarioError}
              onBack={handleBackToDashboard}
              onOpenWizard={() => setView("wizard")}
              initialTab={scenarioInitialTab}
            />
          </motion.div>
        )}

        {view === "notfound" && (
          <motion.div
            key="notfound"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <NotFoundPage onBack={handleBackToDashboard} />
          </motion.div>
        )}

        {view === "game" && (
          <motion.div
            key="game"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* No book selected - redirect to scenario selector */}
            {!hasBook ? (
              <div className="min-h-screen flex items-center justify-center">
                <div className="text-center space-y-4">
                  <p className="text-sm text-muted-foreground">No scenario selected</p>
                  <button
                    onClick={() => setView("scenario")}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
                  >
                    Select Scenario
                  </button>
                </div>
              </div>
            ) : isConnected && hasWorld && needsNicknamePrompt ? (
              /* Nickname prompt for multiplayer */
              <NicknamePrompt onSubmit={handleNicknameSubmit} />
            ) : gameSubView === "connecting" || !hasWorld ? (
              // Connecting / waiting for world state
              <div className="min-h-screen flex items-center justify-center">
                <div className="text-center space-y-6">
                  {wsState === "connecting" && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.4 }}
                      className="text-center space-y-5"
                    >
                      <div className="flex gap-2 justify-center">
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
                            }}
                          />
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground/60">
                        Connecting to the story engine
                        <motion.span
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >...</motion.span>
                      </p>
                      <AnimatePresence>
                        {connectingTooLong && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="space-y-3"
                          >
                            <p className="text-xs text-muted-foreground/40 max-w-xs mx-auto">
                              Taking longer than expected — the server may be waking up from sleep
                            </p>
                            <button
                              onClick={handleBackToDashboard}
                              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Back to dashboard
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}

                  {wsState === "disconnected" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="text-center space-y-5 max-w-sm mx-auto"
                    >
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          The Library is resting&hellip;
                        </p>
                        <p className="text-xs text-muted-foreground/50 leading-relaxed">
                          Servers spin down when idle to save resources. Click below to wake it up.
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-3">
                        <button
                          onClick={() => actions.connect()}
                          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                          Wake Up Server
                        </button>
                        <button
                          onClick={handleBackToDashboard}
                          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Back to dashboard
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {isConnected && !hasWorld && (
                    <>
                      {/* Loading dots while waiting for world info */}
                      <motion.div
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 0 }}
                        transition={{ delay: 1.2, duration: 0.3 }}
                        className="absolute inset-0 flex items-center justify-center"
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
                              }}
                            />
                          ))}
                        </div>
                      </motion.div>
                      {/* Show error message after delay if world doesn't load */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.5, duration: 0.3 }}
                        className="text-center space-y-4"
                      >
                        <p className="text-sm text-muted-foreground">Loading world...</p>
                        <p className="text-xs text-muted-foreground/50 max-w-xs">
                          If this takes too long, the book may have an issue
                        </p>
                        <button
                          onClick={() => setView("scenario")}
                          className="px-4 py-2 text-muted-foreground hover:text-foreground text-sm"
                        >
                          Choose Different Scenario
                        </button>
                      </motion.div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              // Main game interface
              <ErrorBoundary onReset={() => window.location.reload()}>
                <GameLayout
                  game={game}
                  actions={actions}
                  bookId={library.currentBook?.book_id}
                  onAddCharacter={() => {
                    actions.listCharacters();
                    setShowCharacterWizard(true);
                  }}
                  onDeleteCharacter={handleDeleteCharacter}
                  onResetBook={handleResetBook}
                  onStopWorld={handleStopWorld}
                  onOpenDebug={() => setShowCommandCenter(true)}
                />
              </ErrorBoundary>
            )}

            {/* Character creation wizard */}
            <AnimatePresence>
              {showCharacterWizard && library.currentBook && (
                <CharacterWizard
                  apiUrl={apiUrl}
                  bookId={library.currentBook.book_id}
                  onCharacterAdded={handleCharacterAdded}
                  onClose={() => setShowCharacterWizard(false)}
                  existingCharacters={game.characterNames}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Command Center trigger - hidden during splash */}
      {view !== "splash" && (
        <CommandCenterTrigger onClick={() => setShowCommandCenter(true)} />
      )}

      {/* Command Center panel */}
      {showCommandCenter && (
        <CommandCenter
          isOpen={showCommandCenter}
          onClose={() => setShowCommandCenter(false)}
            apiUrl={apiUrl}
            authInfo={{
              isAuthenticated,
              userEmail: user?.email ?? undefined,
              userName: user?.givenName ? `${user.givenName} ${user.familyName ?? ""}`.trim() : undefined,
              accessToken,
              librarianId: library.librarianId,
            }}
            bookId={library.currentBook?.book_id}
            sendCommand={actions.sendCommand}
            onSelectBook={async (bookId) => {
              const book = await library.getBook(bookId);
              library.setCurrentBook(book);
              setShowCommandCenter(false);
              setGameSubView("connecting");
              setView("game");
            }}
            wsState={wsState}
            gamePaused={game.paused}
            gameManualMode={game.manualMode}
            pageCount={game.pages.length}
            characterCount={game.characterNames.length}
            pageInterval={game.pageInterval}
          />
      )}
    </>
  );
}

export default App;

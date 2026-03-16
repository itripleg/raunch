import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "./hooks/useGame";
import { useLibrary } from "./hooks/useLibrary";
import { SplashScreen } from "./components/SplashScreen";
import { AlphaDashboard } from "./components/AlphaDashboard";
import { AdminSettings } from "./components/AdminSettings";
import { FeedbackKanban } from "./components/FeedbackKanban";
import { VotingPolls } from "./components/VotingPolls";
import { AboutPage } from "./components/AboutPage";
import { GameLayout } from "./components/GameLayout";
import { NicknamePrompt } from "./components/NicknamePrompt";
import { CharacterWizard } from "./components/CharacterWizard";
import { WizardPage } from "./components/WizardPage";
import { ScenarioSelector } from "./components/ScenarioSelector";

const NICKNAME_STORAGE_KEY = "raunch_nickname";
const HAS_PLAYED_KEY = "raunch_has_played";

type AppView = "splash" | "dashboard" | "kanban" | "voting" | "about" | "wizard" | "scenario" | "game";

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

// Helper to check admin status from localStorage
function getStoredAdmin(): boolean {
  try {
    return localStorage.getItem("raunch_admin") === "true";
  } catch {
    return false;
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
  const library = useLibrary(apiUrl);
  const { wsState, game, actions } = useGame(apiUrl, library.currentBook?.book_id);

  // View state (new alpha dashboard flow)
  const [view, setView] = useState<AppView>("splash");
  const [isAdmin, setIsAdmin] = useState(() => getStoredAdmin());
  const [showSettings, setShowSettings] = useState(false);

  // Nickname state with localStorage persistence
  const [nickname, setNickname] = useState<string>(() => getStoredNickname() ?? "");
  const [nicknameConfirmed, setNicknameConfirmed] = useState(() => hasStoredNickname());

  // Scenario selection loading state
  const [scenarioLoading, setScenarioLoading] = useState(false);


  // Character wizard state
  const [showCharacterWizard, setShowCharacterWizard] = useState(false);

  // Game sub-view: connecting vs actual game (scenario selection removed for alpha)
  const [gameSubView, setGameSubView] = useState<"connecting" | "playing">("connecting");

  // Handle splash completion - skip to game if user has played before
  const handleSplashComplete = useCallback(() => {
    if (hasPlayedBefore()) {
      // Skip dashboard, go to scenario selection (or game if book exists)
      if (library.currentBook) {
        setGameSubView("connecting");
        setView("game");
      } else {
        setView("scenario");
      }
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

  // Handle scenario selection
  const handleScenarioSelected = useCallback(async (scenario: string) => {
    setScenarioLoading(true);
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

  // Send join command only in multiplayer mode after nickname confirmed
  useEffect(() => {
    if (wsState === "connected" && nicknameConfirmed && isMultiplayer) {
      actions.join(nickname);
    }
  }, [wsState, nicknameConfirmed, isMultiplayer, nickname, actions]);

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


  // Render based on view state
  return (
    <>
      <AnimatePresence mode="wait">
        {view === "splash" && (
          <motion.div
            key="splash"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <SplashScreen
              onComplete={handleSplashComplete}
              showIntro={!hasPlayedBefore()}
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
              isAdmin={isAdmin}
              onOpenSettings={() => setShowSettings(true)}
              apiUrl={apiUrl}
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
              isAdmin={isAdmin}
              apiUrl={apiUrl}
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
              isAdmin={isAdmin}
              apiUrl={apiUrl}
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
              isAdmin={isAdmin}
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
              onScenarioSelected={handleScenarioSelected}
              isLoading={scenarioLoading}
              onBack={handleBackToDashboard}
            />
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
                    <>
                      <div className="flex gap-1.5 justify-center">
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
                      <p className="text-xs text-muted-foreground/40">connecting to server</p>
                    </>
                  )}

                  {wsState === "disconnected" && (
                    <>
                      <p className="text-sm text-muted-foreground">Server not available</p>
                      <p className="text-xs text-muted-foreground/50 max-w-xs">
                        Start the server with <code className="font-mono text-primary/70">raunch start</code>
                      </p>
                      <div className="flex gap-3 justify-center">
                        <button
                          onClick={() => actions.connect()}
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
                        >
                          Retry
                        </button>
                        <button
                          onClick={handleBackToDashboard}
                          className="px-4 py-2 text-muted-foreground hover:text-foreground text-sm"
                        >
                          Back
                        </button>
                      </div>
                    </>
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
                  apiUrl={apiUrl}
                  onAddCharacter={() => {
                    actions.listCharacters();
                    setShowCharacterWizard(true);
                  }}
                  onDeleteCharacter={handleDeleteCharacter}
                  onStopWorld={handleStopWorld}
                  onBackToDashboard={handleBackToDashboard}
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

      {/* Admin settings modal */}
      <AdminSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        isAdmin={isAdmin}
        onAdminChange={setIsAdmin}
        apiUrl={apiUrl}
      />
    </>
  );
}

export default App;

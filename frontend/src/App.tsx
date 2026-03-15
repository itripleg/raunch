import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "./hooks/useGame";
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

const NICKNAME_STORAGE_KEY = "raunch_nickname";
const HAS_PLAYED_KEY = "raunch_has_played";

type AppView = "splash" | "dashboard" | "kanban" | "voting" | "about" | "wizard" | "game";

// Smart URL detection for local vs remote/production
function getServerUrls(): { wsUrl: string; apiUrl: string } {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.");

  // Check for environment overrides (set at build time)
  const envWsUrl = import.meta.env.VITE_WS_URL;
  const envApiUrl = import.meta.env.VITE_API_URL;

  if (envWsUrl && envApiUrl) {
    return { wsUrl: envWsUrl, apiUrl: envApiUrl };
  }

  if (isLocal) {
    // Local development - use hardcoded ports
    return {
      wsUrl: `ws://${hostname}:7667`,
      apiUrl: `http://${hostname}:8000`
    };
  }

  // Remote/tunneled - assume same host, different ports via path or subdomain
  // For cloudflare tunnels, we need separate tunnel URLs passed via env
  // Fallback: try same host with standard ports (won't work for most tunnels)
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  return {
    wsUrl: envWsUrl || `${wsProtocol}//${hostname}:7667`,
    apiUrl: envApiUrl || `${protocol}//${hostname}:8000`
  };
}

const { wsUrl: DEFAULT_WS_URL, apiUrl: DEFAULT_API_URL } = getServerUrls();

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
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [apiUrl] = useState(DEFAULT_API_URL);
  const { wsState, game, actions } = useGame(wsUrl);

  // View state (new alpha dashboard flow)
  const [view, setView] = useState<AppView>("splash");
  const [isAdmin, setIsAdmin] = useState(() => getStoredAdmin());
  const [showSettings, setShowSettings] = useState(false);

  // Nickname state with localStorage persistence
  const [nickname, setNickname] = useState<string>(() => getStoredNickname() ?? "");
  const [nicknameConfirmed, setNicknameConfirmed] = useState(() => hasStoredNickname());

  // World running status from REST API
  const [worldRunning, setWorldRunning] = useState<boolean | null>(null);
  const [worldCheckError, setWorldCheckError] = useState<string | null>(null);


  // Character wizard state
  const [showCharacterWizard, setShowCharacterWizard] = useState(false);

  // Game sub-view: connecting vs actual game (scenario selection removed for alpha)
  const [gameSubView, setGameSubView] = useState<"connecting" | "playing">("connecting");

  // Handle splash completion - skip to game if user has played before
  const handleSplashComplete = useCallback(() => {
    if (hasPlayedBefore()) {
      // Skip dashboard, go straight to game
      if (wsState !== "connected") {
        actions.connect();
      }
      setGameSubView("connecting");
      setView("game");
    } else {
      setView("dashboard");
    }
  }, [wsState, actions]);

  // Handle navigation from dashboard
  const handleNavigate = useCallback((newView: AppView) => {
    if (newView === "game") {
      // Mark that user has played (for skip-to-game on future visits)
      setHasPlayed();
      // Connect WebSocket when entering game
      if (wsState !== "connected") {
        actions.connect();
      }
      setGameSubView("connecting");
    }
    setView(newView);
  }, [wsState, actions]);

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
    try {
      const response = await fetch(`${apiUrl}/api/v1/characters/${encodeURIComponent(name)}`, {
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
  }, [apiUrl, actions]);

  // Check world status and scenarios from REST API
  const checkWorldStatus = useCallback(async () => {
    try {
      // Fetch world status
      const worldResponse = await fetch(`${apiUrl}/api/v1/world`);
      if (!worldResponse.ok) {
        throw new Error("Failed to check world status");
      }
      const worldData = await worldResponse.json();
      setWorldRunning(worldData.running === true);
      setWorldCheckError(null);

    } catch (err) {
      setWorldCheckError(err instanceof Error ? err.message : "Failed to check world status");
      setWorldRunning(false);
    }
  }, [apiUrl]);

  // Stop the current world and return to dashboard
  const handleStopWorld = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/world/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to stop world");
      }
      // Reset game state
      actions.reset();
      actions.disconnect();
      // Return to dashboard
      setWorldRunning(false);
      setView("dashboard");
    } catch (err) {
      console.error("Failed to stop world:", err);
    }
  }, [apiUrl, actions]);

  // Derived state - define these early so they can be used in effects
  const isConnected = wsState === "connected";
  const hasWorld = worldRunning === true;
  const isMultiplayer = game.world?.multiplayer === true;
  const needsNicknamePrompt = isMultiplayer && !nicknameConfirmed;

  // Check world status when WebSocket connects
  useEffect(() => {
    if (wsState === "connected") {
      checkWorldStatus();
      // Also request world state via WebSocket to sync game.world
      actions.getWorld();
      // Request character list
      actions.listCharacters();
    } else if (wsState === "disconnected") {
      // Reset world status when disconnected
      setWorldRunning(null);
    }
  }, [wsState, checkWorldStatus, actions]);

  // Send join command only in multiplayer mode after nickname confirmed
  useEffect(() => {
    if (wsState === "connected" && nicknameConfirmed && isMultiplayer) {
      actions.join(nickname);
    }
  }, [wsState, nicknameConfirmed, isMultiplayer, nickname, actions]);

  // Sync worldRunning when game.world changes from WebSocket (e.g., world_loaded message)
  useEffect(() => {
    if (game.world?.world_id && worldRunning === false) {
      // World was loaded via WebSocket broadcast, update local state
      setWorldRunning(true);
    }
  }, [game.world, worldRunning]);

  // Update game sub-view when connected and world is running
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

        {view === "game" && (
          <motion.div
            key="game"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Nickname prompt for multiplayer */}
            {isConnected && hasWorld && needsNicknamePrompt ? (
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
                      {/* Show "No world" message after delay */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.5, duration: 0.3 }}
                        className="text-center space-y-4"
                      >
                        <p className="text-sm text-muted-foreground">No world running</p>
                        <p className="text-xs text-muted-foreground/50 max-w-xs">
                          Start a scenario from the CLI with <code className="font-mono text-primary/70">raunch start --scenario name</code>
                        </p>
                        <button
                          onClick={handleBackToDashboard}
                          className="px-4 py-2 text-muted-foreground hover:text-foreground text-sm"
                        >
                          Back to Dashboard
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
              {showCharacterWizard && (
                <CharacterWizard
                  apiUrl={apiUrl}
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

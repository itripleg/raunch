import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "./hooks/useGame";
import { SplashScreen } from "./components/SplashScreen";
import { GameLayout } from "./components/GameLayout";
import { NicknamePrompt } from "./components/NicknamePrompt";
import { ScenarioSelector } from "./components/ScenarioSelector";
import { CharacterWizard } from "./components/CharacterWizard";

const NICKNAME_STORAGE_KEY = "raunch_nickname";

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

  // Nickname state with localStorage persistence
  const [nickname, setNickname] = useState<string>(() => getStoredNickname() ?? "");
  const [nicknameConfirmed, setNicknameConfirmed] = useState(() => hasStoredNickname());

  // World running status from REST API
  const [worldRunning, setWorldRunning] = useState<boolean | null>(null);
  const [worldCheckError, setWorldCheckError] = useState<string | null>(null);

  // Scenarios list from REST API (for pre-fetching)
  const [scenariosAvailable, setScenariosAvailable] = useState<boolean>(false);

  // Character wizard state
  const [showCharacterWizard, setShowCharacterWizard] = useState(false);

  // Handle character added via wizard
  const handleCharacterAdded = useCallback(() => {
    setShowCharacterWizard(false);
    // Refresh character list
    actions.listCharacters();
  }, [actions]);

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

      // Pre-fetch scenarios list to verify API availability
      const scenariosResponse = await fetch(`${apiUrl}/api/v1/scenarios`);
      if (scenariosResponse.ok) {
        const scenariosData = await scenariosResponse.json();
        setScenariosAvailable(Array.isArray(scenariosData) && scenariosData.length > 0);
      }
    } catch (err) {
      setWorldCheckError(err instanceof Error ? err.message : "Failed to check world status");
      setWorldRunning(false);
    }
  }, [apiUrl]);

  // Check world status when WebSocket connects
  useEffect(() => {
    if (wsState === "connected") {
      checkWorldStatus();
    } else if (wsState === "disconnected") {
      // Reset world status when disconnected
      setWorldRunning(null);
    }
  }, [wsState, checkWorldStatus]);

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

  // Handle nickname submission
  const handleNicknameSubmit = (submittedNickname: string) => {
    setNickname(submittedNickname);
    setStoredNickname(submittedNickname);
    setNicknameConfirmed(true);
  };

  // Handle scenario loaded - refresh world status
  const handleScenarioLoaded = useCallback(() => {
    checkWorldStatus();
  }, [checkWorldStatus]);

  const isConnected = wsState === "connected";
  // Use worldRunning from REST API as source of truth for whether a scenario is loaded
  // game.world is set from welcome message regardless of scenario state
  const hasWorld = worldRunning === true;

  // Only show nickname prompt in multiplayer mode
  const isMultiplayer = game.world?.multiplayer === true;
  const needsNicknamePrompt = isMultiplayer && !nicknameConfirmed;

  // In solo mode, auto-confirm nickname (skip the prompt)
  useEffect(() => {
    if (isConnected && hasWorld && !isMultiplayer && !nicknameConfirmed) {
      // Solo mode: auto-confirm with stored or empty nickname
      setNicknameConfirmed(true);
    }
  }, [isConnected, hasWorld, isMultiplayer, nicknameConfirmed]);

  // Show nickname prompt only in multiplayer mode
  if (isConnected && hasWorld && needsNicknamePrompt) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="nickname"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <NicknamePrompt onSubmit={handleNicknameSubmit} />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {!isConnected ? (
        <motion.div
          key="splash"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        >
          <SplashScreen
            onConnect={actions.connect}
            wsState={wsState}
            wsUrl={wsUrl}
            onUrlChange={setWsUrl}
          />
        </motion.div>
      ) : !hasWorld ? (
        <motion.div
          key="scenario"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        >
          <ScenarioSelector
            apiUrl={apiUrl}
            onScenarioLoaded={handleScenarioLoaded}
          />
        </motion.div>
      ) : (
        <motion.div
          key="game"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, delay: 0.2, ease: "easeOut" }}
          className="min-h-screen"
        >
          <ErrorBoundary onReset={() => window.location.reload()}>
            <GameLayout
              game={game}
              actions={actions}
              onAddCharacter={() => setShowCharacterWizard(true)}
            />
          </ErrorBoundary>

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
  );
}

export default App;

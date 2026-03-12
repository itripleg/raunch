import { useState, useEffect, useCallback, Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "./hooks/useGame";
import { SplashScreen } from "./components/SplashScreen";
import { GameLayout } from "./components/GameLayout";
import { NicknamePrompt } from "./components/NicknamePrompt";
import { ScenarioSelector } from "./components/ScenarioSelector";

const DEFAULT_WS_URL = "ws://127.0.0.1:7667";
const DEFAULT_API_URL = "http://127.0.0.1:8000";
const NICKNAME_STORAGE_KEY = "raunch_nickname";

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

  // Send join command and check world status when WebSocket connects
  useEffect(() => {
    if (wsState === "connected" && nicknameConfirmed) {
      // Send join command with the stored nickname
      actions.join(nickname);
      checkWorldStatus();
    } else if (wsState === "disconnected") {
      // Reset world status when disconnected
      setWorldRunning(null);
    }
  }, [wsState, nicknameConfirmed, nickname, actions, checkWorldStatus]);

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
  const hasWorld = game.world !== null || worldRunning === true;

  // Show nickname prompt first if not confirmed
  if (!nicknameConfirmed) {
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
            <GameLayout game={game} actions={actions} />
          </ErrorBoundary>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;

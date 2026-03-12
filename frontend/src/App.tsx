import { useState, Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "./hooks/useGame";
import { SplashScreen } from "./components/SplashScreen";
import { GameLayout } from "./components/GameLayout";
import { NicknamePrompt } from "./components/NicknamePrompt";

const DEFAULT_WS_URL = "ws://127.0.0.1:7667";
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
  const { wsState, game, actions } = useGame(wsUrl);

  // Nickname state with localStorage persistence
  const [nickname, setNickname] = useState<string>(() => getStoredNickname() ?? "");
  const [nicknameConfirmed, setNicknameConfirmed] = useState(() => hasStoredNickname());

  // Handle nickname submission
  const handleNicknameSubmit = (submittedNickname: string) => {
    setNickname(submittedNickname);
    setStoredNickname(submittedNickname);
    setNicknameConfirmed(true);
  };

  const isConnected = wsState === "connected" && game.world;

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

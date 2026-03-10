import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGame } from "./hooks/useGame";
import { SplashScreen } from "./components/SplashScreen";
import { GameLayout } from "./components/GameLayout";

const DEFAULT_WS_URL = "ws://127.0.0.1:7667";

function App() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const { wsState, game, actions } = useGame(wsUrl);

  const isConnected = wsState === "connected" && game.world;

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
          <GameLayout game={game} actions={actions} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;

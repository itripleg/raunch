import { useState } from "react";
import { useGame } from "./hooks/useGame";
import { ConnectScreen } from "./components/ConnectScreen";
import { GameLayout } from "./components/GameLayout";

const DEFAULT_WS_URL = "ws://127.0.0.1:7667";

function App() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const { wsState, game, actions } = useGame(wsUrl);

  if (wsState === "disconnected" || !game.world) {
    return (
      <ConnectScreen
        wsUrl={wsUrl}
        onUrlChange={setWsUrl}
        onConnect={actions.connect}
        connecting={wsState === "connecting"}
      />
    );
  }

  return <GameLayout game={game} actions={actions} />;
}

export default App;

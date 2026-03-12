import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

type Props = {
  onConnect: () => void;
  wsState: "connecting" | "connected" | "disconnected";
  wsUrl: string;
  onUrlChange: (url: string) => void;
};

export function SplashScreen({ onConnect, wsState, wsUrl, onUrlChange }: Props) {
  const [showManual, setShowManual] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [showUrlEdit, setShowUrlEdit] = useState(false);

  // Auto-connect on mount (after splash has time to breathe)
  useEffect(() => {
    const timer = setTimeout(() => {
      onConnect();
      setAttemptCount(1);
    }, 1800); // Let the logo settle before connecting
    return () => clearTimeout(timer);
  }, []);

  // Show manual controls after failed attempt
  useEffect(() => {
    if (wsState === "disconnected" && attemptCount > 0) {
      const timer = setTimeout(() => setShowManual(true), 1200);
      return () => clearTimeout(timer);
    }
  }, [wsState, attemptCount]);

  const handleRetry = () => {
    setAttemptCount((c) => c + 1);
    onConnect();
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Ambient background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-[oklch(0.08_0.03_340)]" />
        <motion.div
          className="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full bg-primary/[0.03] blur-[150px]"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.4, 0.6, 0.4],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-violet-500/[0.02] blur-[120px]"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{
            scale: [1.05, 1, 1.05],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-center mb-16"
        >
          <h1 className="text-7xl font-bold tracking-tighter bg-gradient-to-r from-primary via-[oklch(0.7_0.2_350)] to-primary bg-clip-text text-transparent">
            RAUNCH
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0, duration: 1.2 }}
            className="text-muted-foreground/60 text-[10px] tracking-[0.4em] uppercase mt-3"
          >
            Adult Interactive Fiction
          </motion.p>
        </motion.div>

        {/* Connection Status */}
        <AnimatePresence mode="wait">
          {wsState === "connecting" && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="flex flex-col items-center gap-6"
            >
              {/* Minimal loading indicator */}
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full bg-primary/50"
                    animate={{
                      opacity: [0.2, 0.8, 0.2],
                      scale: [0.9, 1.1, 0.9],
                    }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      delay: i * 0.25,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="text-[10px] text-muted-foreground/30"
              >
                connecting
              </motion.p>
            </motion.div>
          )}

          {showManual && wsState === "disconnected" && (
            <motion.div
              key="manual"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex flex-col items-center gap-8"
            >
              {/* Server unavailable message */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="text-[11px] text-muted-foreground/40"
              >
                server not available
              </motion.p>

              {/* Retry button - minimal style */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.6 }}
                onClick={handleRetry}
                className="px-8 py-2.5 text-sm text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 rounded-full transition-all duration-500 hover:shadow-[0_0_30px_oklch(0.65_0.22_340_/_0.12)]"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                retry
              </motion.button>

              {/* URL editor toggle */}
              <AnimatePresence>
                {showUrlEdit ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.4 }}
                    className="flex flex-col items-center gap-2"
                  >
                    <input
                      type="text"
                      value={wsUrl}
                      onChange={(e) => onUrlChange(e.target.value)}
                      className="w-64 px-3 py-1.5 bg-card/50 border border-border/50 rounded-md text-xs text-foreground/70 focus:outline-none focus:border-primary/30 font-mono text-center"
                      placeholder="ws://127.0.0.1:7667"
                    />
                  </motion.div>
                ) : (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.0, duration: 0.6 }}
                    onClick={() => setShowUrlEdit(true)}
                    className="text-[10px] text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors duration-300"
                  >
                    change server
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hint text */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: showManual ? 1 : 0 }}
          transition={{ delay: 2, duration: 1 }}
          className="absolute bottom-8 text-[9px] text-muted-foreground/15"
        >
          <code className="font-mono">raunch start</code>
        </motion.p>
      </div>
    </div>
  );
}

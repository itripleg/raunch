import { useEffect, useState } from "react";
import { motion } from "motion/react";

type Props = {
  onConnect: () => void;
  wsState: "connecting" | "connected" | "disconnected";
  wsUrl: string;
  onUrlChange: (url: string) => void;
};

export function SplashScreen({ onConnect, wsState }: Props) {
  const [showRetry, setShowRetry] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);

  // Auto-connect on mount (after splash has time to breathe)
  useEffect(() => {
    const timer = setTimeout(() => {
      onConnect();
      setAttemptCount(1);
    }, 1800);
    return () => clearTimeout(timer);
  }, []);

  // Show retry after failed attempt
  useEffect(() => {
    if (wsState === "disconnected" && attemptCount > 0) {
      const timer = setTimeout(() => setShowRetry(true), 800);
      return () => clearTimeout(timer);
    }
    if (wsState === "connecting") {
      setShowRetry(false);
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
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.4, 0.6, 0.4],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-violet-500/[0.02] blur-[120px]"
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
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="text-center mb-16"
        >
          <h1 className="text-7xl font-bold tracking-tighter bg-gradient-to-r from-primary via-[oklch(0.7_0.2_350)] to-primary bg-clip-text text-transparent">
            RAUNCH
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 1 }}
            className="text-muted-foreground/60 text-[10px] tracking-[0.4em] uppercase mt-3"
          >
            Adult Interactive Fiction
          </motion.p>
        </motion.div>

        {/* Connection Status - fixed height container to prevent layout shift */}
        <div className="h-20 flex flex-col items-center justify-start">
          {wsState === "connecting" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full bg-primary/50"
                    animate={{
                      opacity: [0.3, 0.8, 0.3],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </div>
              <p className="text-xs sm:text-[10px] text-muted-foreground/30">connecting</p>
            </motion.div>
          )}

          {showRetry && wsState === "disconnected" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col items-center gap-4"
            >
              <p className="text-xs sm:text-[11px] text-muted-foreground/40">
                server not available
              </p>
              <motion.button
                onClick={handleRetry}
                className="px-8 py-3 sm:py-2.5 text-sm text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 rounded-full transition-all duration-300"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                retry
              </motion.button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

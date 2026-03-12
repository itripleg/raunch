import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

type TurnState = {
  timeout: number;
  waitingFor: string[];
  allReady: boolean;
  playerCount: number;
  turnStartedAt: number | null; // Unix timestamp (ms) when turn started
};

type Props = {
  turnState: TurnState | null;
  myNickname: string | null;
  isMyReady: boolean;
  onReady?: () => void;
};

export function TurnStateUI({
  turnState,
  myNickname,
  isMyReady,
  onReady,
}: Props) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  // Calculate and update countdown timer
  useEffect(() => {
    if (!turnState || turnState.allReady || !turnState.turnStartedAt) {
      setSecondsRemaining(null);
      return;
    }

    const updateCountdown = () => {
      const elapsed = Math.floor((Date.now() - turnState.turnStartedAt!) / 1000);
      const remaining = Math.max(0, turnState.timeout - elapsed);
      setSecondsRemaining(remaining);
    };

    // Initial update
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [turnState]);

  // Format seconds as MM:SS
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Don't render if no turn state or if all players are ready
  if (!turnState || turnState.playerCount === 0) {
    return null;
  }

  // Check if current player is holding up the group
  const isHoldingUp = myNickname && turnState.waitingFor.includes(myNickname);

  // Calculate progress for visual indicator
  const progress =
    turnState.timeout > 0 && secondsRemaining !== null
      ? secondsRemaining / turnState.timeout
      : 1;

  // Determine urgency level for styling
  const isUrgent = secondsRemaining !== null && secondsRemaining <= 10;
  const isWarning = secondsRemaining !== null && secondsRemaining <= 30 && !isUrgent;

  return (
    <AnimatePresence>
      {turnState.waitingFor.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="border-t border-border/30 bg-card/20 backdrop-blur-sm"
        >
          <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
            {/* Left: Waiting for indicator */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Waiting icon */}
              <div
                className={`shrink-0 ${
                  isHoldingUp
                    ? "text-amber-400"
                    : "text-muted-foreground"
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>

              {/* Waiting for text */}
              <div className="text-xs truncate">
                {isHoldingUp ? (
                  <span className="text-amber-400 font-medium">
                    Others are waiting for you
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Waiting for:{" "}
                    <span className="text-foreground/70">
                      {turnState.waitingFor.join(", ")}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* Center: Ready button (only if not ready) */}
            {!isMyReady && onReady && (
              <motion.button
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={onReady}
                className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  isHoldingUp
                    ? "bg-amber-500/80 hover:bg-amber-500 text-black hover:shadow-[0_0_15px_oklch(0.7_0.15_80_/_0.4)]"
                    : "bg-primary/80 hover:bg-primary text-primary-foreground hover:shadow-[0_0_15px_oklch(0.65_0.22_340_/_0.3)]"
                }`}
              >
                Ready
              </motion.button>
            )}

            {/* Right: Countdown timer */}
            {secondsRemaining !== null && (
              <div className="shrink-0 flex items-center gap-2">
                {/* Progress ring */}
                <div className="relative w-8 h-8">
                  <svg
                    className="w-8 h-8 -rotate-90"
                    viewBox="0 0 32 32"
                  >
                    {/* Background ring */}
                    <circle
                      cx="16"
                      cy="16"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-muted/30"
                    />
                    {/* Progress ring */}
                    <circle
                      cx="16"
                      cy="16"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={`${progress * 88} 88`}
                      strokeLinecap="round"
                      className={`transition-all duration-1000 ${
                        isUrgent
                          ? "text-red-500"
                          : isWarning
                          ? "text-amber-400"
                          : "text-primary"
                      }`}
                    />
                  </svg>
                  {/* Time text in center */}
                  <span
                    className={`absolute inset-0 flex items-center justify-center text-[10px] font-mono font-medium ${
                      isUrgent
                        ? "text-red-400"
                        : isWarning
                        ? "text-amber-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {secondsRemaining}
                  </span>
                </div>

                {/* Formatted time for longer durations */}
                {turnState.timeout >= 60 && (
                  <span
                    className={`text-xs font-mono ${
                      isUrgent
                        ? "text-red-400"
                        : isWarning
                        ? "text-amber-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {formatTime(secondsRemaining)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Ready status indicator when player is ready */}
          {isMyReady && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl mx-auto px-4 pb-2 -mt-1"
            >
              <span className="text-xs text-emerald-400/70 flex items-center gap-1">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                You're ready
              </span>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* All ready indicator (brief flash before tick) */}
      {turnState.allReady && turnState.playerCount > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="border-t border-emerald-500/30 bg-emerald-500/10"
        >
          <div className="max-w-3xl mx-auto px-4 py-2 text-center">
            <span className="text-xs text-emerald-400 font-medium flex items-center justify-center gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="animate-pulse"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              All players ready - advancing...
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

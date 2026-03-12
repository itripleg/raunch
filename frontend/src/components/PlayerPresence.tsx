import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

export type Player = {
  player_id: string;
  nickname: string;
  attached_to: string | null;
  ready: boolean;
};

type Props = {
  players: Player[];
  myPlayerId: string | null;
};

export function PlayerPresence({ players, myPlayerId }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Don't render if no players
  if (players.length === 0) {
    return null;
  }

  // Sort players: current player first, then alphabetically by nickname
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.player_id === myPlayerId) return -1;
    if (b.player_id === myPlayerId) return 1;
    return a.nickname.localeCompare(b.nickname);
  });

  return (
    <div className="relative">
      {/* Compact header button */}
      <button
        onClick={toggleExpanded}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-200 ${
          isExpanded
            ? "bg-primary/15 border border-primary/30"
            : "hover:bg-secondary/50 border border-transparent"
        }`}
      >
        {/* Players icon */}
        <div className="text-muted-foreground">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>

        {/* Player count */}
        <span className="text-xs font-medium text-foreground/80">
          {players.length}
        </span>

        {/* Online indicator dot */}
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />

        {/* Chevron */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-muted-foreground"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </motion.div>
      </button>

      {/* Expanded player list dropdown */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute top-full right-0 mt-1.5 z-50 min-w-[200px] max-w-[280px] bg-card/95 backdrop-blur-md border border-border/50 rounded-lg shadow-lg shadow-black/20 overflow-hidden"
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-border/30 bg-secondary/30">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Players Online
              </h3>
            </div>

            {/* Player list */}
            <div className="py-1.5 max-h-[240px] overflow-y-auto">
              {sortedPlayers.map((player) => {
                const isMe = player.player_id === myPlayerId;

                return (
                  <div
                    key={player.player_id}
                    className={`px-3 py-2 ${
                      isMe ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Ready/Status indicator */}
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          player.ready
                            ? "bg-emerald-400"
                            : player.attached_to
                            ? "bg-primary animate-pulse"
                            : "bg-muted-foreground/30"
                        }`}
                      />

                      {/* Nickname */}
                      <span
                        className={`text-sm font-medium truncate ${
                          isMe
                            ? "text-primary"
                            : "text-foreground/80"
                        }`}
                      >
                        {player.nickname}
                        {isMe && (
                          <span className="text-[10px] text-primary/60 ml-1">
                            (you)
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Status details */}
                    <div className="ml-4 mt-0.5 text-[10px] text-muted-foreground space-y-0.5">
                      {player.attached_to && (
                        <div className="truncate">
                          Playing as{" "}
                          <span className="text-foreground/70">
                            {player.attached_to}
                          </span>
                        </div>
                      )}
                      {player.ready && (
                        <div className="text-emerald-400/70 flex items-center gap-1">
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                          Ready
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer with summary */}
            <div className="px-3 py-2 border-t border-border/30 bg-secondary/20">
              <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                <span>
                  {players.filter((p) => p.ready).length} of {players.length}{" "}
                  ready
                </span>
                <span className="text-muted-foreground/50">
                  {players.filter((p) => p.attached_to).length} playing
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click outside handler */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
}

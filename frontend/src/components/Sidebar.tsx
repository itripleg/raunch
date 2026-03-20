import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type CharacterPage = {
  emotional_state?: string;
  action?: string;
  dialogue?: string;
  inner_thoughts?: string;
};

type PotentialCharacter = {
  name: string;
  description?: string;
  first_page: number;
  times_mentioned?: number;
};

type Props = {
  game: {
    world: Record<string, unknown> | null;
    characterNames: string[];
    characterDetails: Record<string, Record<string, unknown>>;
    attachedTo: string | null;
    directorMode?: boolean;
    pages?: { characters: Record<string, CharacterPage> }[];
  };
  actions: {
    attach: (name: string) => void;
    detach: () => void;
    listCharacters: () => void;
    getHistory: (count?: number) => void;
    getCharacterHistory: (name: string, count?: number) => void;
    toggleDirectorMode?: () => void;
  };
  onClose: () => void;
  onCharacterAttached?: () => void;
  onAddCharacter?: () => void;
  onDeleteCharacter?: (name: string) => void;
  onGrabCharacter?: (name: string) => void;
  potentialCharacters?: PotentialCharacter[];
  onResetBook?: () => void;
};

export function Sidebar({ game, actions, onClose, onCharacterAttached, onAddCharacter, onDeleteCharacter, onGrabCharacter, potentialCharacters, onResetBook }: Props) {
  const world = game.world as Record<string, unknown> | null;
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleDelete = (name: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't toggle attachment
    if (confirmDelete === name) {
      onDeleteCharacter?.(name);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(name);
      // Auto-cancel after 3 seconds
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  const handleReset = () => {
    if (confirmReset) {
      onResetBook?.();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
      // Auto-cancel after 3 seconds
      setTimeout(() => setConfirmReset(false), 3000);
    }
  };

  return (
    <aside className="min-w-[256px] h-full border-r border-border/50 bg-card/20 flex flex-col shrink-0 pt-12 overflow-hidden">
      {/* World info */}
      <div className="p-4 space-y-2 group">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            World
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors lg:hidden"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <AnimatePresence mode="wait">
          {world ? (
            <motion.div
              key="world-info"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-1.5"
            >
              <p className="text-sm font-medium">{world.world_name as string}</p>
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                <div>Time: {world.world_time as string ?? "?"}</div>
                <div>Mood: {world.mood as string ?? "?"}</div>
              </div>
            </motion.div>
          ) : (
            <motion.p
              key="world-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-muted-foreground/50 italic"
            >
              Loading...
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <Separator className="bg-border/30" />

      {/* Director */}
      <div className="px-4 pt-3 pb-1">
        <motion.button
          onClick={() => {
            if (game.directorMode) {
              actions.toggleDirectorMode?.();
            } else {
              if (game.attachedTo) actions.detach();
              actions.toggleDirectorMode?.();
            }
          }}
          whileTap={{ scale: 0.98 }}
          layout
          className={`w-full text-left p-2 rounded-lg transition-all duration-200 group ${
            game.directorMode
              ? "bg-amber-500/15 border border-amber-500/30"
              : "hover:bg-secondary/50 border border-transparent"
          }`}
        >
          <div className="flex items-center gap-2">
            <svg
              className={`w-4 h-4 shrink-0 ${game.directorMode ? "text-amber-400" : "text-muted-foreground/50 group-hover:text-muted-foreground"}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 11l18-5v12L3 13v-2z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
            <span className={`text-sm font-medium ${game.directorMode ? "text-amber-400" : "text-foreground/80 group-hover:text-foreground"}`}>
              Director
            </span>
            {game.directorMode && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-auto"
              />
            )}
          </div>
        </motion.button>
      </div>

      <Separator className="bg-border/30" />

      {/* Characters */}
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Characters
        </h2>
        {onAddCharacter && (
          <motion.button
            onClick={onAddCharacter}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add
          </motion.button>
        )}
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-1.5 pb-4">

          <AnimatePresence mode="popLayout">
            {game.characterNames.map((name, index) => {
              const info = game.characterDetails[name];
              const isAttached = name === game.attachedTo;
              // Get live emotional state from latest page
              const latestPage = game.pages?.[game.pages.length - 1];
              const liveState = latestPage?.characters?.[name]?.emotional_state;

              return (
                <motion.button
                  key={name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                  layout
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (isAttached) {
                      actions.detach();
                    } else {
                      actions.attach(name);
                      onCharacterAttached?.();
                    }
                  }}
                  className={`w-full text-left p-2.5 rounded-lg transition-all duration-200 group ${
                    isAttached
                      ? "bg-primary/15 border border-primary/30"
                      : "hover:bg-secondary/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={isAttached ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                      transition={{ duration: 0.4 }}
                      className={`w-2 h-2 rounded-full shrink-0 ${isAttached ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`}
                    />
                    <span className={`text-sm font-medium flex-1 ${isAttached ? "text-primary" : "text-foreground/80 group-hover:text-foreground"}`}>
                      {name}
                    </span>
                    {/* Delete button - shows on hover for any character */}
                    {onDeleteCharacter && (
                      <span
                        onClick={(e) => handleDelete(name, e)}
                        className={`text-[9px] transition-all ${
                          confirmDelete === name
                            ? "text-destructive font-medium opacity-100"
                            : "opacity-0 group-hover:opacity-100 text-pink-400/70 hover:text-purple-400"
                        }`}
                        title={confirmDelete === name ? "Click again to confirm" : "Remove character"}
                      >
                        {confirmDelete === name ? "Remove?" : "×"}
                      </span>
                    )}
                  </div>
                  <AnimatePresence>
                    {info && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="ml-4 mt-1 text-[10px] text-muted-foreground space-y-0.5 overflow-hidden"
                      >
                        {info.species && !["?", "unknown"].includes(String(info.species).toLowerCase()) ? (
                          <div className="truncate">{String(info.species)}</div>
                        ) : null}
                        {(liveState || info.emotional_state) ? (
                          <motion.div
                            key={String(liveState || info.emotional_state)}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.4 }}
                            className="text-amber-400/60 italic truncate"
                          >
                            {String(liveState || info.emotional_state)}
                          </motion.div>
                        ) : null}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Mentioned NPCs — available to promote */}
      {potentialCharacters && potentialCharacters.length > 0 && onGrabCharacter && (
        <>
          <Separator className="bg-border/30" />
          <div className="p-4 pb-2">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground/50 font-semibold mb-2">
              Mentioned
            </h2>
            <div className="space-y-1">
              {potentialCharacters.map(pc => (
                <motion.button
                  key={pc.name}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onGrabCharacter(pc.name)}
                  className="w-full text-left p-2 rounded-lg hover:bg-secondary/50 border border-transparent hover:border-primary/20 transition-all group"
                  title={pc.description || `First appeared on page ${pc.first_page}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground/60 group-hover:text-foreground/80">{pc.name}</span>
                    <span className="text-[9px] text-primary/40 group-hover:text-primary/70 font-mono">grab</span>
                  </div>
                  {pc.description && (
                    <p className="text-[10px] text-muted-foreground/40 truncate mt-0.5">{pc.description}</p>
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Reset Book button */}
      {onResetBook && (
        <>
          <Separator className="bg-border/30" />
          <div className="p-4">
            <motion.button
              onClick={handleReset}
              animate={confirmReset ? { scale: [1, 1.02, 1] } : {}}
              transition={{ duration: 0.3 }}
              className={`w-full text-left px-3 py-2 rounded-lg transition-all text-xs ${
                confirmReset
                  ? "bg-destructive/20 text-destructive border border-destructive/50 font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50 border border-transparent"
              }`}
            >
              {confirmReset ? "Click again to confirm reset" : "Reset Book"}
            </motion.button>
          </div>
        </>
      )}

    </aside>
  );
}

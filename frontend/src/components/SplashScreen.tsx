import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

type Props = {
  onComplete: () => void;
  showIntro?: boolean; // Show "Motherhaven presents" for first-time visitors
};

export function SplashScreen({ onComplete, showIntro = false }: Props) {
  const [phase, setPhase] = useState<"intro" | "logo" | "stamp" | "exit">(
    showIntro ? "intro" : "logo"
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (showIntro) {
      // Intro phase: "Motherhaven presents" (0-2.5s)
      // Then transition to logo
      timers.push(setTimeout(() => setPhase("logo"), 2500));
      // Phase 2: ALPHA stamps in (2.5 + 1.5 = 4s)
      timers.push(setTimeout(() => setPhase("stamp"), 4000));
      // Phase 3: Exit (2.5 + 2.8 = 5.3s)
      timers.push(setTimeout(() => setPhase("exit"), 5300));
      // Complete (2.5 + 3.5 = 6s)
      timers.push(setTimeout(() => onComplete(), 6000));
    } else {
      // No intro - original timing
      timers.push(setTimeout(() => setPhase("stamp"), 1500));
      timers.push(setTimeout(() => setPhase("exit"), 2800));
      timers.push(setTimeout(() => onComplete(), 3500));
    }

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [onComplete, showIntro]);

  return (
    <AnimatePresence mode="wait">
      {/* Motherhaven presents intro */}
      {phase === "intro" && (
        <motion.div
          key="intro"
          className="fixed inset-0 flex items-center justify-center overflow-hidden bg-background z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <motion.p
              className="text-lg sm:text-xl text-muted-foreground/40 font-light tracking-widest"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{ duration: 2.2, times: [0, 0.3, 0.7, 1] }}
            >
              MOTHERHAVEN
            </motion.p>
            <motion.p
              className="text-xs text-muted-foreground/25 tracking-[0.3em] mt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{ duration: 2.2, times: [0, 0.35, 0.65, 1], delay: 0.2 }}
            >
              presents
            </motion.p>
          </motion.div>
        </motion.div>
      )}

      {/* Main splash */}
      {phase !== "exit" && phase !== "intro" && (
        <motion.div
          key="main"
          className="fixed inset-0 flex items-center justify-center overflow-hidden bg-background z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
        >
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

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center">
            {/* Logo */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
              className="text-center"
            >
              <h1 className="text-7xl sm:text-8xl font-bold tracking-tighter bg-gradient-to-r from-primary via-[oklch(0.7_0.2_350)] to-primary bg-clip-text text-transparent">
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

            {/* ALPHA Stamp */}
            <AnimatePresence>
              {phase === "stamp" && (
                <motion.div
                  className="absolute top-full mt-8"
                  initial={{ opacity: 0, scale: 1.8, y: -40, rotate: -8 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    rotate: -3,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 15,
                    mass: 1.2,
                  }}
                >
                  {/* Screen shake container */}
                  <motion.div
                    animate={{ x: [0, -3, 3, -2, 2, 0] }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                  >
                    {/* Glow pulse behind */}
                    <motion.div
                      className="absolute inset-0 blur-xl bg-primary/40"
                      initial={{ opacity: 0.8 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: 1, delay: 0.2 }}
                    />

                    {/* The stamp text */}
                    <motion.span
                      className="relative block font-[var(--font-display)] text-5xl sm:text-6xl tracking-wider text-transparent"
                      style={{
                        WebkitTextStroke: "2px oklch(0.65 0.22 340)",
                      }}
                      initial={{ filter: "blur(4px)" }}
                      animate={{ filter: "blur(0px)" }}
                      transition={{ duration: 0.2 }}
                    >
                      ALPHA
                      {/* Inner glow on impact */}
                      <motion.span
                        className="absolute inset-0 font-[var(--font-display)] text-5xl sm:text-6xl tracking-wider text-primary/30"
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 0.8, delay: 0.1 }}
                      >
                        ALPHA
                      </motion.span>
                    </motion.span>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

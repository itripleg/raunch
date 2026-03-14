import { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";

type Props = {
  onSubmit: (nickname: string) => void;
};

export function NicknamePrompt({ onSubmit }: Props) {
  const [nickname, setNickname] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(nickname.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit(nickname.trim());
    }
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
          className="text-center mb-12"
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

        {/* Nickname prompt */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex flex-col items-center gap-6"
        >
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="text-sm text-muted-foreground/60"
          >
            what should we call you?
          </motion.p>

          <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
            <motion.input
              ref={inputRef}
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="enter nickname"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.0, duration: 0.6 }}
              className="w-full max-w-64 px-4 py-3 sm:py-2.5 bg-card/50 border border-border/50 rounded-md text-base sm:text-sm text-foreground/90 focus:outline-none focus:border-primary/40 text-center placeholder:text-muted-foreground/30 transition-colors duration-300"
              maxLength={24}
              autoComplete="off"
            />

            <motion.button
              type="submit"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.6 }}
              className="px-8 py-3 sm:py-2.5 text-sm text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 rounded-full transition-all duration-500 hover:shadow-[0_0_30px_oklch(0.65_0.22_340_/_0.12)]"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              join
            </motion.button>
          </form>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.6 }}
            className="text-xs sm:text-[10px] text-muted-foreground/30 mt-2"
          >
            leave blank to join anonymously
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}

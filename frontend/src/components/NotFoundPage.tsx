import { motion } from "motion/react";
import { BookX, ArrowLeft } from "lucide-react";

type Props = {
  onBack: () => void;
};

export function NotFoundPage({ onBack }: Props) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8 relative overflow-hidden">
      {/* Ambient glow */}
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full bg-primary/[0.04] blur-[120px]"
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 max-w-md w-full text-center space-y-8"
      >
        {/* Animated book icon */}
        <motion.div
          className="flex justify-center"
          initial={{ rotate: -8 }}
          animate={{ rotate: [-8, 4, -8] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="relative">
            <BookX className="w-20 h-20 text-primary/30" strokeWidth={1} />
            {/* Page flutter effect */}
            <motion.div
              className="absolute top-2 right-0 w-6 h-12 bg-gradient-to-l from-muted/20 to-transparent rounded-r origin-left"
              animate={{ rotateY: [0, 40, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            />
          </div>
        </motion.div>

        {/* 404 number */}
        <div className="space-y-2">
          <motion.h1
            className="text-7xl sm:text-8xl font-bold tracking-tighter bg-gradient-to-r from-primary via-[oklch(0.7_0.2_350)] to-primary bg-clip-text text-transparent"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            404
          </motion.h1>

          <motion.p
            className="text-xl font-semibold text-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            Wrong chapter, darling.
          </motion.p>
        </div>

        {/* Cheeky description */}
        <motion.div
          className="space-y-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <p className="text-muted-foreground/80 leading-relaxed">
            This page doesn&rsquo;t exist&mdash;yet. Maybe the author got
            distracted writing a steamy scene and forgot to finish the plot.
          </p>
          <p className="text-sm text-muted-foreground/50 italic">
            It happens to the best of us.
          </p>
        </motion.div>

        {/* Back button */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to safety
          </button>
        </motion.div>

        {/* Decorative bottom quote */}
        <motion.p
          className="text-xs text-muted-foreground/30 pt-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          &ldquo;Not all who wander are lost&mdash;but you definitely are.&rdquo;
        </motion.p>
      </motion.div>
    </div>
  );
}

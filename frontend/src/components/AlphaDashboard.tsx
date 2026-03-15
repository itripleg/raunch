import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  MessageSquare,
  Gamepad2,
  BookOpen,
  Vote,
  Wand2,
  Lock,
  Settings,
  ChevronRight,
} from "lucide-react";

type View = "dashboard" | "kanban" | "voting" | "about" | "wizard" | "game";

type Props = {
  onNavigate: (view: View) => void;
  isAdmin: boolean;
  onOpenSettings: () => void;
  apiUrl: string;
};

type HeroMessage = {
  content: string;
  updated_at: string;
};

export function AlphaDashboard({ onNavigate, isAdmin, onOpenSettings, apiUrl }: Props) {
  const [heroMessage, setHeroMessage] = useState<HeroMessage | null>(null);
  const [isEditingHero, setIsEditingHero] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch hero message
  useEffect(() => {
    fetch(`${apiUrl}/api/v1/alpha/message`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) setHeroMessage(data);
      })
      .catch(() => {
        // API not available, use fallback
        setHeroMessage({
          content: "Welcome to the Raunch alpha! We're building the future of adult interactive fiction. Your feedback shapes what we create.",
          updated_at: new Date().toISOString(),
        });
      });
  }, [apiUrl]);

  const handleSaveHero = async () => {
    setSaveError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/alpha/message`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setHeroMessage(data);
        setIsEditingHero(false);
      } else {
        setSaveError("Failed to save");
      }
    } catch {
      setSaveError("Server unavailable");
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Updated today";
    if (diffDays === 1) return "Updated yesterday";
    if (diffDays < 7) return `Updated ${diffDays} days ago`;
    return `Updated ${date.toLocaleDateString()}`;
  };

  const cards = [
    {
      id: "game",
      title: "Play Raunch",
      subtitle: "Dive into your story",
      icon: Gamepad2,
      color: "from-violet-500/30 via-fuchsia-500/20 to-primary/20",
      borderColor: "border-violet-400/50",
      hoverGlow: "hover:shadow-[0_0_60px_oklch(0.6_0.25_300_/_0.3)]",
      onClick: () => onNavigate("game"),
      featured: true,
    },
    {
      id: "kanban",
      title: "Feedback",
      subtitle: "Shape the roadmap",
      icon: MessageSquare,
      color: "from-primary/20 to-primary/5",
      borderColor: "border-primary/30",
      hoverGlow: "hover:shadow-[0_0_40px_oklch(0.65_0.22_340_/_0.15)]",
      onClick: () => onNavigate("kanban"),
    },
    {
      id: "about",
      title: "About",
      subtitle: "Getting started",
      icon: BookOpen,
      color: "from-jade/20 to-jade/5",
      borderColor: "border-jade/30",
      hoverGlow: "hover:shadow-[0_0_40px_oklch(0.6_0.15_160_/_0.15)]",
      onClick: () => onNavigate("about"),
    },
    {
      id: "voting",
      title: "Voting",
      subtitle: "Polls & preferences",
      icon: Vote,
      color: "from-amber-500/20 to-amber-500/5",
      borderColor: "border-amber-500/30",
      hoverGlow: "hover:shadow-[0_0_40px_oklch(0.7_0.18_60_/_0.15)]",
      onClick: () => onNavigate("voting"),
    },
    {
      id: "wizard",
      title: "Smut Wizard",
      subtitle: "Generate scenarios",
      icon: Wand2,
      color: "from-fuchsia-500/20 to-fuchsia-500/5",
      borderColor: "border-fuchsia-500/30",
      hoverGlow: "hover:shadow-[0_0_40px_oklch(0.65_0.25_320_/_0.15)]",
      onClick: () => onNavigate("wizard"),
    },
    {
      id: "storage",
      title: "Smut Storage",
      subtitle: "Coming soon",
      icon: Lock,
      color: "from-muted/30 to-muted/10",
      borderColor: "border-border",
      hoverGlow: "",
      disabled: true,
      onClick: () => {},
    },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-[oklch(0.05_0.02_340)]" />
        <motion.div
          className="absolute top-0 right-1/4 w-[600px] h-[600px] rounded-full bg-primary/[0.02] blur-[200px]"
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-1/3 left-0 w-[400px] h-[400px] rounded-full bg-violet-500/[0.015] blur-[150px]"
          animate={{
            scale: [1.1, 1, 1.1],
            opacity: [0.2, 0.3, 0.2],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        />
      </div>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="relative z-10 flex items-center justify-between px-6 sm:px-8 py-6"
      >
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-primary to-[oklch(0.7_0.2_350)] bg-clip-text text-transparent">
              RAUNCH
            </span>
          </h1>
          <span
            className="font-[var(--font-display)] text-sm tracking-wider text-primary/60"
            style={{ WebkitTextStroke: "0.5px currentColor", color: "transparent" }}
          >
            ALPHA
          </span>
        </div>

        <button
          onClick={onOpenSettings}
          className="p-2 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
        >
          <Settings className="w-5 h-5" />
        </button>
      </motion.header>

      {/* Main content */}
      <main className="relative z-10 px-6 sm:px-8 pb-12 max-w-5xl mx-auto">
        {/* Hero Message */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mb-12"
        >
          <div className="relative group">
            {/* Decorative line */}
            <div className="absolute -left-4 top-0 bottom-0 w-px bg-gradient-to-b from-primary/50 via-primary/20 to-transparent" />

            <div className="pl-4">
              {isEditingHero && isAdmin ? (
                <div className="space-y-4">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-card/50 border border-border rounded-lg p-4 text-lg text-foreground/80 focus:outline-none focus:border-primary/50 resize-none"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveHero}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setIsEditingHero(false); setSaveError(null); }}
                      className="px-4 py-2 text-muted-foreground hover:text-foreground text-sm"
                    >
                      Cancel
                    </button>
                    {saveError && (
                      <span className="text-sm text-destructive">{saveError}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => {
                    if (isAdmin) {
                      setEditContent(heroMessage?.content || "");
                      setIsEditingHero(true);
                    }
                  }}
                  className={isAdmin ? "cursor-pointer" : ""}
                >
                  <p className="text-xl sm:text-2xl text-foreground/80 font-light leading-relaxed">
                    {heroMessage?.content || "Loading..."}
                  </p>
                  {heroMessage?.updated_at && (
                    <p className="mt-4 text-xs text-muted-foreground/40">
                      {formatDate(heroMessage.updated_at)}
                      {isAdmin && (
                        <span className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          (click to edit)
                        </span>
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.section>

        {/* Cards Grid */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {cards.map((card, index) => (
              <motion.button
                key={card.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.6 + index * 0.1 }}
                onClick={card.onClick}
                disabled={card.disabled}
                className={`
                  group relative overflow-hidden rounded-2xl border ${card.borderColor}
                  bg-gradient-to-br ${card.color}
                  text-left transition-all duration-500
                  ${card.disabled
                    ? "opacity-50 cursor-not-allowed p-6 sm:p-8"
                    : `hover:scale-[1.02] hover:border-opacity-60 ${card.hoverGlow} p-6 sm:p-8`
                  }
                  ${card.featured ? "sm:col-span-2 lg:col-span-1 p-8 sm:p-10" : ""}
                `}
              >
                {/* Background pattern */}
                <div className="absolute inset-0 opacity-[0.03]">
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)`,
                      backgroundSize: "24px 24px",
                    }}
                  />
                </div>

                {/* Featured card shimmer effect */}
                {card.featured && (
                  <motion.div
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12"
                    animate={{ x: ["-100%", "200%"] }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      repeatDelay: 3,
                      ease: "easeInOut",
                    }}
                  />
                )}

                {/* Icon */}
                <div className="relative mb-6">
                  <card.icon
                    className={`${card.featured ? "w-10 h-10 text-violet-400" : "w-8 h-8"} ${card.disabled ? "text-muted-foreground/40" : card.featured ? "" : "text-foreground/70"}`}
                  />
                </div>

                {/* Content */}
                <div className="relative">
                  <h3 className={`font-semibold mb-1 ${card.featured ? "text-2xl bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent" : "text-xl"} ${card.disabled ? "text-muted-foreground/60" : card.featured ? "" : "text-foreground"}`}>
                    {card.title}
                  </h3>
                  <p className={`text-sm ${card.featured ? "text-violet-300/60" : "text-muted-foreground/60"}`}>
                    {card.subtitle}
                  </p>
                </div>

                {/* Arrow indicator */}
                {!card.disabled && (
                  <div className={`absolute ${card.featured ? "bottom-8 right-8" : "bottom-6 right-6"} opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0`}>
                    <ChevronRight className={`${card.featured ? "w-6 h-6 text-violet-400/60" : "w-5 h-5 text-foreground/40"}`} />
                  </div>
                )}

                {/* Coming soon badge */}
                {card.disabled && (
                  <div className="absolute top-4 right-4">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">
                      Soon
                    </span>
                  </div>
                )}
              </motion.button>
            ))}
          </div>
        </motion.section>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.2 }}
          className="mt-16 text-center"
        >
          <p className="text-[10px] text-muted-foreground/25">
            © 2026 Built with 😈 by Motherhaven. For MoHa
          </p>
        </motion.footer>
      </main>
    </div>
  );
}

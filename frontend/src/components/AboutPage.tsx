import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Sparkles, Terminal, Users, MessageCircle } from "lucide-react";

type Props = {
  onBack: () => void;
  isAdmin: boolean;
  apiUrl: string;
};

export function AboutPage({ onBack, isAdmin, apiUrl }: Props) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    // Try to fetch from API, fall back to default
    fetch(`${apiUrl}/api/v1/alpha/content/about`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.content) setContent(data.content);
      })
      .catch(() => {});
  }, [apiUrl]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center gap-4 px-4 sm:px-6 py-4 max-w-3xl mx-auto">
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-semibold text-foreground">About</h1>
        </div>
      </header>

      {/* Content */}
      <main className="p-6 sm:p-8 max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-12"
        >
          {/* Hero */}
          <section className="text-center space-y-4">
            <h2 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-primary via-[oklch(0.7_0.2_350)] to-primary bg-clip-text text-transparent">
              Welcome to Raunch
            </h2>
            <p className="text-lg text-muted-foreground/80 max-w-xl mx-auto">
              Adult interactive fiction powered by AI. Create immersive stories,
              shape compelling characters, and explore narratives without limits.
            </p>
          </section>

          {/* Features */}
          <section className="grid gap-6 sm:grid-cols-2">
            <FeatureCard
              icon={Sparkles}
              title="AI-Powered Narratives"
              description="Every story adapts to your choices. The AI narrator crafts unique scenes based on your characters and decisions."
            />
            <FeatureCard
              icon={Users}
              title="Rich Characters"
              description="Create detailed characters with personalities, relationships, and desires. Watch them come alive in the story."
            />
            <FeatureCard
              icon={Terminal}
              title="CLI & Web"
              description="Play in the terminal with 'raunch start' or use this web interface. Both offer the full experience."
            />
            <FeatureCard
              icon={MessageCircle}
              title="Alpha Feedback"
              description="You're helping shape Raunch. Use the feedback board and voting to influence what we build next."
            />
          </section>

          {/* Getting Started */}
          <section className="space-y-6">
            <h3 className="text-xl font-semibold text-foreground">Getting Started</h3>

            <div className="space-y-4 text-sm text-muted-foreground/80">
              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">1. Start a scenario</h4>
                <p>
                  Click "Play Raunch" from the dashboard. Choose from pre-made scenarios
                  or generate a random one. Each scenario sets the stage for your story.
                </p>
              </div>

              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">2. Meet your characters</h4>
                <p>
                  The sidebar shows all characters in the scene. Click any character
                  to see their details. Add new characters or promote NPCs as the story evolves.
                </p>
              </div>

              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">3. Shape the narrative</h4>
                <p>
                  Watch the story unfold in the main feed. Use the controls to pause,
                  adjust pacing, or steer the direction. The narrator responds to the world state.
                </p>
              </div>

              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">4. Give feedback</h4>
                <p>
                  Found a bug? Have an idea? Visit the Feedback Board to submit requests
                  or upvote existing ones. Your input directly shapes development priorities.
                </p>
              </div>
            </div>
          </section>

          {/* Known Limitations */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-foreground">Known Limitations</h3>
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl text-sm text-muted-foreground/80 space-y-2">
              <p><strong className="text-amber-400">Alpha software.</strong> Expect rough edges, bugs, and incomplete features.</p>
              <p><strong className="text-foreground/80">No persistence yet.</strong> Stories aren't saved between sessions (coming soon).</p>
              <p><strong className="text-foreground/80">Single LLM.</strong> Currently uses one AI provider. More options planned.</p>
              <p><strong className="text-foreground/80">Content filters.</strong> Some AI providers may limit explicit content generation.</p>
            </div>
          </section>

          {/* Contact */}
          <section className="text-center space-y-4 pb-8">
            <p className="text-sm text-muted-foreground/50">
              Questions? Feedback? Use the Feedback Board or reach out directly.
            </p>
            <p className="text-xs text-muted-foreground/30">
              Raunch Alpha &middot; Built with care for adults who appreciate good fiction
            </p>
          </section>
        </motion.div>
      </main>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 bg-card/30 border border-border rounded-xl space-y-3">
      <Icon className="w-6 h-6 text-primary" />
      <h4 className="font-medium text-foreground">{title}</h4>
      <p className="text-sm text-muted-foreground/70 leading-relaxed">{description}</p>
    </div>
  );
}

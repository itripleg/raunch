import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Sparkles, Users, MessageCircle, Eye, Wand2, Theater, Cpu, Globe, Zap } from "lucide-react";

type Props = {
  onBack: () => void;
  isAdmin: boolean;
  apiUrl: string;
};

export function AboutPage({ onBack, isAdmin: _isAdmin, apiUrl }: Props) {
  const [_content, setContent] = useState<string | null>(null);

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
              icon={Eye}
              title="Inner Thoughts"
              description="Attach to any character to see their private inner thoughts, emotional state, and evolving desires—hidden from other players."
            />
            <FeatureCard
              icon={Theater}
              title="Director Mode"
              description="Step back as the director to see the full scene: all character actions, emotions, and world events. Guide the narrative without being a character."
            />
            <FeatureCard
              icon={Users}
              title="Multiplayer"
              description="Play with friends in real-time. Turn-based sessions with player presence, ready states, and synchronized storytelling across multiple readers."
            />
            <FeatureCard
              icon={MessageCircle}
              title="Influence System"
              description="Whisper to your attached character to subtly guide their actions. They'll incorporate your influence naturally into the story."
            />
            <FeatureCard
              icon={Wand2}
              title="Smut Wizard"
              description="Generate scenarios from 25 settings, 18 pairings, 30+ kinks, and 11 vibes. Roll for instant inspiration or craft your perfect setup."
            />
            <FeatureCard
              icon={Cpu}
              title="Agent Modes"
              description="Three AI modes: Default (sequential), Dual (narrator + batch), or Unified (single call). Trade off between coherence and speed."
            />
            <FeatureCard
              icon={Globe}
              title="NPC Detection"
              description="The narrator naturally introduces new characters. Detected NPCs appear in the sidebar—promote them to full characters with one click."
            />
            <FeatureCard
              icon={Zap}
              title="Live Streaming"
              description="Watch narration and dialogue appear in real-time with typewriter effects. Intensity markers highlight mood shifts as scenes unfold."
            />
          </section>

          {/* Getting Started */}
          <section className="space-y-6">
            <h3 className="text-xl font-semibold text-foreground">Getting Started</h3>

            <div className="space-y-4 text-sm text-muted-foreground/80">
              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">1. Generate or load a scenario</h4>
                <p>
                  Use the <strong className="text-primary">Smut Wizard</strong> to generate a scenario with your preferred
                  settings, kinks, and vibe—or start from the CLI with <code className="text-primary/80">raunch start --scenario name</code>.
                </p>
              </div>

              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">2. Attach to a character</h4>
                <p>
                  Click any character in the sidebar to attach. You'll see their <strong className="text-primary">inner thoughts</strong> and
                  emotional state—private details hidden from other players. Use the input to whisper influence.
                </p>
              </div>

              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">3. Or become the Director</h4>
                <p>
                  Click <strong className="text-amber-400">Director</strong> to see the full scene from above.
                  View all character actions and events. Send narrative guidance to steer where the story goes.
                </p>
              </div>

              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">4. Add or promote characters</h4>
                <p>
                  Click <strong className="text-primary">+ Add</strong> to create new characters, or look for detected NPCs in the sidebar.
                  When the narrator mentions someone interesting, they'll appear as a potential character you can <strong className="text-primary">promote</strong> with one click.
                </p>
              </div>

              <div className="p-4 bg-card/50 border border-border rounded-xl space-y-3">
                <h4 className="font-medium text-foreground">5. Give us feedback</h4>
                <p>
                  Found a bug? Have an idea? Visit the <strong className="text-primary">Feedback Board</strong> to submit requests
                  or upvote existing ones. Your input directly shapes what we build next.
                </p>
              </div>
            </div>
          </section>

          {/* Known Limitations */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-foreground">Known Limitations</h3>
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl text-sm text-muted-foreground/80 space-y-2">
              <p><strong className="text-amber-400">Alpha software.</strong> Expect rough edges, bugs, and incomplete features.</p>
              <p><strong className="text-foreground/80">Refusal handling.</strong> AI may occasionally decline explicit content. The system auto-retries, but some requests may still be filtered.</p>
              <p><strong className="text-foreground/80">Context limits.</strong> Very long sessions may lose early story details as the AI's context window fills.</p>
            </div>
          </section>

          {/* Under the Hood */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-foreground">Under the Hood</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <StatCard label="Agent Modes" value="3" />
              <StatCard label="Scenarios" value="6+" />
              <StatCard label="Flavor Options" value="80+" />
              <StatCard label="WebSocket Commands" value="20+" />
            </div>
            <div className="p-4 bg-card/30 border border-border rounded-xl text-sm text-muted-foreground/70 space-y-2">
              <p><strong className="text-foreground/80">Backend:</strong> Python, FastAPI, WebSockets, Claude AI</p>
              <p><strong className="text-foreground/80">Frontend:</strong> React, TypeScript, TailwindCSS, Framer Motion</p>
              <p><strong className="text-foreground/80">Database:</strong> SQLite (local) or Firestore (cloud)</p>
              <p><strong className="text-foreground/80">Real-time:</strong> Full WebSocket sync for multiplayer and streaming</p>
            </div>
          </section>

          {/* Privacy Note */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-foreground">Privacy Note</h3>
            <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl text-sm text-muted-foreground/80 space-y-2">
              <p>
                During the alpha, stories are stored in a shared database. The developer (and potentially other players
                in multiplayer sessions) can see story content. It's currently anonymous—there's no way to trace stories
                back to specific users.
              </p>
              <p className="text-foreground/70">
                That said, maybe don't put your social security number, real address, or bank details in your smut.
                Keep it fictional, keep it fun.
              </p>
            </div>
          </section>

          {/* Footer */}
          <section className="text-center space-y-4 pb-8">
            <p className="text-sm text-muted-foreground/50">
              Questions? Feedback? Use the Feedback Board or reach out directly.
            </p>
            <p className="text-[10px] text-muted-foreground/25 mt-4">
              © 2026 Built with 😈 by Motherhaven. For MoHa
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-card/30 border border-border rounded-lg">
      <div className="text-xl font-bold text-primary">{value}</div>
      <div className="text-xs text-muted-foreground/60">{label}</div>
    </div>
  );
}

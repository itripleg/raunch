import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  wsUrl: string;
  onUrlChange: (url: string) => void;
  onConnect: () => void;
  connecting: boolean;
};

export function ConnectScreen({ wsUrl, onUrlChange, onConnect, connecting }: Props) {
  const [showUrl, setShowUrl] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background atmosphere */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-[oklch(0.1_0.04_340)]" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/3 w-64 h-64 rounded-full bg-violet/5 blur-[100px]" />

      <div className="relative z-10 text-center space-y-8">
        {/* Logo */}
        <div className="space-y-2">
          <h1 className="text-6xl font-bold tracking-tighter bg-gradient-to-r from-primary via-[oklch(0.7_0.2_350)] to-primary bg-clip-text text-transparent">
            RAUNCH
          </h1>
          <p className="text-muted-foreground text-sm tracking-[0.3em] uppercase">
            Adult Interactive Fiction Engine
          </p>
        </div>

        {/* Divider */}
        <div className="w-24 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent mx-auto" />

        {/* Connect */}
        <div className="space-y-4">
          <Button
            size="lg"
            onClick={onConnect}
            disabled={connecting}
            className="px-12 py-6 text-lg bg-primary/90 hover:bg-primary transition-all duration-300 hover:shadow-[0_0_30px_oklch(0.65_0.22_340_/_0.3)]"
          >
            {connecting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Connecting...
              </span>
            ) : (
              "Connect to Server"
            )}
          </Button>

          {showUrl ? (
            <div className="space-y-2">
              <input
                type="text"
                value={wsUrl}
                onChange={(e) => onUrlChange(e.target.value)}
                className="w-72 px-4 py-2 bg-card border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                placeholder="ws://127.0.0.1:7667"
              />
            </div>
          ) : (
            <button
              onClick={() => setShowUrl(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Change server address
            </button>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/50 pt-8">
          Start the server first:{" "}
          <code className="text-primary/60 font-mono">raunch start</code>
        </p>
      </div>
    </div>
  );
}

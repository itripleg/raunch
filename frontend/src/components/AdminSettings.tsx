import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Shield, ShieldCheck } from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onAdminChange: (isAdmin: boolean) => void;
  apiUrl: string;
};

export function AdminSettings({ isOpen, onClose, isAdmin, onAdminChange, apiUrl }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  // Clear state when opening
  useEffect(() => {
    if (isOpen) {
      setCode("");
      setError("");
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setChecking(true);
    setError("");

    // Hardcoded fallback for alpha testing (API not implemented yet)
    if (code.trim() === "raunch-alpha-dev") {
      onAdminChange(true);
      localStorage.setItem("raunch_admin", "true");
      onClose();
      setChecking(false);
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/alpha/admin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (!res.ok) {
        setError("Invalid code");
        return;
      }

      const data = await res.json();

      if (data.valid) {
        onAdminChange(true);
        localStorage.setItem("raunch_admin", "true");
        onClose();
      } else {
        setError("Invalid code");
      }
    } catch {
      setError("Could not verify code");
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = () => {
    onAdminChange(false);
    localStorage.removeItem("raunch_admin");
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm z-50"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">Settings</h2>
                <button
                  onClick={onClose}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6">
                {isAdmin ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-primary">
                      <ShieldCheck className="w-5 h-5" />
                      <span className="text-sm font-medium">Admin mode active</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      You have access to admin features: editing hero messages,
                      managing kanban items, and creating polls.
                    </p>
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                    >
                      Exit admin mode
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <Shield className="w-5 h-5" />
                      <span className="text-sm font-medium">Developer access</span>
                    </div>

                    <div className="space-y-2">
                      <input
                        type="password"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Enter dev code"
                        className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
                        autoFocus
                      />
                      {error && (
                        <p className="text-xs text-destructive">{error}</p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={checking || !code.trim()}
                      className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                    >
                      {checking ? "Verifying..." : "Verify"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ShieldCheck, Bug, LogOut } from "lucide-react";
import { useKindeAuth } from "@kinde-oss/kinde-auth-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenDebug?: () => void;
};

export function AdminSettings({ isOpen, onClose, onOpenDebug }: Props) {
  const { user, logout } = useKindeAuth();

  // Clear state when opening
  useEffect(() => {
    if (isOpen) {
      // Nothing to clear now that we use Kinde
    }
  }, [isOpen]);

  const handleLogout = () => {
    logout();
    onClose();
  };

  const handleOpenDebug = () => {
    onClose();
    onOpenDebug?.();
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
              <div className="p-6 space-y-6">
                {/* Auth Status */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-primary">
                    <ShieldCheck className="w-5 h-5" />
                    <span className="text-sm font-medium">Authenticated</span>
                  </div>
                  {user && (
                    <div className="pl-8 space-y-1">
                      {user.email && (
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      )}
                      {(user.given_name || user.family_name) && (
                        <p className="text-xs text-foreground/70">
                          {[user.given_name, user.family_name].filter(Boolean).join(" ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="space-y-3">
                  {/* Debug Panel */}
                  {onOpenDebug && (
                    <button
                      onClick={handleOpenDebug}
                      className="w-full flex items-center gap-3 px-4 py-3 border border-border rounded-lg text-sm text-foreground hover:bg-muted/20 transition-colors"
                    >
                      <Bug className="w-4 h-4 text-amber-400" />
                      <span>Open Debug Panel</span>
                    </button>
                  )}

                  {/* Logout */}
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 border border-destructive/30 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

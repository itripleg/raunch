import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ShieldCheck, Bug, LogOut, Key, Plus, Trash2, Check, Loader2, RefreshCw } from "lucide-react";
import { useKindeAuth } from "@kinde-oss/kinde-auth-react";

const ADMIN_EMAIL = "joshua.bell.828@gmail.com";

type TokenInfo = {
  name: string;
  preview: string;
  status: string;
  reset_time?: string;
  active: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenDebug?: () => void;
  apiUrl?: string;
};

export function AdminSettings({ isOpen, onClose, onOpenDebug, apiUrl = "http://localhost:8000" }: Props) {
  const { user, logout } = useKindeAuth();
  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenValue, setNewTokenValue] = useState("");
  const [checkingToken, setCheckingToken] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/tokens`);
      if (res.ok) {
        const data = await res.json();
        setTokens(data);
      }
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (isOpen && isAdmin) {
      fetchTokens();
    }
  }, [isOpen, isAdmin, fetchTokens]);

  // Listen for OAuth callback messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "oauth-callback") {
        fetchTokens();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fetchTokens]);

  const handleLogout = () => {
    logout();
    onClose();
  };

  const handleOpenDebug = () => {
    onClose();
    onOpenDebug?.();
  };

  const handleOAuthLogin = () => {
    window.open(`${apiUrl}/oauth/start`, "oauth", "width=600,height=700");
  };

  const handleAddToken = async () => {
    if (!newTokenName.trim() || !newTokenValue.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTokenName.trim(), token: newTokenValue.trim() }),
      });
      if (res.ok) {
        setNewTokenName("");
        setNewTokenValue("");
        fetchTokens();
      }
    } catch (err) {
      console.error("Failed to add token:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivateToken = async (name: string) => {
    setLoading(true);
    try {
      await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}/activate`, { method: "POST" });
      fetchTokens();
    } catch (err) {
      console.error("Failed to activate token:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteToken = async (name: string) => {
    if (!confirm(`Delete token "${name}"?`)) return;
    try {
      await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}`, { method: "DELETE" });
      fetchTokens();
    } catch (err) {
      console.error("Failed to delete token:", err);
    }
  };

  const handleCheckToken = async (name: string) => {
    setCheckingToken(name);
    try {
      await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}/check`, { method: "POST" });
      fetchTokens();
    } catch (err) {
      console.error("Failed to check token:", err);
    } finally {
      setCheckingToken(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">Settings</h2>
                <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto">
                {/* Auth Status */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-primary">
                    <ShieldCheck className="w-5 h-5" />
                    <span className="text-sm font-medium">Authenticated</span>
                    {isAdmin && (
                      <span className="px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">ADMIN</span>
                    )}
                  </div>
                  {user && (
                    <div className="pl-8 space-y-1">
                      {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                      {(user.givenName || user.familyName) && (
                        <p className="text-xs text-foreground/70">
                          {[user.givenName, user.familyName].filter(Boolean).join(" ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* OAuth Manager (Admin Only) */}
                {isAdmin && (
                  <div className="space-y-4 pt-2 border-t border-border">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Key className="w-4 h-4" />
                      <span className="text-sm font-medium">AI Authentication</span>
                    </div>

                    {/* Token Vault */}
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-muted/20 border-b border-border flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Token Vault</span>
                        <span className="text-[10px] text-muted-foreground">{tokens.length} tokens</span>
                      </div>

                      <div className="max-h-40 overflow-y-auto">
                        {tokens.length === 0 ? (
                          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No tokens stored</div>
                        ) : (
                          tokens.map((t) => (
                            <div
                              key={t.name}
                              className={`px-3 py-2 flex items-center gap-2 border-b border-border last:border-b-0 ${
                                t.active ? "bg-primary/5" : ""
                              }`}
                            >
                              {t.active && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                              <span className="text-xs font-medium flex-1 truncate">{t.name}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{t.preview}</span>
                              {t.status === "rate_limited" && (
                                <span className="text-[10px] text-amber-400">limited</span>
                              )}
                              <div className="flex gap-1">
                                {!t.active && (
                                  <button
                                    onClick={() => handleActivateToken(t.name)}
                                    className="p-1 text-muted-foreground hover:text-primary"
                                    title="Use this token"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleCheckToken(t.name)}
                                  disabled={checkingToken === t.name}
                                  className="p-1 text-muted-foreground hover:text-foreground"
                                  title="Check token"
                                >
                                  {checkingToken === t.name ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3 h-3" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleDeleteToken(t.name)}
                                  className="p-1 text-muted-foreground hover:text-destructive"
                                  title="Delete token"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Add Token */}
                      <div className="px-3 py-2 bg-muted/10 border-t border-border flex gap-2">
                        <input
                          type="text"
                          value={newTokenName}
                          onChange={(e) => setNewTokenName(e.target.value)}
                          placeholder="Name"
                          className="w-20 px-2 py-1 text-xs bg-background border border-border rounded"
                        />
                        <input
                          type="password"
                          value={newTokenValue}
                          onChange={(e) => setNewTokenValue(e.target.value)}
                          placeholder="sk-ant-oat..."
                          className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded font-mono"
                        />
                        <button
                          onClick={handleAddToken}
                          disabled={loading || !newTokenName || !newTokenValue}
                          className="p-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* OAuth Login Button */}
                    <button
                      onClick={handleOAuthLogin}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-600/20 to-orange-600/20 border border-amber-500/30 rounded-lg text-sm text-amber-400 hover:border-amber-400 transition-colors"
                    >
                      <Key className="w-4 h-4" />
                      Login with Claude Max
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-3 pt-2 border-t border-border">
                  {onOpenDebug && (
                    <button
                      onClick={handleOpenDebug}
                      className="w-full flex items-center gap-3 px-4 py-3 border border-border rounded-lg text-sm text-foreground hover:bg-muted/20 transition-colors"
                    >
                      <Bug className="w-4 h-4 text-amber-400" />
                      <span>Open Debug Panel</span>
                    </button>
                  )}

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

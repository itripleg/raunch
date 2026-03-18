import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Plus,
  ChevronUp,
  X,
  Check,
  XCircle,
  GripVertical,
  Send,
} from "lucide-react";

type FeedbackStatus = "planned" | "considering" | "requests" | "results";
type Outcome = "shipped" | "declined" | null;

type FeedbackItem = {
  id: number;
  title: string;
  notes: string | null;
  status: FeedbackStatus;
  outcome: Outcome;
  outcome_notes: string | null;
  upvotes: number;
  has_voted?: boolean;
  created_at: string;
};

type Props = {
  onBack: () => void;
  isAdmin: boolean;
  apiUrl: string;
  userEmail?: string;
};

const STATUS_CONFIG: Record<FeedbackStatus, { label: string; color: string; bgColor: string }> = {
  planned: {
    label: "Planned",
    color: "text-violet-400",
    bgColor: "bg-violet-500/10 border-violet-500/20",
  },
  considering: {
    label: "Considering",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/20",
  },
  requests: {
    label: "Requests",
    color: "text-primary",
    bgColor: "bg-primary/10 border-primary/20",
  },
  results: {
    label: "Results",
    color: "text-jade",
    bgColor: "bg-jade/10 border-jade/20",
  },
};

const COLUMNS: FeedbackStatus[] = ["planned", "considering", "requests", "results"];

// Get or create voter ID for this browser
function getVoterId(): string {
  let id = localStorage.getItem("raunch_voter_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("raunch_voter_id", id);
  }
  return id;
}

export function FeedbackKanban({ onBack, isAdmin, apiUrl, userEmail }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [addingTo, setAddingTo] = useState<FeedbackStatus>("requests");
  const [draggedItem, setDraggedItem] = useState<FeedbackItem | null>(null);
  const [activeTab, setActiveTab] = useState<FeedbackStatus>("planned");

  const voterId = getVoterId();

  // Fetch items
  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/alpha/feedback?voter_id=${voterId}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch {
      // API not ready, use mock data
      setItems([
        { id: 1, title: "More character customization", notes: "Hair, clothes, accessories", status: "planned", outcome: null, outcome_notes: null, upvotes: 0, created_at: new Date().toISOString() },
        { id: 2, title: "Save/load game state", notes: null, status: "considering", outcome: null, outcome_notes: null, upvotes: 0, created_at: new Date().toISOString() },
        { id: 3, title: "Dark mode toggle", notes: "Some people want light mode?", status: "requests", outcome: null, outcome_notes: null, upvotes: 5, created_at: new Date().toISOString() },
        { id: 4, title: "Multiplayer support", notes: null, status: "results", outcome: "shipped", outcome_notes: "Added in v0.2!", upvotes: 0, created_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, voterId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Add item
  const handleAddItem = async () => {
    if (!newTitle.trim()) return;

    const status = isAdmin ? addingTo : "requests";

    try {
      const res = await fetch(`${apiUrl}/api/v1/alpha/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          notes: newNotes.trim() || null,
          status,
        }),
      });

      if (res.ok) {
        await fetchItems();
      }
    } catch {
      // Fallback: add locally
      setItems((prev) => [
        ...prev,
        {
          id: Date.now(),
          title: newTitle.trim(),
          notes: newNotes.trim() || null,
          status,
          outcome: null,
          outcome_notes: null,
          upvotes: 0,
          created_at: new Date().toISOString(),
        },
      ]);
    }

    setNewTitle("");
    setNewNotes("");
    setShowAddForm(false);
  };

  // Upvote
  const handleUpvote = async (itemId: number) => {
    try {
      await fetch(`${apiUrl}/api/v1/alpha/feedback/${itemId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voter_id: voterId }),
      });
      await fetchItems();
    } catch {
      // Fallback: toggle locally
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                upvotes: item.has_voted ? item.upvotes - 1 : item.upvotes + 1,
                has_voted: !item.has_voted,
              }
            : item
        )
      );
    }
  };

  // Move item (admin)
  const handleMoveItem = async (itemId: number, newStatus: FeedbackStatus, outcome?: Outcome, outcomeNotes?: string) => {
    if (!isAdmin) return;

    try {
      await fetch(`${apiUrl}/api/v1/alpha/feedback/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          outcome: outcome || null,
          outcome_notes: outcomeNotes || null,
          admin_email: userEmail,
        }),
      });
      await fetchItems();
    } catch {
      // Fallback: move locally
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? { ...item, status: newStatus, outcome: outcome || null, outcome_notes: outcomeNotes || null }
            : item
        )
      );
    }
  };

  // Delete item (admin)
  const handleDeleteItem = async (itemId: number) => {
    if (!isAdmin) return;

    try {
      await fetch(`${apiUrl}/api/v1/alpha/feedback/${itemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_email: userEmail }),
      });
      await fetchItems();
    } catch {
      setItems((prev) => prev.filter((item) => item.id !== itemId));
    }
  };

  const getItemsByStatus = (status: FeedbackStatus) =>
    items
      .filter((item) => item.status === status)
      .sort((a, b) => (status === "requests" ? b.upvotes - a.upvotes : 0));

  // Check if mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-semibold text-foreground">Feedback Board</h1>
          </div>

          <button
            onClick={() => {
              setAddingTo(isAdmin ? "planned" : "requests");
              setShowAddForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{isAdmin ? "Add Item" : "Request"}</span>
          </button>
        </div>

        {/* Mobile tabs */}
        {isMobile && (
          <div className="flex border-t border-border">
            {COLUMNS.map((status) => (
              <button
                key={status}
                onClick={() => setActiveTab(status)}
                className={`flex-1 py-3 text-xs font-medium transition-colors ${
                  activeTab === status
                    ? STATUS_CONFIG[status].color + " border-b-2 border-current"
                    : "text-muted-foreground"
                }`}
              >
                {STATUS_CONFIG[status].label}
                <span className="ml-1 opacity-60">({getItemsByStatus(status).length})</span>
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Content */}
      <main className="p-4 sm:p-6 max-w-7xl mx-auto flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        ) : isMobile ? (
          // Mobile: single column with tabs
          <div className="space-y-3">
            {getItemsByStatus(activeTab).map((item) => (
              <FeedbackCard
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onUpvote={() => handleUpvote(item.id)}
                onMove={(status, outcome, notes) => handleMoveItem(item.id, status, outcome, notes)}
                onDelete={() => handleDeleteItem(item.id)}
              />
            ))}
            {getItemsByStatus(activeTab).length === 0 && (
              <div className="text-center py-12 text-muted-foreground/50 text-sm">
                No items yet
              </div>
            )}
          </div>
        ) : (
          // Desktop: 4 columns, fill remaining viewport
          <div className="grid grid-cols-4 gap-6 h-full">
            {COLUMNS.map((status) => (
              <div
                key={status}
                className="flex flex-col min-h-0"
                onDragOver={(e) => {
                  if (isAdmin && draggedItem) {
                    e.preventDefault();
                  }
                }}
                onDrop={() => {
                  if (isAdmin && draggedItem && draggedItem.status !== status) {
                    if (status === "results") {
                      // Prompt for outcome
                      const outcome = window.confirm("Mark as shipped? (Cancel for declined)") ? "shipped" : "declined";
                      const notes = window.prompt("Add a note (optional):");
                      handleMoveItem(draggedItem.id, status, outcome, notes || undefined);
                    } else {
                      handleMoveItem(draggedItem.id, status);
                    }
                  }
                  setDraggedItem(null);
                }}
              >
                {/* Column header */}
                <div className={`p-3 rounded-lg border ${STATUS_CONFIG[status].bgColor}`}>
                  <div className="flex items-center justify-between">
                    <h2 className={`font-medium ${STATUS_CONFIG[status].color}`}>
                      {STATUS_CONFIG[status].label}
                    </h2>
                    <span className={`text-xs ${STATUS_CONFIG[status].color} opacity-60`}>
                      {getItemsByStatus(status).length}
                    </span>
                  </div>
                </div>

                {/* Items — scrollable independently */}
                <div className="space-y-3 flex-1 overflow-y-auto min-h-0 pr-1">
                  {getItemsByStatus(status).map((item) => (
                    <FeedbackCard
                      key={item.id}
                      item={item}
                      isAdmin={isAdmin}
                      onUpvote={() => handleUpvote(item.id)}
                      onMove={(newStatus, outcome, notes) => handleMoveItem(item.id, newStatus, outcome, notes)}
                      onDelete={() => handleDeleteItem(item.id)}
                      onDragStart={() => setDraggedItem(item)}
                      onDragEnd={() => setDraggedItem(null)}
                      isDragging={draggedItem?.id === item.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add item modal */}
      <AnimatePresence>
        {showAddForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddForm(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50 p-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <h2 className="text-lg font-semibold">
                    {isAdmin ? "Add Item" : "Submit Request"}
                  </h2>
                  <button onClick={() => setShowAddForm(false)} className="p-1 text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  {isAdmin && (
                    <div className="flex gap-2">
                      {COLUMNS.filter((s) => s !== "results").map((status) => (
                        <button
                          key={status}
                          onClick={() => setAddingTo(status)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                            addingTo === status
                              ? STATUS_CONFIG[status].bgColor + " " + STATUS_CONFIG[status].color
                              : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {STATUS_CONFIG[status].label}
                        </button>
                      ))}
                    </div>
                  )}

                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
                    autoFocus
                  />

                  <textarea
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    rows={3}
                    className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50 resize-none"
                  />

                  <button
                    onClick={handleAddItem}
                    disabled={!newTitle.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    {isAdmin ? "Add" : "Submit Request"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Feedback card component
function FeedbackCard({
  item,
  isAdmin,
  onUpvote,
  onMove: _onMove,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  item: FeedbackItem;
  isAdmin: boolean;
  onUpvote: () => void;
  onMove: (status: FeedbackStatus, outcome?: Outcome, notes?: string) => void;
  onDelete: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const [_expanded, _setExpanded] = useState(false);

  return (
    <motion.div
      layout
      draggable={isAdmin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`
        group bg-card/50 border border-border rounded-xl p-4 transition-all
        ${isAdmin ? "cursor-grab active:cursor-grabbing" : ""}
        ${isDragging ? "opacity-50 rotate-2 scale-105" : ""}
        hover:bg-card/80 hover:border-border/80
      `}
    >
      {/* Drag handle for admin */}
      {isAdmin && (
        <div className="absolute -left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-50 transition-opacity">
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
      )}

      {/* Content */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground leading-tight">
            {item.title}
          </h3>
          {isAdmin && (
            <button
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {item.notes && (
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            {item.notes}
          </p>
        )}

        {/* Outcome badge for results */}
        {item.status === "results" && item.outcome && (
          <div className="flex items-center gap-2">
            {item.outcome === "shipped" ? (
              <span className="inline-flex items-center gap-1 text-xs text-jade bg-jade/10 px-2 py-0.5 rounded-full">
                <Check className="w-3 h-3" />
                Shipped
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                <XCircle className="w-3 h-3" />
                Declined
              </span>
            )}
          </div>
        )}

        {item.outcome_notes && (
          <p className="text-xs text-muted-foreground/60 italic">
            {item.outcome_notes}
          </p>
        )}

        {/* Upvote for requests */}
        {item.status === "requests" && (
          <button
            onClick={onUpvote}
            className={`
              inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg transition-colors
              ${item.has_voted
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-primary hover:bg-primary/5"
              }
            `}
          >
            <ChevronUp className="w-3.5 h-3.5" />
            {item.upvotes}
          </button>
        )}
      </div>
    </motion.div>
  );
}

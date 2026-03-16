import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Plus,
  X,
  Check,
  Clock,
  BarChart3,
  Send,
  Sparkles,
} from "lucide-react";

type PollType = "single" | "multi";

type PollOption = {
  id: number;
  label: string;
  vote_count: number;
  submitted_by: string | null;
};

type Poll = {
  id: number;
  question: string;
  poll_type: PollType;
  max_selections: number | null;
  allow_submissions: boolean;
  show_live_results: boolean;
  closes_at: string | null;
  is_closed: boolean;
  options: PollOption[];
  user_votes?: number[];
  created_at: string;
};

type Props = {
  onBack: () => void;
  isAdmin: boolean;
  apiUrl: string;
  userEmail?: string;
};

function getVoterId(): string {
  let id = localStorage.getItem("raunch_voter_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("raunch_voter_id", id);
  }
  return id;
}

export function VotingPolls({ onBack, isAdmin, apiUrl, userEmail }: Props) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number[]>>({});
  const [newSuggestions, setNewSuggestions] = useState<Record<number, string>>({});

  const voterId = getVoterId();

  // Fetch polls
  const fetchPolls = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/alpha/polls?voter_id=${voterId}`);
      if (res.ok) {
        const data = await res.json();
        setPolls(data);
        // Initialize selected options from user_votes
        const selections: Record<number, number[]> = {};
        data.forEach((poll: Poll) => {
          if (poll.user_votes) {
            selections[poll.id] = poll.user_votes;
          }
        });
        setSelectedOptions(selections);
      }
    } catch {
      // Mock data for testing
      setPolls([
        {
          id: 1,
          question: "What kinks should be included as default presets?",
          poll_type: "multi",
          max_selections: 5,
          allow_submissions: true,
          show_live_results: true,
          closes_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          is_closed: false,
          options: [
            { id: 1, label: "Bondage", vote_count: 28, submitted_by: null },
            { id: 2, label: "Roleplay", vote_count: 22, submitted_by: null },
            { id: 3, label: "Voyeurism", vote_count: 19, submitted_by: null },
            { id: 4, label: "Dom/Sub", vote_count: 31, submitted_by: null },
            { id: 5, label: "Exhibitionism", vote_count: 15, submitted_by: "user" },
          ],
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          question: "Preferred narrator voice style?",
          poll_type: "single",
          max_selections: 1,
          allow_submissions: false,
          show_live_results: false,
          closes_at: null,
          is_closed: true,
          options: [
            { id: 6, label: "Poetic & literary", vote_count: 45, submitted_by: null },
            { id: 7, label: "Direct & punchy", vote_count: 32, submitted_by: null },
            { id: 8, label: "Playful & teasing", vote_count: 28, submitted_by: null },
          ],
          created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, voterId]);

  useEffect(() => {
    fetchPolls();
  }, [fetchPolls]);

  // Vote
  const handleVote = async (pollId: number) => {
    const selections = selectedOptions[pollId] || [];
    if (selections.length === 0) return;

    try {
      await fetch(`${apiUrl}/api/v1/alpha/polls/${pollId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voter_id: voterId,
          option_ids: selections,
        }),
      });
      await fetchPolls();
    } catch {
      // Fallback: update locally
      setPolls((prev) =>
        prev.map((poll) =>
          poll.id === pollId
            ? {
                ...poll,
                options: poll.options.map((opt) =>
                  selections.includes(opt.id)
                    ? { ...opt, vote_count: opt.vote_count + 1 }
                    : opt
                ),
                user_votes: selections,
              }
            : poll
        )
      );
    }
  };

  // Add suggestion
  const handleAddSuggestion = async (pollId: number) => {
    const suggestion = newSuggestions[pollId]?.trim();
    if (!suggestion) return;

    try {
      await fetch(`${apiUrl}/api/v1/alpha/polls/${pollId}/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: suggestion,
          submitted_by: voterId,
        }),
      });
      await fetchPolls();
    } catch {
      // Fallback: add locally
      setPolls((prev) =>
        prev.map((poll) =>
          poll.id === pollId
            ? {
                ...poll,
                options: [
                  ...poll.options,
                  {
                    id: Date.now(),
                    label: suggestion,
                    vote_count: 0,
                    submitted_by: "you",
                  },
                ],
              }
            : poll
        )
      );
    }

    setNewSuggestions((prev) => ({ ...prev, [pollId]: "" }));
  };

  // Toggle option selection
  const toggleOption = (pollId: number, optionId: number, poll: Poll) => {
    if (poll.is_closed || poll.user_votes) return;

    setSelectedOptions((prev) => {
      const current = prev[pollId] || [];
      const isSelected = current.includes(optionId);

      if (poll.poll_type === "single") {
        return { ...prev, [pollId]: isSelected ? [] : [optionId] };
      }

      if (isSelected) {
        return { ...prev, [pollId]: current.filter((id) => id !== optionId) };
      }

      if (poll.max_selections && current.length >= poll.max_selections) {
        return prev;
      }

      return { ...prev, [pollId]: [...current, optionId] };
    });
  };

  const formatTimeLeft = (closesAt: string) => {
    const diff = new Date(closesAt).getTime() - Date.now();
    if (diff <= 0) return "Closed";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h left`;
    return `${hours}h left`;
  };

  const getTotalVotes = (options: PollOption[]) =>
    options.reduce((sum, opt) => sum + opt.vote_count, 0);

  const activePolls = polls.filter((p) => !p.is_closed);
  const closedPolls = polls.filter((p) => p.is_closed);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 max-w-3xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-semibold text-foreground">Voting</h1>
          </div>

          {isAdmin && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Poll</span>
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        ) : (
          <>
            {/* Active polls */}
            {activePolls.length > 0 && (
              <section className="space-y-6">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Active Polls
                </h2>

                {activePolls.map((poll) => (
                  <PollCard
                    key={poll.id}
                    poll={poll}
                    selectedOptions={selectedOptions[poll.id] || []}
                    onToggleOption={(optionId) => toggleOption(poll.id, optionId, poll)}
                    onVote={() => handleVote(poll.id)}
                    suggestion={newSuggestions[poll.id] || ""}
                    onSuggestionChange={(value) =>
                      setNewSuggestions((prev) => ({ ...prev, [poll.id]: value }))
                    }
                    onAddSuggestion={() => handleAddSuggestion(poll.id)}
                    formatTimeLeft={formatTimeLeft}
                    getTotalVotes={getTotalVotes}
                  />
                ))}
              </section>
            )}

            {/* Closed polls */}
            {closedPolls.length > 0 && (
              <section className="space-y-6">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Past Polls
                </h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  {closedPolls.map((poll) => (
                    <ClosedPollCard
                      key={poll.id}
                      poll={poll}
                      getTotalVotes={getTotalVotes}
                    />
                  ))}
                </div>
              </section>
            )}

            {polls.length === 0 && (
              <div className="text-center py-20 text-muted-foreground/50">
                No polls yet
              </div>
            )}
          </>
        )}
      </main>

      {/* Create poll modal (admin) */}
      <AnimatePresence>
        {showCreateForm && isAdmin && (
          <CreatePollModal
            onClose={() => setShowCreateForm(false)}
            onCreated={fetchPolls}
            apiUrl={apiUrl}
            userEmail={userEmail}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Active poll card
function PollCard({
  poll,
  selectedOptions,
  onToggleOption,
  onVote,
  suggestion,
  onSuggestionChange,
  onAddSuggestion,
  formatTimeLeft,
  getTotalVotes,
}: {
  poll: Poll;
  selectedOptions: number[];
  onToggleOption: (optionId: number) => void;
  onVote: () => void;
  suggestion: string;
  onSuggestionChange: (value: string) => void;
  onAddSuggestion: () => void;
  formatTimeLeft: (date: string) => string;
  getTotalVotes: (options: PollOption[]) => number;
}) {
  const hasVoted = poll.user_votes && poll.user_votes.length > 0;
  const totalVotes = getTotalVotes(poll.options);
  const canVote = !hasVoted && selectedOptions.length > 0;

  return (
    <motion.div
      layout
      className="bg-card/50 border border-border rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="p-6 pb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h3 className="text-lg font-medium text-foreground leading-snug">
            {poll.question}
          </h3>
          {poll.closes_at && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
              <Clock className="w-3.5 h-3.5" />
              {formatTimeLeft(poll.closes_at)}
            </span>
          )}
        </div>

        {poll.poll_type === "multi" && poll.max_selections && (
          <p className="text-xs text-muted-foreground/60 mb-4">
            Select up to {poll.max_selections} options
          </p>
        )}
      </div>

      {/* Options */}
      <div className="px-6 space-y-2">
        {poll.options.map((option) => {
          const isSelected = selectedOptions.includes(option.id);
          const wasVoted = poll.user_votes?.includes(option.id);
          const percentage = totalVotes > 0 ? (option.vote_count / totalVotes) * 100 : 0;
          const showResults = poll.show_live_results || hasVoted;

          return (
            <button
              key={option.id}
              onClick={() => onToggleOption(option.id)}
              disabled={hasVoted}
              className={`
                relative w-full text-left p-4 rounded-xl border transition-all overflow-hidden
                ${isSelected || wasVoted
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-border/80 bg-card/30"
                }
                ${hasVoted ? "cursor-default" : "cursor-pointer"}
              `}
            >
              {/* Progress bar background */}
              {showResults && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="absolute inset-y-0 left-0 bg-primary/10"
                />
              )}

              <div className="relative flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {/* Checkbox/radio */}
                  <div
                    className={`
                      w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors
                      ${isSelected || wasVoted
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/30"
                      }
                    `}
                  >
                    {(isSelected || wasVoted) && (
                      <Check className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>

                  <span className="text-sm text-foreground">
                    {option.label}
                  </span>

                  {option.submitted_by && (
                    <span className="text-[10px] text-muted-foreground/40 uppercase">
                      Suggested
                    </span>
                  )}
                </div>

                {showResults && (
                  <span className="text-xs text-muted-foreground font-medium">
                    {option.vote_count} ({percentage.toFixed(0)}%)
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Suggestion input */}
      {poll.allow_submissions && !hasVoted && (
        <div className="px-6 pt-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={suggestion}
              onChange={(e) => onSuggestionChange(e.target.value)}
              placeholder="Suggest an option..."
              className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
            />
            <button
              onClick={onAddSuggestion}
              disabled={!suggestion.trim()}
              className="px-3 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Vote button */}
      <div className="p-6 pt-4">
        {!hasVoted ? (
          <button
            onClick={onVote}
            disabled={!canVote}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            <Send className="w-4 h-4" />
            Submit Vote
          </button>
        ) : (
          <p className="text-center text-xs text-muted-foreground/50">
            You voted &middot; {totalVotes} total votes
          </p>
        )}
      </div>
    </motion.div>
  );
}

// Closed poll summary card
function ClosedPollCard({
  poll,
  getTotalVotes,
}: {
  poll: Poll;
  getTotalVotes: (options: PollOption[]) => number;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalVotes = getTotalVotes(poll.options);
  const winner = poll.options.reduce((a, b) => (a.vote_count > b.vote_count ? a : b));
  const winnerPct = totalVotes > 0 ? ((winner.vote_count / totalVotes) * 100).toFixed(0) : 0;

  return (
    <motion.div
      layout
      className="bg-card/30 border border-border rounded-xl p-4 cursor-pointer hover:bg-card/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <h3 className="text-sm font-medium text-foreground mb-2 leading-snug">
        {poll.question}
      </h3>

      {!expanded ? (
        <p className="text-xs text-muted-foreground">
          Winner: <span className="text-foreground">{winner.label}</span> ({winnerPct}%)
        </p>
      ) : (
        <div className="space-y-2 mt-3">
          {poll.options
            .sort((a, b) => b.vote_count - a.vote_count)
            .map((option) => {
              const pct = totalVotes > 0 ? (option.vote_count / totalVotes) * 100 : 0;
              return (
                <div key={option.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-foreground/80">{option.label}</span>
                    <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          <p className="text-xs text-muted-foreground/50 pt-2">
            {totalVotes} total votes
          </p>
        </div>
      )}
    </motion.div>
  );
}

// Create poll modal (admin)
function CreatePollModal({
  onClose,
  onCreated,
  apiUrl,
  userEmail,
}: {
  onClose: () => void;
  onCreated: () => void;
  apiUrl: string;
  userEmail?: string;
}) {
  const [question, setQuestion] = useState("");
  const [pollType, setPollType] = useState<PollType>("single");
  const [maxSelections, setMaxSelections] = useState(3);
  const [allowSubmissions, setAllowSubmissions] = useState(true);
  const [showLiveResults, setShowLiveResults] = useState(true);
  const [options, setOptions] = useState<string[]>(["", ""]);

  const handleCreate = async () => {
    if (!question.trim() || options.filter((o) => o.trim()).length < 2) return;

    try {
      await fetch(`${apiUrl}/api/v1/alpha/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          poll_type: pollType,
          max_selections: pollType === "multi" ? maxSelections : 1,
          allow_submissions: allowSubmissions,
          show_live_results: showLiveResults,
          options: options.filter((o) => o.trim()).map((o) => o.trim()),
          admin_email: userEmail,
        }),
      });
      onCreated();
      onClose();
    } catch {
      // Silent fail for now
      onClose();
    }
  };

  return (
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
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg z-50 p-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold">Create Poll</h2>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Question */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Question</label>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What do you want to ask?"
                className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Poll type */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPollType("single")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pollType === "single"
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "bg-muted/50 text-muted-foreground border border-transparent"
                  }`}
                >
                  Single choice
                </button>
                <button
                  onClick={() => setPollType("multi")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pollType === "multi"
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "bg-muted/50 text-muted-foreground border border-transparent"
                  }`}
                >
                  Multi-select
                </button>
              </div>
            </div>

            {pollType === "multi" && (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Max selections</label>
                <input
                  type="number"
                  value={maxSelections}
                  onChange={(e) => setMaxSelections(parseInt(e.target.value) || 1)}
                  min={1}
                  max={10}
                  className="w-24 px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
                />
              </div>
            )}

            {/* Options */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Options</label>
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const newOpts = [...options];
                        newOpts[i] = e.target.value;
                        setOptions(newOpts);
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 px-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50"
                    />
                    {options.length > 2 && (
                      <button
                        onClick={() => setOptions(options.filter((_, j) => j !== i))}
                        className="p-2 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setOptions([...options, ""])}
                  className="text-sm text-primary hover:text-primary/80"
                >
                  + Add option
                </button>
              </div>
            </div>

            {/* Settings */}
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSubmissions}
                  onChange={(e) => setAllowSubmissions(e.target.checked)}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-foreground">Allow user submissions</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showLiveResults}
                  onChange={(e) => setShowLiveResults(e.target.checked)}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="text-sm text-foreground">Show live results</span>
              </label>
            </div>

            <button
              onClick={handleCreate}
              disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              Create Poll
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

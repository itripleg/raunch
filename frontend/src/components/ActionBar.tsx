import { useState, useCallback } from "react";

type Props = {
  onSubmit: (text: string) => void;
};

export function ActionBar({ onSubmit }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
  }, [value, onSubmit]);

  return (
    <div className="border-t border-border/50 bg-card/30 p-3 shrink-0">
      <div className="max-w-3xl mx-auto flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Type an action or message..."
          className="flex-1 px-4 py-2.5 bg-secondary/50 border border-border/50 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/30 transition-all"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="px-4 py-2.5 bg-primary/80 hover:bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:hover:bg-primary/80 hover:shadow-[0_0_20px_oklch(0.65_0.22_340_/_0.2)]"
        >
          Send
        </button>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Lightbulb, X, Archive, Reply, Trash2, Star, ListTodo, Clock } from "lucide-react";
import { getBehaviorSuggestion, type BehaviorSuggestion } from "@/services/ai/pastCaseSuggestions";

interface BehaviorSuggestionBannerProps {
  accountId: string;
  threadId: string;
  fromAddress: string | null;
  snippet: string;
  subject: string;
}

const ACTION_ICONS: Record<string, typeof Archive> = {
  reply: Reply,
  archive: Archive,
  trash: Trash2,
  star: Star,
  create_task: ListTodo,
  read_later: Clock,
};

const ACTION_LABELS: Record<string, string> = {
  reply: "Reply",
  archive: "Archive",
  trash: "Trash",
  star: "Star",
  create_task: "Create task",
  read_later: "Read later",
};

export function BehaviorSuggestionBanner({
  accountId,
  fromAddress,
  snippet,
  subject,
}: BehaviorSuggestionBannerProps) {
  const [suggestion, setSuggestion] = useState<BehaviorSuggestion | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getBehaviorSuggestion(accountId, fromAddress, snippet, subject)
      .then((s) => {
        if (!cancelled) setSuggestion(s);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [accountId, fromAddress, snippet, subject]);

  if (!suggestion || dismissed || suggestion.confidence < 0.5) return null;

  const Icon = ACTION_ICONS[suggestion.action] ?? Lightbulb;
  const label = ACTION_LABELS[suggestion.action] ?? suggestion.action;

  return (
    <div className="bg-accent-light/50 border border-accent/20 rounded-lg p-3 mb-3 flex items-start gap-2">
      <Lightbulb size={16} className="text-accent shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className="text-accent" />
          <p className="text-sm text-text-primary font-medium">
            Suggested: {label}
          </p>
          <span className="text-xs text-text-tertiary">
            ({Math.round(suggestion.confidence * 100)}% confidence)
          </span>
        </div>
        <p className="text-xs text-text-secondary mt-0.5">
          {suggestion.reason}
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 p-0.5 rounded hover:bg-accent/10 text-text-tertiary hover:text-text-secondary transition-colors"
        aria-label="Dismiss suggestion"
      >
        <X size={14} />
      </button>
    </div>
  );
}

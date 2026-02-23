import { useState, useEffect, useCallback } from "react";
import { ListOrdered, Check, RefreshCw, ChevronDown, ChevronUp, Clock } from "lucide-react";
import {
  getActivePriorities,
  getAllPriorities,
  markPriorityCompleted,
  type DbWorkPriority,
} from "@/services/db/workPriorities";
import { generateWorkPriorities } from "@/services/ai/workPriority";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { navigateToThread } from "@/router/navigate";
// navigateToThread only takes threadId, navigates within current mail context

const URGENCY_COLORS: Record<string, string> = {
  critical: "text-danger",
  high: "text-warning",
  normal: "text-text-secondary",
  low: "text-text-tertiary",
};

const ACTION_LABELS: Record<string, string> = {
  reply: "Reply",
  archive: "Archive",
  forward: "Forward",
  create_task: "Create task",
  read: "Read",
};

export function WorkPriorityPanel() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const threadMap = useThreadStore((s) => s.threadMap);
  const [priorities, setPriorities] = useState<DbWorkPriority[]>([]);
  const [allPriorities, setAllPriorities] = useState<DbWorkPriority[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!activeAccountId) return;
    const active = await getActivePriorities(activeAccountId);
    const all = await getAllPriorities(activeAccountId);
    setPriorities(active);
    setAllPriorities(all);
  }, [activeAccountId]);

  useEffect(() => { load(); }, [load]);

  const handleComplete = async (p: DbWorkPriority) => {
    await markPriorityCompleted(p.id);
    setPriorities((prev) => prev.filter((x) => x.id !== p.id));
    setAllPriorities((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, is_completed: 1 } : x)),
    );
  };

  const handleRefresh = async () => {
    if (!activeAccountId || refreshing) return;
    setRefreshing(true);
    try {
      await generateWorkPriorities(activeAccountId, true);
      await load();
    } catch (err) {
      console.error("Failed to refresh work priorities:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleThreadClick = (threadId: string) => {
    navigateToThread(threadId);
  };

  const completedCount = allPriorities.filter((p) => p.is_completed).length;
  const totalCount = allPriorities.length;
  const remainingMinutes = priorities.reduce(
    (sum, p) => sum + (p.estimated_minutes ?? 0),
    0,
  );

  if (totalCount === 0) return null;

  return (
    <div className="border-b border-border-primary bg-bg-secondary/50">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ListOrdered size={14} className="text-accent shrink-0" />
        <span className="text-xs font-medium text-text-primary flex-1">
          Today&apos;s work: {completedCount}/{totalCount}
          {remainingMinutes > 0 && (
            <span className="text-text-tertiary font-normal ml-1">
              (~{remainingMinutes} min remaining)
            </span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
          className="p-0.5 rounded hover:bg-bg-hover text-text-tertiary"
          title="Refresh priorities"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {allPriorities.map((p) => {
            const thread = threadMap.get(p.thread_id);
            const isCompleted = p.is_completed === 1;

            return (
              <div
                key={p.id}
                className={`flex items-start gap-2 p-2 rounded-md border transition-colors cursor-pointer
                  ${isCompleted
                    ? "bg-bg-primary/30 border-border-secondary opacity-60"
                    : "bg-bg-primary/50 border-border-secondary hover:border-accent/30"
                  }`}
                onClick={() => !isCompleted && handleThreadClick(p.thread_id)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isCompleted) handleComplete(p);
                  }}
                  className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors
                    ${isCompleted
                      ? "bg-success/20 border-success/40 text-success"
                      : "border-border-primary hover:border-accent"
                    }`}
                >
                  {isCompleted && <Check size={10} />}
                </button>

                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${isCompleted ? "line-through text-text-tertiary" : "text-text-primary"}`}>
                    {thread?.subject ?? p.thread_id}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {p.suggested_action && (
                      <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                        {ACTION_LABELS[p.suggested_action] ?? p.suggested_action}
                      </span>
                    )}
                    <span className={`text-[10px] font-medium ${URGENCY_COLORS[p.urgency] ?? ""}`}>
                      {p.urgency}
                    </span>
                    {p.estimated_minutes && (
                      <span className="text-[10px] text-text-tertiary flex items-center gap-0.5">
                        <Clock size={8} /> {p.estimated_minutes}m
                      </span>
                    )}
                  </div>
                  {p.reason && (
                    <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-1">
                      {p.reason}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

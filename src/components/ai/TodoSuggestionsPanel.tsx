import { useState, useEffect, useCallback } from "react";
import { ListTodo, Check, X, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import {
  getPendingSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  type DbTodoSuggestion,
} from "@/services/db/todoSuggestions";
import { insertTask } from "@/services/db/tasks";
import { generateTodoSuggestions } from "@/services/ai/todoSuggestions";
import { useAccountStore } from "@/stores/accountStore";
import { useTaskStore } from "@/stores/taskStore";
import type { TaskPriority } from "@/services/db/tasks";

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-text-tertiary",
};

export function TodoSuggestionsPanel() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const addTaskToStore = useTaskStore((s) => s.addTask);
  const [suggestions, setSuggestions] = useState<DbTodoSuggestion[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!activeAccountId) return;
    const items = await getPendingSuggestions(activeAccountId);
    setSuggestions(items);
  }, [activeAccountId]);

  useEffect(() => { load(); }, [load]);

  const handleAccept = async (s: DbTodoSuggestion) => {
    const priority: TaskPriority = s.priority === "high" ? "high" : s.priority === "low" ? "low" : "medium";
    const taskId = await insertTask({
      accountId: s.account_id,
      title: s.title,
      description: s.description,
      priority,
      dueDate: s.due_date,
      threadId: s.thread_id,
      threadAccountId: s.account_id,
    });
    await acceptSuggestion(s.id, taskId);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    const now = Math.floor(Date.now() / 1000);
    addTaskToStore({
      id: taskId,
      account_id: s.account_id,
      title: s.title,
      description: s.description,
      priority,
      is_completed: 0,
      completed_at: null,
      due_date: s.due_date,
      parent_id: null,
      thread_id: s.thread_id,
      thread_account_id: s.account_id,
      sort_order: 0,
      recurrence_rule: null,
      next_recurrence_at: null,
      tags_json: "[]",
      created_at: now,
      updated_at: now,
    });
  };

  const handleDismiss = async (s: DbTodoSuggestion) => {
    await dismissSuggestion(s.id);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  };

  const handleRefresh = async () => {
    if (!activeAccountId || refreshing) return;
    setRefreshing(true);
    try {
      // Force regeneration by clearing cache first
      const { deleteAiCache } = await import("@/services/db/aiCache");
      const today = new Date().toISOString().slice(0, 10);
      await deleteAiCache(activeAccountId, "__daily_todos__", today);
      await generateTodoSuggestions(activeAccountId);
      await load();
    } catch (err) {
      console.error("Failed to refresh TODO suggestions:", err);
    } finally {
      setRefreshing(false);
    }
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="border-b border-border-primary bg-bg-secondary/50">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ListTodo size={14} className="text-accent shrink-0" />
        <span className="text-xs font-medium text-text-primary flex-1">
          {suggestions.length} suggested TODO{suggestions.length > 1 ? "s" : ""}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
          className="p-0.5 rounded hover:bg-bg-hover text-text-tertiary"
          title="Refresh suggestions"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-2 p-2 rounded-md bg-bg-primary/50 border border-border-secondary"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary truncate">
                  {s.title}
                </p>
                {s.description && (
                  <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">
                    {s.description}
                  </p>
                )}
                <span className={`text-[10px] font-medium ${PRIORITY_COLORS[s.priority] ?? ""}`}>
                  {s.priority}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleAccept(s)}
                  className="p-1 rounded hover:bg-success/10 text-success transition-colors"
                  title="Create task"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => handleDismiss(s)}
                  className="p-1 rounded hover:bg-bg-hover text-text-tertiary transition-colors"
                  title="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

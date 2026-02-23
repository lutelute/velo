import { callAi } from "./aiService";
import { WORK_PRIORITY_PROMPT } from "./prompts";
import { getAiCache, setAiCache } from "@/services/db/aiCache";
import {
  insertWorkPriority,
  clearPrioritiesForAccount,
} from "@/services/db/workPriorities";
import { getSetting } from "@/services/db/settings";
import { getDb } from "@/services/db/connection";

interface ThreadSnippet {
  id: string;
  subject: string;
  snippet: string;
  fromAddress: string;
  is_read: number;
}

/**
 * Generate work priority rankings for inbox threads.
 * Cached daily per account via ai_cache with key "__daily_priorities__".
 */
export async function generateWorkPriorities(
  accountId: string,
  force = false,
): Promise<void> {
  // Check if feature is enabled
  const enabled = await getSetting("ai_work_priority_enabled");
  if (enabled === "false") return;

  const aiEnabled = await getSetting("ai_enabled");
  if (aiEnabled === "false") return;

  // Check daily cache (skip if forced)
  const today = new Date().toISOString().slice(0, 10);
  if (!force) {
    const cached = await getAiCache(accountId, "__daily_priorities__", today);
    if (cached) return;
  }

  // Fetch INBOX threads (unread first, max 20)
  const db = await getDb();
  const threads = await db.select<ThreadSnippet[]>(
    `SELECT t.id, t.subject, t.snippet, t.is_read,
       (SELECT m.from_address FROM messages m
        WHERE m.account_id = t.account_id AND m.thread_id = t.id
        ORDER BY m.date DESC LIMIT 1) as fromAddress
     FROM threads t
     JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     WHERE t.account_id = $1 AND tl.label_id = 'INBOX'
     ORDER BY t.is_read ASC, t.last_message_at DESC LIMIT 20`,
    [accountId],
  );

  if (threads.length === 0) {
    await setAiCache(accountId, "__daily_priorities__", today, "[]");
    return;
  }

  // Also get existing tasks summary
  const tasks = await db.select<{ title: string; priority: string; due_date: number | null }[]>(
    `SELECT title, priority, due_date FROM tasks
     WHERE (account_id = $1 OR account_id IS NULL) AND is_completed = 0
     ORDER BY due_date ASC NULLS LAST LIMIT 10`,
    [accountId],
  );

  const tasksContext = tasks.length > 0
    ? `\n\nExisting tasks:\n${tasks.map((t) => `- [${t.priority}] ${t.title}${t.due_date ? ` (due: ${new Date(t.due_date * 1000).toLocaleDateString()})` : ""}`).join("\n")}`
    : "";

  // Format threads for AI
  const input = threads
    .map((t) =>
      `<email_content>ID:${t.id}\nFrom: ${t.fromAddress ?? "Unknown"}\nSubject: ${t.subject ?? "(No subject)"}\nUnread: ${t.is_read === 0 ? "yes" : "no"}\n${t.snippet ?? ""}</email_content>`,
    )
    .join("\n===\n");

  const result = await callAi(WORK_PRIORITY_PROMPT, input + tasksContext);

  // Parse response
  let priorities: {
    thread_id: string;
    rank: number;
    suggested_action?: string;
    urgency?: string;
    estimated_minutes?: number;
    reason?: string;
  }[] = [];

  try {
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      priorities = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Failed to parse, skip
  }

  // Validate and store
  const validThreadIds = new Set(threads.map((t) => t.id));
  const validActions = new Set(["reply", "archive", "forward", "create_task", "read"]);
  const validUrgencies = new Set(["critical", "high", "normal", "low"]);

  // Clear old priorities
  await clearPrioritiesForAccount(accountId);

  for (const p of priorities) {
    if (!p.thread_id || !validThreadIds.has(p.thread_id) || typeof p.rank !== "number") continue;

    await insertWorkPriority(
      accountId,
      p.thread_id,
      p.rank,
      p.reason?.slice(0, 500) ?? null,
      validActions.has(p.suggested_action ?? "") ? p.suggested_action! : null,
      validUrgencies.has(p.urgency ?? "") ? p.urgency! : "normal",
      typeof p.estimated_minutes === "number" ? Math.min(p.estimated_minutes, 120) : null,
    );
  }

  // Mark as generated today
  await setAiCache(accountId, "__daily_priorities__", today, JSON.stringify(priorities));
}

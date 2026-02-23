import { callAi } from "./aiService";
import { SUGGEST_TODOS_PROMPT } from "./prompts";
import { getAiCache, setAiCache } from "@/services/db/aiCache";
import {
  insertTodoSuggestion,
  clearSuggestionsForAccount,
} from "@/services/db/todoSuggestions";
import { getSetting } from "@/services/db/settings";
import { getDb } from "@/services/db/connection";

interface ThreadSnippet {
  id: string;
  subject: string;
  snippet: string;
  fromAddress: string;
}

/**
 * Generate TODO suggestions from unread inbox threads.
 * Cached daily per account via ai_cache with key "__daily_todos__".
 */
export async function generateTodoSuggestions(
  accountId: string,
): Promise<void> {
  // Check if feature is enabled
  const enabled = await getSetting("ai_todo_suggestions_enabled");
  if (enabled === "false") return;

  const aiEnabled = await getSetting("ai_enabled");
  if (aiEnabled === "false") return;

  // Check daily cache
  const today = new Date().toISOString().slice(0, 10);
  const cached = await getAiCache(accountId, "__daily_todos__", today);
  if (cached) return; // Already generated today

  // Fetch unread INBOX threads (max 20)
  const db = await getDb();
  const threads = await db.select<ThreadSnippet[]>(
    `SELECT t.id, t.subject, t.snippet,
       (SELECT m.from_address FROM messages m
        WHERE m.account_id = t.account_id AND m.thread_id = t.id
        ORDER BY m.date DESC LIMIT 1) as fromAddress
     FROM threads t
     JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     WHERE t.account_id = $1 AND t.is_read = 0 AND tl.label_id = 'INBOX'
     ORDER BY t.last_message_at DESC LIMIT 20`,
    [accountId],
  );

  if (threads.length === 0) {
    await setAiCache(accountId, "__daily_todos__", today, "[]");
    return;
  }

  // Format threads for AI
  const input = threads
    .map((t) =>
      `<email_content>ID:${t.id}\nFrom: ${t.fromAddress ?? "Unknown"}\nSubject: ${t.subject ?? "(No subject)"}\n${t.snippet ?? ""}</email_content>`,
    )
    .join("\n===\n");

  const result = await callAi(SUGGEST_TODOS_PROMPT, input);

  // Parse response
  let suggestions: {
    thread_id: string;
    title: string;
    description?: string;
    priority?: string;
    due_date?: number | null;
  }[] = [];

  try {
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      suggestions = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Failed to parse, skip
  }

  // Validate and store suggestions
  const validThreadIds = new Set(threads.map((t) => t.id));
  const validPriorities = new Set(["high", "medium", "low"]);

  // Clear old pending suggestions
  await clearSuggestionsForAccount(accountId);

  for (const s of suggestions) {
    if (!s.thread_id || !validThreadIds.has(s.thread_id) || !s.title) continue;

    await insertTodoSuggestion(
      accountId,
      s.thread_id,
      s.title.slice(0, 500),
      s.description?.slice(0, 1000) ?? null,
      validPriorities.has(s.priority ?? "") ? s.priority! : "medium",
      typeof s.due_date === "number" ? s.due_date : null,
    );
  }

  // Mark as generated today
  await setAiCache(accountId, "__daily_todos__", today, JSON.stringify(suggestions));
}

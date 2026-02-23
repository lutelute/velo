import { getDb } from "./connection";

export interface DbTodoSuggestion {
  id: string;
  account_id: string;
  thread_id: string;
  title: string;
  description: string | null;
  priority: string;
  due_date: number | null;
  suggested_at: number;
  status: string;
  accepted_task_id: string | null;
}

export async function getPendingSuggestions(
  accountId: string,
  limit = 20,
): Promise<DbTodoSuggestion[]> {
  const db = await getDb();
  return db.select<DbTodoSuggestion[]>(
    `SELECT * FROM ai_todo_suggestions
     WHERE account_id = $1 AND status = 'pending'
     ORDER BY suggested_at DESC LIMIT $2`,
    [accountId, limit],
  );
}

export async function insertTodoSuggestion(
  accountId: string,
  threadId: string,
  title: string,
  description: string | null,
  priority: string,
  dueDate: number | null,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO ai_todo_suggestions (id, account_id, thread_id, title, description, priority, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, accountId, threadId, title, description, priority, dueDate],
  );
  return id;
}

export async function acceptSuggestion(
  suggestionId: string,
  taskId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ai_todo_suggestions SET status = 'accepted', accepted_task_id = $1 WHERE id = $2`,
    [taskId, suggestionId],
  );
}

export async function dismissSuggestion(suggestionId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ai_todo_suggestions SET status = 'dismissed' WHERE id = $1`,
    [suggestionId],
  );
}

export async function clearSuggestionsForAccount(accountId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM ai_todo_suggestions WHERE account_id = $1 AND status = 'pending'`,
    [accountId],
  );
}

import { getDb } from "./connection";

export interface DbWorkPriority {
  id: string;
  account_id: string;
  thread_id: string;
  rank: number;
  reason: string | null;
  suggested_action: string | null;
  urgency: string;
  estimated_minutes: number | null;
  generated_at: number;
  is_completed: number;
}

export async function getActivePriorities(
  accountId: string,
): Promise<DbWorkPriority[]> {
  const db = await getDb();
  return db.select<DbWorkPriority[]>(
    `SELECT * FROM ai_work_priorities
     WHERE account_id = $1 AND is_completed = 0
     ORDER BY rank ASC`,
    [accountId],
  );
}

export async function getAllPriorities(
  accountId: string,
): Promise<DbWorkPriority[]> {
  const db = await getDb();
  return db.select<DbWorkPriority[]>(
    `SELECT * FROM ai_work_priorities
     WHERE account_id = $1
     ORDER BY rank ASC`,
    [accountId],
  );
}

export async function insertWorkPriority(
  accountId: string,
  threadId: string,
  rank: number,
  reason: string | null,
  suggestedAction: string | null,
  urgency: string,
  estimatedMinutes: number | null,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO ai_work_priorities (id, account_id, thread_id, rank, reason, suggested_action, urgency, estimated_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, accountId, threadId, rank, reason, suggestedAction, urgency, estimatedMinutes],
  );
  return id;
}

export async function markPriorityCompleted(priorityId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ai_work_priorities SET is_completed = 1 WHERE id = $1`,
    [priorityId],
  );
}

export async function clearPrioritiesForAccount(accountId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM ai_work_priorities WHERE account_id = $1`,
    [accountId],
  );
}

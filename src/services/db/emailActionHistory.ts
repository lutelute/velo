import { getDb } from "./connection";

export interface DbEmailActionHistory {
  id: number;
  account_id: string;
  thread_id: string;
  action_type: string;
  from_address: string | null;
  from_domain: string | null;
  subject_keywords: string | null;
  thread_category: string | null;
  response_time_seconds: number | null;
  performed_at: number;
}

export async function insertActionHistory(
  accountId: string,
  threadId: string,
  actionType: string,
  meta: {
    fromAddress?: string | null;
    fromDomain?: string | null;
    subjectKeywords?: string | null;
    threadCategory?: string | null;
    responseTimeSeconds?: number | null;
  },
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO email_action_history
       (account_id, thread_id, action_type, from_address, from_domain, subject_keywords, thread_category, response_time_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      accountId,
      threadId,
      actionType,
      meta.fromAddress ?? null,
      meta.fromDomain ?? null,
      meta.subjectKeywords ?? null,
      meta.threadCategory ?? null,
      meta.responseTimeSeconds ?? null,
    ],
  );
}

export async function getActionHistoryForDomain(
  accountId: string,
  fromDomain: string,
  limit = 100,
): Promise<DbEmailActionHistory[]> {
  const db = await getDb();
  return db.select<DbEmailActionHistory[]>(
    `SELECT * FROM email_action_history
     WHERE account_id = $1 AND from_domain = $2
     ORDER BY performed_at DESC LIMIT $3`,
    [accountId, fromDomain, limit],
  );
}

export async function getActionHistoryForAddress(
  accountId: string,
  fromAddress: string,
  limit = 100,
): Promise<DbEmailActionHistory[]> {
  const db = await getDb();
  return db.select<DbEmailActionHistory[]>(
    `SELECT * FROM email_action_history
     WHERE account_id = $1 AND from_address = $2
     ORDER BY performed_at DESC LIMIT $3`,
    [accountId, fromAddress, limit],
  );
}

export async function getRecentActions(
  accountId: string,
  limit = 50,
): Promise<DbEmailActionHistory[]> {
  const db = await getDb();
  return db.select<DbEmailActionHistory[]>(
    `SELECT * FROM email_action_history
     WHERE account_id = $1
     ORDER BY performed_at DESC LIMIT $2`,
    [accountId, limit],
  );
}

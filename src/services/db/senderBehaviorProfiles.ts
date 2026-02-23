import { getDb } from "./connection";

export interface DbSenderBehaviorProfile {
  id: string;
  account_id: string;
  from_domain: string;
  from_address: string | null;
  total_received: number;
  total_replied: number;
  total_archived: number;
  total_trashed: number;
  avg_response_time_seconds: number | null;
  most_common_action: string | null;
  last_updated: number;
}

export async function getSenderProfile(
  accountId: string,
  fromDomain: string,
  fromAddress?: string | null,
): Promise<DbSenderBehaviorProfile | null> {
  const db = await getDb();
  // Try exact address match first, then fall back to domain-level
  if (fromAddress) {
    const rows = await db.select<DbSenderBehaviorProfile[]>(
      `SELECT * FROM sender_behavior_profiles
       WHERE account_id = $1 AND from_domain = $2 AND from_address = $3`,
      [accountId, fromDomain, fromAddress],
    );
    if (rows[0]) return rows[0];
  }
  const rows = await db.select<DbSenderBehaviorProfile[]>(
    `SELECT * FROM sender_behavior_profiles
     WHERE account_id = $1 AND from_domain = $2 AND from_address IS NULL`,
    [accountId, fromDomain],
  );
  return rows[0] ?? null;
}

export async function upsertSenderProfile(
  accountId: string,
  fromDomain: string,
  fromAddress: string | null,
  actionType: string,
  responseTimeSeconds?: number | null,
): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();

  // Use conditional increments via CASE expressions (safe, no dynamic SQL)
  const isReply = actionType === "send" || actionType === "reply" ? 1 : 0;
  const isArchive = actionType === "archive" ? 1 : 0;
  const isTrash = actionType === "trash" || actionType === "spam" ? 1 : 0;

  await db.execute(
    `INSERT INTO sender_behavior_profiles
       (id, account_id, from_domain, from_address, total_received, total_replied, total_archived, total_trashed, avg_response_time_seconds)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8)
     ON CONFLICT(account_id, from_domain, from_address) DO UPDATE SET
       total_received = total_received + 1,
       total_replied = total_replied + $5,
       total_archived = total_archived + $6,
       total_trashed = total_trashed + $7,
       avg_response_time_seconds = CASE
         WHEN $8 IS NOT NULL THEN COALESCE(
           (avg_response_time_seconds * (total_received - 1) + $8) / total_received,
           $8
         )
         ELSE avg_response_time_seconds
       END,
       most_common_action = CASE
         WHEN total_replied + $5 >= total_archived + $6 AND total_replied + $5 >= total_trashed + $7 THEN 'reply'
         WHEN total_archived + $6 >= total_trashed + $7 THEN 'archive'
         ELSE 'trash'
       END,
       last_updated = unixepoch()`,
    [id, accountId, fromDomain, fromAddress, isReply, isArchive, isTrash, responseTimeSeconds ?? null],
  );
}

export async function getDomainProfiles(
  accountId: string,
  fromDomain: string,
): Promise<DbSenderBehaviorProfile[]> {
  const db = await getDb();
  return db.select<DbSenderBehaviorProfile[]>(
    `SELECT * FROM sender_behavior_profiles
     WHERE account_id = $1 AND from_domain = $2
     ORDER BY total_received DESC`,
    [accountId, fromDomain],
  );
}

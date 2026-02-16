import { getDb, selectFirstBy } from "./connection";

export interface JmapSyncState {
  account_id: string;
  object_type: string;
  state: string;
  updated_at: number | null;
}

export async function getJmapSyncState(
  accountId: string,
  objectType: string,
): Promise<JmapSyncState | null> {
  return selectFirstBy<JmapSyncState>(
    "SELECT * FROM jmap_sync_state WHERE account_id = $1 AND object_type = $2",
    [accountId, objectType],
  );
}

export async function upsertJmapSyncState(
  accountId: string,
  objectType: string,
  state: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO jmap_sync_state (account_id, object_type, state)
     VALUES ($1, $2, $3)
     ON CONFLICT(account_id, object_type) DO UPDATE SET
       state = $3, updated_at = unixepoch()`,
    [accountId, objectType, state],
  );
}

export async function deleteJmapSyncState(
  accountId: string,
  objectType?: string,
): Promise<void> {
  const db = await getDb();
  if (objectType) {
    await db.execute(
      "DELETE FROM jmap_sync_state WHERE account_id = $1 AND object_type = $2",
      [accountId, objectType],
    );
  } else {
    await db.execute(
      "DELETE FROM jmap_sync_state WHERE account_id = $1",
      [accountId],
    );
  }
}

export async function getAllJmapSyncStates(
  accountId: string,
): Promise<JmapSyncState[]> {
  const db = await getDb();
  return db.select<JmapSyncState[]>(
    "SELECT * FROM jmap_sync_state WHERE account_id = $1 ORDER BY object_type ASC",
    [accountId],
  );
}

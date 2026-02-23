import { insertActionHistory } from "@/services/db/emailActionHistory";
import { upsertSenderProfile } from "@/services/db/senderBehaviorProfiles";
import { getDb } from "@/services/db/connection";

interface ThreadMeta {
  fromAddress?: string | null;
  subject?: string | null;
  category?: string | null;
  receivedAt?: number | null;
}

function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const idx = email.lastIndexOf("@");
  return idx >= 0 ? email.slice(idx + 1).toLowerCase() : null;
}

function extractKeywords(subject: string | null | undefined): string | null {
  if (!subject) return null;
  // Remove Re:/Fwd: prefixes and extract significant words
  const cleaned = subject
    .replace(/^(re|fwd|fw):\s*/gi, "")
    .toLowerCase();
  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);
  return words.length > 0 ? words.join(",") : null;
}

/**
 * Log an email action and update sender behavior profile.
 * This function is designed to be called non-blocking (fire-and-forget).
 */
export async function logEmailAction(
  accountId: string,
  threadId: string,
  actionType: string,
  meta: ThreadMeta,
): Promise<void> {
  const fromDomain = extractDomain(meta.fromAddress);
  const subjectKeywords = extractKeywords(meta.subject);

  // Calculate response time if we have a received timestamp
  let responseTimeSeconds: number | null = null;
  if (meta.receivedAt && (actionType === "send" || actionType === "reply")) {
    responseTimeSeconds = Math.floor(Date.now() / 1000) - meta.receivedAt;
    if (responseTimeSeconds < 0) responseTimeSeconds = null;
  }

  // Insert action history
  await insertActionHistory(accountId, threadId, actionType, {
    fromAddress: meta.fromAddress,
    fromDomain,
    subjectKeywords,
    threadCategory: meta.category,
    responseTimeSeconds,
  });

  // Update sender behavior profile (domain-level)
  if (fromDomain) {
    await upsertSenderProfile(
      accountId,
      fromDomain,
      null,
      actionType,
      responseTimeSeconds,
    );

    // Also update address-level profile if we have the address
    if (meta.fromAddress) {
      await upsertSenderProfile(
        accountId,
        fromDomain,
        meta.fromAddress,
        actionType,
        responseTimeSeconds,
      );
    }
  }
}

/**
 * Get thread metadata for behavior logging by looking up thread info in DB.
 */
export async function getThreadMeta(
  accountId: string,
  threadId: string,
): Promise<ThreadMeta> {
  const db = await getDb();
  const rows = await db.select<{
    from_address: string | null;
    subject: string | null;
    date: number | null;
  }[]>(
    `SELECT m.from_address, m.subject, m.date
     FROM messages m
     WHERE m.account_id = $1 AND m.thread_id = $2
     ORDER BY m.date DESC LIMIT 1`,
    [accountId, threadId],
  );

  const msg = rows[0];
  if (!msg) return {};

  // Try to get thread category
  const catRows = await db.select<{ category: string }[]>(
    `SELECT category FROM thread_categories
     WHERE account_id = $1 AND thread_id = $2`,
    [accountId, threadId],
  );

  return {
    fromAddress: msg.from_address,
    subject: msg.subject,
    category: catRows[0]?.category ?? null,
    receivedAt: msg.date,
  };
}

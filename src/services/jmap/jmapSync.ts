import type { JmapClient } from "./client";
import type { JmapEmail, JmapMailbox } from "./types";
import type { ParsedMessage, ParsedAttachment } from "../gmail/messageParser";
import { upsertMessage } from "../db/messages";
import { upsertThread, setThreadLabels } from "../db/threads";
import { upsertAttachment } from "../db/attachments";
import { updateAccountSyncState } from "../db/accounts";
import { upsertJmapSyncState, getJmapSyncState } from "../db/jmapSyncState";
import {
  syncMailboxesToLabels,
  buildMailboxMap,
  getLabelsForJmapEmail,
} from "./mailboxMapper";
import { upsertContact } from "../db/contacts";

const EMAIL_PROPERTIES = [
  "id",
  "blobId",
  "threadId",
  "mailboxIds",
  "keywords",
  "size",
  "receivedAt",
  "messageId",
  "inReplyTo",
  "references",
  "from",
  "to",
  "cc",
  "bcc",
  "replyTo",
  "subject",
  "sentAt",
  "hasAttachment",
  "preview",
  "bodyStructure",
  "textBody",
  "htmlBody",
  "attachments",
];

const BODY_PROPERTIES = ["partId", "blobId", "size", "name", "type", "charset", "disposition", "cid"];

const BATCH_SIZE = 50;

function formatAddresses(
  addrs: { name: string | null; email: string }[] | null | undefined,
): string | null {
  if (!addrs || addrs.length === 0) return null;
  return addrs.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
}

/**
 * Convert a JMAP Email object to the app's ParsedMessage format.
 */
export function jmapEmailToParsedMessage(
  email: JmapEmail,
  mailboxMap: Map<string, JmapMailbox>,
): ParsedMessage {
  const from = email.from?.[0];
  const isRead = !!email.keywords["$seen"];
  const isStarred = !!email.keywords["$flagged"];
  const date = email.sentAt
    ? new Date(email.sentAt).getTime()
    : new Date(email.receivedAt).getTime();
  const internalDate = new Date(email.receivedAt).getTime();

  const labelIds = getLabelsForJmapEmail(email.mailboxIds, email.keywords, mailboxMap);

  // Extract body text/html from bodyValues if available
  let bodyHtml: string | null = null;
  let bodyText: string | null = null;

  if (email.bodyValues) {
    if (email.htmlBody?.[0]?.partId) {
      const val = email.bodyValues[email.htmlBody[0].partId];
      if (val) bodyHtml = val.value;
    }
    if (email.textBody?.[0]?.partId) {
      const val = email.bodyValues[email.textBody[0].partId];
      if (val) bodyText = val.value;
    }
  }

  // Parse attachments
  const attachments: ParsedAttachment[] = (email.attachments ?? []).map((att) => ({
    filename: att.name ?? "attachment",
    mimeType: att.type,
    size: att.size,
    gmailAttachmentId: att.blobId ?? "",
    contentId: att.cid,
    isInline: att.disposition === "inline",
  }));

  return {
    id: email.id,
    threadId: email.threadId,
    fromAddress: from?.email ?? null,
    fromName: from?.name ?? null,
    toAddresses: formatAddresses(email.to),
    ccAddresses: formatAddresses(email.cc),
    bccAddresses: formatAddresses(email.bcc),
    replyTo: formatAddresses(email.replyTo),
    subject: email.subject,
    snippet: email.preview,
    date,
    isRead,
    isStarred,
    bodyHtml,
    bodyText,
    rawSize: email.size,
    internalDate,
    labelIds,
    hasAttachments: email.hasAttachment,
    attachments,
    listUnsubscribe: null,
    listUnsubscribePost: null,
    authResults: null,
  };
}

/**
 * Persist a batch of parsed messages to the database.
 */
async function persistMessages(
  accountId: string,
  messages: ParsedMessage[],
): Promise<void> {
  for (const parsed of messages) {
    await upsertMessage({
      id: parsed.id,
      accountId,
      threadId: parsed.threadId,
      fromAddress: parsed.fromAddress,
      fromName: parsed.fromName,
      toAddresses: parsed.toAddresses,
      ccAddresses: parsed.ccAddresses,
      bccAddresses: parsed.bccAddresses,
      replyTo: parsed.replyTo,
      subject: parsed.subject,
      snippet: parsed.snippet,
      date: parsed.date,
      isRead: parsed.isRead,
      isStarred: parsed.isStarred,
      bodyHtml: parsed.bodyHtml,
      bodyText: parsed.bodyText,
      rawSize: parsed.rawSize,
      internalDate: parsed.internalDate,
      messageIdHeader: null,
      referencesHeader: null,
      inReplyToHeader: null,
    });

    // Upsert thread
    await upsertThread({
      id: parsed.threadId,
      accountId,
      subject: parsed.subject,
      snippet: parsed.snippet,
      lastMessageAt: parsed.date,
      messageCount: 1,
      isRead: parsed.isRead,
      isStarred: parsed.isStarred,
      isImportant: parsed.labelIds.includes("IMPORTANT"),
      hasAttachments: parsed.hasAttachments,
    });

    // Set thread labels
    await setThreadLabels(accountId, parsed.threadId, parsed.labelIds);

    // Upsert attachments
    for (const att of parsed.attachments) {
      await upsertAttachment({
        id: `${parsed.id}-${att.gmailAttachmentId}`,
        messageId: parsed.id,
        accountId,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        gmailAttachmentId: att.gmailAttachmentId,
        contentId: att.contentId,
        isInline: att.isInline,
      });
    }

    // Upsert contact
    if (parsed.fromAddress) {
      await upsertContact(parsed.fromAddress, parsed.fromName);
    }
  }
}

export interface JmapSyncProgress {
  phase: "mailboxes" | "messages" | "done";
  current: number;
  total: number;
}

/**
 * Perform initial JMAP sync — fetch mailboxes, query emails, store to DB.
 */
export async function jmapInitialSync(
  client: JmapClient,
  accountId: string,
  daysBack: number,
  onProgress?: (progress: JmapSyncProgress) => void,
): Promise<void> {
  // 1. Fetch all mailboxes
  onProgress?.({ phase: "mailboxes", current: 0, total: 1 });

  const mbResp = await client.mailboxGet();
  const mailboxes = (mbResp.list ?? []) as JmapMailbox[];
  const mailboxState = mbResp.state as string;
  const mailboxMap = buildMailboxMap(mailboxes);

  await syncMailboxesToLabels(accountId, mailboxes);
  await upsertJmapSyncState(accountId, "Mailbox", mailboxState);

  onProgress?.({ phase: "mailboxes", current: 1, total: 1 });

  // 2. Query emails from the last N days
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - daysBack);
  const sinceIso = sinceDate.toISOString();

  // Get total count first
  const countResp = await client.emailQuery(
    { after: sinceIso },
    [{ property: "receivedAt", isAscending: false }],
    0,
    0,
  );
  const totalEmails = (countResp.total ?? 0) as number;

  // Fetch in batches
  let position = 0;
  let fetched = 0;

  while (position < totalEmails || position === 0) {
    onProgress?.({ phase: "messages", current: fetched, total: totalEmails });

    const queryResp = await client.emailQuery(
      { after: sinceIso },
      [{ property: "receivedAt", isAscending: false }],
      position,
      BATCH_SIZE,
    );

    const emailIds = (queryResp.ids ?? []) as string[];
    if (emailIds.length === 0) break;

    // Fetch full email objects
    const getResp = await client.emailGet(
      emailIds,
      EMAIL_PROPERTIES,
      BODY_PROPERTIES,
      true,
      true,
    );
    const emails = (getResp.list ?? []) as JmapEmail[];

    // Convert and persist
    const parsed = emails.map((e) => jmapEmailToParsedMessage(e, mailboxMap));
    await persistMessages(accountId, parsed);

    fetched += emails.length;
    position += BATCH_SIZE;
  }

  // Save Email state for delta sync
  const emailStateResp = await client.emailGet([], EMAIL_PROPERTIES.slice(0, 1));
  const emailState = emailStateResp.state as string;
  await upsertJmapSyncState(accountId, "Email", emailState);

  // Mark account as synced
  await updateAccountSyncState(accountId, `jmap:${emailState}`);

  onProgress?.({ phase: "done", current: fetched, total: totalEmails });
}

/**
 * Perform delta JMAP sync using Email/changes.
 */
export async function jmapDeltaSync(
  client: JmapClient,
  accountId: string,
): Promise<void> {
  // Get saved states
  const emailSyncState = await getJmapSyncState(accountId, "Email");
  const mailboxSyncState = await getJmapSyncState(accountId, "Mailbox");

  if (!emailSyncState) {
    throw new Error("JMAP_NO_STATE");
  }

  // 1. Check mailbox changes
  if (mailboxSyncState) {
    try {
      const mbChanges = await client.mailboxChanges(mailboxSyncState.state);
      const newMbState = mbChanges.newState as string;

      if (newMbState !== mailboxSyncState.state) {
        // Refresh all mailboxes
        const mbResp = await client.mailboxGet();
        const mailboxes = (mbResp.list ?? []) as JmapMailbox[];
        await syncMailboxesToLabels(accountId, mailboxes);
        await upsertJmapSyncState(accountId, "Mailbox", newMbState);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("cannotCalculateChanges")) {
        // Full mailbox refresh
        const mbResp = await client.mailboxGet();
        const mailboxes = (mbResp.list ?? []) as JmapMailbox[];
        const mbState = mbResp.state as string;
        await syncMailboxesToLabels(accountId, mailboxes);
        await upsertJmapSyncState(accountId, "Mailbox", mbState);
      } else {
        throw err;
      }
    }
  }

  // 2. Get current mailbox map
  const mbResp = await client.mailboxGet();
  const mailboxes = (mbResp.list ?? []) as JmapMailbox[];
  const mailboxMap = buildMailboxMap(mailboxes);

  // 3. Check email changes
  try {
    let sinceState = emailSyncState.state;
    let hasMore = true;

    while (hasMore) {
      const changes = await client.emailChanges(sinceState);
      const created = (changes.created ?? []) as string[];
      const updated = (changes.updated ?? []) as string[];
      const destroyed = (changes.destroyed ?? []) as string[];
      const newState = changes.newState as string;
      hasMore = (changes.hasMoreChanges ?? false) as boolean;

      // Fetch created + updated emails
      const idsToFetch = [...created, ...updated];
      if (idsToFetch.length > 0) {
        // Fetch in batches
        for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
          const batch = idsToFetch.slice(i, i + BATCH_SIZE);
          const getResp = await client.emailGet(
            batch,
            EMAIL_PROPERTIES,
            BODY_PROPERTIES,
            true,
            true,
          );
          const emails = (getResp.list ?? []) as JmapEmail[];
          const parsed = emails.map((e) => jmapEmailToParsedMessage(e, mailboxMap));
          await persistMessages(accountId, parsed);
        }
      }

      // Handle destroyed emails
      if (destroyed.length > 0) {
        const { getDb } = await import("../db/connection");
        const db = await getDb();
        for (const emailId of destroyed) {
          await db.execute(
            "DELETE FROM messages WHERE account_id = $1 AND id = $2",
            [accountId, emailId],
          );
        }
      }

      sinceState = newState;
    }

    // Save the latest state
    await upsertJmapSyncState(accountId, "Email", sinceState);
    await updateAccountSyncState(accountId, `jmap:${sinceState}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("cannotCalculateChanges")) {
      throw new Error("JMAP_STATE_EXPIRED");
    }
    throw err;
  }
}

import type { JmapMailbox } from "./types";
import { upsertLabel } from "../db/labels";

/**
 * Mapping from JMAP mailbox roles (RFC 8621 Section 2) to Gmail-style label IDs.
 */
const ROLE_MAP: Record<string, { labelId: string; labelName: string; type: string }> = {
  inbox: { labelId: "INBOX", labelName: "Inbox", type: "system" },
  archive: { labelId: "archive", labelName: "Archive", type: "system" },
  drafts: { labelId: "DRAFT", labelName: "Drafts", type: "system" },
  sent: { labelId: "SENT", labelName: "Sent", type: "system" },
  trash: { labelId: "TRASH", labelName: "Trash", type: "system" },
  junk: { labelId: "SPAM", labelName: "Spam", type: "system" },
  important: { labelId: "IMPORTANT", labelName: "Important", type: "system" },
};

export interface MailboxLabelMapping {
  labelId: string;
  labelName: string;
  type: string;
}

/**
 * Map a JMAP mailbox to a Gmail-style label.
 * Uses the role field first, then falls back to a prefixed ID for user mailboxes.
 */
export function mapMailboxToLabel(mailbox: JmapMailbox): MailboxLabelMapping {
  if (mailbox.role) {
    const mapping = ROLE_MAP[mailbox.role];
    if (mapping) {
      return mapping;
    }
  }

  return {
    labelId: `jmap-${mailbox.id}`,
    labelName: mailbox.name,
    type: "user",
  };
}

/**
 * Get label IDs for a JMAP email based on its mailboxIds and keywords.
 */
export function getLabelsForJmapEmail(
  mailboxIds: Record<string, boolean>,
  keywords: Record<string, boolean>,
  mailboxMap: Map<string, JmapMailbox>,
): string[] {
  const labels: string[] = [];

  for (const mailboxId of Object.keys(mailboxIds)) {
    const mailbox = mailboxMap.get(mailboxId);
    if (mailbox) {
      const mapping = mapMailboxToLabel(mailbox);
      labels.push(mapping.labelId);
    }
  }

  if (!keywords["$seen"]) {
    labels.push("UNREAD");
  }

  if (keywords["$flagged"]) {
    labels.push("STARRED");
  }

  if (keywords["$draft"]) {
    if (!labels.includes("DRAFT")) {
      labels.push("DRAFT");
    }
  }

  return labels;
}

/**
 * Sync JMAP mailboxes to the labels table in the DB.
 */
export async function syncMailboxesToLabels(
  accountId: string,
  mailboxes: JmapMailbox[],
): Promise<void> {
  for (const mailbox of mailboxes) {
    const mapping = mapMailboxToLabel(mailbox);
    await upsertLabel({
      id: mapping.labelId,
      accountId,
      name: mapping.labelName,
      type: mapping.type,
    });
  }

  // Ensure the UNREAD pseudo-label exists
  await upsertLabel({
    id: "UNREAD",
    accountId,
    name: "Unread",
    type: "system",
  });
}

/**
 * Build a lookup map from JMAP mailbox ID → mailbox object.
 */
export function buildMailboxMap(mailboxes: JmapMailbox[]): Map<string, JmapMailbox> {
  const map = new Map<string, JmapMailbox>();
  for (const mb of mailboxes) {
    map.set(mb.id, mb);
  }
  return map;
}

/**
 * Find a mailbox by role.
 */
export function findMailboxByRole(
  mailboxes: JmapMailbox[],
  role: string,
): JmapMailbox | undefined {
  return mailboxes.find((mb) => mb.role === role);
}

/**
 * Resolve a Gmail-style label ID back to a JMAP mailbox ID.
 */
export function labelIdToMailboxId(
  labelId: string,
  mailboxes: JmapMailbox[],
): string | null {
  // Check role-based labels
  for (const [role, mapping] of Object.entries(ROLE_MAP)) {
    if (mapping.labelId === labelId) {
      const mb = findMailboxByRole(mailboxes, role);
      return mb?.id ?? null;
    }
  }

  // Check user labels with jmap- prefix
  if (labelId.startsWith("jmap-")) {
    return labelId.slice(5);
  }

  return null;
}

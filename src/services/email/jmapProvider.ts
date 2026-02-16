import type { EmailProvider, EmailFolder, SyncResult } from "./types";
import type { ParsedMessage } from "../gmail/messageParser";
import type { JmapClient } from "../jmap/client";
import type { JmapEmail, JmapMailbox } from "../jmap/types";
import {
  mapMailboxToLabel,
  buildMailboxMap,
  findMailboxByRole,
  labelIdToMailboxId,
} from "../jmap/mailboxMapper";
import { jmapEmailToParsedMessage } from "../jmap/jmapSync";

const EMAIL_FETCH_PROPERTIES = [
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

/**
 * EmailProvider adapter for JMAP accounts.
 * All operations use JSON-over-HTTP via the JmapClient.
 */
export class JmapProvider implements EmailProvider {
  readonly accountId: string;
  readonly type = "jmap" as const;
  private client: JmapClient;
  private mailboxCache: JmapMailbox[] | null = null;

  constructor(accountId: string, client: JmapClient) {
    this.accountId = accountId;
    this.client = client;
  }

  private async getMailboxes(): Promise<JmapMailbox[]> {
    if (this.mailboxCache) return this.mailboxCache;
    const resp = await this.client.mailboxGet();
    this.mailboxCache = (resp.list ?? []) as JmapMailbox[];
    return this.mailboxCache;
  }

  private invalidateMailboxCache(): void {
    this.mailboxCache = null;
  }

  private async resolveMailboxId(labelId: string): Promise<string> {
    const mailboxes = await this.getMailboxes();
    const id = labelIdToMailboxId(labelId, mailboxes);
    if (!id) throw new Error(`Cannot resolve label "${labelId}" to JMAP mailbox`);
    return id;
  }

  private async getMailboxByRole(role: string): Promise<JmapMailbox> {
    const mailboxes = await this.getMailboxes();
    const mb = findMailboxByRole(mailboxes, role);
    if (!mb) throw new Error(`No mailbox with role "${role}" found`);
    return mb;
  }

  // ---- Folder/Label operations ----

  async listFolders(): Promise<EmailFolder[]> {
    const mailboxes = await this.getMailboxes();
    return mailboxes.map((mb) => {
      const mapping = mapMailboxToLabel(mb);
      return {
        id: mapping.labelId,
        name: mapping.labelName,
        path: mb.name,
        type: mapping.type as "system" | "user",
        specialUse: mb.role,
        delimiter: "/",
        messageCount: mb.totalEmails,
        unreadCount: mb.unreadEmails,
      };
    });
  }

  async createFolder(name: string, _parentPath?: string): Promise<EmailFolder> {
    const mailboxes = await this.getMailboxes();
    let parentId: string | null = null;

    if (_parentPath) {
      const parent = mailboxes.find((mb) => mb.name === _parentPath);
      parentId = parent?.id ?? null;
    }

    const resp = await this.client.mailboxSet(
      { new1: { name, parentId } },
    );
    this.invalidateMailboxCache();

    const created = resp.created as Record<string, { id: string }> | undefined;
    const newId = created?.new1?.id ?? `jmap-new-${Date.now()}`;

    return {
      id: `jmap-${newId}`,
      name,
      path: name,
      type: "user",
      specialUse: null,
      delimiter: "/",
      messageCount: 0,
      unreadCount: 0,
    };
  }

  async deleteFolder(path: string): Promise<void> {
    const mailboxId = await this.resolveMailboxId(path);
    await this.client.mailboxSet(undefined, undefined, [mailboxId]);
    this.invalidateMailboxCache();
  }

  async renameFolder(path: string, newName: string): Promise<void> {
    const mailboxId = await this.resolveMailboxId(path);
    await this.client.mailboxSet(undefined, {
      [mailboxId]: { name: newName },
    });
    this.invalidateMailboxCache();
  }

  // ---- Sync operations ----

  async initialSync(
    _daysBack: number,
    _onProgress?: (phase: string, current: number, total: number) => void,
  ): Promise<SyncResult> {
    // Initial sync is handled by jmapSync.ts module
    return { messages: [] };
  }

  async deltaSync(_syncToken: string): Promise<SyncResult> {
    // Delta sync is handled by jmapSync.ts module
    return { messages: [] };
  }

  // ---- Message operations ----

  async fetchMessage(messageId: string): Promise<ParsedMessage> {
    const resp = await this.client.emailGet(
      [messageId],
      EMAIL_FETCH_PROPERTIES,
      BODY_PROPERTIES,
      true,
      true,
    );
    const emails = (resp.list ?? []) as JmapEmail[];
    if (emails.length === 0) {
      throw new Error(`Email ${messageId} not found`);
    }
    const mailboxes = await this.getMailboxes();
    const mailboxMap = buildMailboxMap(mailboxes);
    return jmapEmailToParsedMessage(emails[0]!, mailboxMap);
  }

  async fetchAttachment(
    _messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    // attachmentId is the blobId for JMAP
    const buffer = await this.client.downloadBlob(attachmentId);
    const bytes = new Uint8Array(buffer);
    // Convert to base64
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    const base64 = btoa(binary);
    return { data: base64, size: bytes.length };
  }

  // ---- Actions ----

  async archive(_threadId: string, messageIds: string[]): Promise<void> {
    const inboxMb = await this.getMailboxByRole("inbox");
    const archiveMb = findMailboxByRole(await this.getMailboxes(), "archive");

    const update: Record<string, Record<string, unknown>> = {};
    for (const id of messageIds) {
      const patch: Record<string, unknown> = {
        [`mailboxIds/${inboxMb.id}`]: null,
      };
      if (archiveMb) {
        patch[`mailboxIds/${archiveMb.id}`] = true;
      }
      update[id] = patch;
    }

    await this.client.emailSet(undefined, update);
  }

  async trash(_threadId: string, messageIds: string[]): Promise<void> {
    const trashMb = await this.getMailboxByRole("trash");
    const inboxMb = await this.getMailboxByRole("inbox");

    const update: Record<string, Record<string, unknown>> = {};
    for (const id of messageIds) {
      update[id] = {
        [`mailboxIds/${trashMb.id}`]: true,
        [`mailboxIds/${inboxMb.id}`]: null,
      };
    }

    await this.client.emailSet(undefined, update);
  }

  async permanentDelete(_threadId: string, messageIds: string[]): Promise<void> {
    await this.client.emailSet(undefined, undefined, messageIds);
  }

  async markRead(
    _threadId: string,
    messageIds: string[],
    read: boolean,
  ): Promise<void> {
    const update: Record<string, Record<string, unknown>> = {};
    for (const id of messageIds) {
      update[id] = { "keywords/$seen": read ? true : null };
    }
    await this.client.emailSet(undefined, update);
  }

  async star(
    _threadId: string,
    messageIds: string[],
    starred: boolean,
  ): Promise<void> {
    const update: Record<string, Record<string, unknown>> = {};
    for (const id of messageIds) {
      update[id] = { "keywords/$flagged": starred ? true : null };
    }
    await this.client.emailSet(undefined, update);
  }

  async spam(
    _threadId: string,
    messageIds: string[],
    isSpam: boolean,
  ): Promise<void> {
    const junkMb = await this.getMailboxByRole("junk");
    const inboxMb = await this.getMailboxByRole("inbox");

    const update: Record<string, Record<string, unknown>> = {};
    for (const id of messageIds) {
      if (isSpam) {
        update[id] = {
          [`mailboxIds/${junkMb.id}`]: true,
          [`mailboxIds/${inboxMb.id}`]: null,
        };
      } else {
        update[id] = {
          [`mailboxIds/${inboxMb.id}`]: true,
          [`mailboxIds/${junkMb.id}`]: null,
        };
      }
    }
    await this.client.emailSet(undefined, update);
  }

  async moveToFolder(
    _threadId: string,
    messageIds: string[],
    folderPath: string,
  ): Promise<void> {
    const targetMailboxId = await this.resolveMailboxId(folderPath);

    // Get current mailbox assignments for the messages
    const resp = await this.client.emailGet(messageIds, ["mailboxIds"]);
    const emails = (resp.list ?? []) as { id: string; mailboxIds: Record<string, boolean> }[];

    const update: Record<string, Record<string, unknown>> = {};
    for (const email of emails) {
      const patch: Record<string, unknown> = {
        [`mailboxIds/${targetMailboxId}`]: true,
      };
      // Remove from all current mailboxes
      for (const mbId of Object.keys(email.mailboxIds)) {
        if (mbId !== targetMailboxId) {
          patch[`mailboxIds/${mbId}`] = null;
        }
      }
      update[email.id] = patch;
    }

    await this.client.emailSet(undefined, update);
  }

  async addLabel(_threadId: string, labelId: string): Promise<void> {
    const mailboxId = await this.resolveMailboxId(labelId);

    // Get all messages in this thread
    const queryResp = await this.client.emailQuery({ inThread: _threadId });
    const ids = (queryResp.ids ?? []) as string[];
    if (ids.length === 0) return;

    const update: Record<string, Record<string, unknown>> = {};
    for (const id of ids) {
      update[id] = { [`mailboxIds/${mailboxId}`]: true };
    }
    await this.client.emailSet(undefined, update);
  }

  async removeLabel(_threadId: string, labelId: string): Promise<void> {
    const mailboxId = await this.resolveMailboxId(labelId);

    const queryResp = await this.client.emailQuery({ inThread: _threadId });
    const ids = (queryResp.ids ?? []) as string[];
    if (ids.length === 0) return;

    const update: Record<string, Record<string, unknown>> = {};
    for (const id of ids) {
      update[id] = { [`mailboxIds/${mailboxId}`]: null };
    }
    await this.client.emailSet(undefined, update);
  }

  // ---- Send/Draft operations ----

  async sendMessage(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ id: string }> {
    // Decode base64url to Uint8Array
    const base64 = rawBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Upload as blob
    const blobId = await this.client.uploadBlob(bytes, "message/rfc822");

    // Create email from blob and submit
    const accountId = await this.client.getJmapAccountId();
    const resp = await this.client.apiCall([
      [
        "Email/import",
        {
          accountId,
          emails: {
            draft1: {
              blobId,
              mailboxIds: {},
              keywords: {},
            },
          },
        },
        "imp0",
      ],
      [
        "EmailSubmission/set",
        {
          accountId,
          create: {
            sub1: {
              emailId: "#draft1",
              envelope: null, // auto-derive from message headers
            },
          },
          onSuccessUpdateEmail: {
            "#sub1": {
              "keywords/$draft": null,
              "keywords/$seen": true,
            },
          },
        },
        "sub0",
      ],
    ]);

    const importResp = this.client.getMethodResponse(resp, "imp0");
    const created = importResp.created as Record<string, { id: string }> | undefined;
    const emailId = created?.draft1?.id ?? `jmap-sent-${Date.now()}`;

    return { id: emailId };
  }

  async createDraft(
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    const base64 = rawBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blobId = await this.client.uploadBlob(bytes, "message/rfc822");
    const draftsMb = await this.getMailboxByRole("drafts");
    const accountId = await this.client.getJmapAccountId();

    const resp = await this.client.apiCall([
      [
        "Email/import",
        {
          accountId,
          emails: {
            draft1: {
              blobId,
              mailboxIds: { [draftsMb.id]: true },
              keywords: { $draft: true, $seen: true },
            },
          },
        },
        "imp0",
      ],
    ]);

    const importResp = this.client.getMethodResponse(resp, "imp0");
    const created = importResp.created as Record<string, { id: string }> | undefined;
    const emailId = created?.draft1?.id ?? `jmap-draft-${Date.now()}`;

    return { draftId: emailId };
  }

  async updateDraft(
    draftId: string,
    rawBase64Url: string,
    _threadId?: string,
  ): Promise<{ draftId: string }> {
    // JMAP doesn't have draft update — delete old, create new
    await this.deleteDraft(draftId);
    return this.createDraft(rawBase64Url, _threadId);
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.client.emailSet(undefined, undefined, [draftId]);
  }

  // ---- Connection ----

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return this.client.testConnection();
  }

  async getProfile(): Promise<{ email: string; name?: string }> {
    const session = await this.client.getSession();
    return { email: session.username };
  }
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JmapEmail, JmapMailbox, JmapEmailAddress, JmapBodyPart } from "./types";
import { jmapEmailToParsedMessage } from "./jmapSync";

// Mock all DB modules
vi.mock("../db/messages", () => ({ upsertMessage: vi.fn() }));
vi.mock("../db/threads", () => ({ upsertThread: vi.fn(), setThreadLabels: vi.fn() }));
vi.mock("../db/attachments", () => ({ upsertAttachment: vi.fn() }));
vi.mock("../db/accounts", () => ({ updateAccountSyncState: vi.fn() }));
vi.mock("../db/jmapSyncState", () => ({ upsertJmapSyncState: vi.fn(), getJmapSyncState: vi.fn() }));
vi.mock("../db/contacts", () => ({ upsertContact: vi.fn() }));
vi.mock("../db/labels", () => ({ upsertLabel: vi.fn() }));

// Mock mailboxMapper to avoid DB dependencies
vi.mock("./mailboxMapper", () => ({
  syncMailboxesToLabels: vi.fn(),
  buildMailboxMap: vi.fn((mailboxes: JmapMailbox[]) => {
    const map = new Map<string, JmapMailbox>();
    for (const mb of mailboxes) {
      map.set(mb.id, mb);
    }
    return map;
  }),
  getLabelsForJmapEmail: vi.fn((
    mailboxIds: Record<string, boolean>,
    keywords: Record<string, boolean>,
    mailboxMap: Map<string, JmapMailbox>,
  ): string[] => {
    const labels: string[] = [];
    for (const mailboxId of Object.keys(mailboxIds)) {
      const mailbox = mailboxMap.get(mailboxId);
      if (mailbox) {
        if (mailbox.role === "inbox") {
          labels.push("INBOX");
        } else {
          labels.push(`jmap-${mailbox.id}`);
        }
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
  }),
}));

/**
 * Helper function to create a minimal JmapEmail with defaults.
 */
function createJmapEmail(overrides: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: "email-123",
    blobId: "blob-123",
    threadId: "thread-456",
    mailboxIds: { "inbox-1": true },
    keywords: {},
    size: 1024,
    receivedAt: "2024-01-15T10:00:00Z",
    messageId: ["<msg@example.com>"],
    inReplyTo: null,
    references: null,
    sender: null,
    from: [{ name: "John Doe", email: "john@example.com" }],
    to: [{ name: "Jane Smith", email: "jane@example.com" }],
    cc: null,
    bcc: null,
    replyTo: null,
    subject: "Test Subject",
    sentAt: "2024-01-15T09:55:00Z",
    hasAttachment: false,
    preview: "This is a preview of the email",
    bodyStructure: null,
    bodyValues: null,
    textBody: null,
    htmlBody: null,
    attachments: null,
    ...overrides,
  };
}

/**
 * Helper function to create a minimal JmapMailbox with defaults.
 */
function createMailbox(overrides: Partial<JmapMailbox> = {}): JmapMailbox {
  return {
    id: "inbox-1",
    name: "Inbox",
    parentId: null,
    role: "inbox",
    sortOrder: 0,
    totalEmails: 100,
    unreadEmails: 5,
    totalThreads: 80,
    unreadThreads: 4,
    myRights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: false,
      mayRename: false,
      mayDelete: false,
      maySubmit: true,
    },
    isSubscribed: true,
    ...overrides,
  };
}

describe("jmapEmailToParsedMessage", () => {
  let mailboxMap: Map<string, JmapMailbox>;

  beforeEach(() => {
    const inbox = createMailbox();
    mailboxMap = new Map([[inbox.id, inbox]]);
  });

  it("should perform basic conversion mapping id, threadId, subject, and snippet", () => {
    const email = createJmapEmail({
      id: "msg-001",
      threadId: "thread-001",
      subject: "Important Meeting",
      preview: "Let's discuss the project",
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.id).toBe("msg-001");
    expect(result.threadId).toBe("thread-001");
    expect(result.subject).toBe("Important Meeting");
    expect(result.snippet).toBe("Let's discuss the project");
  });

  it("should extract from address and name correctly", () => {
    const email = createJmapEmail({
      from: [{ name: "Alice Brown", email: "alice@company.com" }],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.fromAddress).toBe("alice@company.com");
    expect(result.fromName).toBe("Alice Brown");
  });

  it("should mark email as read when $seen keyword is present", () => {
    const email = createJmapEmail({
      keywords: { "$seen": true },
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.isRead).toBe(true);
  });

  it("should mark email as unread when $seen keyword is absent", () => {
    const email = createJmapEmail({
      keywords: {},
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.isRead).toBe(false);
  });

  it("should mark email as starred when $flagged keyword is present", () => {
    const email = createJmapEmail({
      keywords: { "$flagged": true },
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.isStarred).toBe(true);
  });

  it("should mark email as not starred when $flagged keyword is absent", () => {
    const email = createJmapEmail({
      keywords: {},
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.isStarred).toBe(false);
  });

  it("should include DRAFT label when $draft keyword is present", () => {
    const email = createJmapEmail({
      keywords: { "$draft": true },
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.labelIds).toContain("DRAFT");
  });

  it("should extract bodyHtml from bodyValues using htmlBody partId", () => {
    const email = createJmapEmail({
      htmlBody: [
        {
          partId: "html-part-1",
          blobId: "blob-html",
          size: 512,
          name: null,
          type: "text/html",
          charset: "utf-8",
          disposition: null,
          cid: null,
          subParts: null,
        },
      ],
      bodyValues: {
        "html-part-1": {
          value: "<html><body>HTML content</body></html>",
          isEncodingProblem: false,
          isTruncated: false,
        },
      },
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.bodyHtml).toBe("<html><body>HTML content</body></html>");
  });

  it("should extract bodyText from bodyValues using textBody partId", () => {
    const email = createJmapEmail({
      textBody: [
        {
          partId: "text-part-1",
          blobId: "blob-text",
          size: 256,
          name: null,
          type: "text/plain",
          charset: "utf-8",
          disposition: null,
          cid: null,
          subParts: null,
        },
      ],
      bodyValues: {
        "text-part-1": {
          value: "Plain text content",
          isEncodingProblem: false,
          isTruncated: false,
        },
      },
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.bodyText).toBe("Plain text content");
  });

  it("should parse attachments from JmapBodyPart array", () => {
    const email = createJmapEmail({
      hasAttachment: true,
      attachments: [
        {
          partId: "att-1",
          blobId: "blob-att-1",
          size: 2048,
          name: "document.pdf",
          type: "application/pdf",
          charset: null,
          disposition: "attachment",
          cid: null,
          subParts: null,
        },
        {
          partId: "att-2",
          blobId: "blob-att-2",
          size: 512,
          name: "image.png",
          type: "image/png",
          charset: null,
          disposition: "inline",
          cid: "image-cid-123",
          subParts: null,
        },
      ],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.hasAttachments).toBe(true);
    expect(result.attachments).toHaveLength(2);

    expect(result.attachments[0]).toEqual({
      filename: "document.pdf",
      mimeType: "application/pdf",
      size: 2048,
      gmailAttachmentId: "blob-att-1",
      contentId: null,
      isInline: false,
    });

    expect(result.attachments[1]).toEqual({
      filename: "image.png",
      mimeType: "image/png",
      size: 512,
      gmailAttachmentId: "blob-att-2",
      contentId: "image-cid-123",
      isInline: true,
    });
  });

  it("should derive labels from mailboxIds via mailbox map", () => {
    const draftsMailbox = createMailbox({
      id: "drafts-1",
      name: "Drafts",
      role: "drafts",
    });
    const customMailbox = createMailbox({
      id: "custom-1",
      name: "Projects",
      role: null,
    });

    const map = new Map([
      ["inbox-1", createMailbox()],
      ["drafts-1", draftsMailbox],
      ["custom-1", customMailbox],
    ]);

    const email = createJmapEmail({
      mailboxIds: {
        "inbox-1": true,
        "custom-1": true,
      },
      keywords: {},
    });

    const result = jmapEmailToParsedMessage(email, map);

    expect(result.labelIds).toContain("INBOX");
    expect(result.labelIds).toContain("jmap-custom-1");
    // Should also include UNREAD since $seen is not present
    expect(result.labelIds).toContain("UNREAD");
  });

  it("should use sentAt for date when available", () => {
    const sentDate = "2024-01-20T14:30:00Z";
    const receivedDate = "2024-01-20T14:35:00Z";

    const email = createJmapEmail({
      sentAt: sentDate,
      receivedAt: receivedDate,
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.date).toBe(new Date(sentDate).getTime());
    expect(result.internalDate).toBe(new Date(receivedDate).getTime());
  });

  it("should fallback to receivedAt for date when sentAt is null", () => {
    const receivedDate = "2024-01-20T14:35:00Z";

    const email = createJmapEmail({
      sentAt: null,
      receivedAt: receivedDate,
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.date).toBe(new Date(receivedDate).getTime());
    expect(result.internalDate).toBe(new Date(receivedDate).getTime());
  });

  it("should return null fromAddress when from array is empty", () => {
    const email = createJmapEmail({
      from: [],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.fromAddress).toBe(null);
    expect(result.fromName).toBe(null);
  });

  it("should return null fromAddress when from array is null", () => {
    const email = createJmapEmail({
      from: null,
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.fromAddress).toBe(null);
    expect(result.fromName).toBe(null);
  });

  it("should handle from address with null name", () => {
    const email = createJmapEmail({
      from: [{ name: null, email: "noreply@service.com" }],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.fromAddress).toBe("noreply@service.com");
    expect(result.fromName).toBe(null);
  });

  it("should format toAddresses correctly", () => {
    const email = createJmapEmail({
      to: [
        { name: "Alice", email: "alice@example.com" },
        { name: null, email: "bob@example.com" },
      ],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.toAddresses).toBe("Alice <alice@example.com>, bob@example.com");
  });

  it("should format ccAddresses correctly", () => {
    const email = createJmapEmail({
      cc: [
        { name: "Charlie", email: "charlie@example.com" },
      ],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.ccAddresses).toBe("Charlie <charlie@example.com>");
  });

  it("should format bccAddresses correctly", () => {
    const email = createJmapEmail({
      bcc: [
        { name: null, email: "secret@example.com" },
      ],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.bccAddresses).toBe("secret@example.com");
  });

  it("should format replyTo correctly", () => {
    const email = createJmapEmail({
      replyTo: [
        { name: "Support Team", email: "support@example.com" },
      ],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.replyTo).toBe("Support Team <support@example.com>");
  });

  it("should set null fields correctly", () => {
    const email = createJmapEmail({
      to: null,
      cc: null,
      bcc: null,
      replyTo: null,
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.toAddresses).toBe(null);
    expect(result.ccAddresses).toBe(null);
    expect(result.bccAddresses).toBe(null);
    expect(result.replyTo).toBe(null);
  });

  it("should always set listUnsubscribe, listUnsubscribePost, and authResults to null", () => {
    const email = createJmapEmail();

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.listUnsubscribe).toBe(null);
    expect(result.listUnsubscribePost).toBe(null);
    expect(result.authResults).toBe(null);
  });

  it("should handle attachment with null name by using default filename", () => {
    const email = createJmapEmail({
      hasAttachment: true,
      attachments: [
        {
          partId: "att-1",
          blobId: "blob-att-1",
          size: 1024,
          name: null,
          type: "application/octet-stream",
          charset: null,
          disposition: "attachment",
          cid: null,
          subParts: null,
        },
      ],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.attachments[0].filename).toBe("attachment");
  });

  it("should handle attachment with null blobId", () => {
    const email = createJmapEmail({
      hasAttachment: true,
      attachments: [
        {
          partId: "att-1",
          blobId: null,
          size: 1024,
          name: "file.txt",
          type: "text/plain",
          charset: null,
          disposition: "attachment",
          cid: null,
          subParts: null,
        },
      ],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.attachments[0].gmailAttachmentId).toBe("");
  });

  it("should include rawSize and map it from email size", () => {
    const email = createJmapEmail({
      size: 4096,
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.rawSize).toBe(4096);
  });

  it("should handle empty attachments array", () => {
    const email = createJmapEmail({
      hasAttachment: false,
      attachments: [],
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.attachments).toHaveLength(0);
    expect(result.hasAttachments).toBe(false);
  });

  it("should handle null bodyValues gracefully", () => {
    const email = createJmapEmail({
      htmlBody: [
        {
          partId: "html-part-1",
          blobId: "blob-html",
          size: 512,
          name: null,
          type: "text/html",
          charset: "utf-8",
          disposition: null,
          cid: null,
          subParts: null,
        },
      ],
      bodyValues: null,
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.bodyHtml).toBe(null);
    expect(result.bodyText).toBe(null);
  });

  it("should handle bodyValues without matching partId", () => {
    const email = createJmapEmail({
      htmlBody: [
        {
          partId: "html-part-1",
          blobId: "blob-html",
          size: 512,
          name: null,
          type: "text/html",
          charset: "utf-8",
          disposition: null,
          cid: null,
          subParts: null,
        },
      ],
      bodyValues: {
        "different-part": {
          value: "Some content",
          isEncodingProblem: false,
          isTruncated: false,
        },
      },
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.bodyHtml).toBe(null);
  });

  it("should handle both read and starred flags together", () => {
    const email = createJmapEmail({
      keywords: {
        "$seen": true,
        "$flagged": true,
      },
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.isRead).toBe(true);
    expect(result.isStarred).toBe(true);
    expect(result.labelIds).toContain("STARRED");
    expect(result.labelIds).not.toContain("UNREAD");
  });

  it("should handle null subject", () => {
    const email = createJmapEmail({
      subject: null,
    });

    const result = jmapEmailToParsedMessage(email, mailboxMap);

    expect(result.subject).toBe(null);
  });

  it("should handle complex multi-mailbox scenario", () => {
    const inbox = createMailbox({ id: "inbox-1", role: "inbox" });
    const sent = createMailbox({ id: "sent-1", name: "Sent", role: "sent" });
    const important = createMailbox({ id: "imp-1", name: "Important", role: "important" });

    const map = new Map([
      ["inbox-1", inbox],
      ["sent-1", sent],
      ["imp-1", important],
    ]);

    const email = createJmapEmail({
      mailboxIds: {
        "inbox-1": true,
        "sent-1": true,
        "imp-1": true,
      },
      keywords: {
        "$seen": true,
        "$flagged": true,
      },
    });

    const result = jmapEmailToParsedMessage(email, map);

    expect(result.isRead).toBe(true);
    expect(result.isStarred).toBe(true);
    expect(result.labelIds).toContain("INBOX");
    // Labels depend on the mocked getLabelsForJmapEmail implementation
    expect(result.labelIds).toContain("STARRED");
    expect(result.labelIds).not.toContain("UNREAD");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { JmapProvider } from "./jmapProvider";
import type { JmapClient } from "../jmap/client";
import type { JmapMailbox, JmapEmail, JmapSession } from "../jmap/types";

// Mock dependencies
vi.mock("../jmap/jmapSync", () => ({
  jmapEmailToParsedMessage: vi.fn(),
}));

vi.mock("../jmap/mailboxMapper", () => ({
  mapMailboxToLabel: vi.fn((mb: JmapMailbox) => ({
    labelId: `jmap-${mb.id}`,
    labelName: mb.name,
    type: mb.role ? "system" : "user",
  })),
  buildMailboxMap: vi.fn((mailboxes: JmapMailbox[]) => {
    const map = new Map<string, JmapMailbox>();
    for (const mb of mailboxes) {
      map.set(mb.id, mb);
    }
    return map;
  }),
  findMailboxByRole: vi.fn((mailboxes: JmapMailbox[], role: string) =>
    mailboxes.find((mb) => mb.role === role),
  ),
  labelIdToMailboxId: vi.fn((labelId: string, mailboxes: JmapMailbox[]) => {
    // Strip jmap- prefix and find by id or name
    const id = labelId.replace(/^jmap-/, "");
    const mb = mailboxes.find((m) => m.id === id || m.name === id);
    return mb?.id ?? null;
  }),
}));

// Helper to create a mock JmapClient
function createMockClient(): JmapClient {
  return {
    mailboxGet: vi.fn(),
    mailboxSet: vi.fn(),
    mailboxChanges: vi.fn(),
    emailGet: vi.fn(),
    emailSet: vi.fn(),
    emailQuery: vi.fn(),
    emailChanges: vi.fn(),
    emailSubmissionSet: vi.fn(),
    apiCall: vi.fn(),
    getMethodResponse: vi.fn(),
    testConnection: vi.fn(),
    getSession: vi.fn(),
    getJmapAccountId: vi.fn(),
    downloadBlob: vi.fn(),
    uploadBlob: vi.fn(),
    clearSession: vi.fn(),
  } as unknown as JmapClient;
}

// Helper to create a mock JmapMailbox with defaults
function createMailbox(overrides: Partial<JmapMailbox> = {}): JmapMailbox {
  return {
    id: "mb1",
    name: "Inbox",
    parentId: null,
    role: "inbox",
    sortOrder: 0,
    totalEmails: 10,
    unreadEmails: 3,
    totalThreads: 8,
    unreadThreads: 2,
    myRights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: true,
      mayRename: true,
      mayDelete: true,
      maySubmit: true,
    },
    isSubscribed: true,
    ...overrides,
  };
}

// Helper to create a mock JmapEmail
function createEmail(overrides: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: "email1",
    blobId: "blob1",
    threadId: "thread1",
    mailboxIds: { mb1: true },
    keywords: {},
    size: 1024,
    receivedAt: "2024-01-01T00:00:00Z",
    messageId: ["<msg1@example.com>"],
    inReplyTo: null,
    references: null,
    sender: null,
    from: [{ name: "Alice", email: "alice@example.com" }],
    to: [{ name: "Bob", email: "bob@example.com" }],
    cc: null,
    bcc: null,
    replyTo: null,
    subject: "Test",
    sentAt: "2024-01-01T00:00:00Z",
    hasAttachment: false,
    preview: "Test preview",
    bodyStructure: null,
    bodyValues: null,
    textBody: null,
    htmlBody: null,
    attachments: null,
    ...overrides,
  };
}

describe("JmapProvider", () => {
  let provider: JmapProvider;
  let mockClient: JmapClient;

  beforeEach(() => {
    mockClient = createMockClient();
    provider = new JmapProvider("account-123", mockClient);
  });

  describe("constructor", () => {
    it("should initialize with account ID and type", () => {
      expect(provider.accountId).toBe("account-123");
      expect(provider.type).toBe("jmap");
    });
  });

  describe("listFolders", () => {
    it("should return mapped folders from mailboxGet", async () => {
      const mailbox1 = createMailbox({ id: "mb1", name: "Inbox", role: "inbox", totalEmails: 10, unreadEmails: 3 });
      const mailbox2 = createMailbox({ id: "mb2", name: "Custom", role: null, totalEmails: 5, unreadEmails: 0 });

      vi.mocked(mockClient.mailboxGet).mockResolvedValue({
        list: [mailbox1, mailbox2],
      });

      const folders = await provider.listFolders();

      expect(mockClient.mailboxGet).toHaveBeenCalledOnce();
      expect(folders).toHaveLength(2);
      expect(folders[0]).toMatchObject({
        id: "jmap-mb1",
        name: "Inbox",
        path: "Inbox",
        type: "system",
        specialUse: "inbox",
        delimiter: "/",
        messageCount: 10,
        unreadCount: 3,
      });
      expect(folders[1]).toMatchObject({
        id: "jmap-mb2",
        name: "Custom",
        path: "Custom",
        type: "user",
        specialUse: null,
        delimiter: "/",
        messageCount: 5,
        unreadCount: 0,
      });
    });

    it("should cache mailboxes for subsequent calls", async () => {
      const mailbox = createMailbox();
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });

      await provider.listFolders();
      await provider.listFolders();

      // Should only call mailboxGet once due to caching
      expect(mockClient.mailboxGet).toHaveBeenCalledOnce();
    });
  });

  describe("createFolder", () => {
    it("should call mailboxSet with create arg", async () => {
      const mailbox = createMailbox();
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.mailboxSet).mockResolvedValue({
        created: { new1: { id: "mb-new" } },
      });

      const folder = await provider.createFolder("New Folder");

      expect(mockClient.mailboxSet).toHaveBeenCalledWith(
        { new1: { name: "New Folder", parentId: null } },
      );
      expect(folder).toMatchObject({
        id: "jmap-mb-new",
        name: "New Folder",
        path: "New Folder",
        type: "user",
        specialUse: null,
        delimiter: "/",
        messageCount: 0,
        unreadCount: 0,
      });
    });

    it("should set parentId when parent path is provided", async () => {
      const parentMailbox = createMailbox({ id: "mb-parent", name: "Parent" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [parentMailbox] });
      vi.mocked(mockClient.mailboxSet).mockResolvedValue({
        created: { new1: { id: "mb-child" } },
      });

      await provider.createFolder("Child", "Parent");

      expect(mockClient.mailboxSet).toHaveBeenCalledWith(
        { new1: { name: "Child", parentId: "mb-parent" } },
      );
    });

    it("should invalidate mailbox cache after creation", async () => {
      const mailbox = createMailbox();
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.mailboxSet).mockResolvedValue({
        created: { new1: { id: "mb-new" } },
      });

      await provider.listFolders(); // Load cache
      await provider.createFolder("New");
      await provider.listFolders(); // Should reload

      expect(mockClient.mailboxGet).toHaveBeenCalledTimes(2);
    });
  });

  describe("deleteFolder", () => {
    it("should call mailboxSet with destroy", async () => {
      const mailbox = createMailbox({ id: "mb-delete", name: "ToDelete" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.mailboxSet).mockResolvedValue({});

      await provider.deleteFolder("jmap-mb-delete");

      expect(mockClient.mailboxSet).toHaveBeenCalledWith(undefined, undefined, ["mb-delete"]);
    });

    it("should invalidate mailbox cache after deletion", async () => {
      const mailbox = createMailbox({ id: "mb-delete", name: "ToDelete" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.mailboxSet).mockResolvedValue({});

      await provider.listFolders();
      await provider.deleteFolder("jmap-mb-delete");
      await provider.listFolders();

      expect(mockClient.mailboxGet).toHaveBeenCalledTimes(2);
    });
  });

  describe("renameFolder", () => {
    it("should call mailboxSet with update", async () => {
      const mailbox = createMailbox({ id: "mb-rename", name: "OldName" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.mailboxSet).mockResolvedValue({});

      await provider.renameFolder("jmap-mb-rename", "NewName");

      expect(mockClient.mailboxSet).toHaveBeenCalledWith(undefined, {
        "mb-rename": { name: "NewName" },
      });
    });
  });

  describe("fetchMessage", () => {
    it("should fetch and parse a single message", async () => {
      const email = createEmail({ id: "email1" });
      const mailbox = createMailbox();
      vi.mocked(mockClient.emailGet).mockResolvedValue({ list: [email] });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });

      const { jmapEmailToParsedMessage } = await import("../jmap/jmapSync");
      vi.mocked(jmapEmailToParsedMessage).mockReturnValue({
        id: "email1",
        subject: "Test",
        from: [{ name: "Alice", email: "alice@example.com" }],
        to: [],
        cc: [],
        bcc: [],
        date: "2024-01-01T00:00:00Z",
        snippet: "Test preview",
        htmlBody: null,
        textBody: "Test",
        labels: [],
        attachments: [],
        isRead: false,
        isStarred: false,
      } as never);

      const message = await provider.fetchMessage("email1");

      expect(mockClient.emailGet).toHaveBeenCalledWith(
        ["email1"],
        expect.any(Array),
        expect.any(Array),
        true,
        true,
      );
      expect(jmapEmailToParsedMessage).toHaveBeenCalledWith(email, expect.any(Map));
      expect(message.id).toBe("email1");
    });

    it("should throw if message not found", async () => {
      vi.mocked(mockClient.emailGet).mockResolvedValue({ list: [] });

      await expect(provider.fetchMessage("nonexistent")).rejects.toThrow(
        "Email nonexistent not found",
      );
    });
  });

  describe("fetchAttachment", () => {
    it("should download blob and return base64", async () => {
      const arrayBuffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]).buffer; // "Hello"
      vi.mocked(mockClient.downloadBlob).mockResolvedValue(arrayBuffer);

      const result = await provider.fetchAttachment("email1", "blob123");

      expect(mockClient.downloadBlob).toHaveBeenCalledWith("blob123");
      expect(result.size).toBe(5);
      expect(result.data).toBe("SGVsbG8="); // base64 of "Hello"
    });
  });

  describe("archive", () => {
    it("should remove inbox and add archive mailbox", async () => {
      const inboxMb = createMailbox({ id: "mb-inbox", role: "inbox" });
      const archiveMb = createMailbox({ id: "mb-archive", role: "archive" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [inboxMb, archiveMb] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.archive("thread1", ["email1", "email2"]);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: {
          "mailboxIds/mb-inbox": null,
          "mailboxIds/mb-archive": true,
        },
        email2: {
          "mailboxIds/mb-inbox": null,
          "mailboxIds/mb-archive": true,
        },
      });
    });

    it("should only remove inbox if no archive mailbox exists", async () => {
      const inboxMb = createMailbox({ id: "mb-inbox", role: "inbox" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [inboxMb] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.archive("thread1", ["email1"]);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: {
          "mailboxIds/mb-inbox": null,
        },
      });
    });
  });

  describe("trash", () => {
    it("should move messages to trash mailbox", async () => {
      const inboxMb = createMailbox({ id: "mb-inbox", role: "inbox" });
      const trashMb = createMailbox({ id: "mb-trash", role: "trash" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [inboxMb, trashMb] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.trash("thread1", ["email1"]);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: {
          "mailboxIds/mb-trash": true,
          "mailboxIds/mb-inbox": null,
        },
      });
    });
  });

  describe("permanentDelete", () => {
    it("should call emailSet with destroy", async () => {
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.permanentDelete("thread1", ["email1", "email2"]);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, undefined, ["email1", "email2"]);
    });
  });

  describe("markRead", () => {
    it("should set $seen keyword to true when marking as read", async () => {
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.markRead("thread1", ["email1", "email2"], true);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: { "keywords/$seen": true },
        email2: { "keywords/$seen": true },
      });
    });

    it("should set $seen keyword to null when marking as unread", async () => {
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.markRead("thread1", ["email1"], false);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: { "keywords/$seen": null },
      });
    });
  });

  describe("star", () => {
    it("should set $flagged keyword to true when starring", async () => {
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.star("thread1", ["email1"], true);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: { "keywords/$flagged": true },
      });
    });

    it("should set $flagged keyword to null when unstarring", async () => {
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.star("thread1", ["email1", "email2"], false);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: { "keywords/$flagged": null },
        email2: { "keywords/$flagged": null },
      });
    });
  });

  describe("spam", () => {
    it("should move to junk mailbox when marking as spam", async () => {
      const inboxMb = createMailbox({ id: "mb-inbox", role: "inbox" });
      const junkMb = createMailbox({ id: "mb-junk", role: "junk" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [inboxMb, junkMb] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.spam("thread1", ["email1"], true);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: {
          "mailboxIds/mb-junk": true,
          "mailboxIds/mb-inbox": null,
        },
      });
    });

    it("should move to inbox when marking as not spam", async () => {
      const inboxMb = createMailbox({ id: "mb-inbox", role: "inbox" });
      const junkMb = createMailbox({ id: "mb-junk", role: "junk" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [inboxMb, junkMb] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.spam("thread1", ["email1"], false);

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: {
          "mailboxIds/mb-inbox": true,
          "mailboxIds/mb-junk": null,
        },
      });
    });
  });

  describe("moveToFolder", () => {
    it("should move messages to target folder and remove from others", async () => {
      const inboxMb = createMailbox({ id: "mb-inbox", name: "Inbox", role: "inbox" });
      const targetMb = createMailbox({ id: "mb-target", name: "Target", role: null });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [inboxMb, targetMb] });
      vi.mocked(mockClient.emailGet).mockResolvedValue({
        list: [{ id: "email1", mailboxIds: { "mb-inbox": true, "mb-other": true } }],
      });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.moveToFolder("thread1", ["email1"], "jmap-mb-target");

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: {
          "mailboxIds/mb-target": true,
          "mailboxIds/mb-inbox": null,
          "mailboxIds/mb-other": null,
        },
      });
    });
  });

  describe("addLabel", () => {
    it("should add mailbox to all messages in thread", async () => {
      const mailbox = createMailbox({ id: "mb-label", name: "Label" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.emailQuery).mockResolvedValue({ ids: ["email1", "email2"] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.addLabel("thread1", "jmap-mb-label");

      expect(mockClient.emailQuery).toHaveBeenCalledWith({ inThread: "thread1" });
      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: { "mailboxIds/mb-label": true },
        email2: { "mailboxIds/mb-label": true },
      });
    });

    it("should do nothing if thread has no messages", async () => {
      const mailbox = createMailbox({ id: "mb-label", name: "Label" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.emailQuery).mockResolvedValue({ ids: [] });

      await provider.addLabel("thread1", "jmap-mb-label");

      expect(mockClient.emailSet).not.toHaveBeenCalled();
    });
  });

  describe("removeLabel", () => {
    it("should remove mailbox from all messages in thread", async () => {
      const mailbox = createMailbox({ id: "mb-label", name: "Label" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [mailbox] });
      vi.mocked(mockClient.emailQuery).mockResolvedValue({ ids: ["email1"] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.removeLabel("thread1", "jmap-mb-label");

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, {
        email1: { "mailboxIds/mb-label": null },
      });
    });
  });

  describe("sendMessage", () => {
    it("should upload blob and submit email", async () => {
      const rawBase64Url = "SGVsbG8gV29ybGQ"; // "Hello World" base64url
      vi.mocked(mockClient.uploadBlob).mockResolvedValue("blob-upload-123");
      vi.mocked(mockClient.getJmapAccountId).mockResolvedValue("jmap-acc-1");
      vi.mocked(mockClient.apiCall).mockResolvedValue({
        methodResponses: [],
        sessionState: "state1",
      });
      vi.mocked(mockClient.getMethodResponse).mockReturnValue({
        created: { draft1: { id: "email-sent-456" } },
      });

      const result = await provider.sendMessage(rawBase64Url);

      expect(mockClient.uploadBlob).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "message/rfc822",
      );
      expect(mockClient.apiCall).toHaveBeenCalledWith([
        [
          "Email/import",
          {
            accountId: "jmap-acc-1",
            emails: {
              draft1: {
                blobId: "blob-upload-123",
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
            accountId: "jmap-acc-1",
            create: {
              sub1: {
                emailId: "#draft1",
                envelope: null,
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
      expect(result.id).toBe("email-sent-456");
    });
  });

  describe("createDraft", () => {
    it("should upload blob and import to drafts mailbox", async () => {
      const rawBase64Url = "RHJhZnQ"; // "Draft" base64url
      const draftsMb = createMailbox({ id: "mb-drafts", role: "drafts" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [draftsMb] });
      vi.mocked(mockClient.uploadBlob).mockResolvedValue("blob-draft-123");
      vi.mocked(mockClient.getJmapAccountId).mockResolvedValue("jmap-acc-1");
      vi.mocked(mockClient.apiCall).mockResolvedValue({
        methodResponses: [],
        sessionState: "state1",
      });
      vi.mocked(mockClient.getMethodResponse).mockReturnValue({
        created: { draft1: { id: "draft-789" } },
      });

      const result = await provider.createDraft(rawBase64Url);

      expect(mockClient.uploadBlob).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "message/rfc822",
      );
      expect(mockClient.apiCall).toHaveBeenCalledWith([
        [
          "Email/import",
          {
            accountId: "jmap-acc-1",
            emails: {
              draft1: {
                blobId: "blob-draft-123",
                mailboxIds: { "mb-drafts": true },
                keywords: { $draft: true, $seen: true },
              },
            },
          },
          "imp0",
        ],
      ]);
      expect(result.draftId).toBe("draft-789");
    });
  });

  describe("updateDraft", () => {
    it("should delete old draft and create new one", async () => {
      const draftsMb = createMailbox({ id: "mb-drafts", role: "drafts" });
      vi.mocked(mockClient.mailboxGet).mockResolvedValue({ list: [draftsMb] });
      vi.mocked(mockClient.emailSet).mockResolvedValue({});
      vi.mocked(mockClient.uploadBlob).mockResolvedValue("blob-updated");
      vi.mocked(mockClient.getJmapAccountId).mockResolvedValue("jmap-acc-1");
      vi.mocked(mockClient.apiCall).mockResolvedValue({
        methodResponses: [],
        sessionState: "state1",
      });
      vi.mocked(mockClient.getMethodResponse).mockReturnValue({
        created: { draft1: { id: "draft-new-999" } },
      });

      const result = await provider.updateDraft("draft-old-123", "VXBkYXRlZA");

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, undefined, ["draft-old-123"]);
      expect(result.draftId).toBe("draft-new-999");
    });
  });

  describe("deleteDraft", () => {
    it("should call emailSet with destroy", async () => {
      vi.mocked(mockClient.emailSet).mockResolvedValue({});

      await provider.deleteDraft("draft-123");

      expect(mockClient.emailSet).toHaveBeenCalledWith(undefined, undefined, ["draft-123"]);
    });
  });

  describe("testConnection", () => {
    it("should delegate to client.testConnection", async () => {
      vi.mocked(mockClient.testConnection).mockResolvedValue({
        success: true,
        message: "Connected successfully",
      });

      const result = await provider.testConnection();

      expect(mockClient.testConnection).toHaveBeenCalledOnce();
      expect(result.success).toBe(true);
      expect(result.message).toBe("Connected successfully");
    });

    it("should return failure when client fails", async () => {
      vi.mocked(mockClient.testConnection).mockResolvedValue({
        success: false,
        message: "Connection error",
      });

      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe("Connection error");
    });
  });

  describe("getProfile", () => {
    it("should return email from session.username", async () => {
      const session: JmapSession = {
        capabilities: {},
        accounts: {},
        primaryAccounts: {},
        username: "user@example.com",
        apiUrl: "https://jmap.example.com/api",
        downloadUrl: "https://jmap.example.com/download",
        uploadUrl: "https://jmap.example.com/upload",
        eventSourceUrl: "https://jmap.example.com/events",
        state: "state1",
      };
      vi.mocked(mockClient.getSession).mockResolvedValue(session);

      const profile = await provider.getProfile();

      expect(mockClient.getSession).toHaveBeenCalledOnce();
      expect(profile.email).toBe("user@example.com");
      expect(profile.name).toBeUndefined();
    });
  });

  describe("initialSync", () => {
    it("should return empty result (handled by jmapSync module)", async () => {
      const result = await provider.initialSync(30);

      expect(result.messages).toEqual([]);
    });
  });

  describe("deltaSync", () => {
    it("should return empty result (handled by jmapSync module)", async () => {
      const result = await provider.deltaSync("sync-token-123");

      expect(result.messages).toEqual([]);
    });
  });
});

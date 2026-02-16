import type { JmapMailbox } from "./types";
import {
  mapMailboxToLabel,
  getLabelsForJmapEmail,
  syncMailboxesToLabels,
  buildMailboxMap,
  findMailboxByRole,
  labelIdToMailboxId,
} from "./mailboxMapper";

vi.mock("../db/labels", () => ({
  upsertLabel: vi.fn(),
}));

import { upsertLabel } from "../db/labels";

/**
 * Helper function to create JmapMailbox objects with sensible defaults.
 */
function createMailbox(overrides: Partial<JmapMailbox> = {}): JmapMailbox {
  return {
    id: "test-id",
    name: "Test Mailbox",
    parentId: null,
    role: null,
    sortOrder: 0,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
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

describe("mailboxMapper", () => {
  describe("mapMailboxToLabel", () => {
    it("should map inbox role to INBOX label", () => {
      const mailbox = createMailbox({ role: "inbox" });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "INBOX",
        labelName: "Inbox",
        type: "system",
      });
    });

    it("should map sent role to SENT label", () => {
      const mailbox = createMailbox({ role: "sent" });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "SENT",
        labelName: "Sent",
        type: "system",
      });
    });

    it("should map trash role to TRASH label", () => {
      const mailbox = createMailbox({ role: "trash" });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "TRASH",
        labelName: "Trash",
        type: "system",
      });
    });

    it("should map drafts role to DRAFT label", () => {
      const mailbox = createMailbox({ role: "drafts" });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "DRAFT",
        labelName: "Drafts",
        type: "system",
      });
    });

    it("should map archive role to archive label", () => {
      const mailbox = createMailbox({ role: "archive" });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "archive",
        labelName: "Archive",
        type: "system",
      });
    });

    it("should map junk role to SPAM label", () => {
      const mailbox = createMailbox({ role: "junk" });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "SPAM",
        labelName: "Spam",
        type: "system",
      });
    });

    it("should map important role to IMPORTANT label", () => {
      const mailbox = createMailbox({ role: "important" });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "IMPORTANT",
        labelName: "Important",
        type: "system",
      });
    });

    it("should map mailbox with no role to jmap-prefixed label", () => {
      const mailbox = createMailbox({
        id: "custom-123",
        name: "My Custom Folder",
        role: null,
      });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "jmap-custom-123",
        labelName: "My Custom Folder",
        type: "user",
      });
    });

    it("should map mailbox with unknown role to jmap-prefixed label", () => {
      const mailbox = createMailbox({
        id: "unknown-456",
        name: "Unknown Role",
        role: "some-unknown-role",
      });
      const result = mapMailboxToLabel(mailbox);

      expect(result).toEqual({
        labelId: "jmap-unknown-456",
        labelName: "Unknown Role",
        type: "user",
      });
    });
  });

  describe("getLabelsForJmapEmail", () => {
    it("should include UNREAD label when $seen keyword is missing", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = {};
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).toContain("UNREAD");
      expect(labels).toContain("INBOX");
    });

    it("should include UNREAD label when $seen keyword is false", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = { "$seen": false };
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).toContain("UNREAD");
    });

    it("should not include UNREAD label when $seen keyword is true", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = { "$seen": true };
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).not.toContain("UNREAD");
      expect(labels).toContain("INBOX");
    });

    it("should include STARRED label when $flagged keyword is true", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = { "$flagged": true };
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).toContain("STARRED");
      expect(labels).toContain("INBOX");
    });

    it("should not include STARRED label when $flagged keyword is false", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = { "$flagged": false };
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).not.toContain("STARRED");
    });

    it("should include DRAFT label when $draft keyword is true", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = { "$draft": true };
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).toContain("DRAFT");
    });

    it("should not duplicate DRAFT label when already present from mailbox role", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = { "$draft": true };
      const mailbox = createMailbox({ id: "mb-1", role: "drafts" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      const draftCount = labels.filter((l) => l === "DRAFT").length;
      expect(draftCount).toBe(1);
    });

    it("should handle multiple mailboxes", () => {
      const mailboxIds = { "mb-1": true, "mb-2": true };
      const keywords = {};
      const mailbox1 = createMailbox({ id: "mb-1", role: "inbox" });
      const mailbox2 = createMailbox({ id: "mb-2", name: "Custom", role: null });
      const mailboxMap = new Map([
        ["mb-1", mailbox1],
        ["mb-2", mailbox2],
      ]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).toContain("INBOX");
      expect(labels).toContain("jmap-mb-2");
      expect(labels).toContain("UNREAD");
    });

    it("should handle combination of keywords", () => {
      const mailboxIds = { "mb-1": true };
      const keywords = { "$flagged": true };
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).toContain("INBOX");
      expect(labels).toContain("UNREAD");
      expect(labels).toContain("STARRED");
    });

    it("should skip mailbox IDs not found in map", () => {
      const mailboxIds = { "mb-1": true, "mb-nonexistent": true };
      const keywords = {};
      const mailbox = createMailbox({ id: "mb-1", role: "inbox" });
      const mailboxMap = new Map([["mb-1", mailbox]]);

      const labels = getLabelsForJmapEmail(mailboxIds, keywords, mailboxMap);

      expect(labels).toContain("INBOX");
      expect(labels).toContain("UNREAD");
      expect(labels.length).toBe(2);
    });
  });

  describe("syncMailboxesToLabels", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should upsert labels for all mailboxes", async () => {
      const accountId = "account-1";
      const mailboxes = [
        createMailbox({ id: "mb-1", role: "inbox" }),
        createMailbox({ id: "mb-2", role: "sent" }),
        createMailbox({ id: "mb-3", name: "Custom", role: null }),
      ];

      await syncMailboxesToLabels(accountId, mailboxes);

      expect(upsertLabel).toHaveBeenCalledTimes(4); // 3 mailboxes + UNREAD

      expect(upsertLabel).toHaveBeenCalledWith({
        id: "INBOX",
        accountId: "account-1",
        name: "Inbox",
        type: "system",
      });

      expect(upsertLabel).toHaveBeenCalledWith({
        id: "SENT",
        accountId: "account-1",
        name: "Sent",
        type: "system",
      });

      expect(upsertLabel).toHaveBeenCalledWith({
        id: "jmap-mb-3",
        accountId: "account-1",
        name: "Custom",
        type: "user",
      });

      expect(upsertLabel).toHaveBeenCalledWith({
        id: "UNREAD",
        accountId: "account-1",
        name: "Unread",
        type: "system",
      });
    });

    it("should handle empty mailboxes array", async () => {
      const accountId = "account-1";
      const mailboxes: JmapMailbox[] = [];

      await syncMailboxesToLabels(accountId, mailboxes);

      expect(upsertLabel).toHaveBeenCalledTimes(1); // Only UNREAD
      expect(upsertLabel).toHaveBeenCalledWith({
        id: "UNREAD",
        accountId: "account-1",
        name: "Unread",
        type: "system",
      });
    });

    it("should always ensure UNREAD label exists", async () => {
      const accountId = "account-2";
      const mailboxes = [createMailbox({ id: "mb-1", role: "inbox" })];

      await syncMailboxesToLabels(accountId, mailboxes);

      const unreadCall = (upsertLabel as any).mock.calls.find(
        (call: any[]) => call[0]?.id === "UNREAD"
      );
      expect(unreadCall).toBeDefined();
      expect(unreadCall?.[0]).toEqual({
        id: "UNREAD",
        accountId: "account-2",
        name: "Unread",
        type: "system",
      });
    });
  });

  describe("buildMailboxMap", () => {
    it("should create a Map from mailbox ID to mailbox object", () => {
      const mailboxes = [
        createMailbox({ id: "mb-1", role: "inbox" }),
        createMailbox({ id: "mb-2", role: "sent" }),
        createMailbox({ id: "mb-3", name: "Custom", role: null }),
      ];

      const map = buildMailboxMap(mailboxes);

      expect(map.size).toBe(3);
      expect(map.get("mb-1")).toEqual(mailboxes[0]);
      expect(map.get("mb-2")).toEqual(mailboxes[1]);
      expect(map.get("mb-3")).toEqual(mailboxes[2]);
    });

    it("should handle empty array", () => {
      const mailboxes: JmapMailbox[] = [];
      const map = buildMailboxMap(mailboxes);

      expect(map.size).toBe(0);
    });

    it("should handle duplicate IDs by keeping the last one", () => {
      const mailboxes = [
        createMailbox({ id: "mb-1", name: "First" }),
        createMailbox({ id: "mb-1", name: "Second" }),
      ];

      const map = buildMailboxMap(mailboxes);

      expect(map.size).toBe(1);
      expect(map.get("mb-1")?.name).toBe("Second");
    });
  });

  describe("findMailboxByRole", () => {
    it("should find mailbox with matching role", () => {
      const mailboxes = [
        createMailbox({ id: "mb-1", role: "inbox" }),
        createMailbox({ id: "mb-2", role: "sent" }),
        createMailbox({ id: "mb-3", role: "trash" }),
      ];

      const result = findMailboxByRole(mailboxes, "sent");

      expect(result).toEqual(mailboxes[1]);
    });

    it("should return undefined when role not found", () => {
      const mailboxes = [
        createMailbox({ id: "mb-1", role: "inbox" }),
        createMailbox({ id: "mb-2", role: "sent" }),
      ];

      const result = findMailboxByRole(mailboxes, "trash");

      expect(result).toBeUndefined();
    });

    it("should return first match when multiple mailboxes have same role", () => {
      const mailboxes = [
        createMailbox({ id: "mb-1", role: "inbox" }),
        createMailbox({ id: "mb-2", role: "inbox" }),
      ];

      const result = findMailboxByRole(mailboxes, "inbox");

      expect(result).toEqual(mailboxes[0]);
    });

    it("should handle empty array", () => {
      const mailboxes: JmapMailbox[] = [];
      const result = findMailboxByRole(mailboxes, "inbox");

      expect(result).toBeUndefined();
    });

    it("should not match mailboxes with null role", () => {
      const mailboxes = [
        createMailbox({ id: "mb-1", role: null }),
        createMailbox({ id: "mb-2", role: "inbox" }),
      ];

      const result = findMailboxByRole(mailboxes, null as any);

      expect(result).toEqual(mailboxes[0]);
    });
  });

  describe("labelIdToMailboxId", () => {
    const mailboxes = [
      createMailbox({ id: "mb-inbox", role: "inbox" }),
      createMailbox({ id: "mb-sent", role: "sent" }),
      createMailbox({ id: "mb-trash", role: "trash" }),
      createMailbox({ id: "mb-drafts", role: "drafts" }),
      createMailbox({ id: "mb-archive", role: "archive" }),
      createMailbox({ id: "mb-junk", role: "junk" }),
      createMailbox({ id: "mb-important", role: "important" }),
      createMailbox({ id: "custom-123", name: "My Folder", role: null }),
    ];

    it("should resolve INBOX label to inbox role mailbox", () => {
      const result = labelIdToMailboxId("INBOX", mailboxes);
      expect(result).toBe("mb-inbox");
    });

    it("should resolve SENT label to sent role mailbox", () => {
      const result = labelIdToMailboxId("SENT", mailboxes);
      expect(result).toBe("mb-sent");
    });

    it("should resolve TRASH label to trash role mailbox", () => {
      const result = labelIdToMailboxId("TRASH", mailboxes);
      expect(result).toBe("mb-trash");
    });

    it("should resolve DRAFT label to drafts role mailbox", () => {
      const result = labelIdToMailboxId("DRAFT", mailboxes);
      expect(result).toBe("mb-drafts");
    });

    it("should resolve archive label to archive role mailbox", () => {
      const result = labelIdToMailboxId("archive", mailboxes);
      expect(result).toBe("mb-archive");
    });

    it("should resolve SPAM label to junk role mailbox", () => {
      const result = labelIdToMailboxId("SPAM", mailboxes);
      expect(result).toBe("mb-junk");
    });

    it("should resolve IMPORTANT label to important role mailbox", () => {
      const result = labelIdToMailboxId("IMPORTANT", mailboxes);
      expect(result).toBe("mb-important");
    });

    it("should resolve jmap-prefixed label by stripping prefix", () => {
      const result = labelIdToMailboxId("jmap-custom-123", mailboxes);
      expect(result).toBe("custom-123");
    });

    it("should return null for UNREAD pseudo-label", () => {
      const result = labelIdToMailboxId("UNREAD", mailboxes);
      expect(result).toBeNull();
    });

    it("should return null for STARRED pseudo-label", () => {
      const result = labelIdToMailboxId("STARRED", mailboxes);
      expect(result).toBeNull();
    });

    it("should return null for unknown label", () => {
      const result = labelIdToMailboxId("UNKNOWN", mailboxes);
      expect(result).toBeNull();
    });

    it("should return null when role mailbox does not exist", () => {
      const limitedMailboxes = [
        createMailbox({ id: "mb-inbox", role: "inbox" }),
      ];
      const result = labelIdToMailboxId("SENT", limitedMailboxes);
      expect(result).toBeNull();
    });

    it("should handle empty mailboxes array", () => {
      const result = labelIdToMailboxId("INBOX", []);
      expect(result).toBeNull();
    });
  });
});

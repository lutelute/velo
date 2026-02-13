import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock all external dependencies
vi.mock("@/services/gmail/tokenManager", () => ({
  getGmailClient: vi.fn(),
}));

vi.mock("@/services/db/threads", () => ({
  pinThread: vi.fn(() => Promise.resolve()),
  unpinThread: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/threadCategories", () => ({
  setThreadCategory: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/snooze/snoozeManager", () => ({
  snoozeThread: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/stores/threadStore", () => {
  const state = {
    threads: [
      { id: "t1", labelIds: ["INBOX", "UNREAD"], isRead: false, isStarred: false, isPinned: false },
      { id: "t2", labelIds: ["INBOX"], isRead: true, isStarred: true, isPinned: false },
    ],
    updateThread: vi.fn(),
    removeThreads: vi.fn(),
  };
  return {
    useThreadStore: {
      getState: () => state,
    },
  };
});

import { getGmailClient } from "@/services/gmail/tokenManager";
import { pinThread, unpinThread } from "@/services/db/threads";
import { setThreadCategory } from "@/services/db/threadCategories";
import { snoozeThread } from "@/services/snooze/snoozeManager";
import { useThreadStore } from "@/stores/threadStore";
import { executeQuickStep } from "./executor";
import type { QuickStep } from "./types";

function makeQuickStep(overrides: Partial<QuickStep> = {}): QuickStep {
  return {
    id: "qs-1",
    accountId: "acct-1",
    name: "Test Quick Step",
    description: null,
    shortcut: null,
    actions: [],
    icon: null,
    isEnabled: true,
    continueOnError: false,
    sortOrder: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

const mockClient = {
  modifyThread: vi.fn(() => Promise.resolve({})),
  deleteThread: vi.fn(() => Promise.resolve()),
};

describe("executeQuickStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGmailClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof getGmailClient>>);
  });

  it("executes a single archive action", async () => {
    const step = makeQuickStep({
      actions: [{ type: "archive" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(result.completedActions).toBe(1);
    expect(result.totalActions).toBe(1);
    expect(mockClient.modifyThread).toHaveBeenCalledWith("t1", undefined, ["INBOX"]);
    // archive removes from view — threads should be batch-removed after chain completes
    expect(useThreadStore.getState().removeThreads).toHaveBeenCalledWith(["t1"]);
  });

  it("executes a multi-action chain (markRead + archive)", async () => {
    const step = makeQuickStep({
      actions: [{ type: "markRead" }, { type: "archive" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(result.completedActions).toBe(2);
    expect(result.totalActions).toBe(2);

    // markRead: removes UNREAD label
    expect(mockClient.modifyThread).toHaveBeenCalledWith("t1", undefined, ["UNREAD"]);
    expect(useThreadStore.getState().updateThread).toHaveBeenCalledWith("t1", { isRead: true });

    // archive: removes INBOX label
    expect(mockClient.modifyThread).toHaveBeenCalledWith("t1", undefined, ["INBOX"]);

    // Deferred removal after chain
    expect(useThreadStore.getState().removeThreads).toHaveBeenCalledWith(["t1"]);
  });

  it("fails fast by default", async () => {
    // Make the first action fail
    mockClient.modifyThread.mockRejectedValueOnce(new Error("API Error"));

    const step = makeQuickStep({
      actions: [{ type: "archive" }, { type: "markRead" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(false);
    expect(result.completedActions).toBe(0);
    expect(result.totalActions).toBe(2);
    expect(result.error).toBe("API Error");
    expect(result.failedActionIndex).toBe(0);

    // markRead should NOT have been called since archive failed
    expect(mockClient.modifyThread).toHaveBeenCalledTimes(1);
  });

  it("continues on error when configured", async () => {
    // Make the first action fail
    mockClient.modifyThread.mockRejectedValueOnce(new Error("API Error"));

    const step = makeQuickStep({
      continueOnError: true,
      actions: [{ type: "archive" }, { type: "markRead" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    // Should still succeed overall since continueOnError is true
    expect(result.success).toBe(true);
    // Only 1 completed (markRead), archive failed
    expect(result.completedActions).toBe(1);
    expect(result.totalActions).toBe(2);

    // Both actions were attempted
    expect(mockClient.modifyThread).toHaveBeenCalledTimes(2);
  });

  it("defers thread removal until chain completes", async () => {
    const step = makeQuickStep({
      actions: [{ type: "star" }, { type: "archive" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);

    // star should update thread state but not remove
    expect(useThreadStore.getState().updateThread).toHaveBeenCalledWith("t1", { isStarred: true });

    // archive sets shouldRemoveThreads flag, but removal is deferred
    // removeThreads should be called once, after all actions complete
    expect(useThreadStore.getState().removeThreads).toHaveBeenCalledTimes(1);
    expect(useThreadStore.getState().removeThreads).toHaveBeenCalledWith(["t1"]);
  });

  it("dispatches event for reply action and does not remove from view", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const step = makeQuickStep({
      actions: [{ type: "reply" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(result.completedActions).toBe(1);

    // Should dispatch a custom event for reply
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "velo-inline-reply",
        detail: { threadId: "t1", accountId: "acct-1", mode: "reply" },
      }),
    );

    // reply does not remove from view
    expect(useThreadStore.getState().removeThreads).not.toHaveBeenCalled();

    dispatchSpy.mockRestore();
  });

  it("executes pin action using DB function", async () => {
    const step = makeQuickStep({
      actions: [{ type: "pin" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(pinThread).toHaveBeenCalledWith("acct-1", "t1");
    expect(useThreadStore.getState().updateThread).toHaveBeenCalledWith("t1", { isPinned: true });
  });

  it("executes unpin action using DB function", async () => {
    const step = makeQuickStep({
      actions: [{ type: "unpin" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(unpinThread).toHaveBeenCalledWith("acct-1", "t1");
    expect(useThreadStore.getState().updateThread).toHaveBeenCalledWith("t1", { isPinned: false });
  });

  it("executes snooze action", async () => {
    const step = makeQuickStep({
      actions: [{ type: "snooze", params: { snoozeDuration: 3600000 } }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(snoozeThread).toHaveBeenCalledWith("acct-1", "t1", expect.any(Number));
    expect(useThreadStore.getState().removeThreads).toHaveBeenCalledWith(["t1"]);
  });

  it("executes moveToCategory action", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const step = makeQuickStep({
      actions: [{ type: "moveToCategory", params: { category: "Promotions" } }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(setThreadCategory).toHaveBeenCalledWith("acct-1", "t1", "Promotions", true);
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "velo-sync-done" }));

    dispatchSpy.mockRestore();
  });

  it("executes spam action", async () => {
    const step = makeQuickStep({
      actions: [{ type: "spam" }],
    });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(mockClient.modifyThread).toHaveBeenCalledWith("t1", ["SPAM"], ["INBOX"]);
    expect(useThreadStore.getState().removeThreads).toHaveBeenCalledWith(["t1"]);
  });

  it("handles multiple threads", async () => {
    const step = makeQuickStep({
      actions: [{ type: "markRead" }],
    });

    const result = await executeQuickStep(step, ["t1", "t2"], "acct-1");

    expect(result.success).toBe(true);
    expect(mockClient.modifyThread).toHaveBeenCalledTimes(2);
    expect(mockClient.modifyThread).toHaveBeenCalledWith("t1", undefined, ["UNREAD"]);
    expect(mockClient.modifyThread).toHaveBeenCalledWith("t2", undefined, ["UNREAD"]);
  });

  it("returns correct result for empty action list", async () => {
    const step = makeQuickStep({ actions: [] });

    const result = await executeQuickStep(step, ["t1"], "acct-1");

    expect(result.success).toBe(true);
    expect(result.completedActions).toBe(0);
    expect(result.totalActions).toBe(0);
  });
});

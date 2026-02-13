import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveQueryTokens,
  getSmartFolderSearchQuery,
  getSmartFolderUnreadCount,
} from "./smartFolderQuery";

describe("resolveQueryTokens", () => {
  beforeEach(() => {
    // Fix the date to 2025-03-15 00:00:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 2, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces __LAST_7_DAYS__ with date 7 days ago", () => {
    const result = resolveQueryTokens(
      "is:starred after:__LAST_7_DAYS__",
    );
    expect(result).toBe("is:starred after:2025/03/08");
  });

  it("replaces __LAST_30_DAYS__ with date 30 days ago", () => {
    const result = resolveQueryTokens(
      "from:boss after:__LAST_30_DAYS__",
    );
    expect(result).toBe("from:boss after:2025/02/13");
  });

  it("replaces __TODAY__ with today's date", () => {
    const result = resolveQueryTokens("before:__TODAY__");
    expect(result).toBe("before:2025/03/15");
  });

  it("replaces multiple tokens in one query", () => {
    const result = resolveQueryTokens(
      "after:__LAST_7_DAYS__ before:__TODAY__",
    );
    expect(result).toBe("after:2025/03/08 before:2025/03/15");
  });

  it("returns query unchanged when no tokens present", () => {
    const result = resolveQueryTokens("is:unread from:john");
    expect(result).toBe("is:unread from:john");
  });
});

describe("getSmartFolderSearchQuery", () => {
  it("returns sql and params", () => {
    const result = getSmartFolderSearchQuery("is:unread", "acc-1");
    expect(result).toHaveProperty("sql");
    expect(result).toHaveProperty("params");
    expect(typeof result.sql).toBe("string");
    expect(Array.isArray(result.params)).toBe(true);
  });

  it("includes account filter", () => {
    const { sql, params } = getSmartFolderSearchQuery("is:unread", "acc-1");
    expect(sql).toContain("m.account_id =");
    expect(params).toContain("acc-1");
  });

  it("includes is:unread filter", () => {
    const { sql } = getSmartFolderSearchQuery("is:unread", "acc-1");
    expect(sql).toContain("m.is_read = 0");
  });

  it("includes has:attachment filter", () => {
    const { sql } = getSmartFolderSearchQuery("has:attachment", "acc-1");
    expect(sql).toContain("EXISTS (SELECT 1 FROM attachments");
  });

  it("respects custom limit", () => {
    const { params } = getSmartFolderSearchQuery("is:unread", "acc-1", 25);
    expect(params[params.length - 1]).toBe(25);
  });

  it("defaults to limit 50", () => {
    const { params } = getSmartFolderSearchQuery("is:unread", "acc-1");
    expect(params[params.length - 1]).toBe(50);
  });
});

describe("getSmartFolderUnreadCount", () => {
  it("returns sql and params for count query", () => {
    const result = getSmartFolderUnreadCount("has:attachment", "acc-1");
    expect(result).toHaveProperty("sql");
    expect(result).toHaveProperty("params");
  });

  it("generates a COUNT query", () => {
    const { sql } = getSmartFolderUnreadCount("has:attachment", "acc-1");
    expect(sql).toContain("COUNT(DISTINCT m.id)");
  });

  it("includes unread filter", () => {
    const { sql } = getSmartFolderUnreadCount("has:attachment", "acc-1");
    expect(sql).toContain("m.is_read = 0");
  });

  it("does not include LIMIT", () => {
    const { sql } = getSmartFolderUnreadCount("is:starred", "acc-1");
    expect(sql).not.toMatch(/LIMIT/i);
  });
});

import {
  getJmapSyncState,
  upsertJmapSyncState,
  deleteJmapSyncState,
  getAllJmapSyncStates,
  type JmapSyncState,
} from "./jmapSyncState";

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("./connection", () => ({
  getDb: vi.fn(() => ({
    execute: (...args: unknown[]) => mockExecute(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  })),
  selectFirstBy: vi.fn(),
}));

import { selectFirstBy } from "./connection";

const mockSelectFirstBy = vi.mocked(selectFirstBy);

describe("jmapSyncState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getJmapSyncState", () => {
    it("returns null for non-existent jmap sync state", async () => {
      mockSelectFirstBy.mockResolvedValue(null);

      const result = await getJmapSyncState("acc-1", "Email");

      expect(result).toBeNull();
      expect(mockSelectFirstBy).toHaveBeenCalledWith(
        "SELECT * FROM jmap_sync_state WHERE account_id = $1 AND object_type = $2",
        ["acc-1", "Email"],
      );
    });

    it("returns existing jmap sync state", async () => {
      const state: JmapSyncState = {
        account_id: "acc-1",
        object_type: "Email",
        state: "s123456",
        updated_at: 1700000000,
      };
      mockSelectFirstBy.mockResolvedValue(state);

      const result = await getJmapSyncState("acc-1", "Email");

      expect(result).toEqual(state);
    });

    it("passes correct parameters for different object types", async () => {
      mockSelectFirstBy.mockResolvedValue(null);

      await getJmapSyncState("acc-2", "Mailbox");

      expect(mockSelectFirstBy).toHaveBeenCalledWith(
        expect.any(String),
        ["acc-2", "Mailbox"],
      );
    });
  });

  describe("upsertJmapSyncState", () => {
    it("creates new state via INSERT ON CONFLICT", async () => {
      mockExecute.mockResolvedValue(undefined);

      await upsertJmapSyncState("acc-1", "Email", "s123456");

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO jmap_sync_state");
      expect(sql).toContain("ON CONFLICT");
      expect(params).toEqual(["acc-1", "Email", "s123456"]);
    });

    it("handles different object types", async () => {
      mockExecute.mockResolvedValue(undefined);

      await upsertJmapSyncState("acc-1", "Mailbox", "m789");

      const [, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual(["acc-1", "Mailbox", "m789"]);
    });

    it("updates existing state on conflict (upsert)", async () => {
      mockExecute.mockResolvedValue(undefined);

      // First insert
      await upsertJmapSyncState("acc-1", "Email", "s123456");

      // Update same key
      await upsertJmapSyncState("acc-1", "Email", "s789012");

      expect(mockExecute).toHaveBeenCalledTimes(2);
      const [, params2] = mockExecute.mock.calls[1] as [string, unknown[]];
      expect(params2).toEqual(["acc-1", "Email", "s789012"]);
    });
  });

  describe("deleteJmapSyncState", () => {
    it("deletes specific object type when provided", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteJmapSyncState("acc-1", "Email");

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("DELETE FROM jmap_sync_state");
      expect(sql).toContain("account_id = $1");
      expect(sql).toContain("object_type = $2");
      expect(params).toEqual(["acc-1", "Email"]);
    });

    it("deletes all states for account when objectType is not provided", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteJmapSyncState("acc-1");

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("DELETE FROM jmap_sync_state");
      expect(sql).toContain("account_id = $1");
      expect(sql).not.toContain("object_type");
      expect(params).toEqual(["acc-1"]);
    });

    it("uses correct SQL with both WHERE conditions when objectType provided", async () => {
      mockExecute.mockResolvedValue(undefined);

      await deleteJmapSyncState("acc-2", "Mailbox");

      const [sql] = mockExecute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("account_id = $1");
      expect(sql).toContain("object_type = $2");
    });
  });

  describe("getAllJmapSyncStates", () => {
    it("returns all states for an account", async () => {
      const states: JmapSyncState[] = [
        {
          account_id: "acc-1",
          object_type: "Email",
          state: "s123456",
          updated_at: 1700000000,
        },
        {
          account_id: "acc-1",
          object_type: "Mailbox",
          state: "m789012",
          updated_at: 1700000000,
        },
        {
          account_id: "acc-1",
          object_type: "Thread",
          state: "t345678",
          updated_at: 1700000000,
        },
      ];
      mockSelect.mockResolvedValue(states);

      const result = await getAllJmapSyncStates("acc-1");

      expect(result).toEqual(states);
      expect(result).toHaveLength(3);
    });

    it("returns empty array when no states exist", async () => {
      mockSelect.mockResolvedValue([]);

      const result = await getAllJmapSyncStates("acc-nonexistent");

      expect(result).toEqual([]);
    });

    it("passes account_id and orders by object_type ASC", async () => {
      mockSelect.mockResolvedValue([]);

      await getAllJmapSyncStates("acc-1");

      const [sql, params] = mockSelect.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("WHERE account_id = $1");
      expect(sql).toContain("ORDER BY object_type ASC");
      expect(params).toEqual(["acc-1"]);
    });
  });
});

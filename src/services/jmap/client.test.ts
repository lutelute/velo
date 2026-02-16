import { describe, it, expect, beforeEach, vi } from "vitest";
import { JmapClient } from "./client";
import type { JmapSession, JmapResponse } from "./types";

// Mock Tauri HTTP plugin
const mockFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

describe("JmapClient", () => {
  const sessionUrl = "https://jmap.example.com/.well-known/jmap";
  const basicAuthCredential = btoa("user@example.com:password");
  const bearerToken = "test-bearer-token";

  const validSession: JmapSession = {
    capabilities: {
      "urn:ietf:params:jmap:core": {},
      "urn:ietf:params:jmap:mail": {},
    },
    accounts: {
      acc123: {
        name: "Test Account",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: {
          "urn:ietf:params:jmap:mail": {},
        },
      },
    },
    primaryAccounts: {
      "urn:ietf:params:jmap:mail": "acc123",
    },
    username: "test@example.com",
    apiUrl: "https://jmap.example.com/api",
    downloadUrl:
      "https://jmap.example.com/download/{accountId}/{blobId}/{name}?type={type}",
    uploadUrl: "https://jmap.example.com/upload/{accountId}",
    eventSourceUrl: "https://jmap.example.com/events",
    state: "state123",
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("getSession", () => {
    it("fetches and caches session", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      const session1 = await client.getSession();
      expect(session1).toEqual(validSession);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(sessionUrl, {
        method: "GET",
        headers: {
          Authorization: `Basic ${basicAuthCredential}`,
          Accept: "application/json",
        },
      });

      // Second call should use cached session
      const session2 = await client.getSession();
      expect(session2).toEqual(validSession);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it("uses Basic auth header for basic method", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      await client.getSession();

      expect(mockFetch).toHaveBeenCalledWith(sessionUrl, {
        method: "GET",
        headers: {
          Authorization: `Basic ${basicAuthCredential}`,
          Accept: "application/json",
        },
      });
    });

    it("uses Bearer auth header for bearer method", async () => {
      const client = new JmapClient(sessionUrl, "bearer", bearerToken);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      await client.getSession();

      expect(mockFetch).toHaveBeenCalledWith(sessionUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: "application/json",
        },
      });
    });

    it("throws on non-OK response", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(client.getSession()).rejects.toThrow(
        "JMAP session discovery failed: 401 Unauthorized",
      );
    });
  });

  describe("clearSession", () => {
    it("forces re-fetch after clearing session", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => validSession,
      });

      // First fetch
      await client.getSession();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Clear session
      client.clearSession();

      // Second fetch should call API again
      await client.getSession();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("getJmapAccountId", () => {
    it("returns primary mail account ID", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      const accountId = await client.getJmapAccountId();
      expect(accountId).toBe("acc123");
    });

    it("throws when no mail account found", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      const sessionWithoutMail: JmapSession = {
        ...validSession,
        primaryAccounts: {},
        accounts: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sessionWithoutMail,
      });

      await expect(client.getJmapAccountId()).rejects.toThrow(
        "No JMAP mail account found in session",
      );
    });
  });

  describe("apiCall", () => {
    it("sends correct JSON body", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      // Mock session fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      // Mock API call
      const apiResponse: JmapResponse = {
        methodResponses: [
          ["Mailbox/get", { accountId: "acc123", list: [] }, "mb0"],
        ],
        sessionState: "state123",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => apiResponse,
      });

      const methodCalls: [string, Record<string, unknown>, string][] = [
        ["Mailbox/get", { accountId: "acc123" }, "mb0"],
      ];

      const response = await client.apiCall(methodCalls);

      expect(response).toEqual(apiResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2); // 1 for session, 1 for API
      expect(mockFetch).toHaveBeenNthCalledWith(2, validSession.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuthCredential}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          using: [
            "urn:ietf:params:jmap:core",
            "urn:ietf:params:jmap:mail",
            "urn:ietf:params:jmap:submission",
          ],
          methodCalls,
        }),
      });
    });

    it("clears session when sessionState changes", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      // Mock session fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      // Mock API call with changed sessionState
      const apiResponse: JmapResponse = {
        methodResponses: [
          ["Mailbox/get", { accountId: "acc123", list: [] }, "mb0"],
        ],
        sessionState: "state456", // Changed state
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => apiResponse,
      });

      const methodCalls: [string, Record<string, unknown>, string][] = [
        ["Mailbox/get", { accountId: "acc123" }, "mb0"],
      ];

      await client.apiCall(methodCalls);

      // Session should be cleared, so next call fetches session again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...validSession, state: "state456" }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => apiResponse,
      });

      await client.apiCall(methodCalls);

      // Should have called fetch 4 times total:
      // 1. Initial session
      // 2. First API call
      // 3. Re-fetch session (after clear)
      // 4. Second API call
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("throws on non-OK response", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      // Mock session fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      // Mock failed API call
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const methodCalls: [string, Record<string, unknown>, string][] = [
        ["Mailbox/get", { accountId: "acc123" }, "mb0"],
      ];

      await expect(client.apiCall(methodCalls)).rejects.toThrow(
        "JMAP API call failed: 500 Internal Server Error",
      );
    });
  });

  describe("getMethodResponse", () => {
    it("returns correct response by callId", () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      const response: JmapResponse = {
        methodResponses: [
          ["Mailbox/get", { accountId: "acc123", list: [] }, "mb0"],
          ["Email/query", { accountId: "acc123", ids: ["e1"] }, "eq0"],
        ],
        sessionState: "state123",
      };

      const result = client.getMethodResponse(response, "eq0");
      expect(result).toEqual({ accountId: "acc123", ids: ["e1"] });
    });

    it("throws on error response", () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      const response: JmapResponse = {
        methodResponses: [
          [
            "error",
            { type: "invalidArguments", description: "Invalid account ID" },
            "mb0",
          ],
        ],
        sessionState: "state123",
      };

      expect(() => client.getMethodResponse(response, "mb0")).toThrow(
        "JMAP error (invalidArguments): Invalid account ID",
      );
    });

    it("throws when callId not found", () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      const response: JmapResponse = {
        methodResponses: [
          ["Mailbox/get", { accountId: "acc123", list: [] }, "mb0"],
        ],
        sessionState: "state123",
      };

      expect(() => client.getMethodResponse(response, "notfound")).toThrow(
        "No response found for call ID: notfound",
      );
    });
  });

  describe("testConnection", () => {
    it("returns success for valid session with mail capability", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validSession,
      });

      const result = await client.testConnection();

      expect(result).toEqual({
        success: true,
        message: "Connected as test@example.com",
      });
    });

    it("returns failure when mail capability missing", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      const sessionWithoutMail: JmapSession = {
        ...validSession,
        capabilities: {
          "urn:ietf:params:jmap:core": {},
          // No mail capability
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sessionWithoutMail,
      });

      const result = await client.testConnection();

      expect(result).toEqual({
        success: false,
        message:
          "Server does not support JMAP Mail (urn:ietf:params:jmap:mail)",
      });
    });

    it("returns failure on error", async () => {
      const client = new JmapClient(sessionUrl, "basic", basicAuthCredential);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const result = await client.testConnection();

      expect(result).toEqual({
        success: false,
        message: "JMAP session discovery failed: 401 Unauthorized",
      });
    });
  });
});

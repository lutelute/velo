import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverJmapUrl, isKnownJmapProvider } from "./autoDiscovery";

const mockFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

describe("discoverJmapUrl", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns known provider URL for fastmail.com", async () => {
    const result = await discoverJmapUrl("user@fastmail.com");

    expect(result).toEqual({
      sessionUrl: "https://api.fastmail.com/jmap/session",
      source: "known-provider",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns known provider URL for messagingengine.com", async () => {
    const result = await discoverJmapUrl("user@messagingengine.com");

    expect(result).toEqual({
      sessionUrl: "https://api.fastmail.com/jmap/session",
      source: "known-provider",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("tries .well-known/jmap for unknown domains", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    await discoverJmapUrl("user@unknown.com");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://unknown.com/.well-known/jmap",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      }
    );
  });

  it("returns well-known result on 200 OK", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await discoverJmapUrl("user@example.com");

    expect(result).toEqual({
      sessionUrl: "https://example.com/.well-known/jmap",
      source: "well-known",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/.well-known/jmap",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      }
    );
  });

  it("returns null when .well-known fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await discoverJmapUrl("user@nojmap.com");

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns null when .well-known throws error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await discoverJmapUrl("user@offline.com");

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns null for invalid email", async () => {
    const result = await discoverJmapUrl("notanemail");

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for email without domain", async () => {
    const result = await discoverJmapUrl("user@");

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles case-insensitive domain matching", async () => {
    const result = await discoverJmapUrl("user@FASTMAIL.COM");

    expect(result).toEqual({
      sessionUrl: "https://api.fastmail.com/jmap/session",
      source: "known-provider",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("isKnownJmapProvider", () => {
  it("returns true for fastmail.com", () => {
    expect(isKnownJmapProvider("user@fastmail.com")).toBe(true);
  });

  it("returns true for messagingengine.com", () => {
    expect(isKnownJmapProvider("user@messagingengine.com")).toBe(true);
  });

  it("returns false for gmail.com", () => {
    expect(isKnownJmapProvider("user@gmail.com")).toBe(false);
  });

  it("returns false for unknown domains", () => {
    expect(isKnownJmapProvider("user@example.com")).toBe(false);
  });

  it("returns false for invalid email", () => {
    expect(isKnownJmapProvider("notanemail")).toBe(false);
  });

  it("handles case-insensitive domain matching", () => {
    expect(isKnownJmapProvider("user@FASTMAIL.COM")).toBe(true);
  });
});

import { fetch } from "@tauri-apps/plugin-http";

/** Known JMAP provider configurations */
const KNOWN_PROVIDERS: Record<string, string> = {
  "fastmail.com": "https://api.fastmail.com/jmap/session",
  "messagingengine.com": "https://api.fastmail.com/jmap/session",
};

export interface JmapDiscoveryResult {
  sessionUrl: string;
  source: "well-known" | "known-provider" | "manual";
}

/**
 * Attempt to discover the JMAP session URL for a given email domain.
 *
 * Tries in order:
 * 1. Known providers (Fastmail, etc.)
 * 2. RFC 8620 `.well-known/jmap` discovery
 */
export async function discoverJmapUrl(
  email: string,
): Promise<JmapDiscoveryResult | null> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  // 1. Check known providers
  const knownUrl = KNOWN_PROVIDERS[domain];
  if (knownUrl) {
    return { sessionUrl: knownUrl, source: "known-provider" };
  }

  // 2. Try .well-known/jmap (RFC 8620 Section 2.2)
  try {
    const wellKnownUrl = `https://${domain}/.well-known/jmap`;
    const resp = await fetch(wellKnownUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (resp.ok) {
      // The .well-known/jmap URL IS the session URL if it returns session data
      return { sessionUrl: wellKnownUrl, source: "well-known" };
    }
  } catch {
    // Discovery failed — not a JMAP server
  }

  return null;
}

/**
 * Check if a domain is a known JMAP provider.
 */
export function isKnownJmapProvider(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && domain in KNOWN_PROVIDERS;
}

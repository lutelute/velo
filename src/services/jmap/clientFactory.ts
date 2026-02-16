import { JmapClient } from "./client";
import type { DbAccount } from "../db/accounts";
import type { JmapAuthMethod } from "./types";

/**
 * Create a JmapClient for a database account record.
 */
export async function createJmapClientForAccount(
  account: DbAccount,
): Promise<JmapClient> {
  if (!account.jmap_url) {
    throw new Error("JMAP URL not configured for this account");
  }

  let authMethod: JmapAuthMethod;
  let authCredential: string;

  if (account.auth_method === "oauth2" || account.auth_method === "bearer") {
    // Bearer token auth
    authMethod = "bearer";
    if (!account.access_token) {
      throw new Error("No access token available for JMAP account");
    }
    authCredential = account.access_token;
  } else {
    // Basic auth (app password)
    authMethod = "basic";
    const password = account.imap_password ?? "";
    authCredential = btoa(`${account.email}:${password}`);
  }

  return new JmapClient(account.jmap_url, authMethod, authCredential);
}

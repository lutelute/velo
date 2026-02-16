import { fetch } from "@tauri-apps/plugin-http";
import type {
  JmapSession,
  JmapRequest,
  JmapResponse,
  JmapMethodCall,
  JmapAuthMethod,
} from "./types";

const JMAP_CORE_CAPABILITY = "urn:ietf:params:jmap:core";
const JMAP_MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";
const JMAP_SUBMISSION_CAPABILITY = "urn:ietf:params:jmap:submission";

/**
 * JMAP HTTP client — manages session discovery and authenticated API calls.
 * Uses Tauri's HTTP plugin fetch to bypass CSP for arbitrary domains.
 */
export class JmapClient {
  private sessionUrl: string;
  private authMethod: JmapAuthMethod;
  private authCredential: string; // base64(user:pass) for basic, raw token for bearer
  private session: JmapSession | null = null;
  private accountId: string | null = null; // JMAP account ID (not app account ID)

  constructor(
    sessionUrl: string,
    authMethod: JmapAuthMethod,
    authCredential: string,
  ) {
    this.sessionUrl = sessionUrl;
    this.authMethod = authMethod;
    this.authCredential = authCredential;
  }

  private getAuthHeader(): string {
    if (this.authMethod === "basic") {
      return `Basic ${this.authCredential}`;
    }
    return `Bearer ${this.authCredential}`;
  }

  /**
   * Discover and cache the JMAP session resource.
   */
  async getSession(): Promise<JmapSession> {
    if (this.session) return this.session;

    const resp = await fetch(this.sessionUrl, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`JMAP session discovery failed: ${resp.status} ${resp.statusText}`);
    }

    this.session = (await resp.json()) as JmapSession;

    // Determine primary mail account
    this.accountId =
      this.session.primaryAccounts[JMAP_MAIL_CAPABILITY] ??
      Object.keys(this.session.accounts)[0] ??
      null;

    return this.session;
  }

  /**
   * Invalidate the cached session (e.g., if sessionState changed).
   */
  clearSession(): void {
    this.session = null;
    this.accountId = null;
  }

  /**
   * Get the JMAP account ID for mail operations.
   */
  async getJmapAccountId(): Promise<string> {
    if (!this.accountId) {
      await this.getSession();
    }
    if (!this.accountId) {
      throw new Error("No JMAP mail account found in session");
    }
    return this.accountId;
  }

  /**
   * Make a JMAP API call with one or more method invocations.
   */
  async apiCall(methodCalls: JmapMethodCall[]): Promise<JmapResponse> {
    const session = await this.getSession();

    const request: JmapRequest = {
      using: [JMAP_CORE_CAPABILITY, JMAP_MAIL_CAPABILITY, JMAP_SUBMISSION_CAPABILITY],
      methodCalls,
    };

    const resp = await fetch(session.apiUrl, {
      method: "POST",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!resp.ok) {
      throw new Error(`JMAP API call failed: ${resp.status} ${resp.statusText}`);
    }

    const response = (await resp.json()) as JmapResponse;

    // Check if session state changed
    if (response.sessionState !== session.state) {
      this.clearSession();
    }

    return response;
  }

  /**
   * Extract a method response by call ID, throwing on errors.
   */
  getMethodResponse(
    response: JmapResponse,
    callId: string,
  ): Record<string, unknown> {
    for (const [name, args, id] of response.methodResponses) {
      if (id === callId) {
        if (name === "error") {
          const errType = (args as Record<string, unknown>).type ?? "unknown";
          const errDesc = (args as Record<string, unknown>).description ?? "";
          throw new Error(`JMAP error (${errType}): ${errDesc}`);
        }
        return args;
      }
    }
    throw new Error(`No response found for call ID: ${callId}`);
  }

  // ---- Convenience methods ----

  async mailboxGet(
    properties?: string[],
  ): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const args: Record<string, unknown> = { accountId };
    if (properties) args.properties = properties;

    const resp = await this.apiCall([["Mailbox/get", args, "mb0"]]);
    return this.getMethodResponse(resp, "mb0");
  }

  async mailboxChanges(sinceState: string): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const resp = await this.apiCall([
      ["Mailbox/changes", { accountId, sinceState }, "mbc0"],
    ]);
    return this.getMethodResponse(resp, "mbc0");
  }

  async mailboxSet(
    create?: Record<string, unknown>,
    update?: Record<string, Record<string, unknown>>,
    destroy?: string[],
  ): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const args: Record<string, unknown> = { accountId };
    if (create) args.create = create;
    if (update) args.update = update;
    if (destroy) args.destroy = destroy;

    const resp = await this.apiCall([["Mailbox/set", args, "mbs0"]]);
    return this.getMethodResponse(resp, "mbs0");
  }

  async emailQuery(
    filter: Record<string, unknown>,
    sort?: Record<string, unknown>[],
    position?: number,
    limit?: number,
  ): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const args: Record<string, unknown> = { accountId, filter };
    if (sort) args.sort = sort;
    if (position !== undefined) args.position = position;
    if (limit !== undefined) args.limit = limit;

    const resp = await this.apiCall([["Email/query", args, "eq0"]]);
    return this.getMethodResponse(resp, "eq0");
  }

  async emailGet(
    ids: string[],
    properties?: string[],
    bodyProperties?: string[],
    fetchTextBodyValues?: boolean,
    fetchHTMLBodyValues?: boolean,
  ): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const args: Record<string, unknown> = { accountId, ids };
    if (properties) args.properties = properties;
    if (bodyProperties) args.bodyProperties = bodyProperties;
    if (fetchTextBodyValues) args.fetchTextBodyValues = true;
    if (fetchHTMLBodyValues) args.fetchHTMLBodyValues = true;

    const resp = await this.apiCall([["Email/get", args, "eg0"]]);
    return this.getMethodResponse(resp, "eg0");
  }

  async emailChanges(sinceState: string): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const resp = await this.apiCall([
      ["Email/changes", { accountId, sinceState }, "ec0"],
    ]);
    return this.getMethodResponse(resp, "ec0");
  }

  async emailSet(
    create?: Record<string, unknown>,
    update?: Record<string, Record<string, unknown>>,
    destroy?: string[],
  ): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const args: Record<string, unknown> = { accountId };
    if (create) args.create = create;
    if (update) args.update = update;
    if (destroy) args.destroy = destroy;

    const resp = await this.apiCall([["Email/set", args, "es0"]]);
    return this.getMethodResponse(resp, "es0");
  }

  async emailSubmissionSet(
    create?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const accountId = await this.getJmapAccountId();
    const args: Record<string, unknown> = { accountId };
    if (create) args.create = create;

    const resp = await this.apiCall([
      ["EmailSubmission/set", args, "ess0"],
    ]);
    return this.getMethodResponse(resp, "ess0");
  }

  // ---- Blob operations ----

  /**
   * Download a blob (attachment, raw message).
   */
  async downloadBlob(blobId: string): Promise<ArrayBuffer> {
    const session = await this.getSession();
    const accountId = await this.getJmapAccountId();

    const url = session.downloadUrl
      .replace("{accountId}", encodeURIComponent(accountId))
      .replace("{blobId}", encodeURIComponent(blobId))
      .replace("{type}", "application/octet-stream")
      .replace("{name}", "download");

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    if (!resp.ok) {
      throw new Error(`Blob download failed: ${resp.status}`);
    }

    return resp.arrayBuffer();
  }

  /**
   * Upload a blob (for sending messages).
   * Returns the blobId of the uploaded content.
   */
  async uploadBlob(data: Uint8Array, type: string): Promise<string> {
    const session = await this.getSession();
    const accountId = await this.getJmapAccountId();

    const url = session.uploadUrl.replace(
      "{accountId}",
      encodeURIComponent(accountId),
    );

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": type,
      },
      body: data.buffer as ArrayBuffer,
    });

    if (!resp.ok) {
      throw new Error(`Blob upload failed: ${resp.status}`);
    }

    const result = (await resp.json()) as { blobId: string; type: string; size: number };
    return result.blobId;
  }

  /**
   * Test the connection by fetching the session resource.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const session = await this.getSession();
      const hasMailCapability = JMAP_MAIL_CAPABILITY in session.capabilities;
      if (!hasMailCapability) {
        return {
          success: false,
          message: "Server does not support JMAP Mail (urn:ietf:params:jmap:mail)",
        };
      }
      return {
        success: true,
        message: `Connected as ${session.username}`,
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Unknown connection error",
      };
    }
  }
}

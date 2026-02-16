/** Authentication method for JMAP connections */
export type JmapAuthMethod = "basic" | "bearer";

/** JMAP Session resource (RFC 8620 Section 2) */
export interface JmapSession {
  capabilities: Record<string, unknown>;
  accounts: Record<
    string,
    {
      name: string;
      isPersonal: boolean;
      isReadOnly: boolean;
      accountCapabilities: Record<string, unknown>;
    }
  >;
  primaryAccounts: Record<string, string>;
  username: string;
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string;
  state: string;
}

/** JMAP email address object */
export interface JmapEmailAddress {
  name: string | null;
  email: string;
}

/** JMAP body part (RFC 8621 Section 4.1.4) */
export interface JmapBodyPart {
  partId: string | null;
  blobId: string | null;
  size: number;
  name: string | null;
  type: string;
  charset: string | null;
  disposition: string | null;
  cid: string | null;
  subParts: JmapBodyPart[] | null;
}

/** JMAP Mailbox object (RFC 8621 Section 2) */
export interface JmapMailbox {
  id: string;
  name: string;
  parentId: string | null;
  role: string | null;
  sortOrder: number;
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
  myRights: {
    mayReadItems: boolean;
    mayAddItems: boolean;
    mayRemoveItems: boolean;
    maySetSeen: boolean;
    maySetKeywords: boolean;
    mayCreateChild: boolean;
    mayRename: boolean;
    mayDelete: boolean;
    maySubmit: boolean;
  };
  isSubscribed: boolean;
}

/** JMAP Email object (RFC 8621 Section 4) */
export interface JmapEmail {
  id: string;
  blobId: string;
  threadId: string;
  mailboxIds: Record<string, boolean>;
  keywords: Record<string, boolean>;
  size: number;
  receivedAt: string;
  messageId: string[] | null;
  inReplyTo: string[] | null;
  references: string[] | null;
  sender: JmapEmailAddress[] | null;
  from: JmapEmailAddress[] | null;
  to: JmapEmailAddress[] | null;
  cc: JmapEmailAddress[] | null;
  bcc: JmapEmailAddress[] | null;
  replyTo: JmapEmailAddress[] | null;
  subject: string | null;
  sentAt: string | null;
  hasAttachment: boolean;
  preview: string;
  bodyStructure: JmapBodyPart | null;
  bodyValues: Record<string, { value: string; isEncodingProblem: boolean; isTruncated: boolean }> | null;
  textBody: JmapBodyPart[] | null;
  htmlBody: JmapBodyPart[] | null;
  attachments: JmapBodyPart[] | null;
}

/** A single JMAP method call [methodName, args, callId] */
export type JmapMethodCall = [string, Record<string, unknown>, string];

/** JMAP request body (RFC 8620 Section 3.3) */
export interface JmapRequest {
  using: string[];
  methodCalls: JmapMethodCall[];
}

/** JMAP response body (RFC 8620 Section 3.4) */
export interface JmapResponse {
  methodResponses: [string, Record<string, unknown>, string][];
  sessionState: string;
}

/** JMAP /changes response */
export interface JmapChangesResponse {
  accountId: string;
  oldState: string;
  newState: string;
  hasMoreChanges: boolean;
  created: string[];
  updated: string[];
  destroyed: string[];
}

/** JMAP error response */
export interface JmapError {
  type: string;
  description?: string;
}

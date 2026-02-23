import { getSenderProfile } from "@/services/db/senderBehaviorProfiles";
import { callAi } from "./aiService";
import { BEHAVIOR_SUGGESTION_PROMPT } from "./prompts";
import { getSetting } from "@/services/db/settings";

export interface BehaviorSuggestion {
  action: "reply" | "archive" | "trash" | "star" | "create_task" | "read_later";
  confidence: number;
  reason: string;
  source: "rule" | "ai";
}

function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const idx = email.lastIndexOf("@");
  return idx >= 0 ? email.slice(idx + 1).toLowerCase() : null;
}

/**
 * Get a behavior-based suggestion for how to handle a thread.
 * Uses a two-tier approach:
 * 1. Rule-based (fast): If sender profile has 5+ history entries and 70%+ for one action
 * 2. AI-assisted (slower): If pattern is unclear, ask AI
 */
export async function getBehaviorSuggestion(
  accountId: string,
  fromAddress: string | null,
  threadSnippet: string,
  threadSubject: string,
): Promise<BehaviorSuggestion | null> {
  // Check if feature is enabled
  const enabled = await getSetting("ai_behavior_suggestions_enabled");
  if (enabled === "false") return null;

  const domain = extractDomain(fromAddress);
  if (!domain) return null;

  // Try address-level profile first, then domain-level
  const profile =
    (fromAddress ? await getSenderProfile(accountId, domain, fromAddress) : null) ??
    await getSenderProfile(accountId, domain);

  if (!profile) return null;

  // Tier 1: Rule-based (fast, offline-capable)
  const total = profile.total_received;
  if (total >= 5) {
    const actions = [
      { action: "reply" as const, count: profile.total_replied },
      { action: "archive" as const, count: profile.total_archived },
      { action: "trash" as const, count: profile.total_trashed },
    ];

    const best = actions.reduce((a, b) => (b.count > a.count ? b : a));
    const ratio = best.count / total;

    if (ratio >= 0.7) {
      return {
        action: best.action,
        confidence: Math.min(ratio, 0.95),
        reason: `You ${best.action} ${Math.round(ratio * 100)}% of emails from ${domain}`,
        source: "rule",
      };
    }
  }

  // Tier 2: AI-assisted (only if pattern is unclear and AI is enabled)
  const aiEnabled = await getSetting("ai_enabled");
  if (aiEnabled === "false") return null;
  if (total < 3) return null; // Not enough data for AI either

  try {
    const profileSummary = [
      `Sender: ${fromAddress ?? domain}`,
      `Total received: ${total}`,
      `Replied: ${profile.total_replied}`,
      `Archived: ${profile.total_archived}`,
      `Trashed: ${profile.total_trashed}`,
      profile.avg_response_time_seconds
        ? `Avg response time: ${Math.round(profile.avg_response_time_seconds / 60)} min`
        : null,
    ].filter(Boolean).join("\n");

    const userContent = `Sender profile:\n${profileSummary}\n\nCurrent email:\n<email_content>Subject: ${threadSubject}\n\n${threadSnippet.slice(0, 2000)}</email_content>`;

    const result = await callAi(BEHAVIOR_SUGGESTION_PROMPT, userContent);

    // Parse JSON response
    const jsonMatch = result.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      action?: string;
      confidence?: number;
      reason?: string;
    };

    const validActions = new Set(["reply", "archive", "trash", "star", "create_task", "read_later"]);
    if (!parsed.action || !validActions.has(parsed.action)) return null;

    return {
      action: parsed.action as BehaviorSuggestion["action"],
      confidence: Math.min(Math.max(parsed.confidence ?? 0.5, 0), 1),
      reason: parsed.reason ?? "Based on your past behavior",
      source: "ai",
    };
  } catch {
    return null;
  }
}

import { parseSearchQuery } from "./searchParser";
import { buildSearchQuery } from "./searchQueryBuilder";

/**
 * Replace dynamic date tokens in a query string.
 *  - __LAST_7_DAYS__  -> date 7 days ago (YYYY/MM/DD)
 *  - __LAST_30_DAYS__ -> date 30 days ago (YYYY/MM/DD)
 *  - __TODAY__        -> today's date (YYYY/MM/DD)
 */
export function resolveQueryTokens(query: string): string {
  const now = new Date();

  const formatDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  };

  let resolved = query;

  if (resolved.includes("__LAST_7_DAYS__")) {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    resolved = resolved.replace(/__LAST_7_DAYS__/g, formatDate(d));
  }

  if (resolved.includes("__LAST_30_DAYS__")) {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    resolved = resolved.replace(/__LAST_30_DAYS__/g, formatDate(d));
  }

  if (resolved.includes("__TODAY__")) {
    resolved = resolved.replace(/__TODAY__/g, formatDate(now));
  }

  return resolved;
}

/**
 * Build a SQL query for a smart folder's raw query string.
 * Resolves tokens, parses operators, and builds parameterized SQL.
 */
export function getSmartFolderSearchQuery(
  rawQuery: string,
  accountId: string,
  limit?: number,
): { sql: string; params: unknown[] } {
  const resolved = resolveQueryTokens(rawQuery);
  const parsed = parseSearchQuery(resolved);
  return buildSearchQuery(parsed, accountId, limit ?? 50);
}

/**
 * Build a COUNT query for unread messages matching a smart folder's query.
 * Returns { sql, params } where sql produces a single row with `count` column.
 */
export function getSmartFolderUnreadCount(
  rawQuery: string,
  accountId: string,
): { sql: string; params: unknown[] } {
  const resolved = resolveQueryTokens(rawQuery);
  const parsed = parseSearchQuery(resolved);

  // Force unread filter
  const withUnread = { ...parsed, isUnread: true };
  const { sql: baseSql, params } = buildSearchQuery(withUnread, accountId, 999999);

  // Replace SELECT ... FROM with SELECT COUNT(DISTINCT ...) FROM and remove LIMIT
  const countSql = baseSql
    .replace(/SELECT DISTINCT[\s\S]*?(?=FROM)/i, "SELECT COUNT(DISTINCT m.id) as count ")
    .replace(/ORDER BY[\s\S]*?(?=LIMIT|$)/i, "")
    .replace(/LIMIT \$\d+/i, "");

  // Remove the last param (which was the limit)
  const countParams = params.slice(0, -1);

  return { sql: countSql, params: countParams };
}

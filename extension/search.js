/** Case-insensitive partial match. Space-separated tokens are AND. `*` is a wildcard. */

export function rowMatchesQuery(parts, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  const hay = parts
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((token) => tokenMatches(hay, token));
}

function tokenMatches(hay, token) {
  const escaped = token.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(escaped).test(hay);
}

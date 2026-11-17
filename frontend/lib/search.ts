const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
const SEARCH_PUNCTUATION_RE = /[^\p{L}\p{N}\s]+/gu;
const SEARCH_WHITESPACE_RE = /\s+/g;

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .toLocaleLowerCase()
    .replace(SEARCH_PUNCTUATION_RE, "")
    .replace(SEARCH_WHITESPACE_RE, " ")
    .trim();
}

/**
 * Case-insensitive, order-independent text matching shared by the list views.
 *
 * Matching is punctuation-tolerant and Unicode-aware, so names such as
 * "Anne-Marie O'Connor", "Joao", and non-Latin text remain searchable by
 * partial strings and mixed-case queries.
 */
export function matchesSearch(query: string, ...fields: Array<string | number | null | undefined>): boolean {
  const tokens = normalizeSearchValue(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearchValue(fields.map((field) => (field == null ? "" : String(field))).join(" "));
  return tokens.every((token) => haystack.includes(token));
}

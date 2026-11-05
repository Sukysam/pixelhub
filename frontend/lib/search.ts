/**
 * Case-insensitive, order-independent text matching shared by the list views.
 *
 * A record matches when every whitespace-separated token in `query` is found in
 * the concatenated `fields`, which lets users search by any character, word, or
 * combination of words (for example "acme lagos" matches a customer whose name
 * and address contain those tokens in any order).
 */
export function matchesSearch(query: string, ...fields: Array<string | number | null | undefined>): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = fields.map((field) => (field == null ? "" : String(field))).join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

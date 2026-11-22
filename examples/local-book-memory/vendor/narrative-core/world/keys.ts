/**
 * [INPUT]: none (pure string helpers)
 * [OUTPUT]: `subjectOf` / `mentions` — the two key/text primitives shared across the engine
 * [POS]: lib/narrative-core/world — single home for "what subject does this key belong to" and
 *   "does this value mention that thing". Both are engine logic (key canonicalisation, the F7 ego
 *   graph), not scoring: the harness has its own fuzzy matcher for grading extraction output, and
 *   the two must never be confused. Anything here is used to DECIDE, so it stays conservative.
 */

/** `neave.ring.material` → `neave`. The first segment is the subject by construction. */
export function subjectOf(key: string): string {
  return key.split(".")[0].toLowerCase()
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * Does this value mention a distinctive word? Prefix-tolerant so "Ashcroft's" and "bolted" match
 * "ashcroft" and "bolt", which is what textual adjacency needs. Deliberately NOT a similarity
 * score — a caller gets a yes/no it can act on.
 */
export function mentions(value: string, token: string): boolean {
  const needle = token.toLowerCase()
  return tokens(value).some((word) => word === needle || word.startsWith(needle))
}

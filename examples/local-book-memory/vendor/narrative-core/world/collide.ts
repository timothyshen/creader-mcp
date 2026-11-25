/**
 * [INPUT]: freshly extracted claims + the folded world state
 * [OUTPUT]: `collisionsFor` — every claim whose key already holds a different live value
 * [POS]: lib/narrative-core/world — collision detection is CODE, deliberately.
 *
 *   An LLM check stage was tried and removed. It kept inventing canon entries ("no established
 *   timekeeping is mentioned") and so flagged every clean chapter — absence read as contradiction.
 *   Once keys are canonicalised, "does an existing key already hold a different value" is a
 *   comparison, and a comparison belongs in code, where its precision does not depend on a prompt
 *   and cannot hallucinate the thing it is comparing against.
 */

import { truthOf } from "./fold"
import type { Contradiction, WorldState } from "./types"

/** Same key AND same value twice in one batch is one fact, not two live records. Cheap and
 *  unconditional — a duplicate needs no adjudication, only removal. */
export function dedupeExact<T extends { key: string; value?: string | null }>(claims: T[]): T[] {
  const seen = new Set<string>()
  return claims.filter((claim) => {
    const signature = `${claim.key} ${claim.value ?? ""}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

/**
 * Refutations must be included alongside assertions: a chapter that only CORRECTS something and
 * asserts nothing new would otherwise read as clean, and its correction would never be adjudicated.
 */
export function collisionsFor(
  claims: Array<{ key: string; value?: string | null; evidence?: string }>,
  state: WorldState,
): Contradiction[] {
  const out: Contradiction[] = []

  for (const claim of claims) {
    if (claim.value == null) continue
    const conflicting = truthOf(state, claim.key).filter((r) => r.value !== claim.value)
    if (conflicting.length === 0) continue

    const held = conflicting[0]
    out.push({
      key: claim.key,
      claimed: claim.value,
      canonValue: held.value,
      evidence: claim.evidence ?? "",
      canonRef: `${held.key} = ${held.value} (${held.asserted.by}, #${held.asserted.ordinal})`,
    })
  }

  return out
}

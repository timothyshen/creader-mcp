/**
 * [INPUT]: freshly extracted claims + the key vocabulary already established in canon
 * [OUTPUT]: `canonicalizeKeys` — a conservative mapping from new keys onto existing ones
 * [POS]: lib/narrative-core/world — the stage whose absence made the engine's first live runs
 *   useless.
 *
 *   Nobody hands a real extractor a key vocabulary: it invents one on chapter 1, and every later
 *   chapter that phrases the same fact differently mints a variant. `wilbrand.position.library`
 *   and `wilbrand.location.evening` then never collide, so the contradiction between them is
 *   invisible to every later check. Measured cost when this stage was missing: 10 silent
 *   double-truths in a 10-chapter book.
 *
 *   A WRONG MERGE IS WORSE THAN A MISSED MERGE — it fabricates a contradiction and can overwrite
 *   good canon — so both passes here default to leaving a key alone.
 */

import { truthOf } from "./fold"
import { subjectOf } from "./keys"
import { CANONICALIZE_SYSTEM, canonicalizeUser } from "./prompts"
import { canonicalizeSchema, type NarrativeCall } from "./transport"
import type { Assertion, Refutation, WorldState } from "./types"

export interface KeyMapping {
  from: string
  to: string
  by: "deterministic" | "model"
}

/** Segments that carry no distinguishing meaning, so they must not be what a merge rests on. */
const ATTR_STOP = new Set(["state", "status", "value", "info", "detail", "current"])

export { subjectOf }

function attrTokens(key: string): Set<string> {
  return new Set(
    key
      .split(".")
      .slice(1)
      .flatMap((segment) => segment.split(/[_-]/))
      .map((token) => token.toLowerCase())
      .filter((token) => token.length > 2 && !ATTR_STOP.has(token)),
  )
}

/** Same subject and a materially overlapping attribute — safe to merge without asking a model. */
export function deterministicMatch(newKey: string, knownKeys: string[]): string | null {
  if (knownKeys.includes(newKey)) return newKey

  const subject = subjectOf(newKey)
  const mine = attrTokens(newKey)
  if (mine.size === 0) return null

  for (const known of knownKeys) {
    if (subjectOf(known) !== subject) continue
    const theirs = attrTokens(known)
    if (theirs.size === 0) continue
    const shared = [...mine].filter((token) => theirs.has(token)).length
    if (shared === 0) continue
    // Subset in either direction: "ring.material" and "ring.material.colour" are the same thing.
    if (shared === mine.size || shared === theirs.size) return known
  }
  return null
}

export async function canonicalizeKeys(input: {
  assertions: Assertion[]
  refutations: Refutation[]
  state: WorldState
  call: NarrativeCall
}): Promise<{ mapping: KeyMapping[]; llmCalls: number; promptChars: number }> {
  const knownKeys = Object.keys(input.state.ledger).filter((key) => truthOf(input.state, key).length > 0)
  if (knownKeys.length === 0) return { mapping: [], llmCalls: 0, promptChars: 0 }

  const claims = [
    ...input.assertions.map((a) => ({ key: a.key, value: a.value })),
    ...input.refutations.map((r) => ({ key: r.key, value: r.value ?? "" })),
  ]

  const mapping: KeyMapping[] = []
  const unresolved: Array<{ key: string; value: string }> = []

  for (const claim of claims) {
    if (mapping.some((m) => m.from === claim.key)) continue
    const hit = deterministicMatch(claim.key, knownKeys)
    if (hit === claim.key) continue // already canonical
    if (hit) {
      mapping.push({ from: claim.key, to: hit, by: "deterministic" })
      continue
    }
    if (!unresolved.some((u) => u.key === claim.key)) unresolved.push(claim)
  }

  if (unresolved.length === 0) return { mapping, llmCalls: 0, promptChars: 0 }

  const user = canonicalizeUser({
    known: knownKeys.map((key) => ({ key, value: truthOf(input.state, key)[0]?.value ?? "" })),
    candidates: unresolved,
  })
  const { value: out } = await input.call({ stage: "canonicalize", schema: canonicalizeSchema, system: CANONICALIZE_SYSTEM, user })

  for (const merge of out.merges ?? []) {
    // Never trust a merge onto a key that does not exist, onto a candidate we did not ask about,
    // or across subjects. A model that ignores the instruction must still not corrupt canon.
    if (!knownKeys.includes(merge.existingKey)) continue
    if (!unresolved.some((u) => u.key === merge.newKey)) continue
    if (subjectOf(merge.newKey) !== subjectOf(merge.existingKey)) continue
    if (mapping.some((m) => m.from === merge.newKey)) continue
    mapping.push({ from: merge.newKey, to: merge.existingKey, by: "model" })
  }

  return { mapping, llmCalls: 1, promptChars: CANONICALIZE_SYSTEM.length + user.length }
}

export function applyMapping<T extends { key: string; restsOn?: string[] | null }>(
  items: T[],
  mapping: KeyMapping[],
): T[] {
  if (mapping.length === 0) return items
  const lookup = new Map(mapping.map((m) => [m.from, m.to]))
  const rename = (key: string) => lookup.get(key) ?? key

  return items.map((item) => {
    const key = rename(item.key)
    // `restsOn` names OTHER keys, so it has to be renamed too. Rewriting only `item.key` meant a
    // causal edge kept pointing at a name canonicalization had just retired — the mapping was
    // learned and then thrown away, and the edge died in deriveDependsOn as "no such key".
    const restsOn = item.restsOn?.map(rename)
    if (key === item.key && !restsOn) return item
    return { ...item, key, ...(restsOn ? { restsOn } : {}) }
  })
}

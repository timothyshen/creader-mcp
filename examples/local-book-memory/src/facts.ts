/**
 * @input  none (types and two shared helpers)
 * @output FactRow — one proposed fact in the writer's review queue, as stored in .creader/facts.jsonl;
 *         Ruling — the writer's answer when a fact contradicts canon; quoteIn(), toAssertion().
 * @pos    local-book-memory — the one shape the proposer, the fold and triage share.
 */
import { gateEvidence } from "../vendor/narrative-core/world/gate-policy"
import type { Assertion, DeltaKind } from "../vendor/narrative-core/world/types"

export type FactStatus = "PENDING" | "ACCEPTED" | "DISMISSED"

/**
 * What the writer says about a fact that contradicts what canon held before its chapter. The three
 * accepting verdicts of narrative-core's ingest (gate-policy.ts). The fourth, continuity-error, is not an
 * acceptance: the chapter is wrong, so the writer fixes the prose and dismisses the fact.
 */
export type Ruling = "progression" | "misdirection-revealed" | "suspended"
export const RULINGS: readonly Ruling[] = ["progression", "misdirection-revealed", "suspended"]

export interface FactRow {
  id: string
  chapterId: string
  /** The chapter's contentHash when its quote was checked. A later edit is noticed by comparing it. */
  chapterHash: string
  /** `subject.attribute`, two or three dot-segments (narrative-core's key discipline). */
  key: string
  value: string
  /** WHO claims it: "narrator", or the character who says it. Hearsay stays hearsay. */
  by: string
  kind: DeltaKind
  /** Verbatim from the chapter; it had to be found there to be filed. */
  evidence: string
  status: FactStatus
  /** The agent's key, when it was a spelling variant of an existing key and the fact moved onto that one. */
  renamedFrom?: string
  /** An existing key this one resembles but was NOT merged into (a sub-attribute, a stop-word match): a hint. */
  nearKey?: string
  /** What canon held for this key, before this chapter, when the fact was filed. */
  collision?: { canonValue: string; canonRef: string }
  /** The writer's ruling on a collision, given with ACCEPTED. */
  ruling?: Ruling
  proposedAt: string
  decidedAt?: string
}

/**
 * Is the quote in the text? Through narrative-core's own evidence gate, not a copy of it: punctuation,
 * quote marks (「」/“”), case and ellipses are transcription noise, everything else must match.
 * gateEvidence takes contradiction-shaped items; the shape is filled only to pass the one field it reads.
 */
export function quoteIn(quote: string, text: string): boolean {
  return gateEvidence([{ key: "", claimed: "", canonValue: "", canonRef: "", evidence: quote }], text).length === 1
}

export function toAssertion(row: FactRow): Assertion {
  return { key: row.key, value: row.value, by: row.by, kind: row.kind, evidence: row.evidence }
}

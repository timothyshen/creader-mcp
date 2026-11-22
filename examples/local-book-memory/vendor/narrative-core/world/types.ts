/**
 * [INPUT]: none (pure type definitions)
 * [OUTPUT]: the world model — branching event log, facts with effectivity intervals, delta
 *   typology, the five ingest verdict classes
 * [POS]: lib/narrative-core/world — the production home of the engine validated in
 *   `demos/narrative-world/` (H5 GREEN, 2026-07-30). Part of the carve set: no Prisma, no
 *   `next/*`, no app wiring. Spec: `docs/plans/2026-07-28-narrative-world-platform-prd.md` §3.
 * [PROTOCOL]: 变更时同步 ARCHITECTURE.md 与 PRD §3
 */

export type EventId = string
export type BranchId = string

/** PRD §F3: gate strength follows the delta type, not the input form.
 *  physical → strong (refusable) · cognitive → medium · social → weak (fold, rarely refuse). */
export type DeltaKind = "physical" | "cognitive" | "social"

/** PRD §3.2: a fact is never a bare boolean — it is a claim by someone at some point.
 *  `by` is load-bearing: "the narrator said it" ≠ "the world is it". */
export interface Assertion {
  /** `subject.attribute` slug, e.g. "neave.ring.material". */
  key: string
  value: string
  /** WHO claims it. */
  by: string
  kind: DeltaKind
  /** Verbatim quote from the source text; anchor-gated before it can count as evidence. */
  evidence?: string
  /**
   * E3 causal edges, extracted alongside the fact (PRD §3.3): EXISTING canon keys whose truth this
   * claim is an INFERENCE from — "collapses if that turns out false", not "mentions it". Ingest
   * degrades these fact→key edges to event-level `dependsOn` (the event that asserted the key's
   * live record), so `fold` and `applyCascade` stay untouched by the finer granularity.
   *
   * A wrong edge later deletes good history through the cascade, while a missing edge merely
   * misses one linkage — so the discipline is asymmetric and extraction defaults to none.
   * `null` (not absent) when a model produced it: structured outputs cannot omit keys.
   */
  restsOn?: string[] | null
}

/**
 * PRD §3.2 — how an earlier record stopped being the operative truth:
 *
 * `in-world`   — the reader was misled; it was NEVER true. Record preserved as superseded (that
 *                is the art), and everything resting on it cascades (§3.3).
 * `progressed` — it WAS true, then the world moved on. Record preserved as history, and it does
 *                NOT cascade: testimony written while it held is still sound testimony.
 * `amended`    — the author revised a draft; it never happened. Record erased.
 *
 * `in-world` and `progressed` fold identically and cascade oppositely. That asymmetry is
 * load-bearing — see `applyCascade`.
 */
export type ResolutionKind = "in-world" | "progressed" | "amended"

export interface Refutation {
  key: string
  kind: ResolutionKind
  reason: string
  /** The corrected value, when the refutation also asserts a replacement. `null` (not absent)
   *  when a model produced it — structured outputs cannot omit keys. */
  value?: string | null
  evidence?: string
}

export type EventSource = "ingest" | "player" | "engine" | "author"

/** One node of the event log. Chapters (ingest), turns (play) and author edits are all events. */
export interface WorldEvent {
  id: EventId
  /** Position in the log — chapter number for ingest, turn index for play. */
  ordinal: number
  source: EventSource
  narrator: string
  text: string
  assertions: Assertion[]
  refutations: Refutation[]
  /** Keys this event puts in dispute WITHOUT resolving. Contesting is not refuting: both records
   *  stay live as `contested`, and forcing a winner is the failure mode. */
  contests?: string[]
  /** PRD §3.3 cascade edges: which earlier events this one's truth rests on. */
  dependsOn: EventId[]
}

export type Provenance = "canon" | "emergent-twist" | "player" | "author"

/**
 * `asserted`  — live, never challenged
 * `confirmed` — live, explicitly corroborated later
 * `refuted`   — superseded; kept (unless amended) so the misdirection or the history stays legible
 * `contested` — deliberately unsettled. Multiple live records coexist BY DESIGN — distinct from a
 *               silent double-truth, which is a defect.
 */
export type FactStatus = "asserted" | "confirmed" | "refuted" | "contested"

export interface FactRecord {
  key: string
  value: string
  asserted: { at: EventId; ordinal: number; by: string }
  status: FactStatus
  resolved: { at: EventId; ordinal: number; kind: ResolutionKind } | null
  provenance: Provenance
  /** Set when invalidated by cascade rather than by direct refutation (§3.3). */
  invalidatedBy?: EventId
}

/** Something ingest declined to fold — the source of the world-preview "needs review" list. */
export interface FlaggedItem {
  key: string
  atEvent: EventId
  ordinal: number
  reason: string
  claimed: string
  canonValue: string
}

export interface WorldState {
  /** key → every record ever asserted for it, in assertion order. THE effectivity ledger. */
  ledger: Record<string, FactRecord[]>
  /** Not folded into canon; surfaced to the author instead. */
  flagged: FlaggedItem[]
}

export interface Branch {
  id: BranchId
  /** null ⇒ this IS the trunk, or a branch with no trunk ancestry (a chat-grown world). */
  from: EventId | null
  events: WorldEvent[]
  owner?: string
}

/** PRD §3.4 — an author rule for this world. Deliberately the same shape the gate already
 *  consumes as a world rule: zero new mechanism, just `provenance: author`. */
export interface ConstitutionRule {
  id: string
  rule: string
  author: string
}

export interface World {
  id: string
  title: string
  trunk: WorldEvent[]
  branches: Record<BranchId, Branch>
  constitution: ConstitutionRule[]
}

/**
 * The five ingest classes (PRD §7). During ingest everything is authored text, so "reject" is
 * meaningless — you cannot reject the book. Every contradiction is exactly one of these.
 *
 * Precedence when a chapter yields several: see `ingestVerdict`.
 */
export type IngestVerdict =
  | "clean"
  | "misdirection-revealed"
  | "progression"
  | "continuity-error"
  | "suspended"

export interface Contradiction {
  key: string
  /** What the new text claims. */
  claimed: string
  /** What canon currently holds. */
  canonValue: string
  /** Verbatim quote from the new text — anchor-gated before it can count. */
  evidence: string
  canonRef: string
}

export interface AdjudicatedContradiction extends Contradiction {
  verdict: IngestVerdict
  reason: string
}

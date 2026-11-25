/**
 * @input  The chapters in reading order and the review queue.
 * @output foldCanon(): the world the ACCEPTED facts establish, folded chapter by chapter in reading order
 *         with narrative-core's own fold, plus what was held out of it and why:
 *         - stale:       the chapter changed since the fact was checked and its quote is gone
 *         - orphaned:    the chapter no longer exists
 *         - needsRuling: the fact contradicts what canon held before its chapter (or another fact of the
 *                        same chapter) and the writer has not said how
 *         Nothing unruled enters canon, so the fold can never make a silent double-truth; `doubleTruths`
 *         reports narrative-core's own check, which must stay empty.
 * @pos    local-book-memory — canon is DERIVED: recomputed from the queue and the prose on every read,
 *         never stored. Accept facts in any order; the fold is always in reading order.
 */
import { collisionsFor } from "../vendor/narrative-core/world/collide"
import { emptyState, foldStep, silentDoubleTruths } from "../vendor/narrative-core/world/fold"
import { buildEvent, resolveIntraBatch, type ChapterInput } from "../vendor/narrative-core/world/ingest"
import type { AdjudicatedContradiction, Assertion, Contradiction, WorldEvent, WorldState } from "../vendor/narrative-core/world/types"
import type { Chapter } from "./book.js"
import { quoteIn, toAssertion, type FactRow } from "./facts.js"

export interface Unruled { row: FactRow; canonValue: string; canonRef: string }

export interface Canon {
  state: WorldState
  stale: FactRow[]
  orphaned: FactRow[]
  needsRuling: Unruled[]
  doubleTruths: string[]
}

/**
 * buildEvent turns a ruled collision into a refutation that CARRIES the new value, and foldStep records a
 * carried value as said by the event's narrator — so "the jeweller says it was always gold" folded as the
 * narrator saying it, and hearsay became narration. Here the refutation only retires the old record and the
 * fact itself is asserted, with its claimant. The ledger is otherwise the same (refutations fold before
 * assertions). Upstream issue for narrative-core: see docs/plans/2026-11-19-local-book-memory.md §9.
 */
function keepClaimant(event: WorldEvent, kept: readonly Assertion[]): void {
  for (const refutation of event.refutations) {
    const claim = kept.find((a) => a.key === refutation.key && a.value === refutation.value)
    if (!claim) continue
    refutation.value = null
    if (!event.assertions.includes(claim)) event.assertions.push(claim)
  }
}

export function chapterInput(c: Chapter): ChapterInput {
  return { id: c.id, ordinal: c.order, narrator: "narrator", title: c.title, text: c.text }
}

/** `before`: fold only the chapters that come before this reading position (the canon a chapter is checked against). */
export async function foldCanon(chapters: readonly Chapter[], rows: readonly FactRow[], opts: { before?: number } = {}): Promise<Canon> {
  const accepted = rows.filter((r) => r.status === "ACCEPTED")
  const known = new Set(chapters.map((c) => c.id))
  const out: Canon = { state: emptyState(), stale: [], orphaned: accepted.filter((r) => !known.has(r.chapterId)), needsRuling: [], doubleTruths: [] }

  for (const chapter of chapters) {
    if (opts.before !== undefined && chapter.order >= opts.before) break
    const input = chapterInput(chapter)

    const live: FactRow[] = []
    for (const row of accepted.filter((r) => r.chapterId === chapter.id)) {
      if (row.chapterHash !== chapter.contentHash && !quoteIn(row.evidence, chapter.text)) out.stale.push(row)
      else live.push(row)
    }
    if (live.length === 0) continue

    // Inside the chapter: narrative-core's intra-batch pass, with the writer as the adjudicator. No
    // ruling reads as continuity-error there — the earlier fact stands, the later one is held back.
    const rowFor = (c: Contradiction) => live.find((r) => r.key === c.key && r.value === c.claimed)
    const intra = await resolveIntraBatch({
      chapter: input,
      assertions: live.map(toAssertion),
      adjudicate: async (c) => {
        const ruling = rowFor(c)?.ruling
        return { ...c, verdict: ruling ?? "continuity-error", reason: ruling ? "the writer's ruling" : "no ruling yet" }
      },
    })
    for (const f of intra.flagged) {
      const row = live.find((r) => r.key === f.key && r.value === f.claimed)
      if (row) out.needsRuling.push({ row, canonValue: f.canonValue, canonRef: `${f.key} = ${f.canonValue} (earlier in this same chapter)` })
    }

    // Against canon before this chapter: a collision with a ruling becomes the matching structural act,
    // a collision without one stays out.
    const adjudicated: AdjudicatedContradiction[] = []
    const held = new Set<string>()
    for (const c of collisionsFor(intra.assertions, out.state)) {
      const row = rowFor(c)
      if (row?.ruling) adjudicated.push({ ...c, verdict: row.ruling, reason: "the writer's ruling" })
      else {
        held.add(`${c.key}\u0000${c.claimed}`)
        if (row) out.needsRuling.push({ row, canonValue: c.canonValue, canonRef: c.canonRef })
      }
    }

    const kept = intra.assertions.filter((a) => !held.has(`${a.key}\u0000${a.value}`))
    const { event } = buildEvent({ chapter: input, assertions: kept, refutations: intra.refutations, adjudicated })
    if (intra.contests.length) event.contests = [...new Set([...(event.contests ?? []), ...intra.contests])]
    keepClaimant(event, kept)
    foldStep(out.state, event)
  }

  out.doubleTruths = silentDoubleTruths(out.state)
  return out
}

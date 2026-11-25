/**
 * @input  The queue, one fact id, the writer's decision (and ruling), the chapters.
 * @output triageFact(): the queue after the decision, or a TriageError saying what the writer must do.
 *         ACCEPTED is refused when the fact contradicts canon and no ruling says how (progression /
 *         misdirection-revealed / suspended), when its chapter is gone, or when its quote has left the
 *         chapter. The contradiction is computed against canon NOW, not the one recorded at filing:
 *         another acceptance may have changed it. `newlyUnruled` lists accepted facts of LATER chapters
 *         that this acceptance put in contradiction — they drop out of canon until the writer rules.
 * @pos    local-book-memory — the writer's half of the review queue. DISMISSED keeps the row, so the
 *         statement is not proposed again for that chapter (the hosted triage_entity_fact rule).
 */
import type { Chapter } from "./book.js"
import { foldCanon } from "./canon.js"
import { RULINGS, type FactRow, type Ruling } from "./facts.js"

export class TriageError extends Error {
  constructor(public readonly code: "not_found" | "decided" | "needs_ruling" | "stale" | "orphaned", message: string) { super(message) }
}

export async function triageFact(input: {
  chapters: readonly Chapter[]
  rows: readonly FactRow[]
  id: string
  status: "ACCEPTED" | "DISMISSED"
  ruling?: Ruling
  now: string
}): Promise<{ rows: FactRow[]; row: FactRow; newlyUnruled: FactRow[]; note?: string }> {
  const at = input.rows.findIndex((r) => r.id === input.id)
  const current = input.rows[at]
  if (!current) throw new TriageError("not_found", `no fact "${input.id}"`)
  if (current.status !== "PENDING") throw new TriageError("decided", `${input.id} was already ${current.status}`)

  if (input.status === "DISMISSED") {
    const row: FactRow = { ...current, status: "DISMISSED", decidedAt: input.now }
    return { rows: input.rows.map((r, i) => (i === at ? row : r)), row, newlyUnruled: [] }
  }

  const tryWith = (ruling: Ruling | undefined): FactRow[] =>
    input.rows.map((r, i) => {
      if (i !== at) return r
      const { ruling: _old, ...rest } = r
      return { ...rest, status: "ACCEPTED", decidedAt: input.now, ...(ruling ? { ruling } : {}) }
    })

  const was = await foldCanon(input.chapters, input.rows)
  const plain = await foldCanon(input.chapters, tryWith(undefined))
  if (plain.orphaned.some((r) => r.id === input.id)) throw new TriageError("orphaned", `the chapter of ${input.id} no longer exists; dismiss it`)
  if (plain.stale.some((r) => r.id === input.id)) {
    throw new TriageError("stale", `the chapter of ${input.id} changed and its quote is no longer there; dismiss it and propose again from the current text`)
  }

  const unruled = plain.needsRuling.find((u) => u.row.id === input.id)
  let rows: FactRow[]
  let note: string | undefined
  if (unruled) {
    if (!input.ruling) {
      throw new TriageError(
        "needs_ruling",
        `${input.id} says ${current.key} = ${current.value}, but canon holds ${unruled.canonRef}. Accept it with ruling ` +
          `${RULINGS.join(" | ")} — progression: it was true and changed; misdirection-revealed: the earlier value was never true; ` +
          `suspended: the book leaves it open. If the chapter is simply wrong, fix the prose and dismiss the fact.`,
      )
    }
    rows = tryWith(input.ruling)
  } else {
    rows = tryWith(undefined)
    if (input.ruling) note = `nothing in canon contradicts ${current.key} = ${current.value}; the ruling was not needed and was not kept`
  }

  const after = await foldCanon(input.chapters, rows)
  const before = new Set(was.needsRuling.map((u) => u.row.id))
  const newlyUnruled = after.needsRuling.map((u) => u.row).filter((r) => r.id !== input.id && !before.has(r.id))
  const row = rows[at]!
  return { rows, row, newlyUnruled, ...(note ? { note } : {}) }
}

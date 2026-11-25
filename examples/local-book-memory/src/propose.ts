/**
 * @input  One chapter, the facts an agent read in it (each with a verbatim quote), the queue, all chapters.
 * @output proposeFacts(): narrative-core's CODE stages on the agent's proposals, no model anywhere:
 *           1. shape    — a `subject.attribute` key (two or three segments), a SHORT value (normalizeValue,
 *                         valueTooLong: a sentence is rejected, since the fold compares values exactly), a quote
 *           2. evidence — the quote must be in the chapter (gate-policy's anchor gate)
 *           3. keys     — a spelling variant of a key canon or the queue already uses moves onto it, so a variant
 *                         cannot hide a contradiction; a looser match (canonicalize.ts deterministicMatch) is only
 *                         a hint, `nearKey`, since a wrong merge fabricates one (placeKey)
 *           4. dedupe   — same key and value twice in one call is one fact
 *           5. known    — already canon before this chapter, already in the queue for this chapter, or
 *                         dismissed for this chapter before (a dismissed statement is not proposed again)
 *           6. collide  — against canon before this chapter (collide.ts), recorded on the row for the writer
 *         What survives is filed PENDING. The writer decides; nothing here touches canon.
 * @pos    local-book-memory — the keyless path of docs/plans/2026-11-19-local-book-memory.md §5.6 option 3.
 *         The agent is the model; the server is only the gates.
 */
import { deterministicMatch } from "../vendor/narrative-core/world/canonicalize"
import { collisionsFor } from "../vendor/narrative-core/world/collide"
import { truthOf } from "../vendor/narrative-core/world/fold"
import type { DeltaKind } from "../vendor/narrative-core/world/types"
import type { Chapter } from "./book.js"
import { foldCanon } from "./canon.js"
import { quoteIn, type FactRow } from "./facts.js"

export interface ProposedFact {
  key: string
  value: string
  evidence: string
  by?: string
  kind?: DeltaKind
}

export type Outcome =
  | { index: number; result: "filed"; id: string; key: string; renamedFrom?: string; nearKey?: string; collision?: FactRow["collision"]; sameChapter?: string[] }
  | { index: number; result: "skipped" | "rejected"; key: string; reason: string }

const KEY = /^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+){1,2}$/u

/**
 * A value is compared by exact string in the fold (collide.ts), so it has to be a short canonical value, not
 * a sentence. Measured on 2026-11-21 (design doc §10): sentence values made one place, worded two ways, a false
 * contradiction, and stopped "already canon" from ever matching. Limits: six words, and 40 units of length
 * with a Han character counting three (so thirteen Chinese characters: six words of Chinese run about that).
 */
export const VALUE_MAX_WORDS = 6
export const VALUE_MAX_LENGTH = 40

/** Case, spacing and a trailing full stop are not part of a value: "Dead." and "dead" are one value. */
export function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.。!！]+$/u, "").toLowerCase()
}

/** A key's attribute words: every segment after the subject, split on `.`, `_` and `-`, sorted. */
function attributeWords(key: string): string {
  return key.split(".").slice(1).flatMap((s) => s.split(/[_-]/)).filter(Boolean).sort().join(" ")
}

/**
 * Where a proposed key goes. A key the vocabulary already has is itself. Another key with the same subject and
 * the SAME attribute words (`mara.ring_material` / `mara.ring.material`) is a spelling variant: the fact moves
 * onto it. Anything narrative-core's deterministicMatch would also merge — a sub-attribute (`harry.scar.cause` →
 * `harry.scar`), or a match through a stop word (`letter.state` → `letter.read`) — is only a hint: the fact keeps
 * the agent's key and the outcome names the near one. Measured 2026-11-22 (design doc §11): those merges made two
 * false contradictions in one run, and with no model pass here nothing catches a wrong merge.
 */
export function placeKey(key: string, vocabulary: readonly string[]): { key: string; renamedFrom?: string; nearKey?: string } {
  if (vocabulary.includes(key)) return { key }
  const subject = key.split(".")[0]
  const words = attributeWords(key)
  const variant = vocabulary.find((k) => k.split(".")[0] === subject && attributeWords(k) === words)
  if (variant) return { key: variant, renamedFrom: key }
  const near = deterministicMatch(key, [...vocabulary])
  return near ? { key, nearKey: near } : { key }
}

export function valueTooLong(value: string): boolean {
  const words = value.split(" ").filter(Boolean).length
  const length = [...value].reduce((n, ch) => n + (/\p{Script=Han}/u.test(ch) ? 3 : 1), 0)
  return words > VALUE_MAX_WORDS || length > VALUE_MAX_LENGTH
}

export async function proposeFacts(input: {
  chapters: readonly Chapter[]
  chapterId: string
  rows: readonly FactRow[]
  facts: readonly ProposedFact[]
  now: string
  newId: () => string
}): Promise<{ outcomes: Outcome[]; added: FactRow[] }> {
  const chapter = input.chapters.find((c) => c.id === input.chapterId)
  if (!chapter) throw new Error(`no chapter "${input.chapterId}"`)

  const before = (await foldCanon(input.chapters, input.rows, { before: chapter.order })).state
  const open = input.rows.filter((r) => r.status !== "DISMISSED")
  const vocabulary = new Set([...Object.keys(before.ledger).filter((k) => truthOf(before, k).length > 0), ...open.map((r) => r.key)])

  const outcomes: Outcome[] = []
  const added: FactRow[] = []
  const here = (r: FactRow) => r.chapterId === chapter.id

  input.facts.forEach((fact, index) => {
    const asked = fact.key.trim().toLowerCase()
    const value = normalizeValue(fact.value)
    const evidence = fact.evidence.trim()
    const reject = (reason: string) => outcomes.push({ index, result: "rejected", key: asked, reason })
    const skip = (key: string, reason: string) => outcomes.push({ index, result: "skipped", key, reason })

    if (!KEY.test(asked)) return reject("key must be subject.attribute, two or three dot-separated segments (e.g. mara.ring.material)")
    if (!value) return reject("value is empty")
    if (valueTooLong(value)) {
      return reject(`value is a sentence: give a short canonical value (at most ${VALUE_MAX_WORDS} words, e.g. "dead", "silver", "4 privet drive") and leave the detail in the quote`)
    }
    if (!evidence) return reject("evidence is empty: quote the sentence that establishes it")
    if (!quoteIn(evidence, chapter.text)) return reject("the quote is not in this chapter: copy it verbatim from get_chapter")

    const { key, renamedFrom, nearKey } = placeKey(asked, [...vocabulary])

    if (added.some((r) => r.key === key && r.value === value)) return skip(key, "duplicate of an earlier fact in this call")
    const canon = truthOf(before, key).find((r) => r.value === value)
    if (canon) return skip(key, `already canon (established in chapter #${canon.asserted.ordinal})`)
    const queued = input.rows.find((r) => here(r) && r.key === key && r.value === value)
    if (queued?.status === "PENDING") return skip(key, `already waiting for the writer (${queued.id})`)
    if (queued?.status === "ACCEPTED") return skip(key, `already accepted for this chapter (${queued.id})`)
    if (queued?.status === "DISMISSED") return skip(key, `the writer dismissed this for this chapter (${queued.id}); it is not proposed again`)

    const [hit] = collisionsFor([{ key, value, evidence }], before)
    const row: FactRow = {
      id: input.newId(),
      chapterId: chapter.id,
      chapterHash: chapter.contentHash,
      key,
      value,
      by: fact.by?.trim() || "narrator",
      kind: fact.kind ?? "physical",
      evidence,
      status: "PENDING",
      ...(renamedFrom ? { renamedFrom } : {}),
      ...(nearKey ? { nearKey } : {}),
      ...(hit ? { collision: { canonValue: hit.canonValue, canonRef: hit.canonRef } } : {}),
      proposedAt: input.now,
    }
    const sameChapter = [...open, ...added].filter((r) => here(r) && r.key === key && r.value !== value).map((r) => r.id)
    added.push(row)
    vocabulary.add(key)
    outcomes.push({
      index,
      result: "filed",
      id: row.id,
      key,
      ...(renamedFrom ? { renamedFrom } : {}),
      ...(nearKey ? { nearKey } : {}),
      ...(row.collision ? { collision: row.collision } : {}),
      ...(sameChapter.length ? { sameChapter } : {}),
    })
  })

  return { outcomes, added }
}

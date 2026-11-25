import { describe, expect, it } from "vitest"
import { foldCanon } from "../src/canon.js"
import type { FactRow } from "../src/facts.js"
import { triageFact, TriageError } from "../src/triage.js"
import { truthOf } from "../vendor/narrative-core/world/fold"
import { NOW, accepted, chapter } from "./helpers.js"

const ch1 = chapter("ch1", 1, "Mara turned the ring in the lamplight. It was silver, cold as the river.")
const ch2 = chapter("ch2", 2, "“Gold,” said the jeweller. “It was always gold, under the plating.”")
const ch3 = chapter("ch3", 3, "She sold the ring that winter. Now it was brass, a cheap copy.")
const chapters = [ch1, ch2, ch3]

const pending = (row: FactRow): FactRow => {
  const { decidedAt: _d, ...rest } = row
  return { ...rest, status: "PENDING" }
}
const silver = accepted(ch1, "a1", "mara.ring.material", "silver", "It was silver")
const gold = pending(accepted(ch2, "p2", "mara.ring.material", "gold", "It was always gold"))

const triage = (rows: FactRow[], id: string, status: "ACCEPTED" | "DISMISSED", ruling?: "progression" | "misdirection-revealed" | "suspended") =>
  triageFact({ chapters, rows, id, status, ...(ruling ? { ruling } : {}), now: NOW })

const current = async (rows: FactRow[], key = "mara.ring.material") => truthOf((await foldCanon(chapters, rows)).state, key).map((r) => [r.value, r.status])

describe("triage → canon", () => {
  it("an accepted fact with no contradiction enters canon; a pending one does not", async () => {
    expect(await current([pending(silver)])).toEqual([])
    const { rows, row } = await triage([pending(silver)], "a1", "ACCEPTED")
    expect(row).toMatchObject({ status: "ACCEPTED", decidedAt: NOW })
    expect(await current(rows)).toEqual([["silver", "asserted"]])
  })

  it("refuses to accept a contradiction without a ruling, and says what the rulings mean", async () => {
    const attempt = triage([silver, gold], "p2", "ACCEPTED")
    await expect(attempt).rejects.toBeInstanceOf(TriageError)
    await expect(attempt).rejects.toThrow(/canon holds mara\.ring\.material = silver.*progression \| misdirection-revealed \| suspended/)
  })

  it("misdirection-revealed: the new value is current, the old one kept as never-true", async () => {
    const { rows } = await triage([silver, gold], "p2", "ACCEPTED", "misdirection-revealed")
    const canon = await foldCanon(chapters, rows)
    expect(truthOf(canon.state, "mara.ring.material").map((r) => r.value)).toEqual(["gold"])
    expect(canon.state.ledger["mara.ring.material"]![0]).toMatchObject({ value: "silver", status: "refuted", resolved: { kind: "in-world", ordinal: 2 } })
    expect(canon.doubleTruths).toEqual([])
  })

  it("keeps who claims the new value: a character's word does not become the narrator's", async () => {
    const { rows } = await triage([silver, { ...gold, by: "jeweller", kind: "cognitive" }], "p2", "ACCEPTED", "misdirection-revealed")
    const [record] = truthOf((await foldCanon(chapters, rows)).state, "mara.ring.material")
    expect(record!.asserted).toMatchObject({ by: "jeweller", ordinal: 2 })
  })

  it("progression: the old value was true until it changed", async () => {
    const { rows } = await triage([silver, gold], "p2", "ACCEPTED", "progression")
    expect((await foldCanon(chapters, rows)).state.ledger["mara.ring.material"]![0]!.resolved?.kind).toBe("progressed")
  })

  it("suspended: both stand, contested, and that is not a double-truth", async () => {
    const { rows } = await triage([silver, gold], "p2", "ACCEPTED", "suspended")
    expect(await current(rows)).toEqual([["silver", "contested"], ["gold", "contested"]])
    expect((await foldCanon(chapters, rows)).doubleTruths).toEqual([])
  })

  it("a ruling with nothing to rule on is dropped, with a note", async () => {
    const { row, note } = await triage([pending(silver)], "a1", "ACCEPTED", "progression")
    expect(row.ruling).toBeUndefined()
    expect(note).toMatch(/not needed/)
  })

  it("dismissing keeps the row and keeps it out of canon; a decided fact cannot be decided again", async () => {
    const { rows, row } = await triage([silver, gold], "p2", "DISMISSED")
    expect(row.status).toBe("DISMISSED")
    expect(await current(rows)).toEqual([["silver", "asserted"]])
    await expect(triage(rows, "p2", "ACCEPTED")).rejects.toThrow(/already DISMISSED/)
    await expect(triage(rows, "zz", "ACCEPTED")).rejects.toThrow(/no fact/)
  })
})

describe("canon is folded in reading order, whatever order the writer accepts in", () => {
  it("accepting an EARLIER chapter's fact after a later one holds the later one out until the writer rules", async () => {
    const brass = accepted(ch3, "a3", "mara.ring.material", "brass", "Now it was brass")
    const { rows, newlyUnruled } = await triage([brass, pending(silver)], "a1", "ACCEPTED")
    expect(newlyUnruled.map((r) => r.id)).toEqual(["a3"])
    const canon = await foldCanon(chapters, rows)
    expect(truthOf(canon.state, "mara.ring.material").map((r) => r.value)).toEqual(["silver"])
    expect(canon.needsRuling.map((u) => u.row.id)).toEqual(["a3"])
    expect(canon.doubleTruths).toEqual([])
  })

  it("an accepted fact with a ruling folds as that ruling even when it was accepted first", async () => {
    const brass = accepted(ch3, "a3", "mara.ring.material", "brass", "Now it was brass", { ruling: "progression" })
    const canon = await foldCanon(chapters, [brass, silver])
    expect(truthOf(canon.state, "mara.ring.material").map((r) => r.value)).toEqual(["brass"])
    expect(canon.needsRuling).toEqual([])
  })
})

describe("canon follows the prose", () => {
  it("a fact whose chapter changed but still contains the quote stays in canon", async () => {
    const edited = chapter("ch1", 1, `${ch1.text} A new last line.`)
    const canon = await foldCanon([edited, ch2, ch3], [silver])
    expect(canon.stale).toEqual([])
    expect(truthOf(canon.state, "mara.ring.material").map((r) => r.value)).toEqual(["silver"])
  })

  it("a fact whose quote was edited out of its chapter leaves canon and is reported stale", async () => {
    const rewritten = chapter("ch1", 1, "Mara turned the ring in the lamplight. It was copper.")
    const canon = await foldCanon([rewritten, ch2, ch3], [silver])
    expect(canon.stale.map((r) => r.id)).toEqual(["a1"])
    expect(truthOf(canon.state, "mara.ring.material")).toEqual([])
    await expect(triageFact({ chapters: [rewritten, ch2, ch3], rows: [pending(silver)], id: "a1", status: "ACCEPTED", now: NOW })).rejects.toThrow(/quote is no longer there/)
  })

  it("a fact whose chapter was deleted is reported orphaned", async () => {
    const canon = await foldCanon([ch2, ch3], [silver])
    expect(canon.orphaned.map((r) => r.id)).toEqual(["a1"])
  })
})

describe("two values for one key inside one chapter", () => {
  const door = chapter("d", 1, "The door was open. No — it was locked, he saw now.")
  const open = accepted(door, "o", "door.state", "open", "The door was open")
  const locked = accepted(door, "l", "door.state", "locked", "it was locked")

  it("without a ruling the earlier stands and the later is held for the writer", async () => {
    const canon = await foldCanon([door], [open, locked])
    expect(truthOf(canon.state, "door.state").map((r) => r.value)).toEqual(["open"])
    expect(canon.needsRuling.map((u) => u.row.id)).toEqual(["l"])
  })

  it("with suspended both stand, contested", async () => {
    const canon = await foldCanon([door], [open, { ...locked, ruling: "suspended" }])
    expect(truthOf(canon.state, "door.state").map((r) => [r.value, r.status])).toEqual([["open", "contested"], ["locked", "contested"]])
    expect(canon.doubleTruths).toEqual([])
  })

  it("with progression the later value is the chapter's", async () => {
    const canon = await foldCanon([door], [open, { ...locked, ruling: "progression" }])
    expect(truthOf(canon.state, "door.state").map((r) => r.value)).toEqual(["locked"])
  })
})

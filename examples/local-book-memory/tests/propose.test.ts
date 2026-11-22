import { describe, expect, it } from "vitest"
import type { FactRow } from "../src/facts.js"
import { proposeFacts, type ProposedFact } from "../src/propose.js"
import { NOW, accepted, chapter, ids } from "./helpers.js"

const ch1 = chapter("ch1", 1, "Mara turned the ring in the lamplight. It was silver, cold as the river.")
const ch2 = chapter("ch2", 2, "“Gold,” said the jeweller. “It was always gold, under the plating.” The garden door stood open.")
const ch3 = chapter("ch3", 3, "By morning the garden door was bolted from the inside.")
const zh = chapter("zh1", 4, "沈舟说：“漕船上无一生还。”")
const chapters = [ch1, ch2, ch3, zh]

const propose = (chapterId: string, facts: ProposedFact[], rows: FactRow[] = []) =>
  proposeFacts({ chapters, chapterId, rows, facts, now: NOW, newId: ids() })

describe("proposeFacts: the evidence gate", () => {
  it("files a fact whose quote is in the chapter, PENDING, with the chapter's hash", async () => {
    const { outcomes, added } = await propose("ch1", [{ key: "mara.ring.material", value: "silver", evidence: "It was silver, cold as the river." }])
    expect(outcomes).toEqual([{ index: 0, result: "filed", id: "f1", key: "mara.ring.material" }])
    expect(added[0]).toMatchObject({ status: "PENDING", chapterId: "ch1", chapterHash: ch1.contentHash, by: "narrator", kind: "physical" })
  })

  it("rejects a quote the chapter does not contain: a fabricated quote dies by string matching", async () => {
    const { outcomes, added } = await propose("ch1", [{ key: "mara.ring.material", value: "gold", evidence: "The ring was gold." }])
    expect(outcomes[0]).toMatchObject({ result: "rejected", reason: expect.stringMatching(/not in this chapter/) })
    expect(added).toEqual([])
  })

  it("accepts a quote re-punctuated by the model: quote marks, case and ellipses are noise", async () => {
    const { outcomes } = await propose("ch2", [{ key: "mara.ring.material", value: "gold", by: "jeweller", kind: "cognitive", evidence: "'gold,' said the jeweller ... always gold" }])
    expect(outcomes[0]!.result).toBe("filed")
  })

  it("works on Chinese prose, where the quote has no spaces and different quote marks", async () => {
    const { outcomes } = await propose("zh1", [{ key: "漕船.船员.状态", value: "dead-reported", by: "沈舟", kind: "cognitive", evidence: "漕船上无一生还" }])
    expect(outcomes[0]).toMatchObject({ result: "filed", key: "漕船.船员.状态" })
  })
})

describe("proposeFacts: shape", () => {
  it.each([
    ["ring", "one segment"],
    ["a.b.c.d", "four segments"],
    ["mara ring", "a space"],
  ])("rejects the key %s (%s)", async (key) => {
    const { outcomes } = await propose("ch1", [{ key, value: "silver", evidence: "It was silver" }])
    expect(outcomes[0]).toMatchObject({ result: "rejected", reason: expect.stringMatching(/subject\.attribute/) })
  })

  it("rejects a sentence as a value: values are compared exactly, so they must be short and canonical", async () => {
    const { outcomes } = await propose("ch1", [
      { key: "mara.ring.material", value: "It was made of silver and had belonged to her mother", evidence: "It was silver" },
      { key: "漕船.船员.状态", value: "昨夜的漕船翻了船上的人全部都没有活下来", evidence: "It was silver" },
    ])
    expect(outcomes.map((o) => o.result)).toEqual(["rejected", "rejected"])
    expect(outcomes[0]).toMatchObject({ reason: expect.stringMatching(/short canonical value/) })
  })

  it("normalizes case, spacing and a trailing full stop, so 'Silver.' restates canon's 'silver'", async () => {
    const canon = [accepted(ch1, "a1", "mara.ring.material", "silver", "It was silver")]
    const { outcomes } = await propose("ch2", [{ key: "mara.ring.material", value: "  Silver. ", evidence: "under the plating" }], canon)
    expect(outcomes[0]).toMatchObject({ result: "skipped", reason: expect.stringMatching(/already canon/) })
  })

  it("keeps a short value of up to six words, and a short Chinese one", async () => {
    const { outcomes } = await propose("zh1", [
      { key: "漕船.船员.状态", value: "船上无人生还", by: "沈舟", evidence: "漕船上无一生还" },
      { key: "harry.location", value: "hut on a rock at sea", evidence: "漕船上无一生还" },
    ])
    expect(outcomes.map((o) => o.result)).toEqual(["filed", "filed"])
  })

  it("rejects an empty value or an empty quote", async () => {
    const { outcomes } = await propose("ch1", [
      { key: "mara.ring.material", value: " ", evidence: "It was silver" },
      { key: "mara.ring.material", value: "silver", evidence: "" },
    ])
    expect(outcomes.map((o) => o.result)).toEqual(["rejected", "rejected"])
  })

  it("throws for a chapter that does not exist", async () => {
    await expect(propose("nope", [{ key: "a.b", value: "c", evidence: "d" }])).rejects.toThrow(/no chapter/)
  })
})

describe("proposeFacts: keys, duplicates and what is already known", () => {
  const canon = [accepted(ch1, "a1", "mara.ring.material", "silver", "It was silver")]

  it("moves a variant key onto the canon key, so the contradiction it carries is not hidden", async () => {
    const { outcomes, added } = await propose("ch2", [{ key: "mara.ring_material", value: "gold", evidence: "It was always gold" }], canon)
    expect(outcomes[0]).toMatchObject({ result: "filed", key: "mara.ring.material", renamedFrom: "mara.ring_material" })
    expect(added[0]!.collision).toEqual({ canonValue: "silver", canonRef: "mara.ring.material = silver (narrator, #1)" })
  })

  it("does not merge a sub-attribute into its parent key: harry.scar.cause stays, with harry.scar as a hint", async () => {
    const scar = [accepted(ch1, "s1", "harry.scar", "lightning bolt", "It was silver")]
    const { outcomes, added } = await propose("ch2", [{ key: "harry.scar.cause", value: "car crash", evidence: "It was always gold" }], scar)
    expect(outcomes[0]).toEqual({ index: 0, result: "filed", id: "f1", key: "harry.scar.cause", nearKey: "harry.scar" })
    expect(added[0]!.collision).toBeUndefined()
  })

  it("does not merge through a stop word: letter.state is not letter.read", async () => {
    const { outcomes } = await propose("ch2", [
      { key: "harry.letter.read", value: "unread", evidence: "It was always gold" },
      { key: "harry.letter.state", value: "burned", evidence: "under the plating" },
    ])
    expect(outcomes[1]).toEqual({ index: 1, result: "filed", id: "f2", key: "harry.letter.state", nearKey: "harry.letter.read" })
  })

  it("still merges a spelling variant with the same attribute words, in any order", async () => {
    const { outcomes } = await propose("ch2", [{ key: "mara.material-ring", value: "gold", evidence: "It was always gold" }], canon)
    expect(outcomes[0]).toMatchObject({ result: "filed", key: "mara.ring.material", renamedFrom: "mara.material-ring" })
  })

  it("never merges across subjects", async () => {
    const { outcomes } = await propose("ch2", [{ key: "tomas.ring.material", value: "gold", evidence: "It was always gold" }], canon)
    expect(outcomes[0]).toEqual({ index: 0, result: "filed", id: "f1", key: "tomas.ring.material" })
  })

  it("skips a restatement of what canon already holds", async () => {
    const { outcomes } = await propose("ch2", [{ key: "mara.ring.material", value: "silver", evidence: "under the plating" }], canon)
    expect(outcomes[0]).toMatchObject({ result: "skipped", reason: expect.stringMatching(/already canon/) })
  })

  it("checks against canon BEFORE the chapter: a later chapter's fact is no collision", async () => {
    const later = [accepted(ch3, "a3", "garden.door.state", "bolted", "the garden door was bolted")]
    const { added } = await propose("ch2", [{ key: "garden.door.state", value: "open", evidence: "The garden door stood open." }], later)
    expect(added[0]!.collision).toBeUndefined()
  })

  it("skips a duplicate inside one call", async () => {
    const fact = { key: "garden.door.state", value: "open", evidence: "The garden door stood open." }
    const { outcomes } = await propose("ch2", [fact, fact])
    expect(outcomes.map((o) => o.result)).toEqual(["filed", "skipped"])
  })

  it("does not file again what is already waiting or accepted for the chapter", async () => {
    const waiting: FactRow = { ...accepted(ch2, "p1", "garden.door.state", "open", "stood open"), status: "PENDING" }
    const { outcomes } = await propose("ch2", [{ key: "garden.door.state", value: "open", evidence: "stood open" }], [waiting])
    expect(outcomes[0]).toMatchObject({ result: "skipped", reason: expect.stringMatching(/already waiting.*p1/) })
  })

  it("does not propose again what the writer dismissed for this chapter, but does for another chapter", async () => {
    const dismissed: FactRow = { ...accepted(ch2, "d1", "garden.door.state", "open", "stood open"), status: "DISMISSED" }
    const again = await propose("ch2", [{ key: "garden.door.state", value: "open", evidence: "stood open" }], [dismissed])
    expect(again.outcomes[0]).toMatchObject({ result: "skipped", reason: expect.stringMatching(/dismissed/) })
    const elsewhere = await propose("ch3", [{ key: "garden.door.state", value: "open", evidence: "the garden door" }], [dismissed])
    expect(elsewhere.outcomes[0]!.result).toBe("filed")
  })

  it("marks two different values for one key in one chapter, so the writer sees the pair", async () => {
    const { outcomes } = await propose("ch2", [
      { key: "garden.door.state", value: "open", evidence: "The garden door stood open." },
      { key: "garden.door.state", value: "ajar", evidence: "The garden door stood open." },
    ])
    expect(outcomes[1]).toMatchObject({ result: "filed", sameChapter: ["f1"] })
  })
})

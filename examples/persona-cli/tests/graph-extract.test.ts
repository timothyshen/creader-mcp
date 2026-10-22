import { describe, expect, it } from "vitest"
import { anchorExtraction, chunkText, foldName, mergeExtractions, type Extraction } from "../src/graph-extract.js"

describe("anchor check — nothing enters the graph without a quote the code can find", () => {
  const chunk = "Kevin Nguyen circulates in internet memes in the largely Asian space of the ‘subtle asian traits’ Facebook group; the starter kit includes Juul pods, gold chains, a Lexus, boba milk tea."
  const x: Extraction = {
    entities: [
      { type: "community", name: "subtle asian traits", aliases: ["SAT"], role: "context", description: "Facebook group", evidence: "the largely Asian space of the 'subtle asian traits' Facebook group" },
      { type: "signifier", name: "Lexus", aliases: [], role: "signal", description: "car", evidence: "a Lexus, boba milk tea" },
      { type: "signifier", name: "Audi", aliases: [], role: "signal", description: "car", evidence: "an Audi, a Lexus" },
    ],
    relations: [
      { source: "Lexus", target: "subtle asian traits", type: "signifier_of", evidence: "the starter kit includes Juul pods, gold chains, a Lexus" },
      { source: "Audi", target: "Lexus", type: "paired_with", evidence: "a Lexus, boba milk tea" },
    ],
  }
  it("keeps quoted items, tolerates quote marks and whitespace, drops the invented Audi and any relation that touches it", () => {
    const { kept, dropped } = anchorExtraction(x, chunk)
    expect(kept.entities.map((e) => e.name)).toEqual(["subtle asian traits", "Lexus"])
    expect(kept.relations).toHaveLength(1)
    expect(dropped).toBe(2)
  })
  it("rejects evidence shorter than 12 characters: too easy to find by accident", () => {
    const { kept } = anchorExtraction({ entities: [{ ...x.entities[1]!, evidence: "a Lexus" }], relations: [] }, chunk)
    expect(kept.entities).toHaveLength(0)
  })
})

describe("chunking and folding", () => {
  it("splits on paragraph boundaries under the cap and never loses text", () => {
    const text = Array.from({ length: 30 }, (_, i) => `paragraph ${i} ` + "x".repeat(900)).join("\n\n")
    const chunks = chunkText(text, 5000)
    expect(chunks.length).toBeGreaterThan(4)
    expect(chunks.every((c) => c.length <= 5000)).toBe(true)
    expect(chunks.join("\n\n").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""))
  })
  it("folds diacritics, case, articles and punctuation so Kevin Nguyễn and the Kevin Nguyen meet", () => {
    expect(foldName("Kevin Nguyễn")).toBe(foldName("the Kevin Nguyen"))
    expect(foldName("Fear of God Essentials hoodie")).toBe("fear of god essentials hoodie")
  })
})

describe("merge — one node per folded name, provenance kept", () => {
  it("drops the editorial leak: a node named Tim, or evidence quoting Tim's notes, never enters the graph", () => {
    const x: Extraction = { entities: [
      { type: "person", name: "Tim", aliases: [], role: "context", description: "", evidence: "Tim's description; the image itself was not transcribed" },
      { type: "signifier", name: "boba", aliases: [], role: "signal", description: "", evidence: "(Tim's note from the manifest: boba)" },
      { type: "signifier", name: "Lexus", aliases: [], role: "signal", description: "", evidence: "a Lexus to school" },
    ], relations: [] }
    expect(mergeExtractions([{ source: "s", extraction: x }]).entities.map((e) => e.name)).toEqual(["Lexus"])
  })
  it("unions aliases, roles and sources across documents and drops relations to unknown nodes", () => {
    const a: Extraction = { entities: [{ type: "signifier", name: "Lexus", aliases: ["Lexus IS350"], role: "signal", description: "d1", evidence: "e1" }], relations: [] }
    const b: Extraction = { entities: [{ type: "signifier", name: "the lexus", aliases: [], role: "counter", description: "d2", evidence: "e2" }], relations: [{ source: "Lexus", target: "Ghost", type: "paired_with", evidence: "e3" }] }
    const g = mergeExtractions([{ source: "s1", extraction: a }, { source: "s2", extraction: b }])
    expect(g.entities).toHaveLength(1)
    expect(g.entities[0]!.sources).toEqual(["s1", "s2"])
    expect(g.entities[0]!.roles).toEqual(["signal", "counter"])
    expect(g.entities[0]!.aliases).toEqual(["Lexus IS350"])
    expect(g.relations).toHaveLength(0)
  })
})

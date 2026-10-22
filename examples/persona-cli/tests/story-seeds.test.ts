import { describe, expect, it } from "vitest"
import type { Graph } from "../src/graph-extract.js"
import { aiTells, sampleStorySeeds, signalsOf } from "../src/story-seeds.js"
import { anchorsFromCard } from "../src/triple-sampler.js"
import { WESTBUND } from "../src/fixture/westbund.js"

const E = (key: string, type: string, roles: string[] = ["context"]) => ({ key, type: type as never, name: key, aliases: [], roles: roles as never, descriptions: [], evidence: [{ source: "s", quote: `q ${key}` }], sources: ["s"] })
const graph: Graph = {
  entities: [E("kevin nguyen archetype", "concept"), E("lexus", "signifier", ["signal"]), E("juul", "signifier", ["signal"]), E("boba", "signifier", ["signal"]), E("edc", "event"), E("7 leaves on brookhurst", "place"), E("r autism poster", "person", ["counter"]), E("subcultural capital", "concept")],
  relations: [
    { key: "1", source: "lexus", target: "kevin nguyen archetype", type: "signifier_of", evidence: [], sources: ["s"] },
    { key: "2", source: "juul", target: "kevin nguyen archetype", type: "signifier_of", evidence: [], sources: ["s"] },
    { key: "3", source: "boba", target: "kevin nguyen archetype", type: "signifier_of", evidence: [], sources: ["s"] },
    { key: "4", source: "lexus", target: "7 leaves on brookhurst", type: "located_in", evidence: [], sources: ["s"] },
  ],
}
const selection = new Set(graph.entities.map((e) => e.key))
const mind = anchorsFromCard(WESTBUND.card, "k")

describe("story seeds — code chooses the collision and the ground", () => {
  it("is deterministic for a seed and changes with it", () => {
    const a = sampleStorySeeds(graph, selection, mind, { seed: "a", count: 3 })
    const b = sampleStorySeeds(graph, selection, mind, { seed: "a", count: 3 })
    const c = sampleStorySeeds(graph, selection, mind, { seed: "b", count: 3 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
  })
  it("rotates through the signals so a batch never leans on one object, and only uses signifier_of neighbours", () => {
    expect(signalsOf(graph, selection).map((s) => s.key)).toEqual(["boba", "juul", "lexus"])
    const seeds = sampleStorySeeds(graph, selection, mind, { seed: "x", count: 3 })
    expect(new Set(seeds.map((s) => s.signal.key)).size).toBe(3)
  })
  it("prefers ground linked to the signal when the graph has such a link", () => {
    const seeds = sampleStorySeeds(graph, selection, mind, { seed: "any", count: 6 })
    const lexusSeeds = seeds.filter((s) => s.signal.key === "lexus")
    expect(lexusSeeds.every((s) => s.ground.key === "7 leaves on brookhurst")).toBe(true)
  })
  it("never stands a scene on a county or a city: those are context, the home grounds carry the streets", () => {
    const g3: Graph = { ...graph, entities: [...graph.entities, E("orange county", "place"), E("california", "place")] }
    const sel = new Set(g3.entities.map((e) => e.key))
    const seeds = sampleStorySeeds(g3, sel, mind, { seed: "r", count: 9 })
    expect(seeds.some((s) => s.ground.key === "orange county" || s.ground.key === "california")).toBe(false)
  })
  it("fails loud when the graph has no signals: a story with nothing to stand on is not a story", () => {
    expect(() => sampleStorySeeds({ entities: [E("edc", "event")], relations: [] }, new Set(["edc"]), mind, { seed: "s" })).toThrow(/no signals/)
  })
})

describe("direct sources and home ground", () => {
  it("keeps only signals and grounds that a direct document mentions, and always offers the home grounds", () => {
    const g2: Graph = { ...graph, entities: graph.entities.map((e) => (e.key === "juul" ? { ...e, sources: ["paper-only"] } : e)) }
    const seeds = sampleStorySeeds(g2, selection, mind, { seed: "d", count: 6, directSources: new Set(["s"]), homeGrounds: [{ key: "home:x", name: "7 Leaves on Brookhurst", type: "place", quote: "" }] })
    expect(seeds.some((x) => x.signal.key === "juul")).toBe(false)
    expect(seeds.some((x) => x.ground.key === "home:x")).toBe(true)
  })
})

describe("AI tells — machine prose is a rejection", () => {
  it("catches the usual words and the not-just-X-it's-Y shape, and passes plain speech", () => {
    expect(aiTells("We delved into the vibrant tapestry of the night. It's not just a car, it's a statement.").length).toBeGreaterThanOrEqual(3)
    expect(aiTells("Car's in the shop. Dennis texted twice. I didn't answer.")).toEqual([])
  })
})

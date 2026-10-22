import { describe, expect, it } from "vitest"
import type { Graph } from "../src/graph-extract.js"
import { noteTitle, planLoad, selectNeighbourhood } from "../src/graph-load.js"

const graph: Graph = {
  entities: [
    { key: "lexus", type: "signifier", name: "Lexus", aliases: ["Lexus IS350"], roles: ["signal"], descriptions: ["The car."], evidence: [{ source: "s1", quote: "a Lexus" }], sources: ["s1", "s2"] },
    { key: "orange county", type: "place", name: "Orange County", aliases: [], roles: ["context"], descriptions: ["Where he is from."], evidence: [{ source: "s1", quote: "(ORANGE COUNTY)" }], sources: ["s1"] },
    { key: "bettina makalintal", type: "person", name: "Bettina Makalintal", aliases: [], roles: ["context"], descriptions: ["VICE writer."], evidence: [{ source: "s2", quote: "As Bettina Makalintal writes" }], sources: ["s2"] },
    { key: "2019 vice article", type: "event", name: "2019 VICE article", aliases: [], roles: ["context"], descriptions: ["Published 2019."], evidence: [{ source: "s2", quote: "Makalintal 2019" }], sources: ["s2"] },
  ],
  relations: [
    { key: "lexus|located_in|orange county", source: "lexus", target: "orange county", type: "located_in", evidence: [{ source: "s1", quote: "q" }], sources: ["s1"] },
    { key: "lexus|signifier_of|ghost", source: "lexus", target: "ghost", type: "signifier_of", evidence: [], sources: ["s1"] },
  ],
}

describe("load plan — the graph lands in existing tables, people never in the cast", () => {
  const plan = planLoad(graph, 1)
  it("maps places to locations, events to timeline events, everything else to typed notes", () => {
    expect(plan.rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "note:[signifier] Lexus", "location:Orange County", "note:[person] Bettina Makalintal", "event:2019 VICE article",
    ])
    expect(plan.rows.find((r) => r.name.startsWith("[person]"))?.noteType).toBe("research")
    expect(plan.rows.find((r) => r.name.startsWith("[signifier]"))?.noteType).toBe("worldbuilding")
  })
  it("carries provenance in the body: sources line, aliases, a quote", () => {
    const lexus = plan.rows[0]!
    expect(lexus.body).toContain("Sources: s1, s2")
    expect(lexus.body).toContain("Also called: Lexus IS350")
    expect(lexus.body).toContain('[s1] "a Lexus"')
  })
  it("drops relations whose ends are not loaded, and honours a minimum source count", () => {
    expect(plan.relations).toHaveLength(1)
    const strict = planLoad(graph, 2)
    expect(strict.rows.map((r) => r.name)).toEqual(["[signifier] Lexus"])
    expect(strict.relations).toHaveLength(0)
  })
  it("selects the archetype's neighbourhood plus multi-source nodes plus every place and event, and nothing else", () => {
    const g: Graph = {
      entities: [
        { key: "kevin nguyen archetype", type: "concept", name: "Kevin Nguyen (archetype)", aliases: [], roles: ["signal"], descriptions: [], evidence: [], sources: ["s1"] },
        { key: "juul", type: "signifier", name: "Juul", aliases: [], roles: ["signal"], descriptions: [], evidence: [], sources: ["s1"] },
        { key: "subcultural capital", type: "concept", name: "Subcultural capital", aliases: [], roles: ["context"], descriptions: [], evidence: [], sources: ["s3"] },
        { key: "bourdieu", type: "person", name: "Bourdieu", aliases: [], roles: ["context"], descriptions: [], evidence: [], sources: ["s3", "s4"] },
        { key: "edc", type: "place", name: "EDC", aliases: [], roles: ["context"], descriptions: [], evidence: [], sources: ["s2"] },
      ],
      relations: [{ key: "k", source: "juul", target: "kevin nguyen archetype", type: "signifier_of", evidence: [], sources: ["s1"] }],
    }
    expect([...selectNeighbourhood(g)].sort()).toEqual(["bourdieu", "edc", "juul", "kevin nguyen archetype"])
  })
  it("titles the archetype as a concept note", () => {
    expect(noteTitle({ ...graph.entities[0]!, type: "concept", name: "Kevin Nguyen (archetype)" })).toBe("[concept] Kevin Nguyen (archetype)")
  })
})

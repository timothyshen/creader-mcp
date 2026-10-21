import { describe, expect, it } from "vitest"
import { WESTBUND } from "../src/fixture/westbund.js"
import { AUTHOR_TRUTH, planSeed } from "../src/seed-plan.js"

describe("seed plan — the sampler must find every person the card points at", () => {
  const plan = planSeed()

  it("creates exactly one protagonist and the four people the private facts name", () => {
    expect(plan.characters.filter((c) => c.role === "protagonist").map((c) => c.name)).toEqual(["Kevin"])
    expect(plan.characters.map((c) => c.name)).toEqual(["Kevin", "Dennis", "Tiffany", "Dad", "Grandma"])
  })

  it("puts the card on the protagonist in the fields the motive-gap digest reads, verbatim", () => {
    const kevin = plan.characters[0]!
    expect(kevin.customFields).toEqual({
      goals: WESTBUND.card.goals,
      background: WESTBUND.card.background,
      personality: WESTBUND.card.personality,
      arc: WESTBUND.card.arc,
    })
  })

  it("names only cast members in relations, so the relation pool is never empty and never dangling", () => {
    const names = new Set(plan.characters.map((c) => c.name))
    for (const r of plan.relations) {
      expect(names.has(r.source)).toBe(true)
      expect(names.has(r.target)).toBe(true)
    }
    expect(plan.relations.length).toBeGreaterThan(0)
  })

  it("seeds every [hidden] note as general and every [voice] rule as a prohibition, exactly three (the FREE-tier cap)", () => {
    const hidden = plan.notes.filter((n) => n.title.startsWith("[hidden]"))
    const voice = plan.notes.filter((n) => n.title.startsWith("[voice]"))
    expect(hidden.length).toBe(WESTBUND.hidden.length)
    expect(hidden.every((n) => n.noteType === "general")).toBe(true)
    expect(voice.length).toBe(3)
    expect(voice.every((n) => n.noteType === "prohibition")).toBe(true)
  })

  it("seeds the author's truth as a plain note with no prefix, so neither the prompt nor the detector picks it up", () => {
    const truth = plan.notes.find((n) => n.content === AUTHOR_TRUTH.content)!
    expect(truth.noteType).toBe("general")
    expect(truth.title.startsWith("[")).toBe(false)
  })
})

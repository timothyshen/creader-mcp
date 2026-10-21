import { describe, expect, it } from "vitest"
import { characterFromCreader } from "../src/character-from-creader.js"
import { buildPersonaSystemPrompt } from "../src/persona-prompt.js"

const characters = [
  { id: "k", name: "Kevin", role: "protagonist", description: "Short.", customFields: { goals: "g1; g2", background: "b1", personality: "p1", arc: "a1" } },
  { id: "d", name: "Dennis", role: "supporting", description: "Friend." },
]
const notes = [
  { id: "1", title: "[hidden] Dennis: Dad's stroke", content: "Dennis does not know.", noteType: "general" },
  { id: "2", title: "[voice] One person", content: "He is one person.", noteType: "prohibition" },
  { id: "3", title: "Dad noticed", content: "His dad noticed the resentment in May and has said nothing.", noteType: "general" },
  { id: "4", title: "Research", content: "EDC dates.", noteType: "research" },
]

describe("Creader rows → Character: the prompt gets his mind, never the author's", () => {
  const c = characterFromCreader(characters, notes)

  it("takes the card from the protagonist's custom fields", () => {
    expect(c.id).toBe("k")
    expect(c.card).toEqual({ goals: "g1; g2", background: "b1", personality: "p1", arc: "a1" })
  })

  it("keeps only [hidden] notes as the second-order layer and only prohibitions as voice rules", () => {
    expect(c.hidden.map((h) => h.title)).toEqual(["[hidden] Dennis: Dad's stroke"])
    expect(c.voiceRules.map((r) => r.title)).toEqual(["[voice] One person"])
  })

  it("drops the author's truth and ordinary research notes, so the prompt cannot carry them", () => {
    const prompt = buildPersonaSystemPrompt(c)
    expect(prompt).not.toContain("noticed the resentment")
    expect(prompt).not.toContain("EDC dates")
  })

  it("fails loud without a protagonist instead of producing an empty mind", () => {
    expect(() => characterFromCreader([characters[1]!], notes)).toThrow(/protagonist/)
  })
})

import { describe, expect, it } from "vitest"
import { WESTBUND, type Character } from "../src/fixture/westbund.js"
import { buildPersonaSystemPrompt } from "../src/persona-prompt.js"

const AUTHOR_TRUTH = "His dad noticed the resentment in May and has said nothing."

describe("persona prompt — the direct path owns the boundary (H2: nothing is injected server-side)", () => {
  const prompt = buildPersonaSystemPrompt(WESTBUND)

  it("carries every hidden note and every prohibition", () => {
    for (const h of WESTBUND.hidden) expect(prompt).toContain(h.body)
    for (const r of WESTBUND.voiceRules) expect(prompt).toContain(r.body)
  })

  it("never carries the author's truth: it is not his mind, and the type has no field for it", () => {
    expect(prompt).not.toContain(AUTHOR_TRUTH)
    expect(JSON.stringify(WESTBUND)).not.toContain(AUTHOR_TRUTH)
  })

  it("says plain beats fake when there are no samples", () => {
    expect(prompt).toContain("plain beats fake")
  })

  it("caps card fields at the motive-gap digest limits so the model sees what the detector will see", () => {
    const fat: Character = { ...WESTBUND, card: { ...WESTBUND.card, goals: "x".repeat(500) } }
    const p = buildPersonaSystemPrompt(fat)
    expect(p).toContain("x".repeat(300))
    expect(p).not.toContain("x".repeat(301))
  })
})

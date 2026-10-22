import { describe, expect, it } from "vitest"
import type { StorySeed } from "../src/story-seeds.js"
import { acceptStoryVerdict, buildStoryPrompt, buildStoryVerifyPrompt, gateStory, parseStoryVerdict, type StoryVerdict } from "../src/story-writer.js"

const seed: StorySeed = {
  index: 0, seed: "t",
  triple: { key: "k", index: 0, seed: "t", want: { id: "w", text: "keep the crew seeing the fun one, not the guy whose dad can't hold a cup" }, belief: { id: "b", text: "drives Dad to PT in Dad's own Lexus since the March stroke" }, self: { id: "s", text: "always out, EDC to the 2 a.m. boba run" }, collides: "self", links: { wantBelief: true, wantSelf: true, beliefSelf: true } },
  signal: { key: "lexus", name: "Lexus", type: "signifier", quote: "a Lexus to school" },
  ground: { key: "hard summer music festival", name: "Hard Summer Music Festival", type: "event", quote: "Hard Summer" },
  voice: null,
}
const base = "So Hard Summer, last year. I had the Lexus that weekend, and I told Dennis I'd drive. " + "We parked way out past the lot, and the walk was long, and I kept the keys in my hand the whole time. ".repeat(6) + "He asked why I was leaving at eleven. I said the car had to be back. I left him the wristband."

describe("gate 1 — a story has to stand on the graph and stay his", () => {
  it("passes a grounded, plain telling of the right length", () => {
    expect(gateStory({ story: base, seed, protectedTexts: ["drives dad to pt in dad's own lexus since the march stroke"] })).toEqual([])
  })
  it("rejects a story that never visits the place or never shows the signal", () => {
    const noPlace = base.replace(/Hard Summer/g, "the show")
    expect(gateStory({ story: noPlace, seed, protectedTexts: [] })[0]).toMatch(/not in the scene/)
  })
  it("rejects machine prose, a spelled accent, a lesson, and a protected anchor repeated word for word", () => {
    expect(gateStory({ story: base + " It was a testament to something.", seed, protectedTexts: [] })).toContainEqual(expect.stringMatching(/machine prose/))
    expect(gateStory({ story: base + " I was tryna leave.", seed, protectedTexts: [] })).toContainEqual(expect.stringMatching(/spells an accent/))
    expect(gateStory({ story: base + " That's when I realized who I was.", seed, protectedTexts: [] })).toContain("explains the lesson")
    expect(gateStory({ story: base + " I drive Dad to PT in Dad's own Lexus.", seed, protectedTexts: ["drives Dad to PT in Dad's own Lexus since the March stroke"] })).toContainEqual(expect.stringMatching(/word for word/))
  })
  it("rejects a summary-length fragment", () => {
    expect(gateStory({ story: "Hard Summer. Lexus. Left early.", seed, protectedTexts: [] })[0]).toMatch(/too short/)
  })
})

describe("gate 2 — the four conditions plus scene, choice and no moral", () => {
  const ok: StoryVerdict = { deviatesFrom: "self", statesOutright: false, marked: true, offpage: false, otherGap: null, wantServes: true, scene: true, choice: true, moral: false, revealsHidden: false, reason: "" }
  it("accepts when everything holds and fails on each storytelling question alone", () => {
    expect(acceptStoryVerdict(ok, "self")).toBe(true)
    expect(acceptStoryVerdict({ ...ok, scene: false }, "self")).toBe(false)
    expect(acceptStoryVerdict({ ...ok, choice: false }, "self")).toBe(false)
    expect(acceptStoryVerdict({ ...ok, moral: true }, "self")).toBe(false)
    expect(acceptStoryVerdict({ ...ok, statesOutright: true }, "self")).toBe(false)
  })
  it("rejects a story that spends a secret: canon must survive every visitor (batch 2, story 2 taught Grandma he understands her)", () => {
    expect(acceptStoryVerdict({ ...ok, revealsHidden: true }, "self")).toBe(false)
  })
  it("hands the hidden layer to the verifier only, never to the writer", () => {
    const v = buildStoryVerifyPrompt({ id: "k", name: "Kevin", role: "protagonist", description: "", card: { goals: "g", background: "b", personality: "p" } }, seed, "story", ["His grandmother believes he lost his Vietnamese."])
    expect(v).toContain("WHAT OTHERS DO NOT KNOW")
    expect(v).toContain("lost his Vietnamese")
    expect(buildStoryPrompt(seed)).not.toContain("Vietnamese")
  })
  it("parses strictly", () => {
    expect(parseStoryVerdict(JSON.stringify(ok))).toEqual(ok)
    expect(parseStoryVerdict(JSON.stringify({ ...ok, scene: "yes" }))).toMatch(/scene/)
  })
})

describe("prompt — the pieces code chose are all named", () => {
  it("names where, what people see, the three anchors and BREAKS, and never the hidden layer", () => {
    const p = buildStoryPrompt(seed)
    for (const s of ["WHERE: Hard Summer Music Festival", "WHAT PEOPLE SEE ON YOU: Lexus", "BREAKS: self", seed.triple.want.text]) expect(p).toContain(s)
    expect(p).not.toMatch(/hidden/i)
  })
})

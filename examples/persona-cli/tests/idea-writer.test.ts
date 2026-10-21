import { describe, expect, it } from "vitest"
import { acceptVerdict, buildVerifyPrompt, buildWriterPrompt, gateIdea, minimalPacket, parseIdea, parseVerdict, sentenceCount, type Persona, type Verdict } from "../src/idea-writer.js"
import type { Triple } from "../src/triple-sampler.js"

const triple: Triple = {
  key: "k", index: 5, seed: "westbund-1",
  want: { id: "w", text: "keep the crew seeing the fun one, not the guy whose dad can't hold a cup" },
  belief: { id: "b", text: "drives Dad to PT in Dad's own Lexus since the March stroke" },
  self: { id: "s", text: "the guy who pulls up in the Lexus" },
  collides: "self",
  links: { wantBelief: true, wantSelf: true, beliefSelf: true },
}
const persona: Persona = { id: "c1", name: "Kevin", role: "protagonist", description: "Short and stocky.", card: { goals: "g", background: "b", personality: "p" } }
const good = { title: "No car tonight", want: "He wants the stranger to drop the car question.", openingLine: "Not driving tonight. Got an Uber coming, don't ask." }

describe("gate 1 — code decides format, length, leaks and labels", () => {
  it("passes a clean idea", () => expect(gateIdea(good, triple)).toEqual([]))

  it("rejects a WANT anchor repeated word for word, but lets SELF through", () => {
    expect(gateIdea({ ...good, openingLine: "I just want the crew seeing the fun one tonight." }, triple)[0]).toMatch(/word for word/)
    expect(gateIdea({ ...good, openingLine: "I'm the guy who pulls up in the Lexus. Not tonight." }, triple)).toEqual([])
  })

  it("rejects the shape violations one by one", () => {
    expect(gateIdea({ ...good, title: "one two three four five six seven" }, triple)).toContain("title has more than 6 words")
    expect(gateIdea({ ...good, want: "I want a ride." }, triple)).toContain('want must start with "He wants"')
    expect(gateIdea({ ...good, want: "He wants a ride. He wants it now." }, triple)).toContain("want must be one sentence")
    expect(gateIdea({ ...good, openingLine: "One. Two. Three." }, triple)).toContain("openingLine has more than two sentences")
    expect(gateIdea({ ...good, openingLine: "I'm not a fuckboy, okay." }, triple)[0]).toMatch(/label/)
  })

  it("counts sentences by terminators, not by length", () => {
    expect(sentenceCount("Not driving tonight. Got an Uber coming, don't ask.")).toBe(2)
    expect(sentenceCount("He wants the stranger to drop the car question.")).toBe(1)
  })
})

describe("parsing — fences stripped, extra keys refused", () => {
  it("accepts fenced JSON with exactly the three keys", () => {
    expect(parseIdea("```json\n" + JSON.stringify(good) + "\n```")).toEqual(good)
  })
  it("refuses a fourth key and an empty value", () => {
    expect(parseIdea(JSON.stringify({ ...good, mood: "x" }))).toMatch(/exactly/)
    expect(parseIdea(JSON.stringify({ ...good, title: " " }))).toMatch(/non-empty/)
  })
})

describe("gate 2 — the four conditions of #844 §1.2, any one failing drops the idea", () => {
  const ok: Verdict = { deviatesFrom: "self", statesOutright: false, marked: false, offpage: true, otherGap: null, wantServes: true, reason: "" }
  it("accepts when all four hold", () => expect(acceptVerdict(ok, "self")).toBe(true))
  it("fails on each condition alone", () => {
    expect(acceptVerdict({ ...ok, deviatesFrom: "want" }, "self")).toBe(false)
    expect(acceptVerdict({ ...ok, offpage: false }, "self")).toBe(false)
    expect(acceptVerdict({ ...ok, otherGap: "belief" }, "self")).toBe(false)
    expect(acceptVerdict({ ...ok, wantServes: false }, "self")).toBe(false)
  })
  it("rejects an anchor restated in substance — the leak the 4-gram gate cannot see (first run, ideas 1 and 3)", () => {
    expect(acceptVerdict({ ...ok, statesOutright: true }, "self")).toBe(false)
  })
  it("judges the triple's anchors, not the whole card: the prompt lists the three before the card", () => {
    const p = buildVerifyPrompt(persona, triple, good)
    expect(p.indexOf("THREE ANCHORS")).toBeLessThan(p.indexOf("CARD (context only)"))
    expect(p).toContain(`BELIEF: ${triple.belief.text}`)
  })
  it("asks statesOutright about the spoken line only — the want field restates WANT by contract (run 2 rejected 3/5 on that)", () => {
    const p = buildVerifyPrompt(persona, triple, good)
    expect(p).toMatch(/OPENING LINE itself/)
    expect(p).toMatch(/Ignore the title and the want field/)
  })
  it("parses a verdict strictly: a bad enum is a string error, not a silent default", () => {
    expect(parseVerdict(JSON.stringify({ ...ok, deviatesFrom: "maybe" }))).toMatch(/deviatesFrom/)
    expect(parseVerdict(JSON.stringify(ok))).toEqual(ok)
  })
})

describe("prompt and packet — the hidden layer never travels", () => {
  it("names BREAKS and all three anchors in the writer prompt", () => {
    const p = buildWriterPrompt(persona, triple, [])
    expect(p).toContain("BREAKS: self")
    expect(p).toContain(triple.want.text)
    expect(p).toContain(triple.belief.text)
    expect(p).toContain("(none)")
  })
  it("builds the smallest valid packet: one entity, the rules, no notes, budget within schema bounds", () => {
    const pk = minimalPacket("book1", persona, [{ id: "r1", title: "[voice] One person", body: "He is one person." }])
    expect(pk.entities).toHaveLength(1)
    expect(pk.rules[0]?.body).toBe("He is one person.")
    expect(pk.chapter).toBeNull()
    expect(pk.tokenBudget).toBeGreaterThanOrEqual(500)
    expect(JSON.stringify(pk)).not.toMatch(/hidden/i)
  })
})

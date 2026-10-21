import { describe, expect, it } from "vitest"
import { findLeaks, protectedAnchors, runChecks } from "../src/checks.js"
import { WESTBUND } from "../src/fixture/westbund.js"

const protectedTexts = protectedAnchors(WESTBUND.card, WESTBUND.hidden)

describe("leak gate — the private layer must never surface word for word", () => {
  it("catches a hidden note reproduced verbatim", () => {
    const leaks = findLeaks("Honestly? They think he's flaky, and he lets them. That's the whole thing.", protectedTexts)
    expect(leaks.length).toBeGreaterThan(0)
  })

  it("does not count a paraphrase: deflecting in his own words is the behaviour we want", () => {
    expect(findLeaks("My friends think I flake. Let them.", protectedTexts)).toEqual([])
  })

  it("leaves SELF unprotected: how he presents is allowed to surface", () => {
    expect(findLeaks("I'm the guy who pulls up in the Lexus, usually.", protectedTexts)).toEqual([])
  })

  it("matches across punctuation and case, so quoting the card with commas added still leaks", () => {
    expect(findLeaks("Saw Tiffany leave Hard Summer—with a guy. Not Dennis.", protectedTexts).length).toBeGreaterThan(0)
  })
})

describe("voice gates", () => {
  it("flags group-speak and the taboo label", () => {
    const r = runChecks("Guys like me don't do that. ABBs, whatever. I'm not some fuckboy.", [])
    expect(r.groupSpeak.length).toBe(2)
    expect(r.taboo).toEqual(["fuckboy"])
  })

  it("counts eye-dialect and slang tokens, not the plain words they imitate", () => {
    const r = runChecks("I'm tryna get home. Trying, I mean. Bro.", [])
    expect(r.eyeDialect).toEqual(["tryna"])
    expect(r.slang).toEqual(["bro"])
  })

  it("is silent on plain English", () => {
    const r = runChecks("Car's in the shop. Long story. You coming or not?", [])
    expect(r).toMatchObject({ leaks: [], taboo: [], groupSpeak: [], eyeDialect: [], slang: [] })
  })
})

import { describe, it, expect } from "vitest"
import { stripHtmlForPositions } from "../../src/lib/html-text.js"

// Guardian reports findings as character offsets INTO this output, so the
// contract under test is offset fidelity, not prettiness.
describe("stripHtmlForPositions", () => {
  it("removes tags without inserting spacers", () => {
    expect(stripHtmlForPositions("<p>He had a <em>heart of gold</em>.</p>")).toBe(
      "He had a heart of gold."
    )
  })

  it("keeps offsets usable: a match in the plain text indexes the same words", () => {
    const plain = stripHtmlForPositions("<p>She <strong>ran</strong> fast.</p>")
    const start = plain.indexOf("ran")
    expect(plain.slice(start, start + 3)).toBe("ran")
    expect(plain).toBe("She ran fast.")
  })

  it("decodes named entities to single characters", () => {
    expect(stripHtmlForPositions("a&nbsp;b&amp;c&mdash;d&hellip;")).toBe("a b&c—d…")
  })

  it("decodes numeric and hex entities", () => {
    expect(stripHtmlForPositions("&#72;&#x69;")).toBe("Hi")
  })

  it("does NOT trim or collapse whitespace — that would shift every later offset", () => {
    expect(stripHtmlForPositions("<p>  a   b  </p>")).toBe("  a   b  ")
  })

  it("returns empty string for empty input", () => {
    expect(stripHtmlForPositions("")).toBe("")
  })
})

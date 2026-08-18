import { describe, it, expect } from "vitest"
import { contentHash } from "../../src/lib/content-hash.js"

// This must stay byte-identical to lib/offline/content-hash.ts in
// creader-editor: the server re-hashes its own stored prose and compares.
// A divergence here turns every guarded write into a false conflict.
describe("contentHash", () => {
  it("produces the FNV-1a 32-bit digest the server computes", () => {
    // Offset basis alone, for the empty string.
    expect(contentHash("")).toBe("811c9dc5")
    expect(contentHash("a")).toBe("e40c292c")
    expect(contentHash("foobar")).toBe("bf9cf968")
  })

  it("is always 8 hex characters", () => {
    for (const s of ["", "a", "hello world", "一个中文句子"]) {
      expect(contentHash(s)).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it("changes when the prose changes", () => {
    expect(contentHash("<p>draft</p>")).not.toBe(contentHash("<p>draft.</p>"))
  })
})

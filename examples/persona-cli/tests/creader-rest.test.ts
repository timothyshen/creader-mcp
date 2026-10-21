import { describe, expect, it } from "vitest"
import { assertKeyShape } from "../src/creader-rest.js"

describe("key shape guard — a wrong secret must fail before it reaches the network", () => {
  it("accepts the server's format: cr_live_ + 40 hex", () => {
    expect(() => assertKeyShape("cr_live_" + "a".repeat(40))).not.toThrow()
  })
  it("rejects an OpenAI key, a bare hash, and a quoted value, naming only the first six characters", () => {
    for (const bad of ["sk-proj-" + "x".repeat(150), "d".repeat(64), '"cr_live_' + "a".repeat(40) + '"']) {
      expect(() => assertKeyShape(bad)).toThrow(/does not look like a Creader key/)
      expect(() => assertKeyShape(bad)).not.toThrow(new RegExp(bad.slice(8, 20)))
    }
  })
})

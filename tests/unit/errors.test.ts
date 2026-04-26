import { describe, it, expect } from "vitest"
import { toolError } from "../../src/lib/errors.js"

describe("toolError", () => {
  it("formats Error instances with their message", () => {
    const result = toolError(new Error("boom"))
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: "text", text: "Error: boom" }])
  })

  it("stringifies non-Error values", () => {
    const result = toolError("plain string")
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Error: plain string")
  })

  it("handles null/undefined", () => {
    expect(toolError(null).content[0].text).toBe("Error: null")
    expect(toolError(undefined).content[0].text).toBe("Error: undefined")
  })

  it("stringifies object errors", () => {
    const result = toolError({ code: 42 })
    expect(result.content[0].text).toContain("Error:")
  })
})

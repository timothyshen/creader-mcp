import { describe, it, expect } from "vitest"
import { ApiRequestError, UNAUTHORIZED_HINT, toolError } from "../../src/lib/errors.js"

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

describe("toolError on a 401", () => {
  it("names the plan as a possible cause, since Creader refuses keys below Creator with the same 401", () => {
    const text = toolError(new ApiRequestError("Not authenticated", 401, "UNAUTHORIZED")).content[0].text
    expect(text).toBe(`Error: Not authenticated. ${UNAUTHORIZED_HINT}`)
    expect(text).toMatch(/Creator plan/)
  })

  it("leaves other statuses alone, including a 403 that already says what is wrong", () => {
    const msg = "API access (API keys and the MCP server) is part of the Creator plan."
    expect(toolError(new ApiRequestError(msg, 403, "API_ACCESS_REQUIRES_CREATOR")).content[0].text).toBe(`Error: ${msg}`)
    expect(toolError(new ApiRequestError("Not found", 404)).content[0].text).toBe("Error: Not found")
  })
})

import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxStats, fxQuota } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerStatsTools } = await import("../../../src/tools/stats.js")
  const server = new FakeMcpServer()
  registerStatsTools(server as never)
  return server
}

describe("stats tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers both stats tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual(["get_quota", "get_writing_stats"])
  })

  it("get_writing_stats formats streak and word progress", async () => {
    const server = await setup()
    fetchMock.mockSuccess(fxStats)
    const result = asToolResult(await server.call("get_writing_stats"))
    expect(result.content[0].text).toBe(
      "Streak: 3 days (best 10, goal 7) | Today: 500/1000 words | " +
        "Yesterday: 800 words | This week: 2400/5000 words | Days written: 42"
    )
    expect(fetchMock.lastCall()!.url).toBe(
      "https://test.creader.local/api/user/writing-stats"
    )
  })

  it("names only fields the product actually returns", async () => {
    const server = await setup()
    fetchMock.mockSuccess(fxStats)
    const result = asToolResult(await server.call("get_writing_stats"))
    // The bug this replaces was silent: the tool read fields that do not exist
    // on the wire, so it rendered "undefined" to every caller for months.
    expect(result.content[0].text).not.toContain("undefined")
  })

  it("get_quota formats remaining, used, and bonus", async () => {
    const server = await setup()
    fetchMock.mockSuccess(fxQuota)
    const result = asToolResult(await server.call("get_quota"))
    expect(result.content[0].text).toBe(
      "Quota: 80000/100000 tokens remaining (25000 used, 5000 bonus)"
    )
  })

  it("returns tool errors on failure", async () => {
    const server = await setup()
    fetchMock.mockApiError("X", "down")
    const result = asToolResult(await server.call("get_quota"))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("down")
  })
})

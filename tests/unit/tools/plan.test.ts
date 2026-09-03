import { describe, it, expect, beforeEach, vi } from "vitest"
import { installFetchMock, type FetchMock } from "../../helpers/mock-fetch.js"
import { FakeMcpServer, asToolResult } from "../../helpers/fake-mcp-server.js"
import { fxPlanSpine, fxPlotNode, fxThread } from "../../helpers/fixtures.js"

async function setup() {
  vi.resetModules()
  const { registerPlanTools } = await import("../../../src/tools/plan.js")
  const server = new FakeMcpServer()
  registerPlanTools(server as never)
  return server
}

describe("plan tools", () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  it("registers all eight plan tools", async () => {
    const server = await setup()
    expect(server.names().sort()).toEqual([
      "apply_structure_template",
      "create_plan_thread",
      "create_plot_node",
      "delete_plot_node",
      "get_plan_spine",
      "list_plot_nodes",
      "reorder_plot_nodes",
      "update_plot_node",
    ])
  })

  describe("get_plan_spine", () => {
    it("never returns chapter prose", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxPlanSpine)

      const result = asToolResult(await server.call("get_plan_spine", { bookId: "book_1" }))

      // The route includes whole Chapter rows, prose and all. Forwarding that
      // would spend a book's worth of context to answer "what shape is this
      // book" — and would do it on every call.
      expect(result.content[0].text).not.toContain("The harbour lights had gone out")
      expect(result.content[0].text).not.toContain("content")
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/plan-spine"
      )
    })

    it("keeps the structure a planner actually needs", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxPlanSpine)
      const parsed = JSON.parse(
        asToolResult(await server.call("get_plan_spine", { bookId: "book_1" })).content[0].text
      )

      const volume = parsed.volumes[0]
      expect(volume).toMatchObject({ id: "vol_1", title: "Part One", orderIndex: 0 })
      expect(volume.threads[0]).toMatchObject({ id: "thr_1", name: "Mira and the letter" })
      const chapter = volume.acts[0].chapters[0]
      expect(chapter).toMatchObject({ id: "chap_1", title: "Arrival", wordCount: 1200 })
      expect(chapter.scenes[0]).toMatchObject({ id: "scn_1", title: "The dock" })
      // Beats carry their thread ids flattened out of the M2M join rows —
      // otherwise the caller cannot tell which subplot a beat belongs to.
      expect(chapter.beats[0]).toMatchObject({
        id: "pn_1",
        order: 0,
        summary: "Mira misses the last ferry",
        threadIds: ["thr_1"],
      })
    })

    it("surfaces chapters that belong to no act instead of dropping them", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxPlanSpine)
      const parsed = JSON.parse(
        asToolResult(await server.call("get_plan_spine", { bookId: "book_1" })).content[0].text
      )
      // Chapters written in Write have no act. The spine nests by act, so
      // without this list they would be invisible to a planning agent.
      expect(parsed.unassignedChapters).toHaveLength(1)
      expect(parsed.unassignedChapters[0]).toMatchObject({ id: "chap_9", title: "Loose page" })
    })

    it("says the plan is empty rather than printing empty arrays", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ volumes: [], unassignedChapters: [] })
      const result = asToolResult(await server.call("get_plan_spine", { bookId: "book_1" }))
      expect(result.content[0].text).toContain("no plan yet")
      expect(result.content[0].text).toContain("apply_structure_template")
    })
  })

  describe("list_plot_nodes", () => {
    it("lists beats flat with the ids needed to act on them", async () => {
      const server = await setup()
      fetchMock.mockSuccess([fxPlotNode])
      const result = asToolResult(await server.call("list_plot_nodes", { bookId: "book_1" }))
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/books/book_1/plot-nodes"
      )
      expect(result.content[0].text).toContain("Mira misses the last ferry")
      expect(result.content[0].text).toContain("chapterId:chap_1")
      expect(result.content[0].text).toContain("id:pn_1")
      expect(result.content[0].text).toContain("threads:thr_1")
    })

    it("reports an empty plan plainly", async () => {
      const server = await setup()
      fetchMock.mockSuccess([])
      const result = asToolResult(await server.call("list_plot_nodes", { bookId: "book_1" }))
      expect(result.content[0].text).toBe("No beats in this book yet.")
    })
  })

  describe("create_plot_node", () => {
    it("POSTs to the book-scoped route without leaking bookId into the body", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxPlotNode)
      await server.call("create_plot_node", {
        bookId: "book_1",
        chapterId: "chap_1",
        summary: "Mira misses the last ferry",
        threadIds: ["thr_1"],
      })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("POST")
      expect(call.url).toBe("https://test.creader.local/api/books/book_1/plot-nodes")
      // bookId is in the path; the route's schema is strict about what it takes.
      expect(call.body).toEqual({
        chapterId: "chap_1",
        summary: "Mira misses the last ferry",
        threadIds: ["thr_1"],
      })
    })

    it("omits order so the server appends after the last beat", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxPlotNode)
      await server.call("create_plot_node", {
        bookId: "book_1",
        chapterId: "chap_1",
        summary: "x",
      })
      expect(fetchMock.lastCall()!.body).not.toHaveProperty("order")
    })

    it("surfaces the setup/payoff rejection as written", async () => {
      const server = await setup()
      // The column has no FK and both Plan consumers render whatever it points
      // at as a setup chip, so a payoff id there fails silently in the product.
      // The route turns it into a 400; the tool must not swallow the reason.
      fetchMock.mockHttpError(400, {
        error: "setupId must reference a setup marker, not a payoff",
      })
      const result = asToolResult(
        await server.call("create_plot_node", {
          bookId: "book_1",
          chapterId: "chap_1",
          summary: "x",
          setupId: "fm_payoff",
        })
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("not a payoff")
    })

    it("enforces the server's array caps before spending a round trip", async () => {
      const server = await setup()
      const base = { bookId: "book_1", chapterId: "chap_1", summary: "x" }
      expect(
        server.validate("create_plot_node", {
          ...base,
          threadIds: Array.from({ length: 21 }, (_, i) => `t${i}`),
        }).success
      ).toBe(false)
      expect(
        server.validate("create_plot_node", {
          ...base,
          eventIds: Array.from({ length: 51 }, (_, i) => `e${i}`),
        }).success
      ).toBe(false)
      expect(server.validate("create_plot_node", { ...base, summary: "" }).success).toBe(false)
    })
  })

  describe("update_plot_node", () => {
    it("PATCHes the item route with only the given fields", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ ...fxPlotNode, order: 3 })
      await server.call("update_plot_node", { id: "pn_1", order: 3 })
      const call = fetchMock.lastCall()!
      expect(call.method).toBe("PATCH")
      expect(call.url).toBe("https://test.creader.local/api/plot-nodes/pn_1")
      expect(call.body).toEqual({ order: 3 })
    })

    it("passes an empty threadIds through instead of dropping it", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxPlotNode)
      await server.call("update_plot_node", { id: "pn_1", threadIds: [] })
      // threadIds REPLACES the set, so [] is the only way to detach a beat from
      // every thread. Treating it as "nothing to send" would make that
      // impossible and silently succeed.
      expect(fetchMock.lastCall()!.body).toEqual({ threadIds: [] })
    })
  })

  describe("delete_plot_node", () => {
    it("DELETEs and tolerates a reply with no data field", async () => {
      const server = await setup()
      // This route answers { success: true, message } — no `data`. A tool that
      // read the result would get undefined.
      fetchMock.mockSuccess(undefined)
      const result = asToolResult(await server.call("delete_plot_node", { id: "pn_1" }))
      expect(result.isError).toBeUndefined()
      expect(fetchMock.lastCall()!.method).toBe("DELETE")
      expect(result.content[0].text).toBe("Deleted beat pn_1")
    })
  })

  describe("reorder_plot_nodes", () => {
    it("sends one batch to the transactional route", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ updated: 2 })
      const result = asToolResult(
        await server.call("reorder_plot_nodes", {
          nodes: [
            { id: "pn_1", order: 1 },
            { id: "pn_2", order: 0 },
          ],
        })
      )
      // One call, not one per beat: the server checks every id before the
      // transaction opens, so this cannot half-apply the way reorder_chapters can.
      expect(fetchMock.calls).toHaveLength(1)
      expect(fetchMock.lastCall()!.url).toBe("https://test.creader.local/api/plot-nodes/reorder")
      expect(result.content[0].text).toBe("Reordered 2 beats.")
    })

    it("does not call the server for an empty batch", async () => {
      const server = await setup()
      const result = asToolResult(await server.call("reorder_plot_nodes", { nodes: [] }))
      expect(fetchMock.calls).toHaveLength(0)
      expect(result.content[0].text).toContain("nothing to do")
    })

    it("rejects a batch over the server's 200 cap locally", async () => {
      const server = await setup()
      const nodes = Array.from({ length: 201 }, (_, i) => ({ id: `pn_${i}`, order: i }))
      expect(server.validate("reorder_plot_nodes", { nodes }).success).toBe(false)
    })
  })

  describe("create_plan_thread", () => {
    it("POSTs under the volume, not the book", async () => {
      const server = await setup()
      fetchMock.mockSuccess(fxThread)
      const result = asToolResult(
        await server.call("create_plan_thread", {
          volumeId: "vol_1",
          name: "Mira and the letter",
          color: "#C47F5E",
        })
      )
      expect(fetchMock.lastCall()!.url).toBe(
        "https://test.creader.local/api/volumes/vol_1/threads"
      )
      expect(fetchMock.lastCall()!.body).toEqual({
        name: "Mira and the letter",
        color: "#C47F5E",
      })
      expect(result.content[0].text).toContain("thr_1")
    })

    it("requires a color, which the grid needs and the route enforces", async () => {
      const server = await setup()
      expect(
        server.validate("create_plan_thread", { volumeId: "vol_1", name: "X" }).success
      ).toBe(false)
    })
  })

  describe("apply_structure_template", () => {
    it("reports what the skeleton actually created", async () => {
      const server = await setup()
      fetchMock.mockSuccess({ templateId: "three-act", acts: 3, chapters: 12 })
      const result = asToolResult(
        await server.call("apply_structure_template", {
          bookId: "book_1",
          templateId: "three-act",
        })
      )
      expect(fetchMock.lastCall()!.body).toEqual({ templateId: "three-act" })
      expect(result.content[0].text).toBe(
        "Applied three-act: created 3 acts and 12 chapters."
      )
    })

    it("says plainly when nothing was created because the plan already had content", async () => {
      const server = await setup()
      fetchMock.mockSuccess({
        templateId: "heros-journey",
        acts: 0,
        chapters: 0,
        declaredOnly: true,
      })
      const result = asToolResult(
        await server.call("apply_structure_template", {
          bookId: "book_1",
          templateId: "heros-journey",
        })
      )
      // "Applied heros-journey: created 0 acts" would read as a failed write.
      // It is a deliberate refusal to overwrite, and must say so.
      expect(result.content[0].text).toContain("Nothing was created")
      expect(result.content[0].text).toContain("never overwrites")
    })

    it("only accepts the four templates the route knows", async () => {
      const server = await setup()
      expect(
        server.validate("apply_structure_template", { bookId: "b", templateId: "snowflake" })
          .success
      ).toBe(false)
      expect(
        server.validate("apply_structure_template", { bookId: "b", templateId: "none" }).success
      ).toBe(true)
    })
  })
})

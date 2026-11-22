import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createServer } from "../src/server.js"
import { queuePath } from "../src/store.js"
import { NOW, bookOnDisk, ids } from "./helpers.js"

const BOOK = {
  "01-ring.md": "---\nid: ring\n---\n# The Ring\n\nMara turned the ring in the lamplight. It was silver, cold as the river.",
  "02-jeweller.md": "---\nid: jeweller\n---\n# The Jeweller\n\n“Gold,” said the jeweller. “It was always gold, under the plating.”",
}

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> }
const json = (r: unknown) => JSON.parse((r as Result).content[0]!.text)

async function connect(bookDir: string) {
  const server = createServer({ bookDir, now: () => NOW, newId: ids() })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0" })
  await Promise.all([server.connect(a), client.connect(b)])
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<Result>
  return { client, call }
}

describe("the local server, end to end over MCP", () => {
  it("lists its six tools and tells the agent the loop", async () => {
    const { client } = await connect(bookOnDisk(BOOK))
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(["get_canon", "get_chapter", "list_chapters", "list_entity_facts", "propose_entity_facts", "triage_entity_fact"])
    expect(client.getInstructions()).toMatch(/You are the model/)
  })

  it("propose → triage → canon, with the queue in .creader/facts.jsonl", async () => {
    const dir = bookOnDisk(BOOK)
    const { call } = await connect(dir)

    expect(json(await call("list_chapters")).map((c: { id: string }) => c.id)).toEqual(["ring", "jeweller"])
    expect(json(await call("get_chapter", { chapterId: "ring" })).text).toMatch(/It was silver/)

    const first = json(await call("propose_entity_facts", { chapterId: "ring", facts: [
      { key: "mara.ring.material", value: "silver", evidence: "It was silver, cold as the river." },
      { key: "mara.ring.material", value: "iron", evidence: "It was iron." },
    ] }))
    expect([first.filed, first.rejected]).toEqual([1, 1])
    expect(json(await call("triage_entity_fact", { id: "f1", status: "ACCEPTED" })).row.status).toBe("ACCEPTED")

    const second = json(await call("propose_entity_facts", { chapterId: "jeweller", facts: [
      { key: "mara.ring_material", value: "gold", by: "jeweller", kind: "cognitive", evidence: "It was always gold" },
    ] }))
    expect(second.outcomes[0]).toMatchObject({ result: "filed", id: "f2", key: "mara.ring.material", renamedFrom: "mara.ring_material", collision: { canonValue: "silver" } })
    expect(json(await call("list_entity_facts")).map((r: { id: string }) => r.id)).toEqual(["f2"])

    const refused = await call("triage_entity_fact", { id: "f2", status: "ACCEPTED" })
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toMatch(/^needs_ruling:/)

    await call("triage_entity_fact", { id: "f2", status: "ACCEPTED", ruling: "misdirection-revealed" })
    const canon = json(await call("get_canon", { subject: "mara" }))
    expect(canon.keys).toEqual([{
      key: "mara.ring.material",
      current: [{ value: "gold", by: "jeweller", chapter: 2, chapterTitle: "The Jeweller", status: "asserted" }],
      superseded: [{ value: "silver", chapter: 1, until: 2, how: "in-world" }],
    }])
    expect(canon.doubleTruths).toEqual([])
    expect(json(await call("get_canon")).canon).toMatch(/mara\.ring\.material was silver .* until it was overturned at #2/)

    const lines = readFileSync(queuePath(dir), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(lines.map((r) => [r.id, r.status, r.ruling ?? null])).toEqual([["f1", "ACCEPTED", null], ["f2", "ACCEPTED", "misdirection-revealed"]])
  })

  it("answers an unknown chapter with an error, not a crash", async () => {
    const { call } = await connect(bookOnDisk(BOOK))
    expect((await call("get_chapter", { chapterId: "nope" })).isError).toBe(true)
    expect((await call("propose_entity_facts", { chapterId: "nope", facts: [{ key: "a.b", value: "c", evidence: "d" }] })).isError).toBe(true)
  })

  it("runs as a real stdio server through its bin", async () => {
    const bin = fileURLToPath(new URL("../bin/creader-local-memory.mjs", import.meta.url))
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin, "--book", bookOnDisk(BOOK)], stderr: "pipe" })
    const client = new Client({ name: "stdio-test", version: "0" })
    await client.connect(transport)
    try {
      const chapters = JSON.parse(((await client.callTool({ name: "list_chapters", arguments: {} })) as Result).content[0]!.text)
      expect(chapters.map((c: { id: string; title: string }) => [c.id, c.title])).toEqual([["ring", "The Ring"], ["jeweller", "The Jeweller"]])
    } finally {
      await client.close()
    }
  }, 20_000)
})

/**
 * @input  A book folder (--book <dir> or CREADER_BOOK_DIR): chapters/*.md, and .creader/facts.jsonl once facts exist.
 * @output An MCP server over stdio with six tools: list_chapters, get_chapter, get_canon,
 *         propose_entity_facts, list_entity_facts, triage_entity_fact. No API key, no model, no network.
 * @pos    local-book-memory — the keyless local path. The calling agent reads a chapter and proposes facts
 *         with quotes; narrative-core's code stages check them (propose.ts); the writer triages (triage.ts);
 *         canon is folded from what was accepted (canon.ts). Tool names follow the hosted server where the
 *         act is the same (list_chapters, get_chapter, list_entity_facts, triage_entity_fact).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { renderCanon, truthOf } from "../vendor/narrative-core/world/fold"
import { subjectOf } from "../vendor/narrative-core/world/keys"
import { readChapters } from "./book.js"
import { foldCanon } from "./canon.js"
import { RULINGS } from "./facts.js"
import { proposeFacts } from "./propose.js"
import { newId as randomId, readRows, writeRows } from "./store.js"
import { TriageError, triageFact } from "./triage.js"

const INSTRUCTIONS = [
  "This server keeps one book's memory in local files: no account, no key, no model. You are the model.",
  "The loop: get_canon (the facts and keys already established) → get_chapter → propose_entity_facts with what the chapter establishes, each with a verbatim quote → the writer accepts or dismisses with triage_entity_fact. Nothing you propose is canon until the writer accepts it.",
  "Propose durable facts a later chapter could contradict, in this priority: where a person was and when; alive, dead or reported dead; the state of objects and openings; who someone is (role, name, relation); what someone knows or has claimed. Not texture (routines, durations, how a lamp looks). At most about six per chapter.",
  "Keys are subject.attribute, two or three segments, lowercase, generic and reusable (mara.ring.material, garden.door.state). REUSE a key get_canon already lists whenever the same thing is meant: a variant key hides every later contradiction on it. The subject is what the fact is about; who says it goes in `by` (narrator, or the character), so a rumour stays a rumour.",
  "Values are short canonical values, never sentences: at most six words, lowercase, e.g. dead, silver, 4 privet drive, car crash, hut on a rock. The detail and the why stay in the quote. Values are compared exactly, so the same thing must get the same value every time (reuse the value get_canon shows when nothing changed); a sentence is rejected.",
  "A fact whose quote is not in the chapter is rejected. A fact that contradicts canon is still filed, marked with what canon held: the writer decides whether it is a progression, a revealed misdirection, a matter the book leaves open, or a mistake in the prose.",
  "Triage is the writer's decision. Call triage_entity_fact only when the writer has said what to do, or when the prose itself plainly settles it.",
].join("\n")

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] })
const failure = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] })

export function createServer(opts: { bookDir: string; now?: () => string; newId?: () => string }): McpServer {
  const bookDir = resolve(opts.bookDir)
  const now = opts.now ?? (() => new Date().toISOString())
  const newId = opts.newId ?? randomId
  const server = new McpServer({ name: "creader-local-memory", version: "0.0.1" }, { instructions: INSTRUCTIONS })

  server.tool("list_chapters", "The book's chapters in reading order: id, title, position, word count, contentHash. Read from <book>/chapters/*.md.", {}, async () => {
    const chapters = readChapters(bookDir)
    return text(chapters.map((c) => ({ id: c.id, title: c.title, order: c.order, words: c.text.split(/\s+/).filter(Boolean).length, chars: c.text.length, contentHash: c.contentHash })))
  })

  server.tool(
    "get_chapter",
    "One chapter's full prose, with its contentHash. Quote from this text when proposing facts.",
    { chapterId: z.string().describe("A chapter id from list_chapters") },
    async ({ chapterId }) => {
      const chapter = readChapters(bookDir).find((c) => c.id === chapterId)
      if (!chapter) return failure(`no chapter "${chapterId}"; list_chapters gives the ids`)
      return text({ id: chapter.id, title: chapter.title, order: chapter.order, contentHash: chapter.contentHash, text: chapter.text })
    },
  )

  server.tool(
    "get_canon",
    "What the book has established so far, folded in reading order from the facts the writer accepted: the current value of every key, what was superseded and when, and what is held out of canon (a fact that contradicts canon with no ruling yet; a fact whose chapter changed and no longer contains its quote). Read it before proposing, to reuse its keys.",
    { subject: z.string().optional().describe("Only keys about this subject, the first key segment (e.g. mara)") },
    async ({ subject }) => {
      const chapters = readChapters(bookDir)
      const canon = await foldCanon(chapters, readRows(bookDir))
      const wanted = (key: string) => !subject || subjectOf(key) === subject.trim().toLowerCase()
      const keys = Object.keys(canon.state.ledger).filter(wanted).sort()
      const title = new Map(chapters.map((c) => [c.order, c.title]))
      return text({
        canon: subject ? undefined : renderCanon(canon.state),
        keys: keys.map((key) => ({
          key,
          current: truthOf(canon.state, key).map((r) => ({ value: r.value, by: r.asserted.by, chapter: r.asserted.ordinal, chapterTitle: title.get(r.asserted.ordinal), status: r.status })),
          superseded: (canon.state.ledger[key] ?? []).filter((r) => r.status === "refuted").map((r) => ({ value: r.value, chapter: r.asserted.ordinal, until: r.resolved?.ordinal, how: r.resolved?.kind })),
        })),
        needsRuling: canon.needsRuling.filter((u) => wanted(u.row.key)).map((u) => ({ id: u.row.id, key: u.row.key, value: u.row.value, chapterId: u.row.chapterId, contradicts: u.canonRef })),
        stale: canon.stale.filter((r) => wanted(r.key)).map((r) => ({ id: r.id, key: r.key, value: r.value, chapterId: r.chapterId })),
        orphaned: canon.orphaned.filter((r) => wanted(r.key)).map((r) => ({ id: r.id, key: r.key, chapterId: r.chapterId })),
        doubleTruths: canon.doubleTruths,
      })
    },
  )

  server.tool(
    "propose_entity_facts",
    "File what one chapter establishes into the writer's review queue. Each fact: key (subject.attribute), value (a short canonical value, at most six words; a sentence is rejected), evidence (verbatim from get_chapter), by (who claims it; default narrator), kind (physical | cognitive | social). The server checks each in code: the quote must be in the chapter; a spelling variant of an existing key (same subject, same attribute words) is moved onto it (renamedFrom says so), while a merely similar key is kept and the outcome names it as nearKey — if you meant that key, propose the fact again under it; duplicates, facts already in canon and facts the writer dismissed for this chapter are skipped; a fact that contradicts canon before this chapter is filed with `collision` so the writer can rule on it. Returns one outcome per fact. Spends nothing.",
    {
      chapterId: z.string(),
      facts: z
        .array(
          z.object({
            key: z.string(),
            value: z.string(),
            evidence: z.string().describe("Copied verbatim from the chapter; punctuation and quote marks may differ"),
            by: z.string().optional(),
            kind: z.enum(["physical", "cognitive", "social"]).optional(),
          }),
        )
        .min(1)
        .max(20),
    },
    async ({ chapterId, facts }) => {
      try {
        const rows = readRows(bookDir)
        const { outcomes, added } = await proposeFacts({ chapters: readChapters(bookDir), chapterId, rows, facts, now: now(), newId })
        if (added.length) writeRows(bookDir, [...rows, ...added])
        const count = (r: string) => outcomes.filter((o) => o.result === r).length
        return text({ filed: count("filed"), skipped: count("skipped"), rejected: count("rejected"), outcomes })
      } catch (e) {
        return failure(e instanceof Error ? e.message : String(e))
      }
    },
  )

  server.tool(
    "list_entity_facts",
    "The review queue: proposed facts in reading order, with the quote, who claims it, and any contradiction with canon recorded when it was filed. status defaults to PENDING.",
    { status: z.enum(["PENDING", "ACCEPTED", "DISMISSED"]).optional(), chapterId: z.string().optional() },
    async ({ status, chapterId }) => {
      const order = new Map(readChapters(bookDir).map((c) => [c.id, c.order]))
      const rows = readRows(bookDir)
        .filter((r) => r.status === (status ?? "PENDING") && (!chapterId || r.chapterId === chapterId))
        .sort((a, b) => (order.get(a.chapterId) ?? Infinity) - (order.get(b.chapterId) ?? Infinity))
      return text(rows)
    },
  )

  server.tool(
    "triage_entity_fact",
    `The writer's decision on one proposed fact. ACCEPTED puts it into canon; DISMISSED keeps the row so the statement is not proposed again for that chapter. A fact that contradicts canon needs a ruling with ACCEPTED: ${RULINGS.join(" | ")}. If the chapter is simply wrong, fix the prose and dismiss the fact.`,
    { id: z.string(), status: z.enum(["ACCEPTED", "DISMISSED"]), ruling: z.enum(["progression", "misdirection-revealed", "suspended"]).optional() },
    async ({ id, status, ruling }) => {
      try {
        const result = await triageFact({ chapters: readChapters(bookDir), rows: readRows(bookDir), id, status, ...(ruling ? { ruling } : {}), now: now() })
        writeRows(bookDir, result.rows)
        return text({
          row: result.row,
          ...(result.note ? { note: result.note } : {}),
          ...(result.newlyUnruled.length
            ? { newlyUnruled: result.newlyUnruled.map((r) => ({ id: r.id, key: r.key, value: r.value, chapterId: r.chapterId })), warning: "these accepted facts of later chapters now contradict canon and are held out of it until the writer rules (get_canon → needsRuling)" }
            : {}),
        })
      } catch (e) {
        return failure(e instanceof TriageError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e))
      }
    },
  )

  return server
}

function bookDirFromArgs(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--book")
  return i >= 0 ? argv[i + 1] : process.env.CREADER_BOOK_DIR
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = bookDirFromArgs(process.argv.slice(2))
  if (!dir) {
    console.error("usage: creader-local-memory --book <dir>   (or set CREADER_BOOK_DIR)")
    process.exit(2)
  }
  await createServer({ bookDir: dir }).connect(new StdioServerTransport())
}

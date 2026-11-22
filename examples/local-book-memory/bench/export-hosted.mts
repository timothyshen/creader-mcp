/**
 * Export chapters 1..N of a hosted Creader book into a local book folder, plus the hosted extraction's
 * entity facts for those chapters (whatever is in the book's queue: PENDING, ACCEPTED and DISMISSED).
 * Reads CREADER_API_KEY (and CREADER_API_URL) from the environment. Spends nothing: no extraction is run.
 * Usage: tsx bench/export-hosted.mts <bookId> <chapters> <outDir>
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stripHtmlForPositions } from "../../../src/lib/html-text.js"

const [bookId, count, out] = process.argv.slice(2)
if (!bookId || !count || !out) throw new Error("usage: export-hosted.mts <bookId> <chapters> <outDir>")
const base = process.env.CREADER_API_URL ?? "https://creader.io"
const get = async (path: string) => {
  const r = await fetch(base + path, { headers: { Authorization: `Bearer ${process.env.CREADER_API_KEY}` } })
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return ((await r.json()) as { data: unknown }).data
}
type Meta = { id: string; title: string; orderIndex: number; wordCount: number }
const chapters = ((await get(`/api/books/${bookId}/chapters`)) as Meta[]).filter((c) => c.wordCount > 0).sort((a, b) => a.orderIndex - b.orderIndex).slice(0, Number(count))
mkdirSync(join(out, "book", "chapters"), { recursive: true })
for (const [i, meta] of chapters.entries()) {
  const chapter = (await get(`/api/chapters/${meta.id}`)) as { content?: string }
  const text = stripHtmlForPositions(chapter.content ?? "")
  writeFileSync(join(out, "book", "chapters", `${String(i + 1).padStart(2, "0")}.md`), `---\nid: ${meta.id}\ntitle: ${meta.title}\norder: ${i + 1}\n---\n${text}`)
  console.log(`${meta.title}: ${text.length} chars${text.length > 24_000 ? ` (hosted extraction reads the first 24000)` : ""}`)
}
const wanted = new Set(chapters.map((c) => c.id))
const facts = []
for (const status of ["PENDING", "ACCEPTED", "DISMISSED"]) {
  const data = (await get(`/api/books/${bookId}/entity-facts?status=${status}`)) as unknown[] | { facts: unknown[] }
  facts.push(...(Array.isArray(data) ? data : data.facts).filter((f) => wanted.has((f as { chapterId: string }).chapterId)))
}
writeFileSync(join(out, "hosted-facts.json"), JSON.stringify(facts, null, 1))
console.log(`hosted facts for these chapters: ${facts.length}${facts.length ? "" : " — run extract_entity_candidates on them first (spends quota)"}`)

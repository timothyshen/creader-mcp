/**
 * @input  seed-plan (what), creader-rest (how), env CREADER_API_KEY / CREADER_API_URL.
 * @output `pnpm seed [--env path]`: idempotent upsert of the plan into the caller's Creader
 *         account, then `.persona-seed.json` with the ids the later commands need.
 * @pos    persona-cli — M1 step 2. Match by title / name / (source,target,type); the card and
 *         note bodies are rewritten on every run so the fixture stays the source of truth.
 */
import { writeFileSync } from "node:fs"
import { CreaderRest } from "./creader-rest.js"
import { loadEnvFile } from "./providers.js"
import { planSeed, type SeedPlan } from "./seed-plan.js"

interface Book { id: string; title: string }
interface Entity { id: string; name: string }
interface Note { id: string; title: string }
interface Relation { id: string; sourceId: string; targetId: string; type: string }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function seedBook(api: CreaderRest, plan: SeedPlan): Promise<Book> {
  const books = await api.call<Book[]>("GET", "/api/books")
  const found = books.find((b) => b.title === plan.bookTitle)
  if (found) return found
  return api.call<Book>("POST", "/api/books", { title: plan.bookTitle, contentType: "novel", genre: "literary" })
}

async function seedCharacters(api: CreaderRest, bookId: string, plan: SeedPlan): Promise<Map<string, string>> {
  const existing = await api.call<Entity[]>("GET", `/api/books/${bookId}/characters`)
  const ids = new Map<string, string>()
  for (const row of plan.characters) {
    const hit = existing.find((e) => e.name === row.name)
    const body = { name: row.name, description: row.description, role: row.role, ...(row.customFields ? { customFields: row.customFields } : {}) }
    if (hit) {
      await api.call("PATCH", `/api/characters/${hit.id}`, body)
      ids.set(row.name, hit.id)
      console.error(`  = ${row.name} (updated)`)
    } else {
      const created = await api.call<Entity>("POST", `/api/books/${bookId}/characters`, body)
      ids.set(row.name, created.id)
      console.error(`  + ${row.name}`)
    }
  }
  return ids
}

async function seedRelations(api: CreaderRest, bookId: string, plan: SeedPlan, ids: Map<string, string>): Promise<void> {
  const existing = await api.call<Relation[]>("GET", `/api/books/${bookId}/semantic-relations`)
  for (const r of plan.relations) {
    const sourceId = ids.get(r.source)
    const targetId = ids.get(r.target)
    if (!sourceId || !targetId) throw new Error(`relation ${r.source} → ${r.target}: unknown character`)
    if (existing.some((e) => e.sourceId === sourceId && e.targetId === targetId && e.type === r.type)) {
      console.error(`  = ${r.source} ${r.type} ${r.target}`)
      continue
    }
    await api.call("POST", `/api/books/${bookId}/semantic-relations`, {
      sourceId, sourceType: "character", targetId, targetType: "character", type: r.type, inverseType: r.inverseType,
    })
    console.error(`  + ${r.source} ${r.type} ${r.target}`)
  }
}

async function seedNotes(api: CreaderRest, bookId: string, plan: SeedPlan): Promise<void> {
  const existing = await api.call<Note[]>("GET", `/api/books/${bookId}/notes`)
  for (const n of plan.notes) {
    const hit = existing.find((e) => e.title === n.title)
    if (hit) {
      await api.call("PATCH", `/api/notes/${hit.id}`, { content: n.content, noteType: n.noteType })
      console.error(`  = ${n.title} (updated)`)
    } else {
      await api.call("POST", `/api/books/${bookId}/notes`, { title: n.title, content: n.content, noteType: n.noteType })
      console.error(`  + ${n.title}`)
    }
  }
}

async function main() {
  for (const f of (arg("env") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) console.error(`loaded ${loadEnvFile(f)} env vars from ${f}`)
  const api = CreaderRest.fromEnv()
  const plan = planSeed()
  const book = await seedBook(api, plan)
  console.error(`book ${book.id} "${book.title}"`)
  const ids = await seedCharacters(api, book.id, plan)
  await seedRelations(api, book.id, plan, ids)
  await seedNotes(api, book.id, plan)
  const out = { bookId: book.id, characterIds: Object.fromEntries(ids), seededAt: new Date().toISOString() }
  writeFileSync(".persona-seed.json", JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})

/**
 * @input  corpus/sources.json (the manifest Tim assembled), the open web.
 * @output `pnpm ingest fetch`: one corpus/<id>.md per source with front matter (title, author,
 *         year, url, status, chars) and the readable body; corpus/status.json summarising what
 *         was fetched, what is paywalled or login-walled, and what must be pasted by hand.
 *         Bodies are copyrighted material kept locally for extraction only; they are gitignored.
 * @pos    persona-cli — M2 step 1, the public layer's raw material. `load` (next) turns the
 *         fetched bodies into chapters and runs entity extraction; nothing here touches Creader.
 */
import { Readability } from "@mozilla/readability"
import { JSDOM, VirtualConsole } from "jsdom"
import { createRequire } from "node:module"

/** pdf-parse v1 exports a function, v2 exports a `PDFParse` class with `getText()`; support both. */
type PdfParseFn = (d: Buffer) => Promise<{ text: string }>
type PdfParseCls = new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> }
async function pdfText(data: Buffer): Promise<string> {
  const mod: unknown = createRequire(import.meta.url)("pdf-parse")
  if (typeof mod === "function") return (await (mod as PdfParseFn)(data)).text
  const exported = mod as { PDFParse?: PdfParseCls; default?: PdfParseCls }
  const Cls = exported.PDFParse ?? exported.default
  if (!Cls) throw new Error("pdf-parse: unknown export shape")
  return (await new Cls({ data }).getText()).text
}
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { loadEnvFile } from "./providers.js"
import { join } from "node:path"

interface Source {
  id: string
  group: "article" | "social" | "reddit"
  title: string
  author: string
  year: number | null
  url: string
  note?: string
}
type Status = "fetched" | "manual" | "paywalled" | "blocked" | "empty" | "error"
interface Result { id: string; status: Status; chars: number; detail?: string }

const UA = "creader-persona-cli/0.0.1 (research corpus fetch for an exhibition; contact: timshen191@gmail.com)"
const CORPUS = "corpus"
/** Platforms that only serve a login wall or a JS shell to a plain fetch: do not try, ask for a paste. */
const MANUAL_HOSTS = ["x.com", "twitter.com", "c.org", "change.org"]

function frontMatter(s: Source, status: Status, chars: number): string {
  return `---\nid: ${s.id}\ntitle: ${JSON.stringify(s.title)}\nauthor: ${JSON.stringify(s.author)}\nyear: ${s.year ?? ""}\nurl: ${s.url}\nstatus: ${status}\nchars: ${chars}\nfetchedAt: ${new Date().toISOString()}\n---\n\n`
}

async function get(url: string, accept: string): Promise<{ status: number; text: string; type: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow" })
  return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" }
}

function readable(html: string, url: string): { title: string; text: string } | null {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() })
  const doc = dom.window.document
  const article = new Readability(doc.cloneNode(true) as Document).parse()
  let text = article?.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? ""
  // Readability gives up on some journal layouts (PMC's newer template): fall back to the body minus chrome.
  if (text.length < 2500) {
    for (const el of doc.querySelectorAll("script, style, nav, header, footer, aside, noscript")) el.remove()
    const body = (doc.body?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim()
    if (body.length > text.length) text = body
  }
  if (!text) return null
  return { title: article?.title ?? doc.title ?? "", text }
}

/** OJS journals serve `/article/view/<a>/<g>` as a viewer shell; the galley itself is `/article/download/<a>/<g>`. */
/** A public Google Drive file renders in a JS viewer; the same id serves the bytes at `uc?export=download`. */
function driveDownloadUrl(url: string): string | null {
  const m = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([^/]+)\//)
  return m ? `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t` : null
}

function ojsDownloadUrl(url: string): string | null {
  const m = url.match(/^(.*\/article)\/view\/(\d+)\/(\d+)\/?$/)
  return m ? `${m[1]}/download/${m[2]}/${m[3]}` : null
}

async function fetchPdfText(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/pdf" }, redirect: "follow" })
  if (res.status !== 200) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  // Drive serves PDFs as application/octet-stream; trust the magic bytes, not the header.
  if (!(res.headers.get("content-type") ?? "").includes("pdf") && bytes.subarray(0, 5).toString() !== "%PDF-") return null
  const text = await pdfText(bytes)
  return text.replace(/\n{3,}/g, "\n\n").trim() || null
}

/** Reddit's public JSON: the post body plus top-level comments, which is where the recognition lives. */
async function fetchReddit(url: string): Promise<string | null> {
  const jsonUrl = url.replace(/\/?(\?.*)?$/, "") + ".json?limit=40"
  const r = await get(jsonUrl, "application/json")
  if (r.status !== 200) return null
  const data = JSON.parse(r.text) as Array<{ data: { children: Array<{ data: Record<string, unknown> }> } }>
  const post = data[0]?.data.children[0]?.data ?? {}
  const comments = (data[1]?.data.children ?? []).map((c) => c.data).filter((c) => typeof c.body === "string")
  const lines = [`# ${post.title ?? ""}`, `(${post.subreddit_name_prefixed ?? ""}, score ${post.score ?? "?"})`, "", String(post.selftext ?? ""), "", "## Comments", ""]
  for (const c of comments) lines.push(`- [${c.score ?? "?"}] ${String(c.body).replace(/\s+/g, " ").trim()}`)
  return lines.join("\n")
}

async function fetchOne(s: Source): Promise<Result> {
  const host = new URL(s.url).hostname.replace(/^www\./, "")
  const out = join(CORPUS, `${s.id}.md`)
  if (MANUAL_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    writeFileSync(out, frontMatter(s, "manual", 0) + `(paste the text here: ${s.url})\n`)
    return { id: s.id, status: "manual", chars: 0, detail: `${host} needs a login or a browser` }
  }
  try {
    if (host.endsWith("reddit.com")) {
      const text = await fetchReddit(s.url)
      if (!text) { writeFileSync(out, frontMatter(s, "blocked", 0)); return { id: s.id, status: "blocked", chars: 0, detail: "reddit json refused" } }
      writeFileSync(out, frontMatter(s, "fetched", text.length) + text + "\n")
      return { id: s.id, status: "fetched", chars: text.length }
    }
    const dl = ojsDownloadUrl(s.url) ?? driveDownloadUrl(s.url)
    if (dl) {
      const pdf = await fetchPdfText(dl)
      if (pdf) { writeFileSync(out, frontMatter(s, "fetched", pdf.length) + pdf + "\n"); return { id: s.id, status: "fetched", chars: pdf.length, detail: "pdf galley" } }
    }
    const r = await get(s.url, "text/html,application/xhtml+xml")
    if (r.status === 403 || r.status === 401) { writeFileSync(out, frontMatter(s, "blocked", 0)); return { id: s.id, status: "blocked", chars: 0, detail: `HTTP ${r.status}` } }
    if (r.status !== 200) { writeFileSync(out, frontMatter(s, "error", 0)); return { id: s.id, status: "error", chars: 0, detail: `HTTP ${r.status}` } }
    const art = readable(r.text, s.url)
    const text = art?.text ?? ""
    // A paywalled paper page yields an abstract and chrome, rarely more than a couple of thousand characters.
    const status: Status = text.length === 0 ? "empty" : text.length < 2500 && s.group === "article" ? "paywalled" : "fetched"
    writeFileSync(out, frontMatter(s, status, text.length) + (art?.title ? `# ${art.title}\n\n` : "") + text + "\n")
    return { id: s.id, status, chars: text.length }
  } catch (e) {
    writeFileSync(out, frontMatter(s, "error", 0))
    return { id: s.id, status: "error", chars: 0, detail: (e as Error).message.slice(0, 120) }
  }
}

/** `extract`: every fetched document → chunks → strict structured extraction → anchor check → graph/extract/<id>.json. */
async function extractAll(modelId: string, only?: string[]): Promise<void> {
  const { generateObject } = await import("ai")
  const { ExtractionSchema, EXTRACT_SYSTEM, anchorExtraction, chunkText } = await import("./graph-extract.js")
  const { resolveModel } = await import("./providers.js")
  const model = resolveModel(modelId)
  mkdirSync(join("graph", "extract"), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(CORPUS, "sources.json"), "utf8")) as { sources: Source[] }
  for (const s of manifest.sources) {
    if (only && !only.includes(s.id)) continue
    const file = join(CORPUS, `${s.id}.md`)
    if (!existsSync(file)) continue
    const raw = readFileSync(file, "utf8")
    const status = raw.match(/^status: (\S+)/m)?.[1]
    if (!status || !["fetched", "description-only", "abstract-only", "paywalled"].includes(status)) continue
    // My own editorial notes in the corpus files are parenthetical lines naming Tim; they are not source text.
    const body = raw.replace(/^---[\s\S]*?---\n/, "").split("\n").filter((l) => !/^\(.*\bTim\b.*\)\s*$/.test(l.trim())).join("\n")
    const out = join("graph", "extract", `${s.id}.json`)
    if (existsSync(out) && !process.argv.includes("--force")) { console.error(`cached    ${s.id}`); continue }
    const chunks = chunkText(body)
    let entities = 0, relations = 0, dropped = 0
    const parts = []
    for (const [i, chunk] of chunks.entries()) {
      const r = await generateObject({ model, schema: ExtractionSchema, system: EXTRACT_SYSTEM, prompt: `SOURCE: ${s.title} (${s.author}, ${s.year ?? "n.d."}) — part ${i + 1}/${chunks.length}\n\n${chunk}` })
      const { kept, dropped: d } = anchorExtraction(r.object, chunk)
      parts.push({ chunk: i, kept, dropped: d, usage: r.usage })
      entities += kept.entities.length; relations += kept.relations.length; dropped += d
    }
    writeFileSync(out, JSON.stringify({ id: s.id, model: modelId, chunks: chunks.length, parts }, null, 2))
    console.error(`extracted ${s.id}: ${chunks.length} chunks, ${entities} entities, ${relations} relations, ${dropped} dropped by the anchor check`)
  }
}

/** `merge`: fold every per-document extraction into one graph plus a review sheet. */
async function mergeAll(): Promise<void> {
  const { mergeExtractions } = await import("./graph-extract.js")
  const dir = join("graph", "extract")
  const parts: { source: string; extraction: { entities: never[]; relations: never[] } }[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; parts: { kept: { entities: never[]; relations: never[] } }[] }
    for (const p of doc.parts) parts.push({ source: doc.id, extraction: p.kept })
  }
  const graph = mergeExtractions(parts)
  writeFileSync(join("graph", "graph.json"), JSON.stringify(graph, null, 2))
  const byType = graph.entities.reduce<Record<string, number>>((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {})
  const lines = [`# Graph review — ${new Date().toISOString().slice(0, 10)}`, "", `${graph.entities.length} entities, ${graph.relations.length} relations, from ${new Set(parts.map((p) => p.source)).size} documents.`, "", `By type: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(" · ")}`, ""]
  for (const t of ["signifier", "concept", "community", "place", "event", "person"]) {
    const rows = graph.entities.filter((e) => e.type === t)
    if (!rows.length) continue
    lines.push(`## ${t} (${rows.length})`, "", "| name | roles | sources | aliases | one evidence |", "|---|---|---|---|---|")
    for (const e of rows) lines.push(`| ${e.name} | ${e.roles.join(",")} | ${e.sources.length} | ${e.aliases.slice(0, 3).join("; ")} | ${(e.evidence[0]?.quote ?? "").replace(/\|/g, "/").slice(0, 110)} |`)
    lines.push("")
  }
  lines.push(`## relations (top 60 by sources)`, "", "| source | type | target | sources |", "|---|---|---|---|")
  for (const r of graph.relations.slice(0, 60)) lines.push(`| ${r.source} | ${r.type} | ${r.target} | ${r.sources.length} |`)
  writeFileSync(join("graph", "REVIEW.md"), lines.join("\n") + "\n")
  console.log(lines.slice(0, 5).join("\n"))
}

/** `load`: graph.json → the seeded book, idempotent by name; relations by (source, target, type). */
async function loadGraph(minSources: number): Promise<void> {
  const { planLoad, selectNeighbourhood } = await import("./graph-load.js")
  const { CreaderRest } = await import("./creader-rest.js")
  const graph = JSON.parse(readFileSync(join("graph", "graph.json"), "utf8"))
  const plan = planLoad(graph, selectNeighbourhood(graph, minSources))
  const state = JSON.parse(readFileSync(".persona-seed.json", "utf8")) as { bookId: string }
  const api = CreaderRest.fromEnv()
  const b = state.bookId
  type Row = { id: string; name?: string; title?: string }
  const existing = {
    location: await api.call<Row[]>("GET", `/api/books/${b}/locations`),
    event: await api.call<Row[]>("GET", `/api/books/${b}/timeline-events`),
    note: await api.call<Row[]>("GET", `/api/books/${b}/notes`),
  }
  const ids = new Map<string, { id: string; kind: "location" | "event" | "note" }>()
  let created = 0, updated = 0
  for (const row of plan.rows) {
    const label = (r: Row) => r.name ?? r.title ?? ""
    const hit = existing[row.kind].find((r) => label(r) === row.name)
    if (row.kind === "location") {
      const body = { name: row.name, description: row.body, type: row.locationType ?? "place", tags: row.roles }
      const id = hit ? (await api.call("PATCH", `/api/locations/${hit.id}`, body), hit.id) : (await api.call<Row>("POST", `/api/books/${b}/locations`, body)).id
      ids.set(row.key, { id, kind: "location" })
    } else if (row.kind === "event") {
      // Timeline events need `eventType` (product enum) and an integer `timestamp`; sourced events are world
      // history, placed at their year when the name or a quote carries one, else at 0.
      const year = Number((row.name + " " + row.body).match(/\b(19|20)\d{2}\b/)?.[0] ?? 0)
      const body = { title: row.name, description: row.body, eventType: "world", importance: "background", timestamp: year }
      const id = hit ? (await api.call("PATCH", `/api/timeline-events/${hit.id}`, body), hit.id) : (await api.call<Row>("POST", `/api/books/${b}/timeline-events`, body)).id
      ids.set(row.key, { id, kind: "event" })
    } else {
      const body = { title: row.name, content: row.body, noteType: row.noteType }
      const id = hit ? (await api.call("PATCH", `/api/notes/${hit.id}`, { content: row.body, noteType: row.noteType }), hit.id) : (await api.call<Row>("POST", `/api/books/${b}/notes`, body)).id
      ids.set(row.key, { id, kind: "note" })
    }
    hit ? updated++ : created++
    if ((created + updated) % 25 === 0) console.error(`  ${created + updated}/${plan.rows.length} rows`)
  }
  type Rel = { sourceId: string; targetId: string; type: string }
  const rels = await api.call<Rel[]>("GET", `/api/books/${b}/semantic-relations`)
  let relCreated = 0
  for (const r of plan.relations) {
    const s = ids.get(r.sourceKey), t = ids.get(r.targetKey)
    if (!s || !t) continue
    if (rels.some((x) => x.sourceId === s.id && x.targetId === t.id && x.type === r.type)) continue
    await api.call("POST", `/api/books/${b}/semantic-relations`, { sourceId: s.id, sourceType: s.kind, targetId: t.id, targetType: t.kind, type: r.type, description: r.description })
    relCreated++
  }
  console.log(JSON.stringify({ rows: plan.rows.length, created, updated, relations: plan.relations.length, relationsCreated: relCreated }))
}

async function main() {
  const cmd = process.argv[2]
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]?.split(",") : undefined
  if (cmd === "extract") { for (const f of (process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1]! : "").split(",").filter(Boolean)) loadEnvFile(f); await extractAll(process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1]! : "gpt-5.6-luna", only); return }
  if (cmd === "merge") { await mergeAll(); return }
  if (cmd === "load") { for (const f of (process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1]! : "").split(",").filter(Boolean)) loadEnvFile(f); await loadGraph(Number(process.argv.includes("--min-sources") ? process.argv[process.argv.indexOf("--min-sources") + 1] : 2)); return }
  if (cmd !== "fetch") throw new Error("usage: pnpm ingest fetch|extract|merge|load")
  const manifest = JSON.parse(readFileSync(join(CORPUS, "sources.json"), "utf8")) as { sources: Source[] }
  const results: Result[] = []
  for (const s of manifest.sources) {
    if (only && !only.includes(s.id)) continue
    if (!process.argv.includes("--force") && existsSync(join(CORPUS, `${s.id}.md`)) && readFileSync(join(CORPUS, `${s.id}.md`), "utf8").includes("status: fetched")) {
      results.push({ id: s.id, status: "fetched", chars: -1, detail: "cached" })
      continue
    }
    const r = await fetchOne(s)
    results.push(r)
    console.error(`${r.status.padEnd(9)} ${String(r.chars).padStart(6)}  ${s.id}${r.detail ? `  (${r.detail})` : ""}`)
  }
  writeFileSync(join(CORPUS, "status.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  const by = results.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})
  console.log(JSON.stringify(by))
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})

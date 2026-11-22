/**
 * @input  A book folder on disk: chapters/*.md, each with optional frontmatter (id, title, order).
 * @output readChapters(dir): the chapters in reading order, each with its text and the same
 *         contentHash the hosted API uses, so a stale read is detected the same way here.
 * @pos    local-book-memory — the file source. Reads only; the prose stays the writer's, edited in
 *         any editor (Obsidian included). Nothing here writes a chapter.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { basename, join } from "node:path"
import { contentHash } from "../../../src/lib/content-hash.js"

export interface Chapter {
  /** Frontmatter `id`, else the file name without its extension. Stable across renames only when set. */
  id: string
  title: string
  /** Reading position, 1-based after sorting. */
  order: number
  /** The prose: the file without its frontmatter. */
  text: string
  contentHash: string
  file: string
}

/** `key: value` lines between two `---` fences at the top of the file. Enough for id / title / order. */
export function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]!] = kv[2]!.trim().replace(/^(["'])(.*)\1$/, "$2")
  }
  return { meta, body: raw.slice(m[0].length) }
}

function firstHeading(body: string): string | null {
  const h = /^#\s+(.+)$/m.exec(body)
  return h ? h[1]!.trim() : null
}

/** Chapters sort by frontmatter `order`, then by file name (so `01-…`, `02-…` read in order without frontmatter). */
export function readChapters(bookDir: string): Chapter[] {
  const dir = join(bookDir, "chapters")
  if (!existsSync(dir)) return []
  const rows = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = readFileSync(join(dir, f), "utf8")
      const { meta, body } = splitFrontmatter(raw)
      const stem = basename(f, ".md")
      const order = Number(meta.order)
      return {
        file: join(dir, f),
        id: meta.id || stem,
        title: meta.title || firstHeading(body) || stem,
        sortOrder: Number.isFinite(order) && meta.order !== undefined ? order : Number.POSITIVE_INFINITY,
        stem,
        text: body,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.stem.localeCompare(b.stem))

  const seen = new Set<string>()
  return rows.map((r, i) => {
    if (seen.has(r.id)) throw new Error(`two chapters share the id "${r.id}" (${r.file}); give one a frontmatter id`)
    seen.add(r.id)
    return { id: r.id, title: r.title, order: i + 1, text: r.text, contentHash: contentHash(r.text), file: r.file }
  })
}

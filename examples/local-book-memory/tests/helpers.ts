import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { contentHash } from "../../../src/lib/content-hash.js"
import type { Chapter } from "../src/book.js"
import type { FactRow } from "../src/facts.js"

export function chapter(id: string, order: number, text: string): Chapter {
  return { id, title: id, order, text, contentHash: contentHash(text), file: `${id}.md` }
}

export const NOW = "2026-11-21T00:00:00.000Z"

export function ids(prefix = "f") {
  let n = 0
  return () => `${prefix}${++n}`
}

/** An ACCEPTED row for chapter `c`, as if proposed and triaged without a ruling. */
export function accepted(c: Chapter, id: string, key: string, value: string, evidence: string, extra: Partial<FactRow> = {}): FactRow {
  return { id, chapterId: c.id, chapterHash: c.contentHash, key, value, by: "narrator", kind: "physical", evidence, status: "ACCEPTED", proposedAt: NOW, decidedAt: NOW, ...extra }
}

/** A book folder on disk: chapters/<file> for each entry. */
export function bookOnDisk(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "local-book-"))
  mkdirSync(join(dir, "chapters"))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, "chapters", name), body)
  return dir
}

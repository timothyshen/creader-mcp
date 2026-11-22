/**
 * @input  A book folder.
 * @output readRows / writeRows: the review queue at <book>/.creader/facts.jsonl, one fact per line so a
 *         diff of the file reads as a diff of decisions. Written whole through a temp file and a rename, so
 *         a crash leaves the old queue or the new one, never half of each. newId(): a short random id.
 * @pos    local-book-memory — the only file this server writes. Canon is not stored (canon.ts folds it).
 */
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { FactRow } from "./facts.js"

export const queuePath = (bookDir: string) => join(bookDir, ".creader", "facts.jsonl")

export function readRows(bookDir: string): FactRow[] {
  const file = queuePath(bookDir)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      try { return JSON.parse(line) as FactRow } catch { throw new Error(`${file}:${i + 1} is not JSON; fix or remove that line`) }
    })
}

export function writeRows(bookDir: string, rows: readonly FactRow[]): void {
  const file = queuePath(bookDir)
  mkdirSync(join(bookDir, ".creader"), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""))
  renameSync(tmp, file)
}

export const newId = () => `f_${randomBytes(4).toString("hex")}`

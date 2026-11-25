/**
 * Replay an earlier run's proposals through the CURRENT server code, chapter by chapter in reading order, with
 * the same stand-in writer between chapters (accept whatever needs no ruling). Free: no agent, no model. It
 * answers "what would this rule change have done to that run". It cannot answer how an agent would react to the
 * new outcomes (a hint, a rejection), so a live rerun is still the real test.
 * Usage: tsx bench/replay.mts <runDir>     (writes <runDir>/replay/book/.creader/facts.jsonl)
 */
import { cpSync, rmSync } from "node:fs"
import { join } from "node:path"
import { readChapters } from "../src/book.js"
import { foldCanon } from "../src/canon.js"
import { proposeFacts } from "../src/propose.js"
import { newId, readRows, writeRows } from "../src/store.js"
import { triageFact } from "../src/triage.js"

const run = process.argv[2]!
const out = join(run, "replay", "book")
rmSync(join(run, "replay"), { recursive: true, force: true })
cpSync(join(run, "book", "chapters"), join(out, "chapters"), { recursive: true })
const earlier = readRows(join(run, "book"))
const chapters = readChapters(out)
for (const chapter of chapters) {
  const facts = earlier.filter((r) => r.chapterId === chapter.id).map((r) => ({ key: r.renamedFrom ?? r.key, value: r.value, evidence: r.evidence, by: r.by, kind: r.kind }))
  if (!facts.length) continue
  let rows = readRows(out)
  const { outcomes, added } = await proposeFacts({ chapters, chapterId: chapter.id, rows, facts, now: new Date().toISOString(), newId })
  rows = [...rows, ...added]
  for (const o of outcomes) {
    const extra = o.result === "filed" ? [o.renamedFrom && `renamed from ${o.renamedFrom}`, o.nearKey && `near ${o.nearKey}`, o.collision && `CONTRADICTS canon: ${o.collision.canonValue}`].filter(Boolean).join("; ") : o.reason
    console.log(`ch${chapter.order} ${o.result.padEnd(8)} ${o.key.padEnd(30)} = ${facts[o.index]!.value.padEnd(26)} ${extra}`)
  }
  for (const r of rows.filter((x) => x.status === "PENDING")) {
    try { rows = (await triageFact({ chapters, rows, id: r.id, status: "ACCEPTED", now: new Date().toISOString() })).rows } catch { /* needs a ruling: stays pending */ }
  }
  writeRows(out, rows)
}
const canon = await foldCanon(chapters, readRows(out))
const pending = readRows(out).filter((r) => r.status === "PENDING")
console.log(`\npending with a contradiction: ${pending.map((r) => `${r.key} = ${r.value}`).join(" · ") || "none"}`)
console.log(`needsRuling ${canon.needsRuling.length}, doubleTruths ${canon.doubleTruths.length}`)

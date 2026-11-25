// The stand-in writer: accept every PENDING fact that needs no ruling; leave contradictions pending.
import { readChapters } from "../src/book.js"
import { readRows, writeRows } from "../src/store.js"
import { triageFact } from "../src/triage.js"

const dir = process.argv[2]!
let rows = readRows(dir)
let accepted = 0
let held = 0
for (const r of rows.filter((x) => x.status === "PENDING")) {
  try {
    rows = (await triageFact({ chapters: readChapters(dir), rows, id: r.id, status: "ACCEPTED", now: new Date().toISOString() })).rows
    accepted++
  } catch {
    held++
  }
}
writeRows(dir, rows)
console.log(`  stand-in writer: accepted ${accepted}, pending with a contradiction ${held}`)

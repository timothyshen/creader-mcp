/**
 * Hosted extraction against the agent on the local path, per chapter: counts, where in the chapter each side
 * quoted from, which quotes overlap, and the agent's keyed facts with what the fold made of them. Overlap of
 * quotes is a floor, not a match: two sides can state one fact from different sentences, so read the lists.
 * Usage: tsx bench/compare.mts <outDir>
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readChapters } from "../src/book.js"
import { readRows } from "../src/store.js"
import { coreFragments, normalizeForAnchor } from "../vendor/narrative-core/internal/anchor"

const out = process.argv[2]!
type Hosted = { chapterId: string; statement: string; evidence: string; category: string; entityType: string }
const hosted = JSON.parse(readFileSync(join(out, "hosted-facts.json"), "utf8")) as Hosted[]
const agent = readRows(join(out, "book"))
function span(norm: string, quote: string): [number, number] {
  let lo = Infinity, hi = -1
  for (const f of coreFragments(quote)) { const at = norm.indexOf(f); if (at >= 0) { lo = Math.min(lo, at); hi = Math.max(hi, at + f.length) } }
  return [lo, hi]
}
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1]
for (const c of readChapters(join(out, "book"))) {
  const norm = normalizeForAnchor(c.text)
  const seen = Math.round((100 * normalizeForAnchor(c.text.slice(0, 24_000)).length) / norm.length)
  const H = hosted.filter((h) => h.chapterId === c.id).map((h) => ({ ...h, span: span(norm, h.evidence) }))
  const A = agent.filter((a) => a.chapterId === c.id).map((a) => ({ ...a, span: span(norm, a.evidence) }))
  const at = (xs: { span: [number, number] }[]) => xs.map((x) => Math.round((100 * x.span[0]) / norm.length)).sort((p, q) => p - q).join(" ")
  console.log(`\n# ${c.title} — hosted ${H.length}, agent ${A.length}; hosted extraction could read ${seen}% of it`)
  console.log(`  quoted from (% into the chapter)  hosted: ${at(H)}\n                                   agent:  ${at(A)}`)
  for (const a of A) {
    const near = H.filter((h) => overlaps(a.span, h.span)).map((h) => h.statement.slice(0, 60))
    const fold = a.status === "PENDING" && a.collision ? `  [contradicts canon: ${a.collision.canonValue.slice(0, 40)}]` : ""
    console.log(`  A ${a.key} = ${a.value.slice(0, 50)} (by ${a.by})${fold}${near.length ? `\n      same passage as H: ${near.join(" | ")}` : ""}`)
  }
  for (const h of H.filter((h) => !A.some((a) => overlaps(a.span, h.span)))) console.log(`  H only (${h.category}): ${h.statement.slice(0, 90)}`)
}

/**
 * @input  stories/<seed>/*.json (accepted stories), the seeded book, CREADER_API_KEY.
 * @output `pnpm publish-stories --seed <s>`: each accepted story becomes a chapter in Kevin's book
 *         (idempotent by title), then the product's own Guardian runs its local L2 prose-hygiene
 *         detectors on it; the issues come back as the slop report, saved beside the story.
 * @pos    persona-cli — M2 step 2d. The stories pass through the same gate we sell to authors.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { CreaderRest } from "./creader-rest.js"
import { loadEnvFile } from "./providers.js"
import type { StorySeed } from "./story-seeds.js"

interface Chapter { id: string; title: string }
interface GuardianIssue { detector: string; severity: string; title: string; description: string; layer?: number }
interface RunResult { issues: GuardianIssue[]; deferredLayers?: unknown }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

export function storyTitle(seed: StorySeed): string {
  return `${seed.signal.name} at ${seed.ground.name}`.replace(/\s+/g, " ").slice(0, 120)
}

export function storyHtml(story: string): string {
  return story.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("")
}

async function main() {
  for (const f of (arg("env") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) loadEnvFile(f)
  const seed = arg("seed")
  if (!seed) throw new Error("--seed is required")
  const dir = join("stories", seed)
  const state = JSON.parse(readFileSync(".persona-seed.json", "utf8")) as { bookId: string }
  const api = CreaderRest.fromEnv()
  const b = state.bookId
  const chapters = await api.call<Chapter[]>("GET", `/api/books/${b}/chapters`)
  const summary: { index: number; title: string; chapterId: string; issues: number; byDetector: Record<string, number> }[] = []
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x)).sort()) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { seed: StorySeed; accepted: { story: string } | null }
    if (!r.accepted) continue
    const title = storyTitle(r.seed)
    const html = storyHtml(r.accepted.story)
    let ch = chapters.find((c) => c.title === title)
    if (!ch) { ch = await api.call<Chapter>("POST", `/api/books/${b}/chapters`, { title, content: html }); console.error(`  + chapter "${title}"`) } else console.error(`  = chapter "${title}" (exists)`)
    const run = await api.call<RunResult>("POST", `/api/books/${b}/guardian/run`, { chapterId: ch.id, plainContent: r.accepted.story, htmlContent: html, layers: [2], costBudget: "local", trigger: "manual", locale: "en" })
    const byDetector = run.issues.reduce<Record<string, number>>((a, i) => ((a[i.detector] = (a[i.detector] ?? 0) + 1), a), {})
    writeFileSync(join(dir, f.replace(/\.json$/, ".guardian.json")), JSON.stringify({ chapterId: ch.id, title, issues: run.issues }, null, 2))
    summary.push({ index: r.seed.index, title, chapterId: ch.id, issues: run.issues.length, byDetector })
  }
  for (const s of summary) console.log(`${s.index}. ${s.title} — ${s.issues} L2 issue(s)${s.issues ? ": " + Object.entries(s.byDetector).map(([d, n]) => `${d}×${n}`).join(", ") : ""}`)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})

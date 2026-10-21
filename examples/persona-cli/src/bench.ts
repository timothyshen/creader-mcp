/**
 * @input  fixture/westbund (character, seeded idea, probes), providers (model ids + env keys),
 *         checks (deterministic gates), persona-prompt (direct-path system prompt).
 * @output `pnpm bench [--models a,b] [--env path] [--out dir] [--probes N]`: one scripted
 *         conversation per model, transcripts as JSON cassettes, a summary table.
 *         No API judge: the counts are code's; "secret held / caricature / one person" is a
 *         human read of the transcripts afterwards (same rule as the product's benches).
 * @pos    persona-cli — M1 step 1, the H1 spike turned into a model bench.
 */
import { generateText, type ModelMessage } from "ai"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { protectedAnchors, runChecks, type CheckResult } from "./checks.js"
import { BENCH_IDEA, PROBES, WESTBUND } from "./fixture/westbund.js"
import { buildPersonaSystemPrompt } from "./persona-prompt.js"
import { loadEnvFile, resolveModel } from "./providers.js"

const DEFAULT_MODELS = ["deepseek-chat", "deepseek-v4-flash", "gpt-5.6-luna", "gpt-5.5", "claude-sonnet-5", "claude-opus-5"]

interface Turn {
  readonly probe: string
  readonly reply: string
  readonly ms: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly checks: CheckResult
}
interface Run {
  readonly model: string
  readonly turns: Turn[]
  error?: string
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function runModel(modelId: string, system: string, probes: readonly string[], protectedTexts: readonly string[]): Promise<Run> {
  const run: Run = { model: modelId, turns: [] }
  let model
  try {
    model = resolveModel(modelId)
  } catch (e) {
    run.error = (e as Error).message
    return run
  }
  const messages: ModelMessage[] = [{ role: "assistant", content: BENCH_IDEA.openingLine }]
  for (const probe of probes) {
    messages.push({ role: "user", content: probe })
    const t0 = Date.now()
    try {
      const r = await generateText({ model, system, messages })
      const reply = r.text.trim()
      if (!reply) {
        const parts = r.content.map((c) => c.type).join(",")
        run.error = `turn ${run.turns.length + 1}: empty reply (finish=${r.finishReason}, parts=${parts || "none"}, out=${r.usage?.outputTokens ?? 0})`
        break
      }
      messages.push({ role: "assistant", content: reply })
      run.turns.push({
        probe,
        reply,
        ms: Date.now() - t0,
        inputTokens: r.usage?.inputTokens ?? 0,
        outputTokens: r.usage?.outputTokens ?? 0,
        checks: runChecks(reply, protectedTexts),
      })
    } catch (e) {
      run.error = `turn ${run.turns.length + 1}: ${(e as Error).message}`
      break
    }
  }
  return run
}

function summarize(run: Run) {
  const t = run.turns
  const n = Math.max(t.length, 1)
  const sum = (f: (x: Turn) => number) => t.reduce((a, x) => a + f(x), 0)
  const distinct = (f: (x: Turn) => readonly string[]) => new Set(t.flatMap((x) => [...f(x)])).size
  return {
    model: run.model,
    turns: t.length,
    leaks: distinct((x) => x.checks.leaks),
    taboo: sum((x) => x.checks.taboo.length),
    groupSpeak: sum((x) => x.checks.groupSpeak.length),
    eyeDialect: sum((x) => x.checks.eyeDialect.length),
    slang: sum((x) => x.checks.slang.length),
    avgWords: Math.round(sum((x) => x.checks.words) / n),
    tokens: sum((x) => x.inputTokens + x.outputTokens),
    avgMs: Math.round(sum((x) => x.ms) / n),
    error: run.error ?? "",
  }
}

function table(rows: ReturnType<typeof summarize>[]): string {
  const head = ["model", "turns", "leaks", "taboo", "groupSpeak", "eyeDialect", "slang", "avgWords", "tokens", "avgMs", "error"]
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`]
  for (const r of rows) lines.push(`| ${head.map((h) => String((r as Record<string, unknown>)[h])).join(" | ")} |`)
  return lines.join("\n")
}

async function main() {
  const envPath = arg("env")
  for (const f of (envPath ?? "").split(",").map((x) => x.trim()).filter(Boolean)) console.error(`loaded ${loadEnvFile(f)} env vars from ${f}`)
  const models = (arg("models") ?? DEFAULT_MODELS.join(",")).split(",").map((s) => s.trim()).filter(Boolean)
  const probeCount = Number(arg("probes") ?? PROBES.length)
  const probes = PROBES.slice(0, probeCount)
  const out = arg("out") ?? join("bench", "runs", new Date().toISOString().replace(/[:.]/g, "-"))
  mkdirSync(out, { recursive: true })

  const system = buildPersonaSystemPrompt(WESTBUND)
  const protectedTexts = protectedAnchors(WESTBUND.card, WESTBUND.hidden)
  writeFileSync(join(out, "system-prompt.txt"), system)
  writeFileSync(join(out, "fixture.json"), JSON.stringify({ idea: BENCH_IDEA, probes, protectedTexts }, null, 2))

  const rows = []
  for (const m of models) {
    console.error(`▸ ${m}`)
    const run = await runModel(m, system, probes, protectedTexts)
    writeFileSync(join(out, `${m}.json`), JSON.stringify(run, null, 2))
    rows.push(summarize(run))
  }
  const md = `# persona bench — ${new Date().toISOString()}\n\nIdea: ${BENCH_IDEA.openingLine}\n\n${table(rows)}\n\nCounts are code's. Read the transcripts for: secret held, caricature, one person.\n`
  writeFileSync(join(out, "summary.md"), md)
  writeFileSync(join(out, "summary.json"), JSON.stringify(rows, null, 2))
  console.log(md)
  console.error(`written to ${out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

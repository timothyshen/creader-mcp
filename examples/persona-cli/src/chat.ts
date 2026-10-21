/**
 * @input  .persona-seed.json, ideas/<seed>/<n>.json (an accepted idea), REST (card, notes),
 *         env OPENAI_API_KEY (character model, default gpt-5.5) + CREADER_API_KEY.
 * @output `pnpm chat --seed <s> --idea <n> [--model id] [--env a,b]`: a terminal conversation
 *         with the character, opened by the idea's line. Each turn is appended to
 *         sessions/<seed>-<n>-<timestamp>.jsonl; gate counts from checks.ts go to stderr.
 *         Reads stdin line by line, so it works interactively and piped.
 * @pos    persona-cli — M1 step 4, the direct model path (H1). Nothing here writes back to Creader.
 */
import { generateText, type ModelMessage } from "ai"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { characterFromCreader, type CharacterRow, type NoteRow } from "./character-from-creader.js"
import { protectedAnchors, runChecks } from "./checks.js"
import { CreaderRest } from "./creader-rest.js"
import { buildPersonaSystemPrompt } from "./persona-prompt.js"
import { loadEnvFile, resolveModel } from "./providers.js"

const DEFAULT_MODEL = "gpt-5.5"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  for (const f of (arg("env") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) console.error(`loaded ${loadEnvFile(f)} env vars from ${f}`)
  const seed = arg("seed")
  const ideaIndex = arg("idea")
  if (!seed || ideaIndex === undefined) throw new Error("--seed and --idea are required")
  const modelId = arg("model") ?? DEFAULT_MODEL

  const state = JSON.parse(readFileSync(".persona-seed.json", "utf8")) as { bookId: string }
  const ideaFile = JSON.parse(readFileSync(join("ideas", seed, `${ideaIndex}.json`), "utf8")) as { accepted: { idea: { title: string; openingLine: string } } | null }
  if (!ideaFile.accepted) throw new Error(`idea ${ideaIndex} of seed ${seed} was not accepted`)
  const { title, openingLine } = ideaFile.accepted.idea

  const api = CreaderRest.fromEnv()
  const characters = await api.call<CharacterRow[]>("GET", `/api/books/${state.bookId}/characters`)
  const notes = await api.call<NoteRow[]>("GET", `/api/books/${state.bookId}/notes`)
  const character = characterFromCreader(characters, notes)
  const system = buildPersonaSystemPrompt(character)
  const guarded = protectedAnchors(character.card, character.hidden)
  const model = resolveModel(modelId)

  mkdirSync("sessions", { recursive: true })
  const logPath = join("sessions", `${seed}-${ideaIndex}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`)
  const log = (row: unknown) => appendFileSync(logPath, JSON.stringify(row) + "\n")
  log({ type: "start", seed, idea: ideaIndex, title, model: modelId, character: character.name })

  const messages: ModelMessage[] = [{ role: "assistant", content: openingLine }]
  console.log(`\n[${title}] — ${character.name} (${modelId}). Type /quit to end.\n`)
  console.log(`${character.name}: ${openingLine}\n`)
  log({ type: "assistant", text: openingLine, opening: true })

  // Async iteration buffers lines that arrive while a model call is in flight; `question()` drops them.
  const rl = createInterface({ input: process.stdin, terminal: false })
  const lines = rl[Symbol.asyncIterator]()

  for (;;) {
    if (process.stdin.isTTY) process.stdout.write("you: ")
    const next = await lines.next()
    if (next.done) break
    const line = next.value
    if (line.trim() === "/quit") break
    if (!line.trim()) continue
    if (!process.stdin.isTTY) console.log(`you: ${line}`)
    messages.push({ role: "user", content: line })
    log({ type: "user", text: line })
    const t0 = Date.now()
    const r = await generateText({ model, system, messages })
    const reply = r.text.trim() || "…"
    messages.push({ role: "assistant", content: reply })
    const checks = runChecks(reply, guarded)
    log({ type: "assistant", text: reply, ms: Date.now() - t0, usage: r.usage, checks })
    console.log(`\n${character.name}: ${reply}\n`)
    const flags = [checks.leaks.length && `leak:${checks.leaks[0]}`, checks.taboo.length && "taboo", checks.groupSpeak.length && "group-speak", checks.eyeDialect.length && `dialect:${checks.eyeDialect[0]}`, checks.slang.length && `slang:${checks.slang[0]}`].filter(Boolean)
    if (flags.length) console.error(`  ⚠ ${flags.join(", ")}`)
  }
  rl.close()
  console.error(`session written to ${logPath}`)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})

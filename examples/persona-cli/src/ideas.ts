/**
 * @input  .persona-seed.json (bookId, characterIds), REST (card, cast, voice rules), /api/chat?sync=true
 *         for the writer, a second model (direct) for the verifier, env keys.
 * @output `pnpm ideas --seed <s> [--count N] [--env a,b]`: K accepted ideas under ideas/<seed>/,
 *         one JSON per triple (triple + idea + verdict + attempts), and a list on stdout.
 * @pos    persona-cli — M1 step 3. Code samples and decides; the model writes and the verifier answers.
 */
import { generateText } from "ai"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { CreaderRest } from "./creader-rest.js"
import { acceptVerdict, buildVerifyPrompt, buildWriterPrompt, gateIdea, minimalPacket, parseIdea, parseVerdict, type IdeaDraft, type Persona, type RuleBrief, type Verdict } from "./idea-writer.js"
import { loadEnvFile, resolveModel } from "./providers.js"
import { anchorsFromCard, sampleTriples, type Triple } from "./triple-sampler.js"

const WRITER_MODEL = "gpt-5.5"
const VERIFIER_MODEL = "gpt-5.6-luna"
const MAX_ATTEMPTS = 2

interface CharacterRow { id: string; name: string; role: string; description: string; customFields?: Record<string, string> | null }
interface NoteRow { id: string; title: string; content: string; noteType: string }
interface ChatSync { text: string; sessionId?: string }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function writeIdea(api: CreaderRest, bookId: string, packet: unknown, prompt: string, sessionId: string | undefined): Promise<ChatSync> {
  return api.call<ChatSync>("POST", "/api/chat?sync=true", {
    messages: [{ role: "user", content: prompt }],
    mode: "precise",
    bookId,
    contextPacket: packet,
    model: WRITER_MODEL,
    enableConsistencyCheck: false,
    maxTokens: 400,
    ...(sessionId ? { sessionId } : {}),
  })
}

async function verifyIdea(persona: Persona, triple: Triple, idea: IdeaDraft): Promise<Verdict | string> {
  const r = await generateText({ model: resolveModel(VERIFIER_MODEL), prompt: buildVerifyPrompt(persona, triple, idea) })
  return parseVerdict(r.text)
}

async function main() {
  for (const f of (arg("env") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) console.error(`loaded ${loadEnvFile(f)} env vars from ${f}`)
  const seed = arg("seed")
  if (!seed) throw new Error("--seed is required (no default: a list nobody can regenerate cannot be debugged)")
  const count = Number(arg("count") ?? 5)
  const state = JSON.parse(readFileSync(".persona-seed.json", "utf8")) as { bookId: string; characterIds: Record<string, string> }
  const api = CreaderRest.fromEnv()

  const characters = await api.call<CharacterRow[]>("GET", `/api/books/${state.bookId}/characters`)
  const kevin = characters.find((c) => c.role === "protagonist")
  if (!kevin?.customFields) throw new Error("no protagonist with a card; run seed first")
  const persona: Persona = {
    id: kevin.id, name: kevin.name, role: kevin.role, description: kevin.description,
    card: { goals: kevin.customFields.goals ?? "", background: kevin.customFields.background ?? "", personality: kevin.customFields.personality ?? "", ...(kevin.customFields.arc ? { arc: kevin.customFields.arc } : {}) },
  }
  const notes = await api.call<NoteRow[]>("GET", `/api/books/${state.bookId}/notes`)
  const rules: RuleBrief[] = notes.filter((n) => n.noteType === "prohibition").map((n) => ({ id: n.id, title: n.title, body: n.content }))
  const entities = characters.map((c) => ({ id: c.id, names: [c.name] }))

  const mind = anchorsFromCard(persona.card, kevin.id, entities)
  const triples = sampleTriples(mind, { seed, count })
  const packet = minimalPacket(state.bookId, persona, rules)
  const outDir = join("ideas", seed)
  mkdirSync(outDir, { recursive: true })

  let sessionId: string | undefined
  const accepted: { triple: Triple; idea: IdeaDraft }[] = []
  for (const triple of triples) {
    console.error(`▸ triple ${triple.index} breaks ${triple.collides}`)
    let feedback: string | undefined
    const attempts: unknown[] = []
    let kept: { idea: IdeaDraft; verdict: Verdict } | undefined
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !kept; attempt++) {
      const res = await writeIdea(api, state.bookId, packet, buildWriterPrompt(persona, triple, [], feedback), sessionId)
      sessionId = res.sessionId ?? sessionId
      const parsed = parseIdea(res.text)
      if (typeof parsed === "string") { attempts.push({ attempt, raw: res.text, rejected: parsed }); feedback = parsed; continue }
      const reasons = gateIdea(parsed, triple)
      if (reasons.length) { attempts.push({ attempt, idea: parsed, rejected: reasons }); feedback = reasons.join("; "); continue }
      const verdict = await verifyIdea(persona, triple, parsed)
      if (typeof verdict === "string") { attempts.push({ attempt, idea: parsed, rejected: verdict }); feedback = verdict; continue }
      if (!acceptVerdict(verdict, triple.collides)) { attempts.push({ attempt, idea: parsed, verdict, rejected: "verifier" }); feedback = verdict.reason || "the verifier could not explain the opening line by the anchors"; continue }
      kept = { idea: parsed, verdict }
      attempts.push({ attempt, idea: parsed, verdict, accepted: true })
    }
    writeFileSync(join(outDir, `${triple.index}.json`), JSON.stringify({ triple, accepted: kept ?? null, attempts, sessionId }, null, 2))
    if (kept) accepted.push({ triple, idea: kept.idea })
    else console.error(`  ✗ dropped after ${MAX_ATTEMPTS} attempts`)
  }

  console.log(`\n# ideas — seed ${seed} — ${accepted.length}/${triples.length} accepted\n`)
  for (const { triple, idea } of accepted) {
    console.log(`${triple.index}. [${triple.collides}] ${idea.title}\n   ${idea.openingLine}\n   (${idea.want})\n`)
  }
  console.error(`written to ${outDir}/ (session ${sessionId ?? "none"})`)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})

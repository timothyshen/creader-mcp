/**
 * @input  graph/graph.json + the load selection, the seeded book (card, hidden notes, cast) via REST,
 *         env keys (OPENAI for the writer and the verifier, CREADER for the card).
 * @output `pnpm stories --seed <s> [--count N] [--env a,b]`: K told stories under stories/<seed>/,
 *         one JSON per seed (seed + story + verdict + attempts), accepted stories printed in full.
 * @pos    persona-cli — M2 step 2c. Writer = gpt-5.5 on the direct path with the story-mode persona
 *         prompt; verifier = gpt-5.6-luna; decisions in code.
 */
import { generateObject, generateText } from "ai"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { characterFromCreader, type CharacterRow, type NoteRow } from "./character-from-creader.js"
import { protectedAnchors } from "./checks.js"
import { CreaderRest } from "./creader-rest.js"
import type { Graph } from "./graph-extract.js"
import { selectNeighbourhood } from "./graph-load.js"
import type { Persona } from "./idea-writer.js"
import { buildPersonaSystemPrompt } from "./persona-prompt.js"
import { loadEnvFile, resolveModel } from "./providers.js"
import { HOME_GROUNDS } from "./fixture/westbund.js"
import { sampleStorySeeds, type StorySeed } from "./story-seeds.js"
import { acceptStoryVerdict, buildStoryPrompt, buildStoryVerifyPrompt, gateStory, StoryVerdictSchema, type StoryVerdict } from "./story-writer.js"
import { anchorsFromCard } from "./triple-sampler.js"

const WRITER_MODEL = "gpt-5.5"
const VERIFIER_MODEL = "gpt-5.6-luna"
const MAX_ATTEMPTS = 2

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  for (const f of (arg("env") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) console.error(`loaded ${loadEnvFile(f)} env vars from ${f}`)
  const seed = arg("seed")
  if (!seed) throw new Error("--seed is required")
  const count = Number(arg("count") ?? 5)

  const graph = JSON.parse(readFileSync(join("graph", "graph.json"), "utf8")) as Graph
  const selection = selectNeighbourhood(graph)
  const state = JSON.parse(readFileSync(".persona-seed.json", "utf8")) as { bookId: string }
  const api = CreaderRest.fromEnv()
  const characters = await api.call<CharacterRow[]>("GET", `/api/books/${state.bookId}/characters`)
  const notes = await api.call<NoteRow[]>("GET", `/api/books/${state.bookId}/notes`)
  const character = characterFromCreader(characters, notes)
  const persona: Persona = { id: character.id, name: character.name, role: "protagonist", description: character.description, card: character.card }
  const mind = anchorsFromCard(character.card, character.id, characters.map((c) => ({ id: c.id, names: [c.name] })))
  const manifest = JSON.parse(readFileSync(join("corpus", "sources.json"), "utf8")) as { sources: { id: string; relation: string; group: string }[] }
  const directSources = new Set(manifest.sources.filter((x) => x.relation.startsWith("direct") || x.group === "social" || x.group === "reddit").map((x) => x.id))
  const seeds = sampleStorySeeds(graph, selection, mind, { seed, count, directSources, homeGrounds: HOME_GROUNDS })
  const protectedTexts = protectedAnchors(character.card, character.hidden)
  const system = buildPersonaSystemPrompt(character, "story")
  const writer = resolveModel(WRITER_MODEL)
  const verifier = resolveModel(VERIFIER_MODEL)
  const outDir = join("stories", seed)
  mkdirSync(outDir, { recursive: true })

  const accepted: { seed: StorySeed; story: string }[] = []
  for (const s of seeds) {
    console.error(`▸ story ${s.index}: ${s.signal.name} @ ${s.ground.name}, breaks ${s.triple.collides}${s.voice ? `, voice: ${s.voice.name}` : ""}`)
    let feedback: string | undefined
    const attempts: unknown[] = []
    let kept: { story: string; verdict: StoryVerdict } | undefined
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !kept; attempt++) {
      const r = await generateText({ model: writer, system, prompt: buildStoryPrompt(s, feedback) })
      const story = r.text.trim()
      const reasons = gateStory({ story, seed: s, protectedTexts })
      if (reasons.length) { attempts.push({ attempt, story, rejected: reasons }); feedback = reasons.join("; "); continue }
      let verdict: StoryVerdict
      try {
        verdict = (await generateObject({ model: verifier, schema: StoryVerdictSchema, prompt: buildStoryVerifyPrompt(persona, s, story, character.hidden.map((h) => h.body)) })).object
      } catch (e) { const why = `verifier failed: ${(e as Error).message.slice(0, 120)}`; attempts.push({ attempt, story, rejected: why }); feedback = undefined; continue }
      if (!acceptStoryVerdict(verdict, s.triple.collides)) { attempts.push({ attempt, story, verdict, rejected: "verifier" }); feedback = verdict.reason || "the verifier could not read it as his story"; continue }
      kept = { story, verdict }
      attempts.push({ attempt, story, verdict, accepted: true })
    }
    writeFileSync(join(outDir, `${s.index}.json`), JSON.stringify({ seed: s, accepted: kept ?? null, attempts }, null, 2))
    if (kept) accepted.push({ seed: s, story: kept.story })
    else console.error(`  ✗ dropped after ${MAX_ATTEMPTS} attempts`)
  }

  console.log(`\n# stories — seed ${seed} — ${accepted.length}/${seeds.length} accepted\n`)
  for (const { seed: s, story } of accepted) console.log(`## ${s.index}. ${s.signal.name} @ ${s.ground.name} [breaks ${s.triple.collides}]\n\n${story}\n`)
  console.error(`written to ${outDir}/`)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})

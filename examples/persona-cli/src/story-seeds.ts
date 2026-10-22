/**
 * @input  graph.json (the merged, anchored graph) + its load selection, and the character's Mind
 *         (triple-sampler). A seed string.
 * @output sampleStorySeeds(): K story seeds, each = a private triple × one signal the crowd attached
 *         to the archetype × a place or event to stand on × sometimes a counter voice. Deterministic.
 *         Also the AI-tell lexical gate (aiTells) used on the written story.
 * @pos    persona-cli — M2 step 2a. Code decides what collides with what and where; the model only
 *         tells the story.
 */
import type { Graph, GraphEntity } from "./graph-extract.js"
import { sampleTriples, type Mind, type Triple } from "./triple-sampler.js"

export interface SeedNode { key: string; name: string; type: string; quote: string }
export interface StorySeed { index: number; seed: string; triple: Triple; signal: SeedNode; ground: SeedNode; voice: SeedNode | null }

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function mulberry32(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const ARCHE = "kevin nguyen archetype"

function node(e: GraphEntity): SeedNode {
  return { key: e.key, name: e.name, type: e.type, quote: e.evidence[0]?.quote ?? "" }
}

export interface SeedOptions {
  seed: string
  count?: number
  /** Documents that speak about Kevin Nguyen directly (the manifest's `direct*` relations). Signals and grounds must come from one of these; the Bay Area club studies describe a scene, not him. */
  directSources?: Set<string>
  /** Places from the character's own world (fixture), always available as ground. */
  homeGrounds?: readonly SeedNode[]
}

/** Too coarse to stand a scene on: countries, regions, counties and whole cities. Home grounds carry the street-level places. */
const COUNTRY_LEVEL = /^(united states|usa|america|china|vietnam|asia|canada|the us|orange county|southern california|california|san francisco|san francisco bay area|bay area|los angeles|san diego|west coast)$/

function fromDirect(e: GraphEntity, direct?: Set<string>): boolean {
  return !direct || e.sources.some((s) => direct.has(s))
}

/** The signals: nodes the crowd attached to the archetype with `signifier_of`, in the loaded selection, from a direct source. */
export function signalsOf(graph: Graph, selection: Set<string>, direct?: Set<string>): GraphEntity[] {
  const keys = new Set(graph.relations.filter((r) => r.type === "signifier_of" && r.target === ARCHE && selection.has(r.source)).map((r) => r.source))
  return graph.entities.filter((e) => keys.has(e.key) && fromDirect(e, direct)).sort((a, b) => a.key.localeCompare(b.key))
}

export function sampleStorySeeds(graph: Graph, selection: Set<string>, mind: Mind, opts: SeedOptions): StorySeed[] {
  const count = opts.count ?? 5
  const rng = mulberry32(fnv1a(opts.seed))
  const signals = signalsOf(graph, selection, opts.directSources)
  const graphGrounds = graph.entities
    .filter((e) => (e.type === "place" || e.type === "event") && selection.has(e.key) && fromDirect(e, opts.directSources) && !COUNTRY_LEVEL.test(e.key))
    .sort((a, b) => a.key.localeCompare(b.key))
  const grounds: (GraphEntity | SeedNode)[] = [...graphGrounds, ...(opts.homeGrounds ?? [])]
  const voices = graph.entities.filter((e) => e.roles.includes("counter") && selection.has(e.key)).sort((a, b) => a.key.localeCompare(b.key))
  if (!signals.length || !grounds.length) throw new Error("story seeds: the graph has no signals or no ground; load the neighbourhood first")
  const triples = sampleTriples(mind, { seed: opts.seed, count })
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!
  // Signals go round-robin from a seeded offset so a batch of five never repeats one.
  const offset = Math.floor(rng() * signals.length)
  return triples.map((triple, i) => {
    const signal = signals[(offset + i) % signals.length]!
    const linked = graph.relations.filter((r) => (r.source === signal.key || r.target === signal.key)).map((r) => (r.source === signal.key ? r.target : r.source))
    const near = grounds.filter((g) => linked.includes(g.key))
    const ground = near.length ? pick(near) : pick(grounds)
    const voice = voices.length && rng() < 0.34 ? pick(voices) : null
    const asNode = (g: GraphEntity | SeedNode): SeedNode => ("evidence" in g ? node(g) : g)
    return { index: i, seed: opts.seed, triple, signal: node(signal), ground: asNode(ground), voice: voice ? node(voice) : null }
  })
}

/** Lexical tells of machine prose. A hit is a rejection, not a style note: the stories must read as told. */
const AI_TELLS: readonly RegExp[] = [
  /\bdelve(s|d)?\b/i, /\btapestr(y|ies)\b/i, /\ba testament to\b/i, /\bnavigat(e|ing) (the|this|that|my|our)\b/i,
  /\b(embark|embarked|embarking) on\b/i, /\bjourney\b/i, /\bvibrant\b/i, /\bbustling\b/i, /\bnestled\b/i,
  /\bin a world where\b/i, /\blittle did (i|he|she|they) know\b/i, /\bi couldn'?t help but\b/i, /\ba (sense|wave|mix) of\b/i,
  /\bit'?s not (just|about) [^.]{3,60}, it'?s (about )?/i, /\bnot (just|only) [^.]{3,40} but (also )?/i,
  /\bat the end of the day\b/i, /\bin that moment\b/i, /\bthe weight of\b/i, /\bsomething shifted\b/i, /\blet that sink in\b/i,
  /\bunspoken\b/i, /\bpalpable\b/i, /\bresonat(e|es|ed)\b/i, /\bprofound(ly)?\b/i, /\bgenuinely\b/i, /\bhonestly\?/i,
]
export function aiTells(text: string): string[] {
  const hits: string[] = []
  for (const re of AI_TELLS) { const m = text.match(re); if (m) hits.push(m[0]) }
  return hits
}

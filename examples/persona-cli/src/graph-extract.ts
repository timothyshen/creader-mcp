/**
 * @input  Corpus documents (corpus/<id>.md) and a model (providers.ts).
 * @output Pure halves of graph extraction: chunking, the strict extraction schema, the verbatim
 *         anchor check (an entity or relation whose evidence is not in its chunk is dropped), and
 *         the merge that folds names across documents. `ingest extract|merge` in ingest.ts drive it.
 * @pos    persona-cli — M2 step 1b. The product's own discipline applied to discourse documents:
 *         nothing enters the graph without a quote the code can find in the source.
 */
import { z } from "zod"

export const ENTITY_TYPES = ["person", "place", "event", "signifier", "community", "concept"] as const
export const ROLES = ["signal", "context", "counter"] as const
export const RELATION_TYPES = ["signifier_of", "variant_of", "paired_with", "member_of", "located_in", "originated", "rejects", "explains", "studies", "part_of", "happened_at", "attributed_to", "contrasts_with"] as const
export type EntityType = (typeof ENTITY_TYPES)[number]
export type Role = (typeof ROLES)[number]

/** Every field required, nothing optional, nothing defaulted: OpenAI strict output rejects optional keys (#737). */
export const ExtractionSchema = z.object({
  entities: z.array(z.object({
    type: z.enum(ENTITY_TYPES),
    name: z.string().max(80),
    aliases: z.array(z.string().max(80)).max(6),
    role: z.enum(ROLES),
    description: z.string().max(300),
    evidence: z.string().max(240),
  })).max(40),
  relations: z.array(z.object({
    source: z.string().max(80),
    target: z.string().max(80),
    type: z.enum(RELATION_TYPES),
    evidence: z.string().max(240),
  })).max(60),
})
export type Extraction = z.infer<typeof ExtractionSchema>

export const EXTRACT_SYSTEM = `You are building a knowledge graph of the world around "Kevin Nguyen", the Asian-American internet archetype, from source documents (papers, articles, posts). The graph feeds a fictional character who is one person inside that world.

Extract only what THIS text states. For every entity and relation, copy an EVIDENCE quote of at most 240 characters EXACTLY from the text, character for character; anything you cannot quote, leave out.

Entity types: person (a real, named individual: author, interviewee, poster — never the archetype), place (a city, neighborhood, venue, festival site), event (a dated or datable happening: a post, a brawl, a petition, a study's fieldwork), signifier (an object, brand, food, style, practice or trait people use to recognize a Kevin Nguyen), community (a platform, group, subreddit, scene), concept (a label, theory or term: ABG, model minority, self-casting).
Name the archetype itself exactly "Kevin Nguyen (archetype)" with type concept, once per text at most.
Roles: signal = used to recognize him; context = the scenes, communities, scholarship and history around him; counter = a voice or fact that rejects, complicates or varies the archetype.
Relations only between entities you listed, with one of the given types. Prefer fewer, well-evidenced items over many. Skip generic words (society, identity, culture) unless the text defines them as a specific concept.`

export function chunkText(text: string, max = 10_000): string[] {
  const paras = text.split(/\n\s*\n/)
  const chunks: string[] = []
  let cur = ""
  for (const p of paras) {
    if (cur.length + p.length + 2 > max && cur) { chunks.push(cur.trim()); cur = "" }
    if (p.length > max) { for (let i = 0; i < p.length; i += max) chunks.push(p.slice(i, i + max)); continue }
    cur += (cur ? "\n\n" : "") + p
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks
}

export function normalizeQuote(s: string): string {
  return s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim()
}

/** Keep only items whose evidence the code can find verbatim in the chunk. Returns what was dropped, for the report. */
export function anchorExtraction(x: Extraction, chunk: string): { kept: Extraction; dropped: number } {
  const hay = normalizeQuote(chunk)
  const ok = (ev: string) => { const n = normalizeQuote(ev); return n.length >= 12 && hay.includes(n) }
  const entities = x.entities.filter((e) => ok(e.evidence))
  const names = new Set(entities.map((e) => foldName(e.name)))
  const relations = x.relations.filter((r) => ok(r.evidence) && names.has(foldName(r.source)) && names.has(foldName(r.target)))
  return { kept: { entities, relations }, dropped: x.entities.length - entities.length + (x.relations.length - relations.length) }
}

/** The corpus files carry Tim's own notes beside the source text; a node for "Tim" or quoting his notes is not evidence. */
export function isEditorialLeak(e: { name: string; evidence: string }): boolean {
  return foldName(e.name) === "tim" || /\btim'?s\b/i.test(e.evidence)
}

export function foldName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim()
}

export interface GraphEntity { key: string; type: EntityType; name: string; aliases: string[]; roles: Role[]; descriptions: string[]; evidence: { source: string; quote: string }[]; sources: string[] }
export interface GraphRelation { key: string; source: string; target: string; type: string; evidence: { source: string; quote: string }[]; sources: string[] }
export interface Graph { entities: GraphEntity[]; relations: GraphRelation[] }

export function mergeExtractions(parts: { source: string; extraction: Extraction }[]): Graph {
  const ents = new Map<string, GraphEntity>()
  const rels = new Map<string, GraphRelation>()
  const push = <T>(arr: T[], v: T, cap: number) => { if (!arr.includes(v) && arr.length < cap) arr.push(v) }
  for (const { source, extraction } of parts) {
    for (const e of extraction.entities) {
      const key = foldName(e.name)
      if (!key || isEditorialLeak(e)) continue
      const g = ents.get(key) ?? { key, type: e.type, name: e.name, aliases: [], roles: [], descriptions: [], evidence: [], sources: [] }
      for (const a of e.aliases) if (foldName(a) !== key) push(g.aliases, a, 8)
      push(g.roles, e.role, 3)
      push(g.descriptions, e.description, 4)
      if (g.evidence.length < 6) g.evidence.push({ source, quote: e.evidence })
      push(g.sources, source, 30)
      ents.set(key, g)
    }
    for (const r of extraction.relations) {
      const s = foldName(r.source), t = foldName(r.target)
      if (!ents.has(s) || !ents.has(t) || s === t) continue
      const key = `${s}|${r.type}|${t}`
      const g = rels.get(key) ?? { key, source: s, target: t, type: r.type, evidence: [], sources: [] }
      if (g.evidence.length < 4) g.evidence.push({ source, quote: r.evidence })
      push(g.sources, source, 30)
      rels.set(key, g)
    }
  }
  const bySources = (a: { sources: string[] }, b: { sources: string[] }) => b.sources.length - a.sources.length
  return { entities: [...ents.values()].sort(bySources), relations: [...rels.values()].sort(bySources) }
}

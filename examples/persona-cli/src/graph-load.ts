/**
 * @input  graph/graph.json (merged, anchored extraction) and the seeded book's existing rows.
 * @output planLoad(): the Creader rows the graph becomes — places → Location, events → TimelineEvent,
 *         everything else → Note with a typed title prefix (real people stay out of the character
 *         roster: that roster is Kevin's cast), relations → semantic relations between them. Pure.
 * @pos    persona-cli — M2 step 1c. Provenance travels in the note body ("Sources:" + quotes) because
 *         the product has no provenance column and we add no schema.
 */
import type { EntityType, Graph, GraphEntity } from "./graph-extract.js"

export type RowKind = "location" | "event" | "note"
export interface LoadRow { key: string; kind: RowKind; name: string; body: string; noteType?: "worldbuilding" | "research"; locationType?: string; roles: string[]; sources: number }
export interface LoadRelation { sourceKey: string; targetKey: string; type: string; description: string }
export interface LoadPlan { rows: LoadRow[]; relations: LoadRelation[] }

const PREFIX: Record<Exclude<EntityType, "place" | "event">, string> = { signifier: "[signifier]", community: "[community]", concept: "[concept]", person: "[person]" }

export function noteTitle(e: GraphEntity): string {
  return e.type === "place" || e.type === "event" ? e.name : `${PREFIX[e.type]} ${e.name}`
}

function provenance(e: { descriptions: string[]; evidence: { source: string; quote: string }[]; sources: string[]; aliases?: string[]; roles?: string[] }): string {
  const lines = [e.descriptions[0] ?? ""]
  if (e.aliases?.length) lines.push(`Also called: ${e.aliases.join("; ")}.`)
  if (e.roles?.length) lines.push(`Role in the archetype: ${e.roles.join(", ")}.`)
  lines.push("", `Sources: ${e.sources.join(", ")}`)
  for (const q of e.evidence.slice(0, 3)) lines.push(`- [${q.source}] "${q.quote}"`)
  return lines.join("\n")
}

/**
 * What enters the book: the archetype node and its one-hop neighbourhood (the signals and voices the
 * crowd attached to him), every node two or more documents agree on, and every place and event
 * (small, and the ground the stories stand on). The academic long tail stays in graph.json.
 */
export function selectNeighbourhood(graph: Graph, minSources = 2): Set<string> {
  const arche = graph.entities.find((e) => e.key === "kevin nguyen archetype")?.key
  const keep = new Set<string>()
  if (arche) {
    keep.add(arche)
    for (const r of graph.relations) {
      if (r.source === arche) keep.add(r.target)
      if (r.target === arche) keep.add(r.source)
    }
  }
  for (const e of graph.entities) if (e.sources.length >= minSources || e.type === "place" || e.type === "event") keep.add(e.key)
  return keep
}

export function planLoad(graph: Graph, selection: Set<string> | number = selectNeighbourhood(graph)): LoadPlan {
  const kept = typeof selection === "number" ? graph.entities.filter((e) => e.sources.length >= selection) : graph.entities.filter((e) => selection.has(e.key))
  const keys = new Set(kept.map((e) => e.key))
  const rows: LoadRow[] = kept.map((e) => {
    const base = { key: e.key, name: noteTitle(e), body: provenance(e), roles: e.roles, sources: e.sources.length }
    if (e.type === "place") return { ...base, kind: "location" as const, locationType: "place" }
    if (e.type === "event") return { ...base, kind: "event" as const }
    return { ...base, kind: "note" as const, noteType: e.type === "person" ? ("research" as const) : ("worldbuilding" as const) }
  })
  const relations: LoadRelation[] = graph.relations
    .filter((r) => keys.has(r.source) && keys.has(r.target))
    .map((r) => ({ sourceKey: r.source, targetKey: r.target, type: r.type, description: r.evidence.map((q) => `[${q.source}] "${q.quote}"`).join("\n").slice(0, 4000) }))
  return { rows, relations }
}

/** Semantic-relation endpoint vocabulary for each row kind. */
export function relationEntityType(kind: RowKind): "location" | "event" | "note" {
  return kind
}

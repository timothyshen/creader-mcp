/**
 * @input  fixture/westbund (the character) + the supporting cast and relations below.
 * @output planSeed(): the exact rows `seed` must upsert — book, five characters, four
 *         relations, hidden notes, voice prohibitions, the author's truth. Pure.
 * @pos    persona-cli — what to seed is decided here, so it can be tested without a server;
 *         seed.ts only sends it.
 */
import { WESTBUND, type Character } from "./fixture/westbund.js"

export const BOOK_TITLE = "Virtual Character — Kevin (West Bund)"

export interface CharacterRow {
  readonly name: string
  readonly description: string
  readonly role: "protagonist" | "supporting"
  readonly customFields?: Readonly<Record<string, string>>
}
export interface RelationRow {
  readonly source: string
  readonly target: string
  readonly type: string
  readonly inverseType: string
}
export interface NoteRow {
  readonly title: string
  readonly content: string
  readonly noteType: "general" | "prohibition"
}
export interface SeedPlan {
  readonly bookTitle: string
  readonly characters: readonly CharacterRow[]
  readonly relations: readonly RelationRow[]
  readonly notes: readonly NoteRow[]
}

/** The people the five private facts point at. Names only; their cards are not his mind. */
export const CAST: readonly CharacterRow[] = [
  { name: "Dennis", description: "His best friend since high school. Runs the group chat.", role: "supporting" },
  { name: "Tiffany", description: "Dennis's girlfriend.", role: "supporting" },
  { name: "Dad", description: "His father. Had a stroke in March; physical therapy on Tuesdays.", role: "supporting" },
  { name: "Grandma", description: "His grandmother. Speaks Vietnamese at home; lives off Bolsa Avenue in Little Saigon.", role: "supporting" },
]

/** Registry ids from creader_editor lib/knowledge/relation-type-registry.ts. */
export const RELATIONS: readonly RelationRow[] = [
  { source: "Kevin", target: "Dennis", type: "friend_of", inverseType: "friend_of" },
  { source: "Dennis", target: "Tiffany", type: "lover_of", inverseType: "lover_of" },
  { source: "Dad", target: "Kevin", type: "parent_of", inverseType: "child_of" },
  { source: "Grandma", target: "Kevin", type: "grandparent_of", inverseType: "grandchild_of" },
]

/** The author's truth: a plain note, no prefix. The CLI's prompt and the detector never read it. */
export const AUTHOR_TRUTH: NoteRow = {
  title: "Dad noticed",
  content: "His dad noticed the resentment in May and has said nothing.",
  noteType: "general",
}

export function planSeed(c: Character = WESTBUND): SeedPlan {
  const protagonist: CharacterRow = {
    name: c.name,
    description: c.description,
    role: "protagonist",
    customFields: { goals: c.card.goals, background: c.card.background, personality: c.card.personality, arc: c.card.arc },
  }
  const notes: NoteRow[] = [
    ...c.hidden.map((h) => ({ title: h.title, content: h.body, noteType: "general" as const })),
    ...c.voiceRules.map((r) => ({ title: r.title, content: r.body, noteType: "prohibition" as const })),
    AUTHOR_TRUTH,
  ]
  return { bookTitle: BOOK_TITLE, characters: [protagonist, ...CAST], relations: RELATIONS, notes }
}

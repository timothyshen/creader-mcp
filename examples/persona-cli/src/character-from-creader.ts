/**
 * @input  REST rows: the book's characters and notes.
 * @output characterFromCreader(): the Character the persona prompt needs — card from the
 *         protagonist's customFields, `[hidden]` notes as the second-order layer, prohibitions
 *         as voice rules. The author's truth (a plain note) is left out by construction.
 * @pos    persona-cli — the only mapping from Creader rows to the prompt's input; `chat` uses it.
 */
import type { Character } from "./fixture/westbund.js"

export interface CharacterRow {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly description: string
  readonly customFields?: Readonly<Record<string, string>> | null
}
export interface NoteRow {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly noteType: string
}

export const HIDDEN_PREFIX = "[hidden]"

export function characterFromCreader(characters: readonly CharacterRow[], notes: readonly NoteRow[]): Character & { id: string } {
  const lead = characters.find((c) => c.role === "protagonist")
  if (!lead) throw new Error("no protagonist in this book; run seed first")
  const cf = lead.customFields ?? {}
  return {
    id: lead.id,
    name: lead.name,
    description: lead.description,
    card: { goals: cf.goals ?? "", background: cf.background ?? "", personality: cf.personality ?? "", arc: cf.arc ?? "" },
    hidden: notes.filter((n) => n.title.startsWith(HIDDEN_PREFIX)).map((n) => ({ title: n.title, body: n.content })),
    voiceRules: notes.filter((n) => n.noteType === "prohibition").map((n) => ({ title: n.title, body: n.content })),
    voiceSamples: [],
  }
}

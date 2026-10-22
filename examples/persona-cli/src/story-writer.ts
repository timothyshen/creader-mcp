/**
 * @input  A StorySeed (story-seeds), the Persona card, the protected anchors (checks).
 * @output Pure halves of the story engine: the telling prompt, gate 1 (length, grounding, verbatim
 *         leaks, labels, voice, AI tells), the verify prompt (#844 §1.2 plus three storytelling
 *         questions), its parser and the code-side accept rule. `stories.ts` drives it.
 * @pos    persona-cli — M2 step 2b. The model tells; code decides whether it was a story and whether
 *         it was his.
 */
import { findLeaks, runChecks, SLANG_LIST } from "./checks.js"
import { z } from "zod"
import type { Persona } from "./idea-writer.js"
import { aiTells, type StorySeed } from "./story-seeds.js"
import type { Dimension } from "./triple-sampler.js"

export function buildStoryPrompt(seed: StorySeed, feedback?: string): string {
  const t = seed.triple
  const voice = seed.voice ? `\nA VOICE IN THE ROOM: ${seed.voice.name} — "${seed.voice.quote}" (something people say or think about guys like you; it can be in the scene or in your head, never as a quotation from anywhere)` : ""
  const tail = feedback ? `\n\nYour previous telling was rejected: ${feedback}\nTell it again, differently, fixing exactly that.` : ""
  return `Tell the stranger one thing that happened to you. Code chose the pieces; you choose the night.

WHERE: ${seed.ground.name} — "${seed.ground.quote}"
WHAT PEOPLE SEE ON YOU: ${seed.signal.name} — "${seed.signal.quote}"${voice}

WANT: ${t.want.text}
BELIEF: ${t.belief.text}
SELF: ${t.self.text}
BREAKS: ${t.collides}

Rules of the telling:
- 150 to 260 words. One scene: one night or one afternoon, one place.
- Spoken, first person, past tense, the way you'd tell it across a table.
- Concrete: the street, the drink, the thing in your hand, what someone actually said. The place and the thing people see on you must be in the scene by name.
- Somewhere in it you make a choice that goes against BREAKS. Show what it cost, or let it sit there unexplained. Never say why.
- Never state WANT or BELIEF. Never explain the lesson. No "that's when I realized". End on a thing, not a feeling.
- Do not mention memes, stereotypes, archetypes or the internet unless the scene is literally about them.
- Plain English. No accent by spelling. No slang: in particular never ${SLANG_LIST.join(", ")}.

Return only the story, no title, no quotes around it.${tail}`
}

export interface StoryGateInput { story: string; seed: StorySeed; protectedTexts: readonly string[] }

/** Gate 1. Empty array = pass. */
export function gateStory({ story, seed, protectedTexts }: StoryGateInput): string[] {
  const reasons: string[] = []
  const words = story.trim().split(/\s+/).length
  if (words < 120) reasons.push(`too short (${words} words)`)
  if (words > 300) reasons.push(`too long (${words} words)`)
  const lower = story.toLowerCase()
  const nameHit = (name: string) => name.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 3).some((w) => lower.includes(w))
  if (!nameHit(seed.ground.name)) reasons.push(`the place or event "${seed.ground.name}" is not in the scene`)
  if (!nameHit(seed.signal.name)) reasons.push(`"${seed.signal.name}" is not in the scene`)
  const leaks = findLeaks(story, protectedTexts)
  if (leaks.length) reasons.push(`repeats a protected anchor word for word ("${leaks[0]}")`)
  const c = runChecks(story, [])
  if (c.taboo.length) reasons.push(`uses the label "${c.taboo[0]}"`)
  if (c.groupSpeak.length) reasons.push(`speaks for a group ("${c.groupSpeak[0]}")`)
  if (c.eyeDialect.length) reasons.push(`spells an accent ("${c.eyeDialect[0]}")`)
  if (c.slang.length) reasons.push(`uses slang with no sample behind it ("${c.slang[0]}")`)
  const tells = aiTells(story)
  if (tells.length) reasons.push(`reads as machine prose ("${tells[0]}")`)
  if (/\bthat'?s when i realized\b|\bi realized\b|\btaught me\b|\bthe lesson\b/i.test(story)) reasons.push("explains the lesson")
  return reasons
}

const VERIFIER = `You check one short story a character tells a stranger, the way a careful reader would.

The story was built from THREE ANCHORS of his card — WANT (what he is after), BELIEF (what he saw or was told), SELF (who he thinks he is) — and his choice in the story must go against the one marked BREAKS, that anchor specifically.

Answer:
- deviatesFrom: which of the three anchors does his choice go against? "want", "belief", "self", or "none".
- statesOutright: does the story, in his spoken words, state the WANT anchor or the BELIEF anchor in substance, the same desire or fact in other words? (SELF may be spoken.)
- marked: does the story show he knows he is going against it — a cost, a struggle, someone's surprise?
- offpage: is the reason on his card but left unsaid, so a listener would want to ask why?
- otherGap: does the story go against any other anchor with no mark and no reason? "want", "belief", "self", or null.
- wantServes: does telling this story serve WANT?
- scene: is it one concrete scene with a place, things and people, rather than a summary of a period or a habit?
- choice: does he do one specific thing in it, an action a listener could picture?
- moral: does it explain its own point, state a lesson, or end on a named feeling instead of a thing?
- revealsHidden: WHAT OTHERS DO NOT KNOW lists things specific people are not supposed to know. Does the story make one of those people learn it, or have him tell the listener it outright? (Acting on it where that person cannot see is fine.)

Judge only whether a reason exists, never whether it is a good one. Only first-order beliefs count. Do not reason about what he thinks others know.

Return JSON only: {"deviatesFrom": ..., "statesOutright": ..., "marked": ..., "offpage": ..., "otherGap": ..., "wantServes": ..., "scene": ..., "choice": ..., "moral": ..., "revealsHidden": ..., "reason": "..."}`

export function buildStoryVerifyPrompt(persona: Persona, seed: StorySeed, story: string, hidden: readonly string[] = []): string {
  const t = seed.triple
  const secrets = hidden.length ? `\n\nWHAT OTHERS DO NOT KNOW\n${hidden.map((h) => `- ${h}`).join("\n")}` : ""
  return `${VERIFIER}${secrets}

THREE ANCHORS
WANT: ${t.want.text}
BELIEF: ${t.belief.text}
SELF: ${t.self.text}
BREAKS: ${t.collides}

CARD (context only)
goals: ${persona.card.goals}
background: ${persona.card.background}
personality: ${persona.card.personality}

STORY
${story}`
}

/** Structured-output schema for the verifier: every field required, so a provider cannot hand back a half verdict. */
export const StoryVerdictSchema = z.object({
  deviatesFrom: z.enum(["want", "belief", "self", "none"]),
  statesOutright: z.boolean(),
  marked: z.boolean(),
  offpage: z.boolean(),
  otherGap: z.enum(["want", "belief", "self"]).nullable(),
  wantServes: z.boolean(),
  scene: z.boolean(),
  choice: z.boolean(),
  moral: z.boolean(),
  revealsHidden: z.boolean(),
  reason: z.string().max(600),
})

export interface StoryVerdict {
  readonly deviatesFrom: Dimension | "none"
  readonly statesOutright: boolean
  readonly marked: boolean
  readonly offpage: boolean
  readonly otherGap: Dimension | null
  readonly wantServes: boolean
  readonly scene: boolean
  readonly choice: boolean
  readonly moral: boolean
  readonly revealsHidden: boolean
  readonly reason: string
}

export function parseStoryVerdict(text: string): StoryVerdict | string {
  let o: Record<string, unknown>
  try { o = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown> } catch { return "verdict not JSON" }
  const dims = ["want", "belief", "self"]
  if (typeof o.deviatesFrom !== "string" || ![...dims, "none"].includes(o.deviatesFrom)) return "verdict.deviatesFrom invalid"
  if (o.otherGap !== null && (typeof o.otherGap !== "string" || !dims.includes(o.otherGap))) return "verdict.otherGap invalid"
  for (const k of ["statesOutright", "marked", "offpage", "wantServes", "scene", "choice", "moral", "revealsHidden"]) if (typeof o[k] !== "boolean") return `verdict.${k} invalid`
  return {
    deviatesFrom: o.deviatesFrom as Dimension | "none", statesOutright: o.statesOutright as boolean, marked: o.marked as boolean, offpage: o.offpage as boolean,
    otherGap: o.otherGap as Dimension | null, wantServes: o.wantServes as boolean, scene: o.scene as boolean, choice: o.choice as boolean, moral: o.moral as boolean, revealsHidden: o.revealsHidden as boolean,
    reason: typeof o.reason === "string" ? o.reason : "",
  }
}

/**
 * Gate 2: the four conditions of #844 §1.2, the restatement rule, the three storytelling questions,
 * and canon: a story may act on a secret but may not spend it — if someone in it learns what the
 * hidden layer says they do not know, the character has changed and every later visitor meets a
 * different Kevin.
 */
export function acceptStoryVerdict(v: StoryVerdict, collides: Dimension): boolean {
  return v.deviatesFrom === collides && !v.statesOutright && (v.marked || v.offpage) && v.otherGap === null && v.wantServes && v.scene && v.choice && !v.moral && !v.revealsHidden
}

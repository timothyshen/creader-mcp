/**
 * @input  A sampled Triple (triple-sampler), the character's card, voice samples.
 * @output Pure halves of the idea writer (private-layer.md §4): the writer prompt, JSON parsing,
 *         gate 1 (format, length, verbatim leaks, taboo), the verify prompt (#844 §1.2 on one
 *         line), and the code-side accept rule for its verdict. Also the minimal ContextPacket
 *         /api/chat requires (B6) — bookMeta + the persona entity + the voice rules, nothing else.
 * @pos    persona-cli — the model writes {title, want, openingLine}; everything else is decided here.
 */
import { findLeaks, runChecks } from "./checks.js"
import type { Dimension, Triple } from "./triple-sampler.js"

export interface IdeaDraft {
  readonly title: string
  readonly want: string
  readonly openingLine: string
}
export interface Persona {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly description: string
  readonly card: { readonly goals: string; readonly background: string; readonly personality: string; readonly arc?: string }
}
export interface RuleBrief {
  readonly id: string
  readonly title: string
  readonly body: string
}

const WRITER = `You are writing one conversation idea for a character a stranger is about to talk to.
Code chose three anchors from his card, and which one his opening choice goes against.

WANT is what he is after. BELIEF is something he saw or was told. SELF is who he thinks he is; the type people read him as lives here.
His first line is a choice that goes against BREAKS, and the other two anchors explain why he makes it. Either show that he knows he is going against it (a reason, a cost, a struggle), or leave the reason unsaid on purpose so the stranger has to ask. Never state WANT or BELIEF outright.

Return JSON only, with exactly these keys:
{"title": "...", "want": "...", "openingLine": "..."}

title: at most 6 words. Name the situation, not the kind of person he is.
want: one sentence that starts "He wants". What he wants from the stranger in this conversation. It must serve WANT.
openingLine: the first thing he says, at most two sentences, in his voice.

Voice: match the samples if there are any; otherwise plain, casual English. Never change spelling or grammar to signal an accent or a dialect. No slang that is not in the samples. His ethnicity is never the joke.`

export function buildWriterPrompt(persona: Persona, triple: Triple, samples: readonly string[], feedback?: string): string {
  const voice = samples.length ? samples.slice(0, 3).map((s) => `- ${s}`).join("\n") : "(none)"
  const tail = feedback ? `\n\nYour previous attempt was rejected: ${feedback}\nWrite a different one that fixes exactly that.` : ""
  return `${WRITER}

CHARACTER: ${persona.name}, ${persona.description}
WANT: ${triple.want.text}
BELIEF: ${triple.belief.text}
SELF: ${triple.self.text}
BREAKS: ${triple.collides}
VOICE SAMPLES:
${voice}${tail}`
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
}

export function parseIdea(text: string): IdeaDraft | string {
  let obj: unknown
  try {
    obj = JSON.parse(stripFences(text))
  } catch {
    return "not JSON"
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "not an object"
  const keys = Object.keys(obj as object).sort()
  if (keys.join(",") !== "openingLine,title,want") return `keys must be exactly title, want, openingLine (got ${keys.join(", ") || "none"})`
  const o = obj as Record<string, unknown>
  for (const k of keys) if (typeof o[k] !== "string" || !(o[k] as string).trim()) return `${k} must be a non-empty string`
  return { title: (o.title as string).trim(), want: (o.want as string).trim(), openingLine: (o.openingLine as string).trim() }
}

export function sentenceCount(s: string): number {
  return s.split(/[.!?]+(?:\s+|$)/).filter((x) => x.trim()).length
}

/** Gate 1 (§4.2 第一道). Empty array = pass. */
export function gateIdea(idea: IdeaDraft, triple: Triple): string[] {
  const reasons: string[] = []
  if (idea.title.split(/\s+/).length > 6) reasons.push("title has more than 6 words")
  if (!idea.want.startsWith("He wants")) reasons.push('want must start with "He wants"')
  if (sentenceCount(idea.want) > 1) reasons.push("want must be one sentence")
  if (idea.want.length > 160) reasons.push("want is over 160 characters")
  if (sentenceCount(idea.openingLine) > 2) reasons.push("openingLine has more than two sentences")
  if (idea.openingLine.length > 220) reasons.push("openingLine is over 220 characters")
  const all = `${idea.title}\n${idea.want}\n${idea.openingLine}`
  const leaks = findLeaks(all, [triple.want.text, triple.belief.text])
  if (leaks.length) reasons.push(`repeats the WANT or BELIEF anchor word for word ("${leaks[0]}")`)
  const taboo = runChecks(all, []).taboo
  if (taboo.length) reasons.push(`uses the label "${taboo[0]}"`)
  return reasons
}

const VERIFIER = `You check one opening line against a character's card, the way a careful reader would.

The idea was built from THREE ANCHORS, one per dimension: WANT (what he is after), BELIEF (what he saw or was told), SELF (who he thinks he is). His opening choice must go against the one marked BREAKS — that anchor specifically, not some other line of his card. The full card is given only as context.

Answer:
- deviatesFrom: which of the THREE ANCHORS does the choice in this line go against? "want", "belief", "self", or "none". Answer "none" if it goes against another line of the card but not one of these three.
- statesOutright: does the OPENING LINE itself — his spoken words only — state the WANT anchor or the BELIEF anchor in substance, the same desire or the same fact in other words? Ignore the title and the want field: those are the writer's notes and are expected to restate WANT. SELF may be spoken.
- marked: does the line itself show he knows he is going against it, through a reason, a cost, a struggle, or someone's surprise?
- offpage: is the reason on his card but left unsaid in the line, so a reader would ask why?
- otherGap: does the line go against any other anchor on the card with no mark and no reason? "want", "belief", "self", or null.
- wantServes: does the idea's want serve WANT?

Judge only whether a reason exists, never whether it is a good one. Only first-order beliefs count: what he saw or was told. Do not reason about what he thinks others know.

Return JSON only: {"deviatesFrom": ..., "statesOutright": ..., "marked": ..., "offpage": ..., "otherGap": ..., "wantServes": ..., "reason": "..."}`

export function buildVerifyPrompt(persona: Persona, triple: Triple, idea: IdeaDraft): string {
  return `${VERIFIER}

THREE ANCHORS
WANT: ${triple.want.text}
BELIEF: ${triple.belief.text}
SELF: ${triple.self.text}
BREAKS: ${triple.collides}

CARD (context only)
goals: ${persona.card.goals}
background: ${persona.card.background}
personality: ${persona.card.personality}

IDEA: ${idea.title} / ${idea.want} / ${idea.openingLine}`
}

export interface Verdict {
  readonly deviatesFrom: Dimension | "none"
  readonly statesOutright: boolean
  readonly marked: boolean
  readonly offpage: boolean
  readonly otherGap: Dimension | null
  readonly wantServes: boolean
  readonly reason: string
}

export function parseVerdict(text: string): Verdict | string {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(stripFences(text)) as Record<string, unknown>
  } catch {
    return "verdict not JSON"
  }
  const dims = ["want", "belief", "self"]
  const dev = o.deviatesFrom
  const other = o.otherGap
  if (typeof dev !== "string" || ![...dims, "none"].includes(dev)) return "verdict.deviatesFrom invalid"
  if (other !== null && (typeof other !== "string" || !dims.includes(other))) return "verdict.otherGap invalid"
  if (typeof o.statesOutright !== "boolean" || typeof o.marked !== "boolean" || typeof o.offpage !== "boolean" || typeof o.wantServes !== "boolean") return "verdict booleans invalid"
  return {
    deviatesFrom: dev as Dimension | "none",
    statesOutright: o.statesOutright,
    marked: o.marked,
    offpage: o.offpage,
    otherGap: other as Dimension | null,
    wantServes: o.wantServes,
    reason: typeof o.reason === "string" ? o.reason : "",
  }
}

/**
 * Gate 2 (§4.2 第二道; the four conditions of #844 §1.2, plus one from the first run: the
 * 4-gram gate cannot see an anchor restated in other words, so the verifier is asked and
 * `statesOutright` rejects). The model answers, code decides.
 */
export function acceptVerdict(v: Verdict, collides: Dimension): boolean {
  return v.deviatesFrom === collides && !v.statesOutright && (v.marked || v.offpage) && v.otherGap === null && v.wantServes
}

/** The smallest packet /api/chat accepts (B6): bookMeta, one entity, the voice rules. No hidden layer. */
export function minimalPacket(bookId: string, persona: Persona, rules: readonly RuleBrief[]) {
  const clip = (s: string | undefined, n: number) => (s ?? "").slice(0, n)
  return {
    bookMeta: { bookId, contentType: "novel", chapterCount: 0, totalWordCount: 0 },
    chapter: null,
    entities: [
      {
        id: persona.id,
        name: persona.name,
        type: "character",
        role: persona.role,
        descriptionSnippet: clip(persona.description, 500),
        metadata: {
          goals: clip(persona.card.goals, 500),
          background: clip(persona.card.background, 500),
          personality: clip(persona.card.personality, 500),
          ...(persona.card.arc ? { arc: clip(persona.card.arc, 500) } : {}),
        },
      },
    ],
    relationships: [],
    volumes: [],
    style: null,
    guardianIssues: [],
    rules: rules.map((r) => ({ id: r.id, title: r.title, body: r.body })),
    timelineEvents: [],
    previousChapterSummary: null,
    tokenBudget: 4000,
  }
}

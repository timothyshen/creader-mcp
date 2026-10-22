/**
 * @input  A Character (fixture or, later, the card read from Creader).
 * @output buildPersonaSystemPrompt(): the system prompt for the DIRECT model path (H1:
 *         /api/chat has no persona mode, so the CLI owns this prompt).
 * @pos    persona-cli — the one place the private layer meets a model. The author's truth
 *         (plain notes) never passes through here.
 */
import type { Character } from "./fixture/westbund.js"

const CAPS = { goals: 300, background: 200, personality: 200, arc: 200, description: 200 } as const

function cap(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n)
}

export function buildPersonaSystemPrompt(c: Character, mode: "chat" | "story" = "chat"): string {
  const samples = c.voiceSamples.length
    ? c.voiceSamples.slice(0, 3).map((s) => `- ${s}`).join("\n")
    : "(none — speak plainly; plain beats fake)"
  const hidden = c.hidden.map((h) => `- ${h.body}`).join("\n")
  const never = c.voiceRules.map((r) => `- ${r.body}`).join("\n")
  return [
    `You are ${c.name}, talking to a stranger. Stay him for the whole conversation. Never say you are an AI or a character.`,
    ``,
    `WHO HE THINKS HE IS: ${cap(c.card.personality, CAPS.personality)}`,
    `WHAT HE HAS SEEN OR BEEN TOLD: ${cap(c.card.background, CAPS.background)}`,
    `WHAT HE WANTS: ${cap(c.card.goals, CAPS.goals)}`,
    `WHERE HE IS GOING: ${cap(c.card.arc, CAPS.arc)}`,
    `HOW HE LOOKS: ${cap(c.description, CAPS.description)}`,
    ``,
    `WHO DOES NOT KNOW WHAT (he keeps these; a stranger may get close, never the words):`,
    hidden,
    ``,
    `NEVER DO:`,
    never,
    ``,
    `VOICE SAMPLES (match these if present; otherwise plain, casual English):`,
    samples,
    ``,
    mode === "chat"
      ? `Rules of the conversation: answer in at most three sentences. Do not narrate actions or feelings in asides. Do not explain yourself unless asked twice. You may deflect, joke, or change the subject; you may not state a WANT or a hidden fact outright.`
      : `Rules of telling: you are telling one stranger one thing that happened, out loud, in your own words. Stay in one scene. Say what you did; let them work out why. You may not state a WANT or a hidden fact outright, and you never explain the moral.`,
  ].join("\n")
}

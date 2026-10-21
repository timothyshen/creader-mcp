/**
 * @input  Assistant turn text + the character's protected anchors.
 * @output Pure, deterministic checks: leaks (verbatim 4-grams from WANT / BELIEF / hidden),
 *         taboo labels, group-speak, eye-dialect spelling, slang. Counts and matched fragments.
 * @pos    persona-cli — code decides what code can decide (private-layer.md §4.2 第一道);
 *         judgment (secret held? caricature? one person?) stays with a human reader.
 */

export interface CheckResult {
  readonly leaks: readonly string[]
  readonly taboo: readonly string[]
  readonly groupSpeak: readonly string[]
  readonly eyeDialect: readonly string[]
  readonly slang: readonly string[]
  readonly words: number
}

const NGRAM = 4

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function ngrams(words: readonly string[], n: number): string[] {
  const out: string[] = []
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "))
  return out
}

/** Any NGRAM-word run from a protected anchor that appears verbatim in the text. */
export function findLeaks(text: string, protectedTexts: readonly string[]): string[] {
  const haystack = new Set(ngrams(normalizeWords(text), NGRAM))
  const hits = new Set<string>()
  for (const anchor of protectedTexts) {
    for (const g of ngrams(normalizeWords(anchor), NGRAM)) if (haystack.has(g)) hits.add(g)
  }
  return [...hits].sort()
}

const TABOO = /\bf(?:\*\*|uc)kboys?\b|\bf-?boys?\b/gi
const GROUP_SPEAK = /\b(?:we|us|guys|people|dudes|men)\s+like\s+(?:me|us)\b|\basian\s+(?:guys|dudes|men|people|kids)\b|\bABBs?\b/gi
/** Spelling changed to signal an accent or dialect — the first [voice] prohibition. */
const EYE_DIALECT = new Set(["dat", "dis", "dem", "dese", "dose", "nuthin", "sumthin", "aight", "finna", "tryna", "gon", "wit", "yall", "ya'll", "axe", "errbody", "wassup", "sup"])
/** Slang is only allowed if it appears in voice samples; the bench fixture has none. */
const SLANG = new Set(["bruh", "bro", "bros", "fam", "lit", "lowkey", "highkey", "deadass", "cap", "bet", "vibes", "vibe", "fr", "ngl", "sus", "drip", "flex", "dope", "homie", "homies", "squad", "goated", "hella"])

function matchAll(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => m[0])
}

export function runChecks(text: string, protectedTexts: readonly string[]): CheckResult {
  const words = normalizeWords(text)
  const pick = (set: ReadonlySet<string>) => words.filter((w) => set.has(w))
  return {
    leaks: findLeaks(text, protectedTexts),
    taboo: matchAll(TABOO, text),
    groupSpeak: matchAll(GROUP_SPEAK, text),
    eyeDialect: pick(EYE_DIALECT),
    slang: pick(SLANG),
    words: words.length,
  }
}

/** The anchors a conversation must never reproduce verbatim: WANT, BELIEF, and every hidden note. SELF is how he presents and may surface. */
export function protectedAnchors(card: { goals: string; background: string }, hidden: readonly { body: string }[]): string[] {
  const split = (s: string) => s.split(/[;；]/).map((x) => x.trim()).filter(Boolean)
  return [...split(card.goals), ...split(card.background), ...hidden.map((h) => h.body)]
}

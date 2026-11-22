/**
 * [INPUT]: raw quote/evidence strings + source text
 * [OUTPUT]: normalizeForAnchor / coreFragments / anchorExists / createAnchorChecker — the
 *   deterministic "does this quote actually appear in the source" gate; foldArabicForMatch — the
 *   one Arabic deletion fold every comparison side shares (anchor, position lookup, name fold)
 * [POS]: lib/narrative-core/internal — engine-shared implementation, not package surface.
 *   One invariant, one implementation: the world gate (gate-policy), and in the host app the
 *   guardian L3 evidence gate, note identity (which stored row a finding is) and note location
 *   (the Fix tab's "Text changed" tray and the retire every content save runs) all import THIS
 *   file (plan PR-0/D6; the last two since 2026-10-14). A quote this file admits at write time
 *   is found by the same rule at read time.
 *   Code answers this question, not a second LLM.
 * [PROTOCOL]: EXISTENCE check only — normalization destroys offsets, so this must never
 *   be used to locate positions (that stays with findIssuePosition and friends).
 */

/**
 * The comparable core of a text: lowercase, everything except letters and digits (any
 * script) removed. Models re-punctuate when they quote — wrap the quote in quote marks,
 * swap 「」/"" styles, fold full-width ：， to half-width, drop or add commas (all
 * bench-measured false-drop classes) — so for an existence check the entire punctuation
 * layer is transcription noise. Aggressive on purpose: a false accept keeps a
 * slightly-off quote (harmless); a false reject would drop a legitimate one.
 */
export function normalizeForAnchor(text: string): string {
  return foldArabicForMatch(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

/**
 * Any code point whose script EXTENSIONS include Arabic: letters, but also tashkeel (Inherited)
 * and tatweel (Common). Extensions rather than `Script=Arabic` so that a caller folding one code
 * point at a time — `findIssuePosition`'s projection — sees a lone mark as Arabic and drops it.
 */
const ARABIC_SCRIPT = /\p{scx=Arabic}/u
/**
 * Tashkeel (fathatan … sukun, U+064B–U+0652), the combining madda / hamza above / hamza below
 * (U+0653–U+0655 — what is left of a hamza seat NFC could not compose, or a seat read one code
 * point at a time) and the superscript alef (U+0670).
 */
const ARABIC_MARKS = /[\u064B-\u0655\u0670]/g
/** Tatweel (kashida), the elongation stroke writers and renderers insert inside a word. */
const TATWEEL = /\u0640/g
/** Alef with madda / hamza above / hamza below → bare alef. */
const ALEF_FAMILY = /[\u0622\u0623\u0625]/g

/**
 * Fold Arabic text to its comparable core. The one implementation behind every comparison
 * side that reads Arabic (Guardian Arabic plan 2026-11-01 §2; design doc 2026-10-11 §3, GA-D6):
 * `normalizeForAnchor` (the evidence gates and note identity), `findIssuePosition` (positions
 * and L1's `evidenceGrounded`) and `foldName` (the ledger key `l1.name-variant` asserts on).
 *
 * Deletion-class steps only, in order:
 *   1. NFC — a decomposed hamza seat (alef + U+0654) becomes the precomposed letter, so step 4
 *      sees it; everything else NFC touches in Arabic is already composed in practice.
 *   2. Strip tashkeel, the combining hamza marks and the superscript alef. A model quoting
 *      vowelled prose drops the vowels, and a writer types them in one spelling of a name and
 *      not the next (محمّد / محمد). A hamza mark NFC left uncomposed goes the same way, so a
 *      caller that folds one code point at a time (no composition possible) lands where the
 *      whole-string fold lands for the alef family.
 *   3. Strip tatweel — an elongation stroke, not a letter (مـحمد / محمد).
 *   4. Unify the alef family [آأإ] → ا. The hamza seat is the single most variable mark in
 *      everyday Arabic typing (أحمد / احمد, إلى / الى); removing it loses a hamza, not a letter.
 *
 * NOT here, by ruling (GA-D6): ة → ه and ى → ي. Both rewrite one letter into another — علي (a
 * name) and على (a preposition) differ by exactly that — and the inline-assert tier this feeds
 * is held to ≥90% precision. They belong at the ask tier, beside the Latin digraph rung.
 *
 * A text with nothing Arabic in it is returned AS IS, byte for byte — the Latin and Han bench
 * fixtures must not move, and NFC alone would recompose a decomposed Latin accent.
 */
export function foldArabicForMatch(text: string): string {
  if (!ARABIC_SCRIPT.test(text)) return text
  return text
    .normalize("NFC")
    .replace(ARABIC_MARKS, "")
    .replace(TATWEEL, "")
    .replace(ALEF_FAMILY, "\u0627")
}

/**
 * Split a quote on ellipsis runs BEFORE stripping punctuation: models elide quote
 * middles ("A ... B" / "A…B") and append trailing dots — each real fragment must
 * anchor on its own. Fragments whose core is under 2 chars are transcription dust,
 * not evidence.
 */
export function coreFragments(quote: string): string[] {
  return quote
    .replace(/…/g, "...")
    .split(/\.{3,}/)
    .map((fragment) => normalizeForAnchor(fragment))
    .filter((fragment) => fragment.length >= 2)
}

function fragmentsAnchor(quote: string, normalizedSource: string): boolean {
  const fragments = coreFragments(quote)
  if (fragments.length === 0) return false
  return fragments.every((fragment) => normalizedSource.includes(fragment))
}

/**
 * One-off existence check. For many quotes against one source, use createAnchorChecker.
 * reachability-ok — the one-quote form of the gate in this carved (Apache-2.0) package;
 * the host builds checkers, the package's own and composer exemplar tests call this.
 */
export function anchorExists(quote: string, sourceText: string): boolean {
  return fragmentsAnchor(quote, normalizeForAnchor(sourceText))
}

/** Normalizes the source once; returns a checker for repeated quote lookups. */
export function createAnchorChecker(sourceText: string): (_quote: string) => boolean {
  const normalizedSource = normalizeForAnchor(sourceText)
  return (quote: string): boolean => fragmentsAnchor(quote, normalizedSource)
}

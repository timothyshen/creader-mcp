/**
 * [INPUT]: chapter text + the rendered canon projection
 * [OUTPUT]: the three ingest-stage prompts (extract / canonicalize / adjudicate) +
 *   `buildExtractSystem(profile)` for non-default fact budgets
 * [POS]: lib/narrative-core/world — every line here was earned by a failed live run; the comments
 *   name which one. Do not "tidy" a rule without re-running the H5 probe.
 * [PROTOCOL]: keep in step with `transport.ts` schemas.
 */

export interface ExtractionProfile {
  /** Fact budget per chapter. 6 is the book profile (canon maintenance: few, load-bearing
   *  facts). Short-text screening (ff-bench) uses a denser budget. */
  factBudget: number
  /** Appends the dense-scan paragraph: record small stateful details, not only reversal-prone
   *  ones. For short texts screened for internal contradictions — a 300-word segment supports
   *  exhaustive extraction; a 5k-word chapter does not. */
  dense?: boolean
}

/** Byte-compat contract: buildExtractSystem({factBudget: 6}) === EXTRACT_SYSTEM, or every
 *  existing cassette (narrative-core-moonstone) silently invalidates. Gated in ingest.test.ts. */
export function buildExtractSystem(profile: ExtractionProfile): string {
  const base = EXTRACT_SYSTEM.replace("- AT MOST 6 facts per chapter,", `- AT MOST ${profile.factBudget} facts per chapter,`)
  if (!profile.dense) return base
  return `${base}

DENSE SCAN MODE: this short text is being screened for internal contradictions, so beyond the
priority order also record small stateful details that a later passage could contradict —
clothing and footwear, objects held or worn and their properties, who knows what, relationship
status, counts, times of day, weather. Same key discipline, same evidence requirement.`
}

export const EXTRACT_SYSTEM = `You extract durable world facts from one chapter of a novel.

CRITICAL DISTINCTION: you are recording WHO CLAIMED WHAT, not what is true. A first-person
narrator asserting his own whereabouts is a claim by that narrator, nothing more. Never promote a
claim to a truth.

Rules:
- AT MOST 6 facts per chapter, and spend that budget in PRIORITY ORDER. Record what a later
  chapter could REVERSE — that is the whole purpose of this ledger:
    1. Where a person was, and when. (Narratives overturn alibis more than anything else.)
    2. Whether someone is alive, dead, or reported dead.
    3. Physical state of objects and openings — bolted/forced, held/lost, whole/broken.
    4. Who someone is: role, name, relation.
    5. What someone knows or has claimed.
  A duration ("steward for nineteen years"), a routine ("counts the ledger on Thursdays"), a lamp
  trimmed twice, how loud a clock is — these are texture and almost never reversed. Do NOT spend
  the budget on them while a whereabouts claim goes unrecorded. Missing a load-bearing fact is the
  worst outcome here; a tidy but shallow ledger is a FAILURE, not thoroughness.
- Keys: \`subject.attribute\`, at most THREE dot-segments, lowercase, generic and reusable.
  Good: "neave.ring.material", "garden.door.state", "wilbrand.location.evening", "house.name".
  Bad:  "wilbrand.library.stay.start_time", "neave.interruption.preference" — too specific, too
        deep, never reusable.
  Ask: "would a different chapter, describing the same thing in other words, produce this exact
  key?" If not, make it more generic.
- The subject is what the claim is ABOUT, never who reports it. Who reports it goes in \`by\`, which
  exists for exactly that. A witness account of an event is keyed to the EVENT.
  Good: "cry.voice" by=wilbrand · "cry.voice" by=ann.trewin  → same key, two claimants, and the
        disagreement is visible.
  Bad:  "wilbrand.heard.cry.type" + "ann.trewin.heard.cry.type" → two keys that can never disagree,
        so conflicting testimony silently becomes two unrelated facts. Only key to a person when the
        fact is about that person ("wilbrand.location.evening" — where HE was).
- REUSE the existing keys given to you whenever the same thing is meant. A new key variant for a
  fact that already exists hides every later contradiction on it — the single most damaging
  mistake you can make here.
- restsOn: testimony, deductions and theories usually REST ON an earlier-established fact — and
  marking that link is how the world later knows what falls when that fact falls. When this
  chapter's claim is an inference FROM something in the ESTABLISHED WORLD STATE (from a PREVIOUS
  chapter), put that key in restsOn (existing keys only, at most 2). The test is collapse:
  would this claim be WORTHLESS if that established key proved false?
    "nobody passed the door"        restsOn "narrator.location" (a watcher who wasn't there saw nothing)
    "X must be the thief"           restsOn the clue-fact the deduction is built from
    "suspicion falls on Y"          restsOn the evidence-fact that implicates Y
  Plain observations, first-hand events and descriptions rest on nothing — use null there.
  Do NOT list a key merely because the claim mentions the same subject; mention is not collapse.
- Resolve people to the roster you are given. Do not invent a new entity for a description ("the
  stranger", "the man on the boat") unless the text names a genuinely new person.
- Every fact needs verbatim evidence copied exactly from the chapter text.
- kind: "physical" (objects, positions, bodies), "cognitive" (knowledge, claims, testimony),
  "social" (promises, threats, bonds).
- If this chapter EXPLICITLY corrects something previously established, record it as a refutation
  with the corrected value, not as a plain new assertion.`

export function extractUser(input: {
  chapterTitle: string
  narrator: string
  text: string
  canon: string
  knownKeys: string[]
  roster: string[]
}): string {
  return `NARRATOR OF THIS CHAPTER: ${input.narrator}
ROSTER (resolve names to these): ${input.roster.length > 0 ? input.roster.join(", ") : "(none yet)"}
EXISTING KEYS (reuse when the same thing is meant): ${input.knownKeys.length > 0 ? input.knownKeys.join(", ") : "(none yet)"}

${input.canon}

CHAPTER: ${input.chapterTitle}
---
${input.text}
---

Extract durable assertions (and explicit refutations) from this chapter.`
}

/**
 * Collision detection is CODE (`collide.ts`), not a model stage. An LLM check stage was tried and
 * removed: it invented canon entries ("no established timekeeping is mentioned") and flagged every
 * clean chapter. Once keys are canonical, "does an existing key already hold a different value" is
 * a comparison — and no prompt can be as precise as a comparison.
 */
export const CANONICALIZE_SYSTEM = `You decide whether newly extracted world-state keys refer to
the same thing as keys that already exist.

You are given existing keys with their current values, and candidate new keys with theirs. Return
only the pairs that describe THE SAME ATTRIBUTE OF THE SAME SUBJECT, even when the wording differs.

Same attribute (merge):
  existing "wilbrand.location.evening = in the library all evening"
  new      "wilbrand.position.library = not in the library"
  → both state where Wilbrand was that evening. Merge. Contradictory values are exactly why this
    matters: unmerged, the contradiction becomes invisible.

Same attribute, hidden behind the observer (merge):
  existing "wilbrand.heard.cry.type = a woman's cry"
  new      "ann.trewin.heard.cry.type = a man's shout"
  → both state what the cry WAS; the differing segment names who heard it, not a different subject.
    Merge onto the existing key. Whose account it is travels separately and is not lost. Testimony
    filed under separate witnesses can never disagree, which is the whole point of merging it.

Different attribute (do NOT merge):
  existing "neave.role = steward"
  new      "neave.status = dead"
  → what he is vs whether he lives. Two facts.

A WRONG MERGE IS WORSE THAN A MISSED MERGE. Merging different attributes fabricates a
contradiction and can destroy good world state. When you are not confident, leave the key alone and
return nothing for it. Never pair keys with different subjects. Returning an empty list is a
perfectly good answer.`

export function canonicalizeUser(input: {
  known: Array<{ key: string; value: string }>
  candidates: Array<{ key: string; value: string }>
}): string {
  return `EXISTING KEYS
${input.known.map((k) => `- ${k.key} = ${k.value}`).join("\n")}

CANDIDATE NEW KEYS
${input.candidates.map((c) => `- ${c.key} = ${c.value}`).join("\n")}

Which candidates mean the same attribute as an existing key?`
}

export const ADJUDICATE_SYSTEM = `You classify a contradiction found in an authored novel.

You cannot reject the text — it is the book. Every contradiction is exactly one of:

Answer bothCouldBeTrue FIRST, before choosing a class: could BOTH values be true at the same
moment, of the same thing?

It decides exactly ONE thing: whether "clean" is available. Answering false and then choosing
"clean" is self-contradictory and code will override it. It says NOTHING about the other four —
a revealed misdirection, a progression and a deliberately-unsettled disagreement ALL have
bothCouldBeTrue = false, and choosing between those still depends entirely on what the text does
with the conflict.


"misdirection-revealed" — the text FRAMES this as a correction or revelation: a narrator admits
  error, a discovery overturns an earlier belief, a confession reverses an account. The earlier
  value was NEVER TRUE; the reader was misled on purpose. Canon is rewritten, the old record kept
  as superseded, and everything that rested on the old value falls with it.

"progression" — the earlier value WAS true, and then time passed and the world changed. Nobody was
  misled and nobody erred; a later chapter simply reports a later state.
    ch5: "the constable stopped looking at the garden side"
    ch9: "the garden side has been searched a second time, walked to the boundary wall"
  Both are true. He stopped, then resumed. Canon takes the new value and keeps the old as HISTORY —
  and, crucially, nothing that rested on the old value is invalidated, because it was sound when it
  was written.
  Ask yourself: "was the earlier statement false all along, or has the world moved since?"
  False all along ⇒ misdirection-revealed. Moved since ⇒ progression. Getting this backwards either
  deletes good testimony or lets a lie stand.

"continuity-error" — an unframed, unremarked contradiction with no narrative purpose. Nobody in the
  text notices; nothing is made of it; it is never revisited. An author's mistake. Canon must NOT
  be rewritten — a human decides.

"suspended" — the text presents conflicting accounts and DELIBERATELY declines to settle them (two
  witnesses disagree; the narrator says he cannot reconcile them). Both stay live. Choosing a
  winner here is a factual error, not a helpful resolution.

"clean" — on inspection this is not really a contradiction. This INCLUDES the mis-keyed case:
  the two values are not describing the same attribute at all, so an earlier stage filed them under
  one key by mistake.

  THE TEST IS CO-TRUTH, and it is the only test — do not decide this one by feel:
  "Could BOTH values be true at the same moment, of the same thing?"
    "the door was bolted" + "nobody passed along the passage"  → both true at once. Mis-keyed, clean.
    "the ring is silver"  + "the ring is gold"                  → CANNOT both be true. NOT clean.
  A plain property of one object — material, colour, count, whether someone is alive — cannot be
  two things at once, so a flip in one is NEVER "clean". It is misdirection-revealed if the text
  frames it, progression if the world changed it, continuity-error if the text never notices.

  "clean" is the narrowest answer here, not the safe one. Reaching for it on a real flip is the
  worst outcome available: the contradiction is silently admitted, canon keeps both values, and the
  author never sees the thing they most needed to see.

Decide from what the TEXT does with the contradiction, not from which version sounds more
plausible. When genuinely torn between continuity-error and misdirection-revealed, choose
continuity-error: flagging for a human is recoverable, silently rewriting canon on an author's
mistake is not.`

export function adjudicateUser(input: {
  chapterTitle: string
  text: string
  key: string
  claimed: string
  canonValue: string
  evidence: string
}): string {
  return `CHAPTER: ${input.chapterTitle}
---
${input.text}
---

CONTRADICTION
  key:          ${input.key}
  this chapter: ${input.claimed}
  canon holds:  ${input.canonValue}
  evidence:     "${input.evidence}"

Classify it.`
}

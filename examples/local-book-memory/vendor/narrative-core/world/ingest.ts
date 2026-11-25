/**
 * [INPUT]: one chapter + the canon folded so far + a `NarrativeCall`
 * [OUTPUT]: `ingestChapter` — extract → canonicalize → collide → adjudicate → the WorldEvent to
 *   fold, plus whatever was flagged instead of folded
 * [POS]: lib/narrative-core/world — the ingest pipeline. Three model stages and one code stage;
 *   which is which is a design decision, not an accident (see `collide.ts`).
 * [PROTOCOL]: this is the production path only. Fixture substitution, dryrun modes and scoring
 *   belong to the harness (`demos/narrative-world/scripts/h5-probe.ts`), never here.
 */

import { ingestVerdict, resolutionFor } from "./gate-policy"
import { renderCanon, truthOf } from "./fold"
import { applyMapping, canonicalizeKeys, deterministicMatch } from "./canonicalize"
import { collisionsFor, dedupeExact } from "./collide"
import { ADJUDICATE_SYSTEM, buildExtractSystem, adjudicateUser, extractUser, type ExtractionProfile } from "./prompts"
import { adjudicateSchema, extractSchema, type NarrativeCall } from "./transport"
import type {
  AdjudicatedContradiction,
  Contradiction,
  Assertion,
  EventId,
  FlaggedItem,
  IngestVerdict,
  Refutation,
  WorldEvent,
  WorldState,
} from "./types"

export interface ChapterInput {
  id: EventId
  ordinal: number
  narrator: string
  title: string
  text: string
  /** PRD §3.3 causal edges — which earlier chapters this one's truth rests on. */
  dependsOn?: EventId[]
}

export interface ChapterIngestResult {
  event: WorldEvent
  flagged: FlaggedItem[]
  adjudicated: AdjudicatedContradiction[]
  verdict: IngestVerdict
  extracted: { assertions: Assertion[]; refutations: Refutation[] }
  llmCalls: number
  promptChars: number
}

export async function ingestChapter(input: {
  chapter: ChapterInput
  state: WorldState
  roster: string[]
  call: NarrativeCall
  /** Default {factBudget: 6} is byte-identical to the historical prompt — cassettes stay valid. */
  profile?: ExtractionProfile
}): Promise<ChapterIngestResult> {
  const { chapter, state, call } = input
  const extractSystem = buildExtractSystem(input.profile ?? { factBudget: 6 })
  const canon = renderCanon(state)
  const knownKeys = Object.keys(state.ledger).sort()
  let llmCalls = 0
  let promptChars = 0

  // ---- extract ---------------------------------------------------------------
  const extractPrompt = extractUser({
    chapterTitle: chapter.title,
    narrator: chapter.narrator,
    text: chapter.text,
    canon,
    knownKeys,
    roster: input.roster,
  })
  promptChars += extractSystem.length + extractPrompt.length
  llmCalls += 1
  const { value: extracted } = await call({ stage: "extract", schema: extractSchema, system: extractSystem, user: extractPrompt })

  let assertions: Assertion[] = extracted.assertions ?? []
  let refutations: Refutation[] = (extracted.refutations ?? []).map((r) => ({
    ...r,
    // `amended` ERASES the earlier record. That is meaningful when an author revises their own
    // draft, and destructive here: ingesting authored text, an erased record is history silently
    // deleted. Anything extraction calls "amended" is at worst an in-world correction.
    kind: r.kind === "amended" ? "in-world" : r.kind,
  }))

  // ---- canonicalize keys -----------------------------------------------------
  const canonical = await canonicalizeKeys({ assertions, refutations, state, call })
  llmCalls += canonical.llmCalls
  promptChars += canonical.promptChars
  assertions = applyMapping(assertions, canonical.mapping)
  refutations = applyMapping(refutations, canonical.mapping)

  // Exact duplicates within one chapter would fold as two live records — a silent double-truth
  // made of a single fact. No adjudication needed; just remove them.
  assertions = dedupeExact(assertions)
  refutations = dedupeExact(refutations)

  const adjudicateOne = async (collision: Contradiction): Promise<AdjudicatedContradiction> => {
    const user = adjudicateUser({
      chapterTitle: chapter.title,
      text: chapter.text,
      key: collision.key,
      claimed: collision.claimed,
      canonValue: collision.canonValue,
      evidence: collision.evidence,
    })
    promptChars += ADJUDICATE_SYSTEM.length + user.length
    llmCalls += 1
    const { value: out } = await call({ stage: "adjudicate", schema: adjudicateSchema, system: ADJUDICATE_SYSTEM, user })
    return { ...collision, ...enforceCoTruth(out) }
  }

  // ---- collide vs prior canon (code, not a model) ------------------------------
  // NOT evidence-gated. The anchor gate exists to kill MODEL-fabricated catches, and since the LLM
  // check stage was replaced by this code collider there is nothing fabricated left to gate.
  // Gating it silently re-admitted double-truths whenever extraction paraphrased its own evidence
  // (measured on a real-novel run: a murder-suspicion collided with an earlier innocence claim,
  // failed to anchor verbatim, and both folded live). The gate stays where model-caught candidates
  // still exist — the play layer's check stage.
  const adjudicated: AdjudicatedContradiction[] = []
  for (const collision of collisionsFor([...assertions, ...refutations], state)) {
    adjudicated.push(await adjudicateOne(collision))
  }

  // ---- collide WITHIN this batch ----------------------------------------------
  const intra = await resolveIntraBatch({ chapter, assertions, refutations, adjudicate: adjudicateOne })
  assertions = intra.assertions
  refutations = intra.refutations

  const { event, flagged } = buildEvent({ chapter, assertions, refutations, adjudicated })
  if (intra.contests.length > 0) {
    event.contests = [...new Set([...(event.contests ?? []), ...intra.contests])]
  }
  flagged.push(...intra.flagged)

  event.dependsOn = deriveDependsOn(event, state)

  const allAdjudicated = [...adjudicated, ...intra.adjudicated]

  return {
    event,
    flagged,
    adjudicated: allAdjudicated,
    verdict: ingestVerdict(allAdjudicated),
    extracted: { assertions, refutations },
    llmCalls,
    promptChars,
  }
}

/**
 * `clean` means "these two values do not actually conflict". If the adjudicator has just told us
 * they cannot both be true, that reading is self-contradictory, and code settles it rather than
 * the prose.
 *
 * The coercion goes to `continuity-error` — the conservative direction the prompt already names.
 * It flags for a human and leaves canon alone, so a wrong coercion costs one review item, while
 * the failure it prevents is a real flip admitted silently with canon keeping both values.
 *
 * Only `clean` is coerced. The other classes each carry their own claim about what the TEXT does,
 * and co-truth has nothing to say about those.
 */
export function enforceCoTruth(out: {
  verdict: IngestVerdict
  reason: string
  bothCouldBeTrue?: boolean
}): { verdict: IngestVerdict; reason: string } {
  if (out.verdict !== "clean" || out.bothCouldBeTrue !== false) {
    return { verdict: out.verdict, reason: out.reason }
  }
  return {
    verdict: "continuity-error",
    reason: `${out.reason} [coerced: answered "clean" while stating the two values cannot both be true]`,
  }
}

/**
 * E3. Extraction marks a claim as RESTING ON existing canon keys; the cascade works on EVENTS.
 * This is the degradation between the two: an edge to the event that asserted the key's currently
 * live record, which is all `applyCascade` needs — so the finer fact→key granularity never has to
 * exist in `fold`, and the cascade stays a simple walk over the log.
 *
 * Three things are deliberately dropped:
 * - keys with no live record (nothing to rest on — including a key extraction invented, which the
 *   prompt forbids but a model may still produce)
 * - self-edges, which would make an event depend on itself
 * - duplicates, since several claims usually rest on the same earlier event
 *
 * Any `dependsOn` the caller supplied is kept: a hand-known causal edge outranks an inferred one.
 * `state` is the canon as it stood BEFORE this chapter, which is what "the key's live record at
 * ingestion time" means.
 */
export function deriveDependsOn(event: WorldEvent, state: WorldState): EventId[] {
  const derived = new Set<EventId>(event.dependsOn)

  // Live keys only: an edge onto a key with nothing live has nothing to cascade from.
  const liveKeys = Object.keys(state.ledger).filter((key) => truthOf(state, key).length > 0)

  for (const assertion of event.assertions) {
    for (const named of assertion.restsOn ?? []) {
      // Measured on the Moonstone corpus: 4 of 5 emitted edges named a key that never existed
      // ("rosanna.location.recent" for a live "rosanna.location"). Extraction is being asked to do
      // exact string retrieval while it extracts, and it invents plausible names instead. Resolving
      // through the same matcher the key pipeline already uses costs no model call and is the same
      // answer canonicalization would give — an exact `truthOf` lookup here silently dropped them.
      const key = truthOf(state, named).length > 0 ? named : deterministicMatch(named, liveKeys)
      if (key === null) continue
      for (const record of truthOf(state, key)) {
        if (record.asserted.at !== event.id) derived.add(record.asserted.at)
      }
    }
  }

  return [...derived]
}

export interface IntraBatchResolution {
  /** The batch after drops and key derivations. */
  assertions: Assertion[]
  /** The same-event refutations, with any value the batch superseded cleared. */
  refutations: Refutation[]
  contests: string[]
  flagged: FlaggedItem[]
  adjudicated: AdjudicatedContradiction[]
}

/**
 * Contradictions that live INSIDE one chapter, rather than between this chapter and prior canon.
 *
 * Found on a real novel: Cuff corrects Seegrave's petticoat theory in the same chapter that stated
 * it; two witnesses give conflicting alibis in one conversation. A collider that only compares
 * against PRIOR canon lets both halves fold and mints a silent double-truth — the exact failure the
 * whole verification layer exists to prevent, arriving through the one door it was not watching.
 *
 * Same adjudicator, applied pairwise within the batch. The RESOLUTION differs from the vs-canon
 * path, because here "canon" is five paragraphs old rather than five chapters:
 *   misdirection / progression → keep the corrected (later) value. The in-scene wrong guess is
 *                                summarised away rather than kept as superseded — a v0 tradeoff:
 *                                preserving every intra-scene guess would bury the ledger.
 *   suspended                  → both fold as contested (fold already honours `event.contests`)
 *   continuity-error           → keep the earlier, flag the pair for the author
 *   clean (mis-keyed)          → the later claim gets a derived key, so the fact is never lost
 *
 * Pairing is interleaved with adjudication on purpose: after a correction wins, a THIRD claim on
 * the same key must be compared against the corrected value, not the original one. Precomputing
 * the pairs would compare it against a value the chapter already retracted.
 */
/**
 * First unused name in the `base`, `base-2`, `base-3`… series. A dash rather than a dot keeps the
 * suffix out of the dot-segment namespace the extractor works in, so a derived key can never be
 * mistaken for one a later chapter might legitimately produce.
 */
function freeDerivedKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export async function resolveIntraBatch(input: {
  chapter: ChapterInput
  assertions: Assertion[]
  /** Same-event refutations. A refutation that CARRIES a value introduces a live record exactly as
   *  an assertion does (see `foldEvents`), so leaving them out of this pass left one uncollidable
   *  way to reach two live records on one key. Measured on the Moonstone corpus: a chapter both
   *  refuted `door.paint.state` ("not smeared by petticoats") and asserted it ("dry for eight
   *  hours"), and both folded live, unadjudicated. */
  refutations?: Refutation[]
  adjudicate: (_collision: Contradiction) => Promise<AdjudicatedContradiction>
}): Promise<IntraBatchResolution> {
  const assertions = [...input.assertions]
  const refutations = [...(input.refutations ?? [])]
  const adjudicated: AdjudicatedContradiction[] = []
  const contests = new Set<string>()
  const flagged: FlaggedItem[] = []
  const dropped = new Set<number>()
  const liveAt = new Map<string, number>()
  const taken = new Set(assertions.map((a) => a.key))

  // A refutation's carried value is the key's current value for the rest of this event, so an
  // assertion on that key is judged against it. Index -1 marks "held by a refutation, not by an
  // assertion" — the two verdicts that would drop the earlier claim clear the refutation's value
  // instead, which is the same outcome expressed where that value actually lives.
  const heldByRefutation = new Map<string, number>()
  for (let i = 0; i < refutations.length; i += 1) {
    if (refutations[i].value != null && !liveAt.has(refutations[i].key)) {
      liveAt.set(refutations[i].key, -1)
      heldByRefutation.set(refutations[i].key, i)
    }
  }

  for (let index = 0; index < assertions.length; index += 1) {
    const claim = assertions[index]
    const earlierIndex = liveAt.get(claim.key)

    if (earlierIndex === undefined) {
      liveAt.set(claim.key, index)
      continue
    }

    const earlier =
      earlierIndex === -1
        ? { value: refutations[heldByRefutation.get(claim.key) as number].value as string }
        : assertions[earlierIndex]
    if (earlier.value === claim.value) continue // dedupeExact already removed true duplicates

    // Deliberately NOT evidence-gated. The anchor gate kills MODEL-fabricated catches; this pair
    // was found by exact key comparison in code, so there is nothing fabricated to gate. Gating it
    // silently re-admitted the double-truth whenever extraction paraphrased its quotes.
    const verdict = await input.adjudicate({
      key: claim.key,
      claimed: claim.value,
      canonValue: earlier.value,
      evidence: claim.evidence ?? "",
      canonRef: `${claim.key} = ${earlier.value} (stated earlier in this same chapter)`,
    })
    adjudicated.push(verdict)

    if (verdict.verdict === "misdirection-revealed" || verdict.verdict === "progression") {
      if (earlierIndex === -1) {
        // The later claim wins, and the value it supersedes lives on the refutation. Clearing it
        // there is what "drop the earlier claim" means in that case: the refutation still fires
        // (canon's old record is resolved), it simply stops carrying a value the chapter retracted.
        const at = heldByRefutation.get(claim.key) as number
        refutations[at] = { ...refutations[at], value: null }
        heldByRefutation.delete(claim.key)
      } else {
        dropped.add(earlierIndex)
      }
      liveAt.set(claim.key, index)
    } else if (verdict.verdict === "suspended") {
      contests.add(claim.key)
    } else if (verdict.verdict === "continuity-error") {
      dropped.add(index)
      flagged.push({
        key: claim.key,
        atEvent: input.chapter.id,
        ordinal: input.chapter.ordinal,
        reason: verdict.reason,
        claimed: claim.value,
        canonValue: earlier.value,
      })
    } else {
      // clean ⇒ mis-keyed. Give the later claim its own key rather than dropping a real fact.
      // The name must be unique per SPLIT, not per chapter: one chapter can mis-key the same base
      // key several times (a window that is "shut", "fastened" and "not forced" all land on
      // office.window.state), and a chapter-scoped name gave all of them the SAME derived key —
      // recreating, on the derived key, the exact double-truth the split exists to prevent.
      assertions[index] = { ...claim, key: freeDerivedKey(`${claim.key}.${input.chapter.id}`, taken) }
      taken.add(assertions[index].key)
    }
  }

  return {
    assertions: dropped.size > 0 ? assertions.filter((_, index) => !dropped.has(index)) : assertions,
    refutations,
    contests: [...contests],
    flagged,
    adjudicated,
  }
}

/**
 * Turn adjudications into the event that gets folded. Each class becomes a different structural
 * act — this function is where the taxonomy stops being vocabulary and starts being behaviour.
 */
export function buildEvent(input: {
  chapter: ChapterInput
  assertions: Assertion[]
  refutations: Refutation[]
  adjudicated: AdjudicatedContradiction[]
}): { event: WorldEvent; flagged: FlaggedItem[] } {
  const { chapter } = input
  const flagged: FlaggedItem[] = []
  const contests: string[] = []
  const dropped = new Set<string>()
  const refutations = [...input.refutations]

  for (const item of input.adjudicated) {
    const resolution = resolutionFor(item.verdict)

    if (item.verdict === "continuity-error") {
      dropped.add(item.key)
      // Extraction can also emit a REFUTATION for this key (it read the chapter as a correction).
      // Dropping only the assertion would leave that refutation to rewrite canon through the back
      // door — the exact failure this verdict exists to prevent.
      const backDoor = refutations.findIndex((r) => r.key === item.key)
      if (backDoor >= 0) refutations.splice(backDoor, 1)

      flagged.push({
        key: item.key,
        atEvent: chapter.id,
        ordinal: chapter.ordinal,
        reason: item.reason,
        claimed: item.claimed,
        canonValue: item.canonValue,
      })
      continue
    }

    if (item.verdict === "suspended") {
      contests.push(item.key)
      continue
    }

    if (item.verdict === "clean") {
      // The collider found an existing key holding a different value and the adjudicator ruled it
      // is not a real conflict (a restatement, a narrowing, a mis-keyed pair). Canon needs no
      // change — but keeping the new assertion too would leave two live records on one key with
      // nothing having adjudicated between them, which IS the silent double-truth pathology.
      dropped.add(item.key)
      continue
    }

    if (resolution) {
      const existing = refutations.findIndex((r) => r.key === item.key)
      if (existing >= 0) {
        // The adjudicator, not extraction, decides the kind: extraction has no view of whether the
        // old value was never true or merely expired.
        refutations[existing] = { ...refutations[existing], kind: resolution }
      } else {
        refutations.push({
          key: item.key,
          kind: resolution,
          value: item.claimed,
          reason: item.reason,
          evidence: item.evidence,
        })
      }
      // The refutation carries the new value; a same-key assertion would fold it twice.
      dropped.add(item.key)
    }
  }

  const event: WorldEvent = {
    id: chapter.id,
    ordinal: chapter.ordinal,
    source: "ingest",
    narrator: chapter.narrator,
    text: chapter.text,
    assertions: input.assertions.filter((a) => !dropped.has(a.key)),
    refutations,
    contests: contests.length > 0 ? contests : undefined,
    dependsOn: chapter.dependsOn ?? [],
  }

  return { event, flagged }
}

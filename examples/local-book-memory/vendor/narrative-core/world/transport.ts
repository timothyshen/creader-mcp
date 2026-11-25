/**
 * [INPUT]: zod; `StructuredCall` from ../structured-call
 * [OUTPUT]: `NarrativeCall` — the engine's one structured-call port, `StructuredCall`, narrowed to
 *   the stages of world ingest and the play loop — plus the per-stage schemas that define each
 *   stage's contract
 * [POS]: lib/narrative-core/world — the engine DECLARES the port; implementations live outside the
 *   carve set. Until N1 (2026-10-27) `NarrativeCall` was a port of its own: keyed by stage, it
 *   returned the stage's output and left the schema to the implementation (`STAGE_SCHEMAS[stage]`).
 *   It is now `StructuredCall`, so every stage hands over its schema and gets `{ value, usage }` back,
 *   and one implementation serves world, play and the adaptation. The name stays for the hosts that
 *   implement it; their implementations change shape once (the only N1 change that is not additive).
 *
 *   Why not reuse `callGuardianLlm`: it is guardian-private (detector ids, guardian env pins,
 *   cassette mode, run-context accounting) and importing it here would invert the dependency —
 *   app-glue must flow into the engine, never the reverse. An app-side adapter backed by
 *   `callGuardianLlm` (or anything else) satisfies this port in a few lines.
 *
 *   `ModelRouter` answers WHICH model runs a stage; this port answers HOW the call is made. They
 *   compose: an adapter resolves the model through the router, then makes the call.
 * [PROTOCOL]: schemas are the stage contract — changing one changes what every implementation
 *   must return. Keep them in step with `prompts.ts`.
 */

import { z } from "zod"

import type { StructuredCall } from "../structured-call"

/**
 * Every stage that needs a model, across both loops. Collision detection is code, not a stage —
 * in ingest AND in play, the same comparison answers "does an existing key hold a different value".
 *
 * ingest: extract → canonicalize → adjudicate
 * play:   narrate · player-extract → player-check → verify → counterforce
 */
export type NarrativeStage =
  | "extract"
  | "canonicalize"
  | "adjudicate"
  | "narrate"
  | "player-extract"
  | "player-check"
  | "verify"
  | "counterforce"

const deltaKind = z.enum(["physical", "cognitive", "social"])

/**
 * `value` is NULLABLE rather than optional on purpose: OpenAI-style structured outputs require
 * every property to appear in `required`, so an absent value must be expressed as null. Marking it
 * optional produces a schema the provider rejects outright.
 */
export const extractSchema = z.object({
  assertions: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      by: z.string(),
      kind: deltaKind,
      evidence: z.string(),
      // E3: existing canon keys this claim's truth RESTS ON (inference, not mention).
      // NULLABLE, not optional — structured outputs require every property in `required`.
      restsOn: z.array(z.string()).nullable(),
    }),
  ),
  refutations: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(["in-world", "progressed", "amended"]),
      value: z.string().nullable(),
      reason: z.string(),
      evidence: z.string(),
    }),
  ),
})

export const canonicalizeSchema = z.object({
  merges: z.array(z.object({ newKey: z.string(), existingKey: z.string() })),
})

export const adjudicateSchema = z.object({
  /** Asked BEFORE the class, and enforced in code: a `clean` verdict paired with `false` here is
   *  self-contradictory and gets coerced. One boolean is a much narrower thing for a model to get
   *  wrong than a five-way class choice. */
  bothCouldBeTrue: z.boolean(),
  verdict: z.enum(["clean", "misdirection-revealed", "progression", "continuity-error", "suspended"]),
  reason: z.string(),
})

// ---- play stages -------------------------------------------------------------

export const narrateSchema = z.object({ beat: z.string() })

/** The player writes action, speech and narration mixed; the extractor classifies. There is no
 *  mode switch to record, so this returns assertions only — a player cannot refute canon by
 *  writing, only by having a claim adjudicated as a twist. */
export const playerExtractSchema = z.object({
  assertions: z.array(
    z.object({ key: z.string(), value: z.string(), by: z.string(), kind: deltaKind, evidence: z.string() }),
  ),
})

export const playerCheckSchema = z.object({
  contradictions: z.array(
    z.object({
      key: z.string(),
      claimed: z.string(),
      canonValue: z.string(),
      evidence: z.string(),
      canonRef: z.string(),
    }),
  ),
})

export const verifySchema = z.object({
  verifyClass: z.enum(["genuine", "twist", "drop", "unclear"]),
  reason: z.string(),
})

export const counterforceSchema = z.object({ prose: z.string() })

export const STAGE_SCHEMAS = {
  extract: extractSchema,
  canonicalize: canonicalizeSchema,
  adjudicate: adjudicateSchema,
  narrate: narrateSchema,
  "player-extract": playerExtractSchema,
  "player-check": playerCheckSchema,
  verify: verifySchema,
  counterforce: counterforceSchema,
} as const

export type StageOutput<S extends NarrativeStage> = z.infer<(typeof STAGE_SCHEMAS)[S]>

/**
 * One structured-output call from world ingest or the play loop. The implementation owns model
 * choice, retries, timeouts, cassettes and usage accounting — the engine owns the prompt and the
 * schema (always `STAGE_SCHEMAS[stage]`). These stages set no temperature: the implementation's
 * default is what they have always run at.
 */
export type NarrativeCall = StructuredCall<NarrativeStage>

/**
 * [INPUT]: zod (types only)
 * [OUTPUT]: `StructuredCall` — the one port through which the engine asks a model for structured
 *   output — with its request (`StructuredCallSpec`) and what a call cost (`LlmUsage`)
 * [POS]: lib/narrative-core — a port a host implements, beside `BookKnowledgeSource`, `VectorIndex`
 *   and `ModelRouter`. World ingest, the play loop and the adaptation all call through it (N1,
 *   2026-10-27). Before, world + play had `NarrativeCall` (stage-keyed, output only) and the
 *   adaptation had `ScriptCall` (schema-carrying, with usage): a host running both implemented two
 *   transports. Both names are kept — `world/transport` and `script/transport` define them as this
 *   port narrowed to their own stages — because hosts implement them. This shape is the adaptation's:
 *   it is the one that carries the schema, the caller's cancellation and the cost.
 *
 *   `ModelRouter` answers WHICH model runs a task; this port makes the call. An implementation
 *   resolves its model (through a router or not), then calls.
 * [PROTOCOL]: changing the spec or the result changes what every implementation must accept or
 *   return. The surface freeze (README § Stability) compares names and kinds, not signatures, so a
 *   change here is caught in review or not at all.
 */

import type { z } from "zod"

/** What one or more model calls cost — counted from the provider's answer, never estimated. */
export interface LlmUsage {
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface StructuredCallSpec<T extends z.ZodType, Stage extends string = string> {
  /**
   * Which step is asking. Names belong to a subsystem: `extract` is world ingest's under
   * `NarrativeCall` and the adaptation's under `ScriptCall`. A host serving both from one function
   * that picks a model by stage tells the two apart by `schema`.
   */
  stage: Stage
  /** The shape the answer must take — the stage's contract. */
  schema: T
  system: string
  user: string
  /**
   * Set by a stage whose meaning includes it — the adaptation always sets one (extraction and the
   * fidelity check at 0, writing warmer), and the implementation must not override it. Absent, the
   * implementation's own default stands: world and play stages have never set one.
   */
  temperature?: number
  /**
   * The caller's cancellation (a chapter's budget spent, a batch cancelled). The implementation
   * hands it to the request, so a call the caller gave up on stops generating and stops costing.
   * Absent, only the implementation's own timeout applies.
   */
  signal?: AbortSignal
}

/**
 * One structured-output call. The implementation owns model choice, retries, timeouts, cassettes
 * and metering; the engine owns the prompt, the schema and — where it matters — the temperature.
 */
export interface StructuredCall<Stage extends string = string> {
  <T extends z.ZodType>(_spec: StructuredCallSpec<T, Stage>): Promise<{ value: z.infer<T>; usage: LlmUsage }>
}

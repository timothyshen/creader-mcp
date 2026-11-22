/**
 * [INPUT]: adjudicated contradictions + the source text
 * [OUTPUT]: the deterministic evidence gate + the ingest verdict precedence table
 * [POS]: lib/narrative-core/world — pure policy, no LLM. Uses the SHARED anchor checker from
 *   `../internal/anchor` rather than a copy: one invariant, one implementation. The demo's
 *   probe-v2 re-implemented this gate naively and silently dropped every real catch, which is the
 *   single worst regression in this engine's history.
 */

import { createAnchorChecker } from "../internal/anchor"

import type { AdjudicatedContradiction, Contradiction, IngestVerdict } from "./types"

/**
 * A contradiction whose quoted evidence does not anchor in the source text is dropped before any
 * verdict — fabricated quotes die by string matching, not by a second model call.
 */
export function gateEvidence<T extends Contradiction>(candidates: T[], sourceText: string): T[] {
  const anchored = createAnchorChecker(sourceText)
  return candidates.filter((c) => c.evidence.length > 0 && anchored(c.evidence))
}

/**
 * The verdict a chapter gets is the strongest intervention it demands:
 *
 *   continuity-error      → a human must look (it never enters canon)
 *   misdirection-revealed → canon rewritten; the old value was never true (cascades)
 *   progression           → canon rewritten; the old value was true and expired (no cascade)
 *   suspended             → a dispute is opened and deliberately left open
 *   clean                 → nothing
 *
 * Flagging outranks rewriting on purpose: silently folding an author's mistake is what makes a
 * world quietly wrong. And a revealed misdirection outranks a progression, because it changes what
 * the reader believed, not merely what is current.
 */
export function ingestVerdict(adjudicated: AdjudicatedContradiction[]): IngestVerdict {
  if (adjudicated.some((a) => a.verdict === "continuity-error")) return "continuity-error"
  if (adjudicated.some((a) => a.verdict === "misdirection-revealed")) return "misdirection-revealed"
  if (adjudicated.some((a) => a.verdict === "progression")) return "progression"
  if (adjudicated.some((a) => a.verdict === "suspended")) return "suspended"
  return "clean"
}

/** The resolution kind a verdict implies, for callers building the refutation. */
export function resolutionFor(verdict: IngestVerdict): "in-world" | "progressed" | null {
  if (verdict === "misdirection-revealed") return "in-world"
  if (verdict === "progression") return "progressed"
  return null
}

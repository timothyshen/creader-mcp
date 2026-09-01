/**
 * Type definitions for MCP tool inputs and API responses.
 */

// Books
export interface Book {
  id: string
  title: string
  description?: string
  contentType: string
  visibility?: string
  createdAt: string
  updatedAt: string
}

// Chapters
export interface Chapter {
  id: string
  bookId: string
  title: string
  content?: string
  orderIndex: number
  wordCount: number
  /** Set when the chapter hangs off a volume / act. The list route returns
   *  both; they are what makes a container delete's blast radius computable. */
  volumeId?: string | null
  actId?: string | null
  createdAt: string
  updatedAt: string
}

// Knowledge entities
export interface Character {
  id: string
  bookId: string
  name: string
  role?: string
  description?: string
  customFields?: Record<string, unknown>
}

export interface Location {
  id: string
  bookId: string
  name: string
  type?: string
  description?: string
  customFields?: Record<string, unknown>
}

export interface TimelineEvent {
  id: string
  bookId: string
  title: string
  description?: string
  importance?: string
  eventType?: string
  consequences?: string
}

export interface Note {
  id: string
  bookId: string
  title: string
  content: string
  noteType?: string
}

// Semantic Relations
export interface SemanticRelation {
  id: string
  bookId: string
  sourceId: string
  sourceType: "character" | "location" | "event" | "note"
  targetId: string
  targetType: "character" | "location" | "event" | "note"
  type: string
  inverseType: string | null
  description: string | null
  strength: number
  createdAt: string
  updatedAt: string
}

// Stats
// Mirror of WritingStatsResponse in creader-editor's types/api/account.ts.
// `todayWords` / `totalWords` used to be declared here and neither has ever
// existed on the wire — the tool printed "undefined words" for both. Progress
// counters are named *WordProgress, and the product keeps NO lifetime word
// total, so do not reintroduce one here to fill the hole.
export interface WritingStats {
  currentStreak: number
  longestStreak: number
  lastWriteDate: string | null
  totalWritingDays: number
  streakGoal: number
  dailyWordGoal: number
  weeklyWordGoal: number
  streakProgress: number
  dailyWordProgress: number
  yesterdayWordProgress: number
  weeklyWordProgress: number
}

export interface QuotaInfo {
  tokenQuota: number
  tokenUsed: number
  tokenBonus: number
  remaining: number
}

// Guardian (deep analysis) issues — mirror of /types/guardian-types.ts from creader-editor.
// Kept loose on optional fields so schema changes upstream don't break the MCP build.
export interface GuardianIssue {
  id: string
  severity: "error" | "warning" | "info" | "critical"
  category: string
  title: string
  description: string
  suggestion?: string
  suggestedFix?: string
  evidence?: string[]
  chapterId?: string
  entityId?: string
  fingerprint: string
  tier?: number
  timestamp: number
  confidence?: "high" | "medium" | "low"
  detector?: string
  lane?: "issue" | "suggestion"
  textPosition?: { start: number; end: number }
}

export interface VectorConflict {
  id: string
  type: string
  explanation: string
  sourceA: { id: string; title: string; content: string; chapterId?: string }
  sourceB: { id: string; title: string; content: string; chapterId?: string }
  detectedAt: number
}

export interface VectorCheckResponse {
  conflicts: VectorConflict[]
  issues: unknown[]
  durationMs: number
}

// ── Guardian 5-layer dispatcher (/guardian/run) ────────────────────
// Mirrors OrchestratorOutput from creader-editor's
// lib/ai/guardian/orchestrator/types.ts. Kept loose on optional fields so
// upstream additions don't break the MCP build.

/** Narrative layers the novelist dispatcher fans out to. */
export type NarrativeLayer = 1 | 2 | 3 | 4 | 5

/** Inclusive ceiling on how expensive a detector may be. local = no LLM calls. */
export type DetectorCost = "local" | "api-light" | "vector" | "api-heavy"

export interface GuardianLayerReport {
  layer: NarrativeLayer
  issues: GuardianIssue[]
  detectorTimingsMs?: Record<string, number>
  errors?: Array<{ detectorId: string; message: string }>
  durationMs?: number
  /** Set when a layer's LLM detectors only saw a prefix of the chapter. */
  truncation?: { analyzedChars: number; totalChars: number }
}

// ── Persisted Guardian issues (/books/:id/guardian/issues) ─────────
// The durable record behind the author's Guardian panel and Story Health.
// A run's findings are transient until they are POSTed here. Both routes
// answered session cookies only until 2026-08-29 — see the tool comments in
// tools/ai.ts for what that cost.

export interface PersistedGuardianIssue {
  id: string
  bookId: string
  chapterId: string | null
  fingerprint: string
  title: string
  severity: string
  category?: string | null
  confidence?: unknown
  description?: string | null
  detector?: string | null
  lane?: string | null
  evidence?: unknown
  metrics?: unknown
  suggestedFix?: string | null
  textPosition?: { start: number; end: number } | null
  status: "OPEN" | "RESOLVED" | "DISMISSED"
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface PersistResult {
  upsertedCount: number
  autoResolvedCount: number
  persistedIds: string[]
}

export interface GuardianRunResponse {
  reports: GuardianLayerReport[]
  /** Flattened, deduplicated issues across every layer that ran. */
  issues: GuardianIssue[]
  techniques?: unknown[]
  durationMs: number
  traceId: string
  usage: { totalTokens: number }
}

// ── Book search (/books/:id/search) ────────────────────────────────
// Searches the PROSE, unlike /knowledge/search which searches entity records.
// Replies with bare JSON, not the envelope — getRaw, or it fails with the
// nonsensical "API error: 200".

export interface BookSearchResult {
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  /** ~120 chars of context around the match, ellipsed at both ends. */
  snippet: string
  /** Character offset of the match in the chapter's plain text. */
  position: number
  /** Title-hit vs body-hit for text search; cosine similarity for semantic. */
  score: number
}

export interface BookSearchResponse {
  results: BookSearchResult[]
  query: string
  type: "text" | "semantic"
  total: number
}

// ── Structure (volumes / acts / scenes) ────────────────────────────
// The v1.0 hierarchy is volume → act → chapter → scene. Chapters carry
// volumeId/actId; acts carry volumeId; scenes carry actId/chapterId. Kept
// loose on optional fields so upstream additions don't break the MCP build.

export interface Volume {
  id: string
  bookId: string
  title: string
  description?: string | null
  synopsis?: string | null
  notes?: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
  _count?: { chapters: number }
}

export interface Act {
  id: string
  bookId: string
  /** Acts are named, not titled — the API field really is `name`. */
  name: string
  description?: string | null
  tags?: string[]
  alternateLabel?: string | null
  volumeId: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export interface Scene {
  id: string
  bookId: string
  title: string
  synopsis?: string | null
  description?: string | null
  tags?: string[]
  orderIndex: number
  status?: string | null
  actId: string | null
  chapterId: string | null
  pov?: string | null
  sceneTime?: string | null
  mood?: string | null
  createdAt: string
  updatedAt: string
}

// ── Style (fingerprint + reference corpus) ─────────────────────────
// Two different things: the fingerprint is MEASURED from the author's prose,
// the references are passages they CHOSE. Both routes use the envelope.

/** Mirror of WritingStyleFingerprint in creader-editor's lib/analyzers/style. */
export interface StyleFingerprint {
  averageSentenceLength: number
  averageParagraphLength: number
  vocabularyDiversity: number
  commonWords: Array<{ word: string; count: number }>
  sentenceStructure: { simple: number; compound: number; complex: number }
  tone: "formal" | "casual" | "mixed"
  pov: "first" | "second" | "third" | "mixed"
  tense: "past" | "present" | "mixed"
}

export interface StyleFingerprintResponse {
  /** Null until the analyzer has enough prose to measure. */
  styleFingerprint: StyleFingerprint | null
}

export interface StyleReference {
  id: string
  content: string
  source: string
  tweetId?: string | null
  tweetDate?: string | null
  createdAt: string
  updatedAt: string
}

export interface StyleReferencesResponse {
  /** Whether Creader feeds the references into its own AI calls. */
  styleEnabled: boolean
  references: StyleReference[]
  count: number
}

// ── Plan (plan-spine, plot-nodes, threads, structure template) ─────
// The book as designed: volumes → acts → chapters → scenes, with beats
// (PlotNode) on chapters and subplot threads (PlanThread) on volumes.
// All of these routes use the { success, data } envelope.

export interface PlanThread {
  id: string
  volumeId: string
  name: string
  short?: string | null
  /** CSS color; the Plan grid uses it as the column accent. */
  color: string
  orderIndex: number
  createdAt?: string
  updatedAt?: string
}

export interface PlotNode {
  id: string
  chapterId: string
  order: number
  summary: string
  sceneNum?: string | null
  /** The kind='setup' ForeshadowingMarker this beat PLANTS. Never a payoff. */
  setupId?: string | null
  eventIds?: string[]
  /** M2M join rows, not the threads themselves. */
  threads?: Array<{ threadId: string }>
  createdAt?: string
  updatedAt?: string
}

/**
 * A chapter as the spine returns it: the full Chapter row — `content`
 * included — plus its scenes and beats. get_plan_spine drops everything but
 * the structural fields; see the header of tools/plan.ts for why.
 */
export interface SpineChapter {
  id: string
  title: string
  orderIndex: number
  status?: string | null
  wordCount?: number
  content?: string
  scenes?: Scene[]
  plotNodes?: PlotNode[]
}

export interface SpineAct {
  id: string
  name: string
  orderIndex: number
  chapters?: SpineChapter[]
}

export interface SpineVolume {
  id: string
  title: string
  orderIndex: number
  acts?: SpineAct[]
  threads?: PlanThread[]
}

export interface PlanSpineResponse {
  volumes: SpineVolume[]
  /** Chapters written in Write that belong to no act — never hidden. */
  unassignedChapters: SpineChapter[]
}

export interface ApplyTemplateResult {
  templateId: string
  acts: number
  chapters: number
  /** True when the spine already had content and only the declaration was stored. */
  declaredOnly?: boolean
}

// ── Generation planning (/api/ai/orchestrate) ──────────────────────
// Mirror of generationPlanSchema in creader-editor's types/generation-types.ts.
// Also a bare `{ success, plan }` reply.

export interface GenerationScene {
  order: number
  purpose: string
  requiredEntities: string[]
  settingId?: string
  emotionalBeat: string
}

export interface GenerationPlan {
  sceneBreakdown: GenerationScene[]
  consistencyConstraints: string[]
  styleDirectives: string[]
  wordTarget: number
  creativePrompt: string
}

export interface OrchestrateResponse {
  success: boolean
  plan: GenerationPlan
}

// ── Knowledge search (/knowledge/search) ───────────────────────────

export interface KnowledgeSearchResult {
  id: string
  type: "character" | "location" | "event" | "note"
  title: string
  content: string
  tags: string[]
  rank: number
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

export interface KnowledgeSearchResponse {
  results: KnowledgeSearchResult[]
  total: number
  query: string
}

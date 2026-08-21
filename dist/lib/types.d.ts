/**
 * Type definitions for MCP tool inputs and API responses.
 */
export interface Book {
    id: string;
    title: string;
    description?: string;
    contentType: string;
    visibility?: string;
    createdAt: string;
    updatedAt: string;
}
export interface Chapter {
    id: string;
    bookId: string;
    title: string;
    content?: string;
    orderIndex: number;
    wordCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface Character {
    id: string;
    bookId: string;
    name: string;
    role?: string;
    description?: string;
    customFields?: Record<string, unknown>;
}
export interface Location {
    id: string;
    bookId: string;
    name: string;
    type?: string;
    description?: string;
    customFields?: Record<string, unknown>;
}
export interface TimelineEvent {
    id: string;
    bookId: string;
    title: string;
    description?: string;
    importance?: string;
    eventType?: string;
    consequences?: string;
}
export interface Note {
    id: string;
    bookId: string;
    title: string;
    content: string;
    noteType?: string;
}
export interface SemanticRelation {
    id: string;
    bookId: string;
    sourceId: string;
    sourceType: "character" | "location" | "event" | "note";
    targetId: string;
    targetType: "character" | "location" | "event" | "note";
    type: string;
    inverseType: string | null;
    description: string | null;
    strength: number;
    createdAt: string;
    updatedAt: string;
}
export interface WritingStats {
    currentStreak: number;
    longestStreak: number;
    totalWords: number;
    todayWords: number;
}
export interface QuotaInfo {
    tokenQuota: number;
    tokenUsed: number;
    tokenBonus: number;
    remaining: number;
}
export interface GuardianIssue {
    id: string;
    severity: "error" | "warning" | "info" | "critical";
    category: string;
    title: string;
    description: string;
    suggestion?: string;
    suggestedFix?: string;
    evidence?: string[];
    chapterId?: string;
    entityId?: string;
    fingerprint: string;
    tier?: number;
    timestamp: number;
    confidence?: "high" | "medium" | "low";
    detector?: string;
    lane?: "issue" | "suggestion";
    textPosition?: {
        start: number;
        end: number;
    };
}
export interface VectorConflict {
    id: string;
    type: string;
    explanation: string;
    sourceA: {
        id: string;
        title: string;
        content: string;
        chapterId?: string;
    };
    sourceB: {
        id: string;
        title: string;
        content: string;
        chapterId?: string;
    };
    detectedAt: number;
}
export interface VectorCheckResponse {
    conflicts: VectorConflict[];
    issues: unknown[];
    durationMs: number;
}
/** Narrative layers the novelist dispatcher fans out to. */
export type NarrativeLayer = 1 | 2 | 3 | 4 | 5;
/** Inclusive ceiling on how expensive a detector may be. local = no LLM calls. */
export type DetectorCost = "local" | "api-light" | "vector" | "api-heavy";
export interface GuardianLayerReport {
    layer: NarrativeLayer;
    issues: GuardianIssue[];
    detectorTimingsMs?: Record<string, number>;
    errors?: Array<{
        detectorId: string;
        message: string;
    }>;
    durationMs?: number;
    /** Set when a layer's LLM detectors only saw a prefix of the chapter. */
    truncation?: {
        analyzedChars: number;
        totalChars: number;
    };
}
export interface GuardianRunResponse {
    reports: GuardianLayerReport[];
    /** Flattened, deduplicated issues across every layer that ran. */
    issues: GuardianIssue[];
    techniques?: unknown[];
    durationMs: number;
    traceId: string;
    usage: {
        totalTokens: number;
    };
}
export interface Volume {
    id: string;
    bookId: string;
    title: string;
    description?: string | null;
    synopsis?: string | null;
    notes?: string | null;
    orderIndex: number;
    createdAt: string;
    updatedAt: string;
    _count?: {
        chapters: number;
    };
}
export interface Act {
    id: string;
    bookId: string;
    /** Acts are named, not titled — the API field really is `name`. */
    name: string;
    description?: string | null;
    tags?: string[];
    alternateLabel?: string | null;
    volumeId: string | null;
    orderIndex: number;
    createdAt: string;
    updatedAt: string;
}
export interface Scene {
    id: string;
    bookId: string;
    title: string;
    synopsis?: string | null;
    description?: string | null;
    tags?: string[];
    orderIndex: number;
    status?: string | null;
    actId: string | null;
    chapterId: string | null;
    pov?: string | null;
    sceneTime?: string | null;
    mood?: string | null;
    createdAt: string;
    updatedAt: string;
}
/** Entity snapshot sent TO the route (server caps: 200 items, 500 chars each). */
export interface EntitySnapshot {
    id: string;
    title: string;
    type: string;
    content: string;
    metadata?: Record<string, unknown>;
}
export interface FactUpdate {
    entityId: string;
    entityTitle?: string;
    entityType?: string;
    updateType?: string;
    fieldPath?: string;
    proposedValue?: unknown;
    confidence?: unknown;
    textEvidence?: string;
    chapterId?: string;
    status?: string;
}
export interface FactExtractionResult {
    chapterId: string;
    factUpdates: FactUpdate[];
    /** True when the server analysed only a prefix of the chapter. */
    truncated?: boolean;
    extractedAt?: unknown;
}
export interface ExtractFactsResponse {
    success: boolean;
    result: FactExtractionResult;
}
export interface GenerationScene {
    order: number;
    purpose: string;
    requiredEntities: string[];
    settingId?: string;
    emotionalBeat: string;
}
export interface GenerationPlan {
    sceneBreakdown: GenerationScene[];
    consistencyConstraints: string[];
    styleDirectives: string[];
    wordTarget: number;
    creativePrompt: string;
}
export interface OrchestrateResponse {
    success: boolean;
    plan: GenerationPlan;
}
export interface KnowledgeSearchResult {
    id: string;
    type: "character" | "location" | "event" | "note";
    title: string;
    content: string;
    tags: string[];
    rank: number;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
}
export interface KnowledgeSearchResponse {
    results: KnowledgeSearchResult[];
    total: number;
    query: string;
}

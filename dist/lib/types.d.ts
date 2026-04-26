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

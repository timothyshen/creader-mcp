import type {
  Book,
  Chapter,
  Character,
  Location,
  TimelineEvent,
  Note,
  SemanticRelation,
  WritingStats,
  QuotaInfo,
  VectorCheckResponse,
  GuardianRunResponse,
} from "../../src/lib/types.js"

export const fxBook: Book = {
  id: "book_1",
  title: "The Test Saga",
  description: "A story used in tests.",
  contentType: "novel",
  visibility: "private",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
}

export const fxChapter: Chapter = {
  id: "chap_1",
  bookId: "book_1",
  title: "Chapter One",
  content: "Once upon a time.",
  orderIndex: 0,
  wordCount: 4,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

export const fxCharacter: Character = {
  id: "char_1",
  bookId: "book_1",
  name: "Alice",
  role: "protagonist",
  description: "A curious heroine.",
}

export const fxLocation: Location = {
  id: "loc_1",
  bookId: "book_1",
  name: "Wonderland",
  type: "realm",
  description: "A strange land.",
}

export const fxEvent: TimelineEvent = {
  id: "evt_1",
  bookId: "book_1",
  title: "The Fall",
  description: "She falls down.",
  importance: "major",
  eventType: "plot",
}

export const fxNote: Note = {
  id: "note_1",
  bookId: "book_1",
  title: "Theme idea",
  content: "Curiosity vs fear.",
  noteType: "theme",
}

export const fxRelation: SemanticRelation = {
  id: "rel_1",
  bookId: "book_1",
  sourceId: "char_1",
  sourceType: "character",
  targetId: "loc_1",
  targetType: "location",
  type: "lives_in",
  inverseType: "houses",
  description: null,
  strength: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

export const fxStats: WritingStats = {
  currentStreak: 3,
  longestStreak: 10,
  totalWords: 12345,
  todayWords: 500,
}

export const fxQuota: QuotaInfo = {
  tokenQuota: 100000,
  tokenUsed: 25000,
  tokenBonus: 5000,
  remaining: 80000,
}

export const fxVectorCheck: VectorCheckResponse = {
  conflicts: [],
  issues: [],
  durationMs: 42,
}

export const fxGuardianRun: GuardianRunResponse = {
  reports: [
    {
      layer: 1,
      issues: [],
      detectorTimingsMs: { "l1.name-typo": 2 },
      errors: [],
      durationMs: 3,
    },
    {
      layer: 2,
      issues: [
        {
          id: "i1",
          severity: "warning",
          category: "style",
          title: "Cliche",
          description: "heart of gold",
          fingerprint: "f1",
          timestamp: 1,
          detector: "l2.cliche",
          textPosition: { start: 5, end: 18 },
        },
      ],
      errors: [{ detectorId: "l2.proofread", message: "provider timeout" }],
      durationMs: 40,
      truncation: { analyzedChars: 6000, totalChars: 9000 },
    },
  ],
  issues: [
    {
      id: "i1",
      severity: "warning",
      category: "style",
      title: "Cliche",
      description: "heart of gold",
      fingerprint: "f1",
      timestamp: 1,
      detector: "l2.cliche",
      textPosition: { start: 5, end: 18 },
    },
  ],
  durationMs: 43,
  traceId: "run-abc-1234",
  usage: { totalTokens: 0 },
}

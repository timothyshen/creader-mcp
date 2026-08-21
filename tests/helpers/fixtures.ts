import type {
  Act,
  Book,
  Chapter,
  Character,
  FactExtractionResult,
  GenerationPlan,
  Location,
  TimelineEvent,
  Note,
  Scene,
  SemanticRelation,
  Volume,
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

export const fxVolume: Volume = {
  id: "vol_1",
  bookId: "book_1",
  title: "Volume One",
  description: "The beginning.",
  synopsis: null,
  notes: null,
  orderIndex: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  _count: { chapters: 2 },
}

export const fxAct: Act = {
  id: "act_1",
  bookId: "book_1",
  name: "Act One",
  description: "Setup.",
  tags: [],
  alternateLabel: null,
  volumeId: "vol_1",
  orderIndex: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

export const fxScene: Scene = {
  id: "scene_1",
  bookId: "book_1",
  title: "Opening",
  synopsis: "Alice wakes.",
  orderIndex: 0,
  status: "draft",
  actId: "act_1",
  chapterId: "chap_1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

export const fxFactResult: FactExtractionResult = {
  chapterId: "chap_1",
  factUpdates: [
    {
      entityId: "char_1",
      entityTitle: "Alice",
      entityType: "character",
      updateType: "status_change",
      fieldPath: "description",
      proposedValue: "Now queen of Wonderland",
      confidence: 0.9,
      textEvidence: "they crowned her that morning",
      chapterId: "chap_1",
      status: "pending",
    },
  ],
  truncated: false,
  extractedAt: "2026-08-21T00:00:00Z",
}

export const fxPlan: GenerationPlan = {
  sceneBreakdown: [
    { order: 1, purpose: "Introduce the threat", requiredEntities: ["Alice"], emotionalBeat: "unease" },
    { order: 2, purpose: "Force a choice", requiredEntities: ["Alice", "Wonderland"], emotionalBeat: "resolve" },
  ],
  consistencyConstraints: ["Alice cannot yet know the Queen's secret"],
  styleDirectives: ["close third person", "short sentences in action"],
  wordTarget: 1800,
  creativePrompt: "Alice returns to a Wonderland that no longer remembers her.",
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

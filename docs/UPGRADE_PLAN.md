# creader-mcp Upgrade Plan

**Created**: 2026-04-22
**Current version**: v1.0.2 (18 tools)
**Target**: v2.0.0 with 6 prioritized improvements landed across 4 releases

---

## Context

Gap analysis between `creader-editor` (v1.0.0) and `creader-mcp` (v1.0.2) identified 6 priority upgrades:

1. Add deep guardian tools (`analyze`, `vector-check`, `proofread`) — highest per-tool value
2. Add volume/act/scene read tools — so MCP can navigate v1.0 structure
3. Add `delete_chapter` + reorder — close CRUD asymmetry
4. Collapse knowledge tools into `create_entity`/`update_entity`/`delete_entity` with type discriminator — reduces 12 tools to 3
5. Add `extract-facts` + `orchestrate` — unlocks toolchain from MCP clients
6. Chat/streaming bridge — separate architectural effort (deferred)

---

## Release Sequencing

```
v1.0.2 (current)
  │
  ├─► v1.1.0  Deep Guardian               [additive, 1-2 days]
  │
  ├─► v1.2.0  Structural reads            [additive, 2-3 days]
  │           + Chapter delete/reorder
  │           + extract-facts / orchestrate
  │
  ├─► v1.3.0  Deprecation markers         [non-breaking, 0.5 day]
  │           (mark old knowledge tools deprecated in descriptions)
  │
  └─► v2.0.0  Knowledge consolidation     [BREAKING, 2-3 days]
              + Timeline event unification
```

Deferred: **v2.1+** — chat/streaming bridge (separate architectural RFC).

---

## v1.1.0 — Deep Guardian (Priority #1)

**Scope**: 3 new tools, 0 changes.

| Tool | Wraps | Hint |
|---|---|---|
| `analyze_book` | `POST /api/books/[id]/guardian/analyze` | `openWorldHint: true` |
| `vector_check` | `POST /api/books/[id]/guardian/vector-check` | `openWorldHint: true` |
| `proofread` | `POST /api/books/[id]/guardian/proofread` | `openWorldHint: true` |

**Shape to verify first**: request bodies and response schemas of each guardian route — document in `src/tools/ai.ts` JSDoc.

**Acceptance**: MCP client can run `analyze_book({bookId})`, get structured issues; token cost comparable to `consistency_check`.

**Risks**: These AI routes likely take longer than 30s — confirm SDK timeout behavior, consider async/polling if needed.

---

## v1.2.0 — Structural Reads + CRUD Symmetry (Priorities #2, #3, #5)

**Scope**: 8 new tools, 0 changes.

### Structural reads (priority #2)

| Tool | Wraps |
|---|---|
| `list_volumes` | `GET /api/books/[id]/volumes` |
| `list_acts` | `GET /api/books/[id]/acts` |
| `list_scenes` | `GET /api/books/[id]/scenes` |

_Read-only for this release. Write ops for volume/act/scene deferred to v2.1+ once we see usage patterns._

### Chapter CRUD (priority #3)

| Tool | Wraps |
|---|---|
| `delete_chapter` | `DELETE /api/chapters/[id]` (verify route exists) |
| `reorder_chapters` | Likely a new editor endpoint — **may block on editor PR** |

**Check first**: does the editor have a chapter reorder API? If no, two options:

- (a) Add it in creader-editor first (separate PR)
- (b) Emulate via N × `update_chapter` with `order` field — ugly, but unblocks MCP

### AI toolchain (priority #5)

| Tool | Wraps |
|---|---|
| `extract_facts` | `POST /api/ai/extract-facts` |
| `orchestrate` | `POST /api/ai/orchestrate` |

> **Outcome (v1.4.0):** both shipped in v1.2.0, and `extract_facts` was then
> removed. The product retired the whole fact-delta chain on 2026-08-27, route
> included, so the tool had no endpoint left. `orchestrate` stands. This
> document is the plan as written at v1.0.2 and is left as it was — the note is
> here so nobody reads the table above as a live mapping.

**Acceptance**: Claude Desktop can navigate a v1.0 story's full hierarchy (book → volume → act → scene → chapter) via read tools.

---

## v1.3.0 — Deprecation Bridge (Non-Breaking)

**Scope**: Descriptions only. Zero code changes.

Mark these tools deprecated in their description strings so clients see warnings:

- `create_character`, `create_location`, `create_event`, `create_note`
- `update_character`, `update_location`, `update_event`, `update_note`
- `delete_character`, `delete_location`, `delete_event`, `delete_note`

Example:

```ts
"[DEPRECATED — use create_entity with type='character' in v2.0] Create a character..."
```

**Purpose**: Give any existing MCP clients one version of warning before breaking.

---

## v2.0.0 — Knowledge Consolidation (Priority #4) — BREAKING

**Scope**: 12 tools → 3 tools. Major version bump.

### New unified tools

```ts
create_entity({
  bookId: string,
  type: 'character' | 'location' | 'event' | 'note' | 'timeline_event',
  name?: string,
  data: { /* type-specific fields validated by zod discriminated union */ }
})

update_entity({
  entityId: string,
  type: 'character' | 'location' | 'event' | 'note' | 'timeline_event',
  patch: { /* type-specific */ }
})

delete_entity({
  entityId: string,
  type: 'character' | 'location' | 'event' | 'note' | 'timeline_event'
})
```

### Implementation pattern

- Use zod **discriminated union** on `type` — each variant declares its own `data` schema
- Internal dispatcher routes to the correct editor endpoint
- Response shape: normalized `{ id, type, ... }` regardless of underlying entity

### Timeline event unification

Currently `create_event` maps to generic "event" but editor has dedicated `timeline-events`. In v2.0, split these clearly:

- `type: 'event'` → generic knowledge event
- `type: 'timeline_event'` → timeline-events endpoint (has date, duration, etc.)

### Migration guide (ship in README + CHANGELOG)

| v1.x tool | v2.0 equivalent |
|---|---|
| `create_character(name, ...)` | `create_entity({type: 'character', name, data})` |
| `update_location(id, ...)` | `update_entity({entityId: id, type: 'location', patch})` |
| ...etc | |

### Breaking acceptance criteria

- [ ] All 12 legacy tools removed
- [ ] 3 unified tools cover 100% of prior capability (verified by migration table)
- [ ] README updated with migration guide
- [ ] Server `instructions` updated to mention unified tools
- [ ] Test: each type × each operation × round-trip against live editor

---

## v2.1+ — Deferred Architectural Work (Priority #6)

Chat / streaming bridge. Requires separate design doc covering:

- How MCP's request/response model maps to streaming chat
- Session persistence (MCP is stateless per-call, chat needs context)
- Token budgeting across a session
- Whether to expose `ChatSession` entity as first-class MCP resources

Not in scope for this upgrade cycle.

---

## Cross-Cutting Work (applies to every release)

1. **Tool count in README** — currently says "16 tools", needs updating per release
2. **SKILL.md sync** — `openclaw/SKILL.md` must list new tools
3. **Server `instructions` string** in `src/index.ts` — update per release to reflect new tool inventory
4. **Changelog entries** — conventional commits, one per tool group
5. **End-to-end smoke test** — add a `scripts/smoke.ts` that calls every tool once against a test book; run before each release

---

## Open Questions Before Starting

1. **Chapter reorder API** — does editor expose this? If not, land editor endpoint first, then MCP tool.
2. **Guardian response shapes** — are `analyze`/`vector-check`/`proofread` responses stable enough to surface raw, or do we want a normalization layer in MCP?
3. **`@creader/mcp-server` name change** — the uncommitted `package.json` diff renames the package. Will v1.1.0 be the first publish under the new scope? If so, this is a coordination step (set up npm org, handle redirect from old name).
4. **Editor version pinning** — MCP depends on editor API shape. Should we declare `"engines": { "creader": ">=1.0.0" }` or at least document compatibility in README?

---

## Current Feature Inventory (baseline, v1.0.2)

**Books** (4): `list_books`, `get_book`, `create_book`, `get_book_context`
**Chapters** (4): `list_chapters`, `get_chapter`, `create_chapter`, `update_chapter`
**Knowledge** (13): `search_knowledge`, `list_knowledge`, create/update/delete × (character, location, event, note), `set_visibility`
**Relations** (4): list/create/update/delete_relation
**Stats** (2): `get_writing_stats`, `get_quota`
**AI** (2): `generate_outline`, `consistency_check`

Total: 29 tool registrations (README says 16 — stale).

---

## Gap Matrix vs creader-editor v1.0.0

### Core entity gaps (CRUD missing)

| Entity | Editor route | MCP status |
|---|---|---|
| Volumes | `/books/[id]/volumes` | missing |
| Acts | `/books/[id]/acts` | missing |
| Scenes | `/books/[id]/scenes` | missing |
| Timeline events | dedicated `/timeline-events` | partial (generic `_event` only) |
| Canvas nodes | `/books/[id]/canvas-nodes` | missing |
| Style references | `/books/[id]/style-references` | missing |
| Semantic relations | top-level + per-book | partial |
| Conflicts | `/books/[id]/conflicts` | missing |
| Linked knowledge | `/books/[id]/linked-knowledge` | missing |

### Chapter ops gaps

- `delete_chapter` missing
- reorder / move chapter missing
- Chapter search within book (`/books/[id]/search`) missing

### AI feature gaps

Editor has 11 AI endpoints; MCP exposes 2.

| Editor AI route | MCP |
|---|---|
| `/api/ai` (main generation) | missing |
| `/api/ai/inline` (style-anchored) | missing |
| `/api/ai/generate-prose` | missing |
| `/api/ai/check-quality` | missing |
| `/api/ai/extract-facts` | missing |
| `/api/ai/detect-chapters` | missing |
| `/api/ai/orchestrate` (toolchain) | missing |
| `/api/ai/structure-outline` | missing |
| `/api/chat` (streaming) | missing |
| `/api/books/[id]/guardian/analyze` (deep) | missing (only `quick-check`) |
| `/api/books/[id]/guardian/vector-check` | missing |
| `/api/books/[id]/guardian/proofread` | missing |
| `/api/scratch/transform` | missing |
| `/api/onboarding/parse` + `quick-generate` | partial (`generate-outline` only) |

### Peripheral (lower priority, not in upgrade scope)

- Publishing: `/publish/[username]`, articles, favorites, feed — not in MCP
- Prompts: template/variant management — not exposed
- Chat sessions — not exposed
- User/profile, subscriptions, upload — intentionally out of scope

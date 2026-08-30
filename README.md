# @creader/mcp-server

> **Turn any AI assistant into a co-author.** This MCP server connects [Creader](https://creader.io) — a writing platform with built-in knowledge management — to Claude, GPT, and any MCP-compatible client. AI agents can read your world, write chapters, track characters, and manage the semantic relationships between every entity in your story.

## Why This Exists

Writers using AI assistants face a fundamental problem: **the AI has no memory of your story world.** Every conversation starts from zero. Character names get mixed up, plot threads are forgotten, locations contradict each other.

Creader solves this with a structured knowledge base (characters, locations, events, notes, and semantic relations). This MCP server exposes that entire knowledge graph to AI agents — so they can:

- **Read** your full story context in one call before writing
- **Create and manage** characters, locations, timeline events, and notes
- **Build a semantic knowledge graph** — define relationships like "allies_with", "located_in", "caused_by" between any entities
- **Write chapters** that are grounded in your actual world, not hallucinated

The result: AI-assisted writing that stays consistent across 100+ chapters and complex story worlds.

## Architecture

```
┌─────────────────┐     MCP (stdio)     ┌──────────────────┐     HTTPS     ┌─────────────┐
│  Claude / GPT   │ ◄────────────────► │  creader-mcp     │ ◄──────────► │  Creader API │
│  or any MCP     │     39 tools        │  (this server)   │   REST+JSON  │  creader.io  │
│  client         │                     │                  │              │              │
└─────────────────┘                     │  - TTL cache     │              │  - Books     │
                                        │  - Error recovery│              │  - Chapters  │
                                        │  - Tool hints    │              │  - Knowledge │
                                        │  - Batched reads │              │  - Relations │
                                        └──────────────────┘              └─────────────┘
```

## Quick Start

```bash
npx -y @creader/mcp-server
```

Requires a `CREADER_API_KEY` environment variable. Create one at [creader.io](https://creader.io) under **Settings > API Keys** — the full tool set needs the `read`, `write` and `ai` scopes.

Published on [npm](https://www.npmjs.com/package/@creader/mcp-server) and in the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.creader/mcp-server`.

## Configuration

### Claude Desktop / OpenClaw

Add to your MCP config:

```json
{
  "mcpServers": {
    "creader": {
      "command": "npx",
      "args": ["-y", "@creader/mcp-server"],
      "env": {
        "CREADER_API_KEY": "cr_live_your_key_here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add creader --env CREADER_API_KEY=cr_live_your_key_here -- npx -y @creader/mcp-server
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CREADER_API_KEY` | Yes | — | Your Creader API key (`cr_live_...`) |
| `CREADER_API_URL` | No | `https://creader.io` | Creader API base URL |

## Tools (41)

### Books (4)

| Tool | Description |
|------|-------------|
| `list_books` | List all books |
| `get_book` | Get book details |
| `create_book` | Create a new book (novel, autobiography, worldbook, encyclopedia) |
| `get_book_context` | Get full book context in one call — metadata, chapters, characters, locations, events |

### Chapters (7)

| Tool | Description |
|------|-------------|
| `list_chapters` | List chapters in a book (titles + word counts, no content) |
| `get_chapter` | Read a chapter's full content, plus the `baseContentHash` to pass back when writing |
| `create_chapter` | Create a new chapter |
| `update_chapter` | Write or update a chapter. Prose writes carry a `baseContentHash` and are rejected as a conflict — never silently overwritten — if the editor changed the chapter meanwhile |
| `delete_chapter` | Permanently delete a chapter (hard delete; its scenes go with it, later chapters are renumbered). Needs the `delete` API-key scope; book owner only |
| `search_book` | Search the book's **prose** and get back matching chapters with snippets, character offsets and chapter ids. `text` (exact substring, CJK-safe, exhaustive) or `semantic` (meaning-based, indexed chapters only). Not the same as `search_knowledge`, which searches entity records |
| `reorder_chapters` | Reorder a book's chapters. Takes the complete chapter-ID list in the new order; writes only the positions that changed. The server has no atomic reorder, so an interrupted run reports exactly which chapters moved and is safe to re-run |

### Structure (3)

Creader organises a book as **volume → act → chapter → scene**. These read-only
tools expose the levels around chapters, so an agent can navigate the whole
spine (acts carry their `volumeId`; scenes carry their `chapterId`/`actId`).
Structure writes stay in the editor for now.

| Tool | Description |
|------|-------------|
| `list_volumes` | List a book's volumes with chapter counts |
| `list_acts` | List a book's acts and which volume each belongs to |
| `list_scenes` | List a book's scenes with their parent chapter/act, status, and synopsis |

### Knowledge Base (14)

> **Deprecation notice (v1.3.0):** the 12 per-type CRUD tools below are
> deprecated. v2.0.0 consolidates them into `create_entity` / `update_entity` /
> `delete_entity` with a `type` discriminator (see
> [docs/UPGRADE_PLAN.md](docs/UPGRADE_PLAN.md)). They remain **fully
> functional throughout 1.x** — keep using them until v2.0.0 ships, then
> migrate with the table in that release's notes.

| Tool | Description |
|------|-------------|
| `search_knowledge` | Substring search across characters, locations, events, and notes (case-insensitive, CJK-safe; queries must be 2+ characters). For the prose itself, use `search_book` |
| `list_knowledge` | List characters, locations, or events in a book |
| `create_character` *(deprecated)* | Create a character (protagonist, antagonist, supporting, minor) |
| `create_location` *(deprecated)* | Create a location |
| `create_event` *(deprecated)* | Create a timeline event |
| `create_note` *(deprecated)* | Create a note (worldbuilding, research, note, general) or a world constraint (`rule` / `prohibition`) — constraints are force-injected into every AI prompt for the book and capped per plan |
| `update_character` *(deprecated)* | Update a character's fields |
| `update_location` *(deprecated)* | Update a location's fields |
| `update_event` *(deprecated)* | Update a timeline event's fields |
| `update_note` *(deprecated)* | Update a note's fields |
| `delete_character` *(deprecated)* | Delete a character |
| `delete_location` *(deprecated)* | Delete a location |
| `delete_event` *(deprecated)* | Delete a timeline event |
| `delete_note` *(deprecated)* | Delete a note |

### Semantic Relations (4)

| Tool | Description |
|------|-------------|
| `list_relations` | List semantic relations (entity-to-entity relationships) in a book |
| `create_relation` | Create a relation between two entities (e.g. allies_with, located_in) |
| `update_relation` | Update a relation's type, description, or strength |
| `delete_relation` | Delete a relation |

### AI (6)

| Tool | Description |
|------|-------------|
| `generate_outline` | Generate a story outline with structured chapter suggestions from a premise |
| `guardian_check` | Run the 5-layer narrative Guardian on one chapter. Choose `layers` and a `costBudget`; returns `GuardianIssue`s with char-offset `textPosition` (and `suggestedFix` on layer-2 proofreading), plus a per-layer roll-up of detector errors and truncation. **Saves its findings to the book by default** — pass `persist: false` for a look that leaves no trace |
| `vector_check` | Cross-book semantic conflict detection via embeddings. Detects duplicates, character contradictions, timeline inconsistencies, and location mismatches. Operates on already-indexed content |
| `list_guardian_issues` | List the issues currently OPEN on a book — the same notes the author sees in the Guardian panel, whoever created them. Optionally narrowed to one chapter |
| `resolve_guardian_issue` | Close an issue (`RESOLVED` / `DISMISSED`) or reopen it, addressed by `fingerprint`. Dismissal also feeds detector confidence |
| `orchestrate` | Turn a writing intent (plus optional outline and book context) into a structured generation plan: scene breakdown, consistency constraints, style directives, word target, creative prompt. Spends token quota; needs the `ai` scope |

#### Guardian layers and cost

`guardian_check` fronts Creader's single Guardian dispatcher. It replaced
`consistency_check`, `analyze_book` and `proofread`, whose routes were deleted
from the product on 2026-05-01 — all three had been returning 404 to every
caller since.

`extract_facts` went the same way in v1.4.0: the product retired the whole
fact-delta chain on 2026-08-27, so `/api/ai/extract-facts` no longer exists.
Nothing replaces it under that name — entity discovery from prose is a
different contract (a review queue of proposed *new* entities and field
updates) and will arrive as its own tool.

#### Findings that stay found

Until v1.5.0 a `guardian_check` was a private event: the dispatcher accepted an
API key but every route that *stores* a `GuardianIssue` refused one, so an MCP
client could run the full 5-layer pass and the author would open their Guardian
panel to an empty list. Story Health, which counts exactly those stored rows,
never moved either.

Creader opened those routes to API keys on 2026-08-29 (`read` to list, `write`
to save or transition). So a run now lands where the author works, and the two
sides share one queue: `list_guardian_issues` shows what the author flagged in
the editor, and an issue you resolve disappears from their panel. Persisting is
best-effort — if the key lacks `write`, the findings still come back with the
refusal attached rather than being thrown away.

| Layer | What it checks |
|-------|----------------|
| 1 | Consistency — dead characters, name typos, timeline and entity contradictions |
| 2 | Style & Prose — cliche, weak verbs, dialogue tags, POV leak, proofreading |
| 3 | Analysis — character arcs, causal chains, literary quality |
| 4 | Chapter & Suspense — opening quality, suspense, thread coverage, cliffhangers |
| 5 | Plot Structure — three-act shape, inciting incident, midpoint, foreshadowing |

`costBudget` is an inclusive ceiling on how expensive a detector may be:

- `local` (default) — no model calls, no token quota, no `ai` scope needed.
  Reaches only the rule-based detectors, so **layer 3 returns nothing** and
  layers 1/2/4/5 return only their local subset (cliche and repetition yes,
  proofreading and POV leak no).
- `api-light` / `vector` / `api-heavy` — progressively deeper. `api-heavy` is
  the full pass; it spends the account's token quota and requires an API key
  minted with the `ai` scope.

### Stats & Publishing (3)

| Tool | Description |
|------|-------------|
| `get_writing_stats` | Writing streak, daily/weekly word progress against goals, and total writing days |
| `get_quota` | Check remaining AI token quota |
| `set_visibility` | Set book visibility (PRIVATE, LINK_ONLY, PUBLIC) |

## Best Practices — What Goes Where

New to Creader? This guide explains **which tool to use for each type of content**, so your story data stays organized and renders correctly on [creader.io](https://creader.io).

### Content Model Overview

```
Book
├── Volumes           ← Top-level grouping (list_volumes)
│   └── Acts          ← Group chapters within a volume (list_acts)
├── Chapters          ← Actual prose, outlines, and story content
│   └── Scenes        ← Beats within a chapter (list_scenes)
├── Knowledge Base
│   ├── Characters    ← People, creatures, named entities in your world
│   ├── Locations     ← Places — cities, rooms, planets, forests
│   ├── Events        ← Timeline entries — plot points, turning points, backstory
│   └── Notes         ← Worldbuilding rules, research, agent-to-agent messages
└── Relations         ← Connections between any two entities above
```

### Where to Put Your Content

| Content | Use This | NOT This | Why |
|---------|----------|----------|-----|
| **Chapter text / prose** | `create_chapter` / `update_chapter` | Notes or Knowledge Base | Chapters render as readable pages on creader.io |
| **Story outline** | `generate_outline` → then `create_chapter` per chapter | Knowledge Base notes | Outlines are chapter-level structure — store them as chapters so they show up in the chapter list |
| **Character profiles** | `create_character` | Notes | Characters have structured fields (role, age, tags) and appear in the World Foundation panel on creader.io |
| **Locations / settings** | `create_location` | Notes | Locations have type fields (city, forest, castle) and appear in World Foundation |
| **Timeline / plot events** | `create_event` | Notes or chapters | Events have timestamps, importance levels, and consequences — they power the timeline view on creader.io |
| **World rules / magic systems** | `create_note` (type: `worldbuilding`) | Characters or Events | Notes are for unstructured world lore that doesn't fit other categories |
| **Research / reference material** | `create_note` (type: `research`) | Events | Notes keep research separate from story content |
| **Agent-to-agent messages** | `create_note` (type: `note`) | — | When multiple agents collaborate, use notes as a message board |
| **Character relationships** | `create_relation` | Character description field | Relations are queryable and have strength scores — don't bury relationships in description text |
| **Location hierarchy** | `create_relation` (type: `contains` / `located_in`) | Location description | "City contains District" is a relation, not a description |

### Recommended Workflow

**Starting a new book:**
```
1. create_book (pick the right type: novel, worldbook, etc.)
2. Create your world foundation FIRST:
   - create_character × N (protagonist, antagonist, supporting cast)
   - create_location × N (key settings)
   - create_event × N (major plot points on the timeline)
   - create_relation × N (how characters/locations/events connect)
3. generate_outline → review → create_chapter for each outline item
4. get_book_context → write chapters with full world awareness
```

**Continuing an existing book:**
```
1. get_book_context → load everything into memory
2. list_relations → understand entity connections
3. Write / update chapters
4. Update knowledge base as the story evolves
```

**Multi-agent collaboration:**
```
Agent A (World Builder): creates characters, locations, events, relations
Agent A: create_note("Outline complete, ready for writing", type: "note")
Agent B (Writer): search_knowledge("ready for writing") → get_book_context → write chapters
Agent B: create_note("Chapter 1 draft done, needs review", type: "note")
```

### How MCP Data Appears on Creader.io

| MCP Tool | Creader Website Location |
|----------|------------------------|
| Chapters | **Chapter list** — readable as story pages |
| Characters | **World Foundation → Characters** panel |
| Locations | **World Foundation → Locations** panel |
| Events | **World Foundation → Timeline** view |
| Notes | **World Foundation → Notes** section |
| Relations | **World Foundation → Relations** graph |
| Book visibility | Controls whether the book is publicly accessible |

> **Tip:** Content created via MCP is the same data shown on creader.io. If something looks wrong on the website, check that you stored it in the right place using the table above.

## Key Design Decisions

### Batch Context Loading
`get_book_context` fires 5 parallel API requests and returns the full story world in a single tool call. This is critical for AI writing — the agent needs characters, locations, events, and chapter structure *before* it can write a coherent paragraph.

### Semantic Knowledge Graph
Relations aren't just labels — they have **types** (`allies_with`, `located_in`, `caused`), **inverse types** (`has_ally`, `contains`), and **strength scores** (1–10). This lets agents reason about narrative structure: "Who is allied with the protagonist?", "What events caused the current conflict?", "Which characters are in this location?"

### TTL Cache
The MCP server is a long-running process. Claude may call `get_book_context` on every turn. The cache stores GET responses for 60 seconds and clears automatically on any write, so agents always see fresh data without hammering the API.

### Token-Efficient Responses
Tool responses use concise text format (`- Character Name (protagonist) id:abc123`) instead of raw JSON. This reduces token consumption and lets the LLM process results faster.

### MCP Best Practices
- **Tool annotations** — `readOnlyHint`, `destructiveHint`, `openWorldHint` on every tool, so clients can make informed decisions about tool execution
- **Server instructions** — guides the LLM on optimal tool usage patterns during MCP handshake
- **Error recovery** — errors returned with `isError` flag so the LLM can self-correct without crashing the conversation

## Use Cases

### Multi-Agent Collaborative Writing

Agent A builds the world, Agent B writes chapters — both connected to the same Creader book:

```
Agent A: create_book → create_character × 3 → create_location × 2 → create_event × 3
         create_relation (character allies_with character)
         create_relation (character located_in location)
Agent B: get_book_context → list_relations → get_chapter → update_chapter × N
Agent A: create_note (feedback for Agent B)
Agent B: search_knowledge ("feedback") → update_chapter (revise)
```

### Single-Agent Writing with World Consistency

```
You: "Write chapter 1 of my fantasy novel"

Claude: get_book_context → get full story world
        list_relations → understand character dynamics
        get_chapter (ch1) → read existing content
        update_chapter (ch1) → write the chapter
```

### Knowledge Graph Construction

```
You: "Build out the world for my detective novel"

Claude: create_character ("Detective Hayes", protagonist)
        create_character ("Mayor Chen", antagonist)
        create_location ("Harborview", city)
        create_relation (Hayes, located_in, Harborview)
        create_relation (Hayes, investigates, Chen, inverse: investigated_by, strength: 8)
        create_event ("Murder at the docks", plot, major)
```

## Development

```bash
git clone https://github.com/timothyshen/creader-mcp
cd creader-mcp
pnpm install
pnpm build
```

### Local Testing

```bash
CREADER_API_KEY=cr_live_... CREADER_API_URL=http://localhost:3000 node dist/index.js
```

### Tests

The project ships with a unit suite (mocked `fetch`) and an integration suite (real Creader API, opt-in).

```bash
pnpm test                # unit tests only — fast, no network
pnpm test:watch          # unit tests in watch mode
pnpm test:coverage       # unit tests + v8 coverage report (70% threshold)
pnpm test:integration    # integration tests — auto-skipped without a token
pnpm test:all            # everything
```

Integration tests are read-only and gated on `CREADER_API_TOKEN`. Without the token they skip silently, so CI without the secret stays green.

```bash
export CREADER_API_TOKEN=cr_live_...
export CREADER_API_URL=https://creader.io   # optional override
pnpm test:integration
```

Coverage reports are written to `coverage/` (HTML at `coverage/index.html`, plus `lcov.info` for CI tooling).

## License

MIT

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
│  or any MCP     │     32 tools        │  (this server)   │   REST+JSON  │  creader.io  │
│  client         │                     │                  │              │              │
└─────────────────┘                     │  - TTL cache     │              │  - Books     │
                                        │  - Error recovery│              │  - Chapters  │
                                        │  - Tool hints    │              │  - Knowledge │
                                        │  - Batched reads │              │  - Relations │
                                        └──────────────────┘              └─────────────┘
```

## Quick Start

```bash
npx github:timothyshen/creader-mcp
```

Requires `CREADER_API_KEY` environment variable. Get your API key from Creader Settings > API Keys.

## Configuration

### Claude Desktop / OpenClaw

Add to your MCP config:

```json
{
  "mcpServers": {
    "creader": {
      "command": "npx",
      "args": ["github:timothyshen/creader-mcp"],
      "env": {
        "CREADER_API_KEY": "cr_live_your_key_here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add creader -- npx github:timothyshen/creader-mcp
```

Then set your API key in the environment or `.env` file.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CREADER_API_KEY` | Yes | — | Your Creader API key (`cr_live_...`) |
| `CREADER_API_URL` | No | `https://creader.io` | Creader API base URL |

## Tools (32)

### Books (4)

| Tool | Description |
|------|-------------|
| `list_books` | List all books |
| `get_book` | Get book details |
| `create_book` | Create a new book (novel, autobiography, worldbook, encyclopedia) |
| `get_book_context` | Get full book context in one call — metadata, chapters, characters, locations, events |

### Chapters (4)

| Tool | Description |
|------|-------------|
| `list_chapters` | List chapters in a book (titles + word counts, no content) |
| `get_chapter` | Read a chapter's full content |
| `create_chapter` | Create a new chapter |
| `update_chapter` | Write or update a chapter |

### Knowledge Base (14)

| Tool | Description |
|------|-------------|
| `search_knowledge` | Search across characters, locations, events, and notes |
| `list_knowledge` | List characters, locations, or events in a book |
| `create_character` | Create a character (protagonist, antagonist, supporting, minor) |
| `create_location` | Create a location |
| `create_event` | Create a timeline event |
| `create_note` | Create a note (worldbuilding, research, general) |
| `update_character` | Update a character's fields |
| `update_location` | Update a location's fields |
| `update_event` | Update a timeline event's fields |
| `update_note` | Update a note's fields |
| `delete_character` | Delete a character |
| `delete_location` | Delete a location |
| `delete_event` | Delete a timeline event |
| `delete_note` | Delete a note |

### Semantic Relations (4)

| Tool | Description |
|------|-------------|
| `list_relations` | List semantic relations (entity-to-entity relationships) in a book |
| `create_relation` | Create a relation between two entities (e.g. allies_with, located_in) |
| `update_relation` | Update a relation's type, description, or strength |
| `delete_relation` | Delete a relation |

### AI (5)

| Tool | Description |
|------|-------------|
| `generate_outline` | Generate a story outline with structured chapter suggestions from a premise |
| `consistency_check` | Fast, quota-cheap consistency scan across a book |
| `analyze_book` | Deep Guardian analysis on a chapter: vector-aware retrieval + AI finds character, plot, timeline, and worldbuilding issues. Returns up to 10 structured `GuardianIssue`s with severity, evidence, and suggestion |
| `vector_check` | Cross-book semantic conflict detection via embeddings. Detects duplicates, character contradictions, timeline inconsistencies, and location mismatches. Operates on already-indexed content |
| `proofread` | Publishing-grade proofread of a chapter — punctuation, typo, grammar, formatting issues with char-offset `textPosition` and `suggestedFix` |

### Stats & Publishing (3)

| Tool | Description |
|------|-------------|
| `get_writing_stats` | Writing streak and word counts |
| `get_quota` | Check remaining AI token quota |
| `set_visibility` | Set book visibility (PRIVATE, LINK_ONLY, PUBLIC) |

## Best Practices — What Goes Where

New to Creader? This guide explains **which tool to use for each type of content**, so your story data stays organized and renders correctly on [creader.io](https://creader.io).

### Content Model Overview

```
Book
├── Chapters          ← Actual prose, outlines, and story content
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

## License

MIT

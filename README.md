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
│  or any MCP     │     29 tools        │  (this server)   │   REST+JSON  │  creader.io  │
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

## Tools (29)

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

### Stats & Publishing (3)

| Tool | Description |
|------|-------------|
| `get_writing_stats` | Writing streak and word counts |
| `get_quota` | Check remaining AI token quota |
| `set_visibility` | Set book visibility (PRIVATE, LINK_ONLY, PUBLIC) |

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

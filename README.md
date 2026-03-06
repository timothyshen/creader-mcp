# @creader/mcp-server

MCP server for [Creader](https://creader.io) — access your stories, knowledge base, and writing tools from any MCP-compatible client.

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

## Tools (24)

### Books

| Tool | Description |
|------|-------------|
| `list_books` | List all books |
| `get_book` | Get book details |
| `create_book` | Create a new book (novel, autobiography, worldbook, encyclopedia) |
| `get_book_context` | Get full book context in one call — metadata, chapters, characters, locations, events |

### Chapters

| Tool | Description |
|------|-------------|
| `list_chapters` | List chapters in a book (titles + word counts, no content) |
| `get_chapter` | Read a chapter's full content |
| `update_chapter` | Write or update a chapter |

### Knowledge Base

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

### Stats & Publishing

| Tool | Description |
|------|-------------|
| `get_writing_stats` | Writing streak and word counts |
| `get_quota` | Check remaining AI token quota |
| `set_visibility` | Set book visibility (PRIVATE, LINK_ONLY, PUBLIC) |

## Features

- **Batch context loading** — `get_book_context` fetches everything in one call (5 parallel API requests), eliminating multiple round trips
- **Token-efficient responses** — concise text format instead of verbose JSON
- **TTL caching** — GET responses cached for 60s, automatically cleared on writes
- **Error handling** — errors returned with `isError` flag so the LLM can self-correct
- **Tool annotations** — `readOnlyHint`, `destructiveHint`, `idempotentHint` on all tools
- **Server instructions** — guides the LLM on optimal tool usage during MCP handshake

## Use Cases

### Collaborative Writing

Agent A builds the world, Agent B writes chapters — both connected to the same Creader book:

```
Agent A: create_book → create_character × 3 → create_location × 2 → create_event × 3
Agent B: get_book_context → get_chapter → update_chapter × N
Agent A: create_note (feedback for Agent B)
Agent B: search_knowledge ("feedback") → update_chapter (revise)
```

### Single-Agent Writing

```
You: "Write chapter 1 of my fantasy novel"

Claude: get_book_context → get full story world
        get_chapter (ch1) → read existing content
        update_chapter (ch1) → write the chapter
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

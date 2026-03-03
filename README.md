# @creader/mcp-server

MCP server for [Creader](https://creader.io) — access your stories, knowledge base, and AI tools from any MCP-compatible client.

## Quick Start

```bash
npx @creader/mcp-server
```

Requires `CREADER_API_KEY` environment variable. Get your API key from Creader Settings > API Keys.

## Configuration

### Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "creader": {
      "command": "npx",
      "args": ["@creader/mcp-server"],
      "env": {
        "CREADER_API_KEY": "cr_live_your_key_here"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CREADER_API_KEY` | Yes | — | Your Creader API key (`cr_live_...`) |
| `CREADER_API_URL` | No | `https://creader.io` | Creader API base URL |

## Tools (20)

### Books

| Tool | Description |
|------|-------------|
| `list_books` | List all books in your library |
| `get_book` | Get book details by ID |
| `create_book` | Create a new book (novel, autobiography, worldbook, encyclopedia) |

### Chapters

| Tool | Description |
|------|-------------|
| `list_chapters` | List chapters in a book (titles + word counts) |
| `get_chapter` | Read a chapter's full content |
| `update_chapter` | Write or update a chapter |

### Knowledge Base

| Tool | Description |
|------|-------------|
| `search_knowledge` | Full-text search across characters, locations, events, notes |
| `list_characters` | List all characters in a book |
| `create_character` | Create a character (protagonist, antagonist, supporting, minor) |
| `list_locations` | List all locations in a book |
| `create_location` | Create a location |
| `list_events` | List all timeline events in a book |
| `create_event` | Create a timeline event |
| `create_note` | Create a note (worldbuilding, research, general) |

### AI

| Tool | Description |
|------|-------------|
| `chat` | Chat with AI about a story (knowledge-base-aware) |
| `generate_outline` | Generate a story outline from a premise |
| `consistency_check` | Check a book for contradictions |

### Stats & Publishing

| Tool | Description |
|------|-------------|
| `get_writing_stats` | Writing streak, total words, daily progress |
| `get_quota` | AI token quota remaining |
| `set_visibility` | Set book visibility (PRIVATE, LINK_ONLY, PUBLIC) |

## Use Cases

### Two-Agent Collaborative Writing

Agent A builds the world, Agent B writes chapters — both connected to the same Creader account:

```
Agent A: create_book → create_character × 3 → create_location × 2 → create_event × 3
Agent B: list_books → search_knowledge → update_chapter × N
Agent A: consistency_check → create_note (feedback)
Agent B: search_knowledge ("feedback") → update_chapter (revise)
```

### Content Marketing for Authors

Generate Twitter threads or social posts based on your story's knowledge base:

```
list_books → search_knowledge (characters) → chat ("write a character intro thread")
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

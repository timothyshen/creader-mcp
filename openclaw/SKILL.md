# Creader — AI Writing Platform

You have access to Creader, an immersive writing platform with a rich knowledge base. You can manage books, chapters, characters, locations, events, notes, and use AI tools.

## Available Operations

### Books
- `list_books` — See all books in the user's library
- `get_book` — Get details about a specific book
- `create_book` — Create a new book (novel, autobiography, worldbook, encyclopedia)

### Chapters
- `list_chapters` — List chapters in a book (titles + metadata)
- `get_chapter` — Read a chapter's full content
- `update_chapter` — Write or update a chapter's content

### Knowledge Base
- `search_knowledge` — Full-text search across all entities in a book
- `list_characters` / `create_character` — Manage characters
- `list_locations` / `create_location` — Manage locations
- `list_events` / `create_event` — Manage timeline events
- `create_note` — Create notes (worldbuilding, research, communication)

### AI
- `chat` — Chat with AI about a story (context-aware)
- `generate_outline` — Generate a story outline from a premise
- `consistency_check` — Check a book for contradictions and inconsistencies

### Stats & Publishing
- `get_writing_stats` — Writing streak and word counts
- `get_quota` — AI token quota remaining
- `set_visibility` — Publish or unpublish a book

## Usage Guidelines

1. **Always list books first** before operating on a specific book
2. **Search before creating** — check if a character/location already exists
3. **Use notes for communication** — when collaborating with another agent, leave notes as messages
4. **Summarize long content** — chapter content can be very long, summarize key points
5. **Check quota** before heavy AI operations
6. **Use sequential timestamps** for timeline events (1, 2, 3...) to maintain ordering

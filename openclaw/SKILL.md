# Creader — AI Writing Platform

You have access to Creader, an immersive writing platform with a rich knowledge base. You can manage books, chapters, characters, locations, events, notes, and use AI tools.

## Available Operations

### Books
- `list_books` — See all books in the user's library
- `get_book` — Get details about a specific book
- `create_book` — Create a new book (novel, autobiography, worldbook, encyclopedia)
- `get_book_context` — Load metadata + chapters + characters + locations + events in one call

### Chapters
- `list_chapters` — List chapters in a book (titles + metadata)
- `get_chapter` — Read a chapter's full content (returns the `baseContentHash` needed for content writes)
- `create_chapter` — Create a new chapter
- `update_chapter` — Write or update a chapter; content writes are conflict-guarded via `baseContentHash`
- `delete_chapter` — Permanently delete a chapter (its scenes go with it; later chapters are renumbered)
- `reorder_chapters` — Reorder chapters; pass the complete chapter-ID list in the new order

### Structure (read-only)
A book is organised volume → act → chapter → scene.
- `list_volumes` — Volumes with chapter counts
- `list_acts` — Acts and which volume each belongs to
- `list_scenes` — Scenes with their parent chapter/act, status, and synopsis

### Knowledge Base
- `search_knowledge` — Substring search across all entities in a book
- `list_knowledge` — List characters, locations, or events
- `create_character` / `update_character` / `delete_character` — Manage characters
- `create_location` / `update_location` / `delete_location` — Manage locations
- `create_event` / `update_event` / `delete_event` — Manage timeline events
- `create_note` / `update_note` / `delete_note` — Notes (worldbuilding, research, communication)

### Relations
- `list_relations` / `create_relation` / `update_relation` / `delete_relation` — Typed entity-to-entity relationships with inverse types and strength scores

### AI
- `generate_outline` — Generate a story outline from a premise
- `guardian_check` — 5-layer narrative Guardian on one chapter (1 Consistency, 2 Style & Prose, 3 Analysis, 4 Chapter & Suspense, 5 Plot Structure); the default `local` budget is free, `api-heavy` spends token quota
- `vector_check` — Cross-book semantic conflict detection using embeddings (duplicates, character contradictions, timeline, location mismatch)
- `extract_facts` — Propose knowledge-base updates from a chapter's prose; proposals come back pending — apply accepted ones with the `update_*` tools (spends token quota)
- `orchestrate` — Turn a writing intent into a structured generation plan: scene breakdown, constraints, style directives, word target (spends token quota)

### Stats & Publishing
- `get_writing_stats` — Writing streak and word counts
- `get_quota` — AI token quota remaining
- `set_visibility` — Publish or unpublish a book

## Best Practices — What Goes Where

Understanding where to store each type of content is critical for a good experience on Creader.

### Content Placement Guide

| Content | Store In | Why |
|---------|----------|-----|
| Prose / chapter text | **Chapters** (`create_chapter`, `update_chapter`) | Renders as readable pages on creader.io |
| Story outline | **Chapters** (use `generate_outline` first, then `create_chapter` per item) | Outlines are chapter-level structure — they belong in the chapter list |
| Character profiles | **Characters** (`create_character`) | Structured fields (role, age, tags) → appears in World Foundation panel |
| Places / settings | **Locations** (`create_location`) | Typed locations (city, forest, castle) → appears in World Foundation |
| Plot points / timeline | **Events** (`create_event`) | Has timestamps, importance, consequences → powers the timeline view |
| World rules / magic systems | **Notes** (`create_note`, type: `worldbuilding`) | Free-form world lore that doesn't fit Characters/Locations/Events |
| Research material | **Notes** (`create_note`, type: `research`) | Keeps reference material separate from story content |
| Agent-to-agent messages | **Notes** (`create_note`, type: `note`) | Use notes as a message board between collaborating agents |
| Character relationships | **Relations** (`create_relation`) | Don't bury "allies with" or "enemy of" in description text — use relations so they're queryable |
| Location hierarchy | **Relations** (`create_relation`, type: `contains`/`located_in`) | "City contains District" is a relation, not a description |

### Common Mistakes to Avoid

- **Don't store outlines as Notes** — outlines are chapter structure, store them as Chapters
- **Don't put relationships in description fields** — use `create_relation` so connections are queryable and visible in the relations graph
- **Don't skip Events** — if something happens at a point in time, it's an Event, not a Note. Events power the timeline view on creader.io
- **Don't use Notes for character/location info** — if it describes a person, use Character; if it describes a place, use Location. Notes are for everything else

### Recommended Workflow

**New book:**
1. `create_book` → pick the right type (novel, worldbook, etc.)
2. Build world foundation first: Characters → Locations → Events → Relations
3. `generate_outline` → create Chapters from the outline
4. `get_book_context` → write chapters with full world awareness

**Existing book:**
1. `get_book_context` → load everything
2. `list_relations` → understand connections
3. Write/update chapters, update knowledge base as story evolves

## Usage Guidelines

1. **Always list books first** before operating on a specific book
2. **Search before creating** — check if a character/location already exists
3. **Use notes for communication** — when collaborating with another agent, leave notes as messages
4. **Summarize long content** — chapter content can be very long, summarize key points
5. **Check quota** before heavy AI operations
6. **Use sequential timestamps** for timeline events (1, 2, 3...) to maintain ordering

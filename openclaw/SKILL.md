# Creader — AI Writing Platform

You have access to Creader, an immersive writing platform with a rich knowledge base. You can manage books, chapters, the structural spine and plan, characters, locations, events, notes, the author's style, and use AI tools.

## Available Operations

### Books
- `list_books` — See all books in the user's library
- `get_book` — Get details about a specific book
- `create_book` — Create a new book (novel, autobiography, worldbook, encyclopedia)
- `get_book_context` — Load metadata + chapters + characters + locations + events in one call

### Chapters
- `list_chapters` — List chapters in a book (titles + metadata, no content)
- `get_chapter` — Read a chapter's full content (returns the `baseContentHash` needed for content writes)
- `create_chapter` — Create a new chapter
- `update_chapter` — Write or update a chapter; content writes are conflict-guarded via `baseContentHash`
- `delete_chapter` — Permanently delete a chapter (its scenes go with it; later chapters are renumbered)
- `search_book` — Search the book's **prose**; returns matching chapters with snippets and character offsets. `text` mode is exact substring and exhaustive, so nothing found means nothing is there. `semantic` mode is meaning-based and only sees indexed chapters, so an empty result proves nothing. Not the same as `search_knowledge`, which searches entity records
- `reorder_chapters` — Reorder chapters; pass the complete chapter-ID list in the new order

### Structure
A book is organised volume → act → chapter → scene. Acts are **named** (`name`); volumes and scenes are **titled** (`title`). Omit `orderIndex` to append at the end.
- `list_volumes` — Volumes with chapter counts
- `list_acts` — Acts and which volume each belongs to
- `list_scenes` — Scenes with their parent chapter/act, status, and synopsis
- `create_volume` / `update_volume` / `delete_volume` — Manage volumes
- `create_act` / `update_act` / `delete_act` — Manage acts (`volumeId` places an act in a volume; pass `null` to detach it)
- `create_scene` / `update_scene` / `delete_scene` — Manage scenes (linked by `chapterId` / `actId`; `delete_scene` takes nothing with it)

> `delete_volume` and `delete_act` are not row deletes: every chapter underneath goes too, prose included, plus those chapters' scenes. Both tools count the casualties first and refuse until you pass that exact number as `confirmChapterCount`. To keep the prose, move the chapters with `update_chapter` first.

### Plan
The book as designed: beats on chapters, subplot threads on volumes.
- `get_plan_spine` — The whole plan tree (volumes → acts → chapters → scenes, with each chapter's beats and each volume's threads) in one call, without chapter prose
- `list_plot_nodes` — Every beat in the book, flat, ordered by chapter then position
- `create_plot_node` / `update_plot_node` / `delete_plot_node` — Manage beats (one thing that happens, in one sentence). `threadIds` attaches subplots and on update **replaces** the set; `setupId` records a foreshadowing setup. Deleting a beat leaves the chapter and its prose untouched
- `reorder_plot_nodes` — Reposition many beats in one transaction; one bad id rejects the whole batch without moving anything
- `create_plan_thread` — Create a subplot thread on a volume (`color` is required; the Plan grid uses it as the column accent)
- `apply_structure_template` — Lay down `three-act` / `heros-journey` / `save-the-cat` on an empty plan, atomically; a plan with content is never overwritten

### Style
Two different things share the word: the **fingerprint** is measured from the author's prose, the **references** are passages they chose.
- `get_style` — The book's measured style fingerprint (sentence/paragraph length, vocabulary diversity, tone, POV, tense, commonest words). Read it before drafting and match it; `null` means not yet computed, not styleless
- `list_style_references` — The author's chosen exemplar passages, plus whether style learning is on
- `add_style_references` — Add passages to the voice corpus (≤50 per call, ≤2000 chars each, 500 per book). Add the author's writing, never your own. Creator plan
- `delete_style_reference` — Remove one exemplar; no prose is touched
- `set_style_learning` — Whether Creader feeds the references into its own AI calls. Creator plan

There is deliberately no `set_style`: the fingerprint is a measurement, and inventing one steers every later AI call on the book.

### Entity review
Extraction proposes; the writer decides. Nothing reaches the world unreviewed.
- `extract_entity_candidates` — Read one chapter and fill two queues in one paid call: new entities, and facts about entities that already exist (spends token quota, needs the `ai` scope)
- `list_entity_candidates` — New entities awaiting the writer's decision (free)
- `triage_entity_candidate` — `ACCEPTED` confirms the draft record into a real entity; `DISMISSED` deletes it. Either way the name is never proposed again
- `list_entity_facts` — Proposed facts about existing entities, ordered by the chapter that established each (free; `status` defaults to `PENDING`)
- `triage_entity_fact` — `ACCEPTED` appends to the fact log without rewriting the author's card; `DISMISSED` keeps the row so the statement is not proposed again

Triage when the writer asks or the prose plainly settles it, not to empty a queue. There is no `extract_facts` any more (removed in v1.4.0); this queue is its successor, not a rename.

### Knowledge Base
- `search_knowledge` — Substring search across all entities in a book (names and descriptions; queries need 2+ characters). For the prose itself, use `search_book`
- `list_knowledge` — List characters, locations, or events
- `create_character` / `update_character` / `delete_character` — Manage characters
- `create_location` / `update_location` / `delete_location` — Manage locations
- `create_event` / `update_event` / `delete_event` — Manage timeline events
- `create_note` / `update_note` / `delete_note` — Notes (worldbuilding, research, communication) and world constraints (`rule` / `prohibition`, force-injected into every AI prompt for the book)

> The 12 per-type CRUD tools above are deprecated as of v1.3.0: v2.0.0 will
> consolidate them into `create_entity` / `update_entity` / `delete_entity`
> with a `type` discriminator. They still work throughout 1.x — keep using
> them until the v2.0.0 replacements actually exist.

### Relations
- `list_relations` / `create_relation` / `update_relation` / `delete_relation` — Typed entity-to-entity relationships with inverse types and strength scores

### AI
- `generate_outline` — Generate a story outline from a premise
- `guardian_check` — 5-layer narrative Guardian on one chapter (1 Consistency, 2 Style & Prose, 3 Analysis, 4 Chapter & Suspense, 5 Plot Structure); the default `local` budget is free, `api-heavy` spends token quota. Findings are **saved to the book by default** so the author sees them in their Guardian panel; pass `persist: false` for a look that leaves no trace
- `list_guardian_issues` — Issues currently open on a book, the same ones the author sees in the Guardian panel (whoever created them); check it before spending quota on another pass
- `resolve_guardian_issue` — Close an issue (`RESOLVED` / `DISMISSED`) or reopen it, addressed by `fingerprint`. Dismissal feeds detector confidence, so dismiss deliberately
- `vector_check` — Cross-book semantic conflict detection using embeddings (duplicates, character contradictions, timeline, location mismatch)
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
| Volumes / acts / scenes | **Structure** (`create_volume`, `create_act`, `create_scene`) | The spine chapters hang from; `apply_structure_template` lays one down on an empty plan |
| What happens in a chapter | **Plan beats** (`create_plot_node`) | One sentence per beat; renders in the Plan grid and never touches the prose |
| Subplot arcs | **Plan threads** (`create_plan_thread`) | Beats attach to threads via `threadIds`; the grid renders one column per thread |
| Character profiles | **Characters** (`create_character`) | Structured fields (role, age, tags) → appears in World Foundation panel |
| Places / settings | **Locations** (`create_location`) | Typed locations (city, forest, castle) → appears in World Foundation |
| Plot points / timeline | **Events** (`create_event`) | Has timestamps, importance, consequences → powers the timeline view |
| World lore / magic systems | **Notes** (`create_note`, type: `worldbuilding`) | Free-form world lore that doesn't fit Characters/Locations/Events |
| Hard world laws | **Notes** (`create_note`, type: `rule` / `prohibition`) | Force-injected into every AI prompt for the book; count capped per plan |
| Research material | **Notes** (`create_note`, type: `research`) | Keeps reference material separate from story content |
| Agent-to-agent messages | **Notes** (`create_note`, type: `note`) | Use notes as a message board between collaborating agents |
| Character relationships | **Relations** (`create_relation`) | Don't bury "allies with" or "enemy of" in description text — use relations so they're queryable |
| Location hierarchy | **Relations** (`create_relation`, type: `contains`/`located_in`) | "City contains District" is a relation, not a description |
| Voice samples | **Style references** (`add_style_references`) | The author's own prose or a sample they chose — never the model's |

### Common Mistakes to Avoid

- **Don't store outlines as Notes** — outlines are chapter structure, store them as Chapters
- **Don't put relationships in description fields** — use `create_relation` so connections are queryable and visible in the relations graph
- **Don't skip Events** — if something happens at a point in time, it's an Event, not a Note. Events power the timeline view on creader.io
- **Don't use Notes for character/location info** — if it describes a person, use Character; if it describes a place, use Location. Notes are for everything else
- **Don't read chapters in bulk to find something** — `search_book` first, then `get_chapter` the hits
- **Don't triage entity candidates or facts to empty the queue** — they are the writer's decisions about their own world
- **Don't add your own prose as a style reference** — that teaches the book to sound like a model

### Recommended Workflow

**New book:**
1. `create_book` → pick the right type (novel, worldbook, etc.)
2. Build world foundation first: Characters → Locations → Events → Relations
3. Lay the spine: `apply_structure_template` or `create_volume` / `create_act`, then `generate_outline` → create Chapters from the outline, with beats via `create_plot_node`
4. `get_book_context` + `get_style` → write chapters with full world awareness, in the author's voice

**Existing book:**
1. `get_book_context` → load everything
2. `get_plan_spine` → the book as designed; `list_relations` → understand connections
3. `get_style` and `list_style_references` → match the voice before writing a word
4. Write/update chapters; run `extract_entity_candidates` and let the writer triage what the prose proposed

## Usage Guidelines

1. **Always list books first** before operating on a specific book
2. **Search before creating** — `search_knowledge` to check if a character/location already exists; `search_book` to look inside the manuscript
3. **Use notes for communication** — when collaborating with another agent, leave notes as messages
4. **Summarize long content** — chapter content can be very long, summarize key points
5. **Check quota** before heavy AI operations, and `list_guardian_issues` before re-running `guardian_check`
6. **Use sequential timestamps** for timeline events (1, 2, 3...) to maintain ordering
7. **Confirm destructive structure deletes** — `delete_volume` / `delete_act` destroy prose and require `confirmChapterCount`

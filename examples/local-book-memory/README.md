# local-book-memory (spike)

A book's memory kept in local files, with **no API key, no model and no network** in the server. The agent
that calls it is the model: it reads a chapter and proposes facts, each with a verbatim quote. The server runs
`narrative-core`'s **code** stages on them, and the writer decides what becomes canon. This is option 3 of
[docs/plans/2026-11-19-local-book-memory.md](../../docs/plans/2026-11-19-local-book-memory.md) §5.6.

Not published, not wired into `@creader/mcp-server`. Where a local mode ships is still the owner's decision
(L2 in that doc).

## Try it

```bash
pnpm install
pnpm test && pnpm typecheck
claude mcp add creader-local -- node "$PWD/bin/creader-local-memory.mjs" --book "$PWD/demo-book"
```

Then ask your agent something like "read the chapters of this book and propose the facts each one establishes",
and decide each fact yourself ("accept f3 as a revealed misdirection", "dismiss f5").

## The book on disk

```
demo-book/
  chapters/01-the-ring.md      frontmatter id/title/order (all optional); body = prose
  .creader/facts.jsonl         the review queue, written by this server (one fact per line)
```

The prose is the writer's: this server never writes a chapter. Canon is not stored at all. It is folded on
every read from the accepted facts and the current prose, in reading order.

## Tools

| Tool | Does |
|---|---|
| `list_chapters`, `get_chapter` | the chapters in reading order; the prose with its `contentHash` (the hosted hash) |
| `get_canon` | the folded world: current value of each key, what was superseded and how, and what is held out (needs a ruling, stale, orphaned) |
| `propose_entity_facts` | files the agent's facts after the checks below; one outcome per fact |
| `list_entity_facts` | the queue, `PENDING` by default |
| `triage_entity_fact` | the writer's `ACCEPTED` / `DISMISSED`; a fact that contradicts canon needs a `ruling` |

## What happens to a proposed fact

All of it is code, mostly `narrative-core`'s own (vendored in `vendor/narrative-core`, see its README):

1. **Shape**: a `subject.attribute` key of two or three segments, a quote, and a **short canonical value**
   (at most six words, or about 13 Chinese characters). Case, spacing and a trailing full stop are normalized away.
   A sentence is rejected, because the fold compares values exactly: two wordings of one thing would read as a
   contradiction.
2. **Evidence**: the quote must be in the chapter (`gateEvidence`). Punctuation, quote marks, case and
   ellipses don't matter; a quote the chapter does not contain is rejected.
3. **Keys**: a spelling variant of a key canon or the queue already uses (same subject, same attribute words:
   `mara.ring_material` / `mara.ring.material`) is moved onto it, and the outcome says `renamedFrom`. A variant
   key would hide every later contradiction on it. A key that is only similar (`harry.scar.cause` next to
   `harry.scar`) is kept, and the outcome names the other key as `nearKey`. A wrong merge would invent a
   contradiction, and no model here would catch it.
4. **Known**: a duplicate in the same call, a value canon already holds before this chapter, a fact already
   waiting, and a fact the writer dismissed for this chapter are all skipped.
5. **Collision**: a value that contradicts canon *before this chapter* (`collisionsFor`) is still filed,
   carrying what canon held.

The writer then rules on each contradiction. **progression**: it was true and changed. **misdirection-revealed**:
the earlier value was never true. **suspended**: the book leaves it open, and both stand as contested. If the
prose is simply wrong, the writer fixes it and dismisses the fact. Until a contradiction has a ruling it stays out
of canon, so the fold can never hold two silent truths for one key.

Canon follows the prose. If an accepted fact's chapter is edited and its quote is gone, the fact leaves canon and
`get_canon` lists it as `stale`. If the chapter is deleted, the fact is `orphaned`.

## Refreshing the vendored engine

```bash
pnpm sync:narrative-core            # from the sibling ../creader_editor checkout
pnpm sync:narrative-core <path>     # or from any lib/narrative-core
```

## Bench: against hosted extraction

```bash
set -a; . ../../.env; set +a                                   # CREADER_API_KEY
node node_modules/tsx/dist/cli.mjs bench/export-hosted.mts <bookId> 3 bench/runs/<name>   # free: reads only
bench/run-agent.sh bench/runs/<name> [model]                   # one headless Claude Code agent per chapter
node node_modules/tsx/dist/cli.mjs bench/compare.mts bench/runs/<name>
node node_modules/tsx/dist/cli.mjs bench/replay.mts bench/runs/<name>    # free: that run's proposals through today's code
```

`bench/runs/` is gitignored: it holds the book's text. The first comparison (2026-11-21) is §10 of the design doc.

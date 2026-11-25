# Local book memory for creader-mcp — research, 2026-11-19

**Date:** 2026-11-19 · **Status:** research, for the owner's decisions (§8). The keyless path (§5.6, option 3)
was built as a spike on 2026-11-21: `examples/local-book-memory/`, results in §9.

The question (owner, 2026-11-19): how can creader-mcp keep a book's memory locally as well? MemGPT came up as one
option. "The book's memory" means what the story has established: its world, facts, timeline and relations. It does
not mean what the assistant remembers about the writer.

**Read:** this repo at `feat/persona-cli-evolve`. `creader_editor` at `staging` 54139ea06: `lib/narrative-core/`,
`lib/ai/guardian/`, the entity-candidates route. The June plans:
`docs/plans/archive/2026-06/2026-06-18-modular-memory-verification-architecture.md` (the "dual-mode MCP" and X-D1 to
X-D4), `2026-06-21-guardian-and-memory-system.md` Part V, and `2026-06-28-resequence-collab-narrative-mcp.md` (R-2).
Two open-source local novel tools cloned in the workspace: InkOS (`Narcooo/inkos`) and NovelForge.

## 中文摘要

- **不用 MemGPT/Letta。** 它管的是"智能体记得自己聊过什么"，不是"这本书确立了什么"；它让模型直接改记忆，而
  Creader 的规则是模型只提议、作者决定。它的 Docker 服务端官方已经不再维护，还要 Python 或另起服务，跟
  `npx` 装的 MCP 不合。
- **该用的是我们自己的 `narrative-core`。** 6 月的设计（"双模式 MCP"）已经写好：本地模式用同一套工具名，书放在
  本地文件夹（兼容 Obsidian），派生索引放在 `.creader/` 里，删掉就能重建。
- **现状：** `narrative-core` 的读接口、内存版数据源、与生产一致性的契约测试、世界模型（事件日志、带有效区间的
  事实、入库判定）都在；缺写接口、文件数据源、本地向量索引，而且还没发布到 npm。
- **最大的缺口是 Guardian。** 它还长在应用里（198 个文件，至少依赖 20 个应用模块，其中 7 个文件直接用 Prisma）。
  不把 Guardian 拆出来，本地模式只是"有记忆、不会查"，而查一致性正是这个 MCP 的主打功能。
- **79 个工具里：** 50 个只靠文件就能本地跑；语义搜索要嵌入向量；实体审核的 5 个要模型；Guardian 的 4 个要先拆
  Guardian；20 个只能在线（配额、发布、文章、文风指纹等）。
- **建议的形状：** 单独一个本地包（按 X-D1，在线版保持两个依赖、Node ≥18 不变）；SQLite 用 Node 自带的
  `node:sqlite`，不引原生依赖；向量先在 JS 里全量扫，书的规模够用；嵌入优先用本机 Ollama（必须支持中文），
  否则用户自带 key；模型步骤默认让调用方的智能体自己提取、服务端只跑代码闸门，配了 key 再用 key。
  MCP sampling 不可行：Claude Code 不支持，2026-07-28 版规范已经弃用。
- **待定：** §8 的 L1 到 L5。

## 1. Where the book's memory is today

**On Creader's server, all of it:**
- the authored knowledge base: characters, locations, events, notes (including `rule` / `prohibition`);
- relations and the plan;
- the review queues: entity candidates and the fact log;
- the world ledger (`lib/ledger`, folded with `narrative-core/world`);
- the pgvector index;
- Guardian's issues.

**In creader-mcp, none of it.** The only state is a 60-second in-process cache of GET responses, cleared on any write
(`src/lib/api-client.ts`, `CACHE_TTL_MS`).

**This was already designed in June.** The modular-memory plan describes a **dual-mode MCP**: the same tool surface,
with a local mode that imports `narrative-core` and injects local adapters ("no creader key, no network except the
user's own model/embedding calls"). Its decisions:
- **X-D1:** the first-party MCP stays hosted "as is". Local use goes through the open SDK, in hosts built on it.
- **X-D2:** BYO embedding key in v1.
- **X-D3:** `LocalVectorIndex` on sqlite-vec or LanceDB, in a dot-folder.
- **X-D4:** no billing locally.

R-2 then published this repo as the thin client, and left "local dual-mode MCP on the SDK" as a later follow-up.

## 2. Why not MemGPT / Letta

- **It is the wrong kind of memory.** Letta remembers an agent's own conversations: core blocks always in the prompt,
  plus archival and recall search. It has no idea of chapters, canon, content hashes, or a fact that holds from one
  chapter to another. `narrative-core/world` is already a memory built for exactly that.
- **The model writes its own memory.** In Letta the model edits memory with tool calls. Creader's rule is the
  opposite: "Knowledge-base proposals are a review queue the writer owns, never a direct write", and
  `world/gate-policy` decides what enters canon.
- **It doesn't fit how this package is installed.** Letta's docs now say its Docker server is "no longer an actively
  maintained or supported Letta product surface". Its replacement local App Server pages don't show how an outside
  app edits memory blocks. Either way it is a Python or Node server running beside a package people install with
  `npx`.
- **Mem0 doesn't fit either.** Its open-source version has an LLM that decides add, update or delete, which bypasses
  the review queue. Its local MCP (OpenMemory) was reportedly deprecated this year; I only found that on third-party
  sites.

## 3. What `narrative-core` gives a local mode today

`@creader/narrative-core` 0.1.0, Apache-2.0. It lives in `creader_editor/lib/narrative-core` and is **not on npm**.
Its public API is frozen until 2026-12-31 (`public-api.test.ts`).

| Piece | Status | What local mode does with it |
|---|---|---|
| `BookKnowledgeSource` (`source.ts`) | **Read-only.** `getCharacters`, `getTimelineEvents`, `getChapters`, `getChapterSnapshot`, `getForeshadowingMarkers`, `getRelations`, `getWorldConstraints`, plus optional `getEntityFacts`, `getWorldState`, `getWorldFold`, `getWorldClaims` and others. Writes and `contentChangeFeed` are Phase 1, not started | A `FilesystemSource` implements the reads. Writes need the Phase 1 port, or live outside it in the local host |
| `SOURCE_CONFORMANCE` | The port's contract as cases. The in-memory provider and the Prisma provider both pass it | A `FilesystemSource` can be held to **the same answers as production**. This is the strongest asset here |
| `createInMemoryBookSource` | Exists. Backs tests, the bench and "offline/SDK consumers" | Reference for the file source |
| `VectorIndex` (`vector-index.ts`) | Interface only: `search`, `hasEmbeddings`, `deleteForSource`, `getChunkContents`, `deleteChunksFrom`, `upsertChunks`. The pgvector implementation is app-side; `rebuild` is still pending | A `LocalVectorIndex` implements it |
| `world/` | Carved: `ingestChapter`, `fold` / `foldStep`, `planFold`, `gate-policy`, `collide`, `canonicalize`, 76 tests with no network. Model stages go through the `StructuredCall` port | The world ledger, locally. Only the event store is missing: the hosted one is `lib/narrative/event-store.ts`, on the DB |
| `ModelRouter`, `StructuredCall` | Ports | BYO model plugs in here (§5.6) |

**Not in the package:**
- **Guardian (`lib/ai/guardian`).** 198 non-test files. It imports from at least 20 app modules, including
  `lib/ai/gateway`, `lib/ai/reader`, `lib/analyzers/*`, `lib/services/quota` and `lib/education/ai`, and 7 files
  import Prisma directly. Its orchestrator already takes `BookKnowledgeSource` and `ModelRouter` injected, so the
  seam exists, but the module is not carved.
- **Hosted entity extraction** (`app/api/books/[bookId]/entity-candidates`). It is app code (`lib/ai/extraction`,
  Prisma), a different pipeline from `world/ingest`.

## 4. Tool by tool: what a local mode could serve

This repo has 79 tools.

| Group | Tools | Count | Needs locally |
|---|---|---|---|
| **A. Files only** | books (4), chapters (7; `search_book` in `text` mode), structure (12), knowledge (14), relations (4), plan (8; `apply_structure_template` needs the templates ported from `lib/templates/plan-skeleton`), `get_writing_stats` (word counts only) | 50 | A file source with writes. No model, no key |
| **B. Embeddings** | `search_book` in `semantic` mode | (same tool) | `LocalVectorIndex` + an embedder |
| **C. Model, through `narrative-core/world`** | `extract_entity_candidates`, `list_entity_candidates`, `triage_entity_candidate`, `list_entity_facts`, `triage_entity_fact` | 5 | Local queues + the model stages (§5.6). The local extractor would be `world/ingest`, not the hosted pipeline, so its proposals will differ |
| **D. Guardian** | `guardian_check`, `vector_check`, `list_guardian_issues`, `resolve_guardian_issue` | 4 | **The Guardian carve.** Even the free `local` budget runs app code |
| **E. Hosted only** | `get_quota`, `set_visibility`, the 11 article tools, the 5 style tools (the fingerprint is measured server-side), `generate_outline`, `orchestrate` | 20 | Not in local mode |

**The consequence:** this package's headline is "check a draft against what it already established", and that is
group D, the furthest from local. Without the Guardian carve, local mode is a structured knowledge base with a
world ledger. That is useful, but it is what the generic MCP memory servers already offer. The carve decides
whether local mode is Creader.

## 5. The shape I'd build

### 5.1 Which "local" (L1)

1. **Local-only book.** Files are the truth; no account. This is the June dual-mode.
2. **Local read mirror of a Creader book.** The cloud stays the truth; reads work offline; writes go over REST. The
   June doc's D7 chose "live read-through with a short cache, not a replicated local store" for the hosted path.
3. **Two-way sync.** The editor's offline work shows the cost for prose alone: the `prose-outbox`, and 409 →
   a "conflicted" version (`2026-07-19-local-first-t1-test-checklist.md`). For the knowledge base, facts and the
   ledger it becomes the CRDT problem the June doc ruled out.

**Recommend 1.** Add 2 only if someone needs to read a hosted book offline.

### 5.2 Where it ships (L2)

X-D1 keeps the hosted MCP as is and puts local use in a separate host. **Recommend keeping that:** a second package
in this repo (for example `@creader/mcp-local`), reusing this repo's tool names, descriptions and zod schemas for
groups A to D.

- The hosted install stays at two dependencies and Node ≥18.
- Local mode needs Node ≥22.13 (`node:sqlite`) and `narrative-core`.
- A single dual-mode package would answer "not available in local mode" for 20 tools, and would teach agents tools
  that do nothing.

### 5.3 Files on disk: the system of record

```
MyNovel/
  book.md                         frontmatter: id, title, type
  chapters/0001-the-door.md       frontmatter: id, order, volume, act; body = prose
  world/characters/mara.md        frontmatter: id, aliases; body = the card
  world/locations/… world/events/… world/notes/…   (noteType rule / prohibition in frontmatter)
  plan/…                          scenes, plot nodes, threads
  .creader/
    relations.yaml                typed edges (V-D2: a creader-owned overlay, since wikilinks lose type)
    facts.jsonl                   the review queue the writer owns; canon is folded from its ACCEPTED rows
                                  and the prose (the spike, §9, needed no separate world log)
    candidates.jsonl              new-entity proposals, the same way (not built yet)
    index.db                      DERIVED: chunks, vectors, fact intervals. Delete it and it rebuilds
```

- **Obsidian-compatible.** Ids live in frontmatter, so renaming a file breaks nothing.
- **Same conflict rule as hosted.** `baseContentHash` is the same FNV-1a (`src/lib/content-hash.ts`) over the file
  body. `update_chapter` therefore refuses when the writer changed the file in Obsidian meanwhile, exactly as it does
  against the web editor.
- **Others landed on the same split.** InkOS keeps truth files (JSON, with a Markdown projection) as the record and
  `story/memory.db` as an "acceleration index built alongside them". Basic Memory keeps Markdown with a SQLite index.
  `narrative-core` states the same rule: the derived index is "always ours, always rebuildable".

### 5.4 Index and search

- **Use `node:sqlite`, built into Node.** Unflagged since 22.13, "release candidate" stability in 24, so no native
  dependency. InkOS uses it for the same job and switches its index off when `node:sqlite` is missing.
- **Store vectors as float32 BLOB rows and scan them in JS.** At book scale this is small: 300 chapters × ~10 chunks ×
  1024 dimensions × 4 bytes ≈ 12 MB. A cosine scan over that should take milliseconds; that is an estimate to measure,
  not a result. Move to sqlite-vec only if a series outgrows it: it is a native prebuilt binary and the database must
  be opened with `allowExtension: true`. LanceDB is a heavier native binary.
- **Keep `text` search an exact substring scan,** exhaustive and CJK-safe as hosted. Not FTS5: the only built-in FTS5
  tokenizer that works for Chinese is `trigram`, and it does not match terms under three characters, while
  `search_knowledge` accepts two.
- **Key every chunk by** (source id, content hash, embedding model id). Changing the model rebuilds the index: the
  `modelVersion` rule from the Memory design.

### 5.5 Embeddings (L3)

X-D2 chose a BYO embedding key for v1. If "local" also means offline:

- **Ollama over HTTP:** `bge-m3` (1024 dimensions, 100+ languages) or `qwen3-embedding`. No native dependency in the
  server.
- **transformers.js in-process:** brings `onnxruntime` (native) and a model download of a few hundred MB on first
  use. A q8 ONNX `bge-m3` exists. One published CPU figure puts `bge-m3` at about 31 ms per query, unbatched; that
  setup differs from ours, so measure.
- **The model must be multilingual.** Many Creader books are in Chinese.

**Recommend:** Ollama when it is running, otherwise a BYO key, and no in-process model in v1.

### 5.6 Model stages (L4)

`world/ingest` has model stages (extract, canonicalize, adjudicate) and code stages (dedupe, collide, the evidence
gate). Ways to run the model stages locally:

1. **A BYO key** on an OpenAI-compatible endpoint (OpenAI, DeepSeek, Ollama), implementing `StructuredCall`.
2. **MCP sampling** (asking the client's model): **no.** Claude Code does not support it (its feature request, open
   since June 2025, was still open in August 2026), and the 2026-07-28 spec deprecates it (SEP-2577).
3. **The calling agent as the model.** A tool takes the agent's proposed claims for one chapter, each with its evidence
   quote. The server runs only the code stages (anchor gate, dedupe, collide against canon) and files the survivors
   as PENDING in the writer's queue. No key at all. Quality is the client model's, and the rule holds: the agent
   proposes, the writer decides.

**Recommend 3 by default and 1 when a key is configured.** Spike 3 first: it removes the key question for the common
case of a writer working in Claude Code. (Built 2026-11-21, §9.)

## 6. Order of work

| Step | What | Depends on | Where |
|---|---|---|---|
| 0 | Decide L1 to L5 (§8) | — | — |
| 1 | Make `narrative-core` installable: an npm 0.x, or vendored | owner | creader_editor / its mirror |
| 2 | `FilesystemSource` (reads) passing `SOURCE_CONFORMANCE` | 1 | narrative-core adapters |
| 3 | The local package: group A over the files, with writes and the hash conflict rule | 2 | this repo |
| 4 | `LocalVectorIndex` (`node:sqlite` + flat scan) and the embedder; `search_book` semantic | 3 | this repo / adapters |
| 5 | World ledger locally: canon folded from the accepted queue; ingest through agent-supplied claims (L4-3, **spiked 2026-11-21, §9**), then a BYO key; the rest of group C (candidates) over local queues | 3 | this repo |
| 6 | The Guardian carve: L1, L2 and L4 local rules first, then L3 | its own project | creader_editor |

Steps 4 and 5 can run in parallel. Step 6 is the long pole, and §4 says why it matters.

## 7. How we know

- **Conformance:** `FilesystemSource` passes the same `SOURCE_CONFORMANCE` cases as the Prisma and in-memory
  providers.
- **Round trip:** a hosted book written out to files and read back gives the same `get_book_context`.
- **Search parity:** the same English and Chinese queries against hosted and local. `text` gives identical results;
  for `semantic`, report the top-k overlap.
- **Conflict:** edit a chapter in Obsidian while the agent holds its hash, and `update_chapter` refuses.
- **Rebuild:** delete `.creader/index.db`; the next run rebuilds it and gives the same answers.
- **Cost on a writer's laptop:** index build time for a 100-chapter book; query time; the Ollama embedding time per
  chunk.

## 8. For the owner to decide

- **L1, which "local":** recommend a local-only book (§5.1).
- **L2, where it ships:** recommend a separate package in this repo, per X-D1 (§5.2).
- **L3, embeddings:** recommend Ollama when present, otherwise a BYO key (§5.5).
- **L4, model stages:** recommend agent-supplied claims by default, and a BYO key when configured (§5.6).
- **L5, is the Guardian carve in scope for local v1?** If not, local mode ships as memory without checks, and its
  README has to say so.
- **Also:** the June doc listed one-time hosted → vault migration as a non-goal. A local mode with no way to bring an
  existing book over may be hard to try. Keep it out, or add an export?

## 9. Spike: the keyless path, 2026-11-21

**What was built.** `examples/local-book-memory/`, on branch `feat/local-book-memory` (off `origin/main`, not
committed). It is a stdio MCP server with six tools: `list_chapters`, `get_chapter`, `get_canon`,
`propose_entity_facts`, `list_entity_facts`, `triage_entity_fact`. It has no key, no model and no network.

- **The flow:** the calling agent reads a chapter and proposes facts with quotes. The server runs `narrative-core`'s
  code stages on them: the evidence gate, `deterministicMatch`, `dedupeExact` and `collisionsFor`. Survivors are
  filed PENDING in `.creader/facts.jsonl`, and the writer accepts or dismisses each one. A fact that contradicts canon
  needs a ruling: progression, misdirection-revealed or suspended.
- **Canon is folded, not stored.** It is rebuilt with `resolveIntraBatch`, `buildEvent` and `foldStep` from the
  accepted facts and the current prose, in reading order, on every read. Accepting in any order is therefore safe,
  and a fact whose quote is edited out of its chapter drops out by itself (`stale`).
- **The engine is vendored.** 12 files of `narrative-core` are copied, pinned to `creader_editor` 54139ea06
  (`scripts/sync-narrative-core.sh`).

**Verified.**
- 42 tests pass and `tsc` passes. The tests cover:
  - the gate on English and Chinese quotes, including re-punctuated ones;
  - key moves, duplicates, already-canon and dismissed facts;
  - checking only against canon *before* the chapter;
  - all three rulings, and refusal without one;
  - accepting out of order;
  - stale and orphaned facts;
  - conflicts inside one chapter;
  - the MCP surface over an in-memory transport, and the real `bin` over stdio.
- A scripted session drove the stdio server over the demo book (two English chapters, one Chinese) through propose,
  triage and canon.
- The result: no fact ever folded as a silent double-truth, and `doubleTruths` was empty throughout.

**Not verified.**
- No real agent did the proposing. Every proposal was scripted, so extraction quality from Claude Code or another
  client is untested. That is the next thing to measure: the same chapters through the hosted
  `extract_entity_candidates` and through an agent on this path, comparing the facts filed.
- Not run on a long book, or with two clients writing the queue at once.
- Whether "dismissed is never proposed again" is per chapter in the hosted product, as it is here, was not
  checked.

**Findings.**
1. **Upstream bug in `narrative-core`: a ruled replacement loses its claimant.** `buildEvent` turns an adjudicated
   progression or misdirection into a refutation that carries the new value. `foldStep` then records a carried value
   as said by `event.narrator`. So "the jeweller says it was always gold" folds as the narrator saying it: hearsay
   becomes narration, the failure M1 requirement 3 warns about. Reproduced against the vendored engine with no spike
   code involved. The hosted ingest has the same path. The spike keeps the claimant (`canon.ts` `keepClaimant`).
   Upstream, `Refutation` could carry `by`, or `buildEvent` could keep the assertion.
2. **The package has no claim-level evidence gate.** `gateEvidence` only takes contradiction-shaped items, and
   `anchorExists` lives in `internal/`, which is not exported. A host gating *claims* has to fill in dummy fields
   (`facts.ts` `quoteIn`). Worth exporting a claim-level gate when the API freeze lifts.
3. **Extensionless imports keep plain `node` from running the package.** The `bin` goes through `tsx`. Publishing
   compiled JS, or `.js` import paths, fixes it.
4. **Skipping the model pass of `canonicalizeKeys` has a visible cost.** Keys sharing no attribute token are not
   merged: in the demo, `tomas.whereabouts` was filed beside a would-be `tomas.location`. The mitigations are the
   instructions (reuse keys from `get_canon`) and the writer's review. Option 1 (a BYO key) would add the model
   pass back.
5. **A simpler layout than §5.3.** No `world.jsonl` is needed: the accepted queue plus the prose is the record,
   and the world is derived from them. Stale facts, out-of-order acceptance and rollback (dismiss) all fall out of
   that.

## 10. A real agent against hosted extraction, 2026-11-21

**Setup.**
- **Book and chapters:** the account's *Harry Potter, Book 1* (`4e7e1368`), chapters 1–3. It is the only book with
  hosted extraction results: 60 PENDING entity facts from a run on 2026-10-23. No quota was spent, nothing was
  written to the account, and all 60 hosted quotes are still found in today's text.
- **The local side:** one headless Claude Code agent per chapter (`claude -p`, the account's default model
  `claude-fable-5-2`), given only this server's tools: no files, no shell, no triage. It was asked only to "read
  chapter N and propose the facts it establishes".
- **Between chapters:** a stand-in writer accepted every fact needing no ruling, so the next chapter saw canon.
- **Reproducible:** `bench/` (export → agent → compare). The exported text stays under the gitignored
  `bench/runs/`.
- **Reporting:** keys and paraphrase only below, no quotes from the book.

**Numbers.**

| | Ch. 1 | Ch. 2 | Ch. 3 | Total |
|---|---|---|---|---|
| Hosted facts | 22 | 17 | 21 | 60 |
| Agent facts filed | 7 | 7 | 7 | 21 |
| Agent quotes not found (rejected) | 0 | 0 | 0 | 0 |
| Agent facts with a hosted counterpart (my reading) | 7 | 3 + 2 partial | 6 | 16 of 21 |
| Contradictions the fold surfaced | — | 3 | 1 | 4 |
| Agent cost, USD equivalent | 0.89 | 0.53 | 0.55 | 1.96 |

There is no gold standard, so "counterpart" is my reading of the two lists, not a score. Quote overlap alone
(`bench/compare.mts`) gives a floor of 11 of 21, because the two sides often state one fact from different
sentences.

**What the comparison shows.**
1. **Keyed facts make contradictions visible to code.** The fold raised four. Three are real:
   - two conflicting accounts of how Harry's parents died, Hagrid's in chapter 1 and Petunia's in chapter 2, a
     known lie in the book, each kept with its claimant (two contradictions, one per parent);
   - Harry's move to the hut in chapter 3, a progression.

   One is false (item 2). The hosted queue has no cross-chapter check, and it never recorded Petunia's account:
   its chapter 2 fact says only that Harry lost his parents. With free-text statements per entity, there is
   nothing for code to compare.
2. **The agent wrote sentences as values, and that broke exact comparison.** Values like a whole clause about the
   doorstep made "still living at the same house" collide with "left on the doorstep there": a false
   contradiction. The same verbosity defeats the "already canon" skip. **The fix is a value rule:** a short
   canonical value (`dead`, `4 privet drive`, `car crash`), with the rest in the quote. Possibly also a length
   guard in `propose.ts`. (Done and re-run: §11.)
3. **Key reuse worked from the instructions alone.** Every later chapter reused the canon keys exactly
   (`harry.location`, `lily.status`, `james.status`), and no deterministic rename was needed. The agent read
   `get_canon` before proposing.
4. **Claimants were kept.** Facts came attributed to hagrid, mcgonagall, petunia, vernon and piers. Hosted facts
   carry no claimant, so hearsay and narration look the same there.
5. **Hosted finds more, much of it texture.** Of its 44 facts with no agent counterpart, many are colour the
   narrative-core prompt tells an extractor to skip: sky and street-lamp detail, a list of birthday presents, a
   sweater. Some rows repeat one statement once per entity it names (four identical rows in chapter 3). But some
   load-bearing facts were missed only by the agent's budget of about seven per chapter: who lent the motorcycle,
   an alias, a hotel the family stops at. The budget is a choice, and it costs recall.
6. **The 24,000-character hosted limit cut chapter 1 at 96%.** No fact on either side fell in the last 4%, so it
   made no measured difference here.

**Not shown.**
- One model, one run per chapter, three chapters.
- Hosted cost was not measured.
- The stand-in writer accepted everything clean, which a real writer would not.
- Whether short values fix the false contradiction without losing what the sentences carried still has to be run.

## 11. Rerun with short values, 2026-11-22

**The change.**
- **A rule in code:** `propose.ts` normalizes values (case, spacing, a trailing full stop) and rejects a sentence:
  more than six words, or more than 40 units of length with a Han character counting three (about 13 Chinese
  characters).
- **The same rule in the instructions,** with examples (`dead`, `4 privet drive`, `car crash`, `hut on a rock`).
- 45 tests pass.

**The rerun.** Same three chapters, same text, same model, through the saved `bench/run-agent.sh` (its first run).
Output is in `bench/runs/hp-v2/`.

| | Run 1 (sentence values) | Run 2 (short values) |
|---|---|---|
| Facts filed | 21 | 21 (1 rejected for a four-segment key, refiled by the agent) |
| Contradictions raised | 4: 3 real, 1 false | 4: 2 real, 2 false |
| What made the false ones | a sentence value | the deterministic key match (below) |
| Agent facts with a hosted counterpart (my reading, partials included) | 16 of 21 | 18 of 21 |
| Agent cost, USD equivalent | 1.96 | 2.01 |

**What changed.**
1. **The value fix worked.** Values came out short, and the false contradiction from two wordings of one place is
   gone. Two real progressions were raised instead: Harry's bedroom (the cupboard, then Dudley's second bedroom) and
   Harry's location (the house, then the hut). Run 1 missed the bedroom.
2. **A false contradiction now comes from `narrative-core`'s `deterministicMatch`.** It merged keys wrongly twice:
   - `harry.scar.cause` was moved onto `harry.scar`. Its subset rule treats a sub-attribute as the same attribute,
     so "car crash" collided with the scar's shape.
   - `harry.letter.state` was moved onto `harry.letter.read`. `state` is a stop word, so the key collapsed to
     `letter`, and "burned" collided with "unread".

   The agent noticed the first itself and told the writer it was not a real contradiction. The package's own rule is
   "a wrong merge is worse than a missed merge", and here there is no model pass to catch one. **Proposed fix:**
   rename only when the attribute tokens are equal (`ring_material` / `ring.material`). For a subset or stop-word
   match, keep the agent's key and return the near key as a hint. (Done 2026-11-22, below.)
3. **The conflicting-testimony catch was lost.** Run 1 caught Hagrid's account against Petunia's only because the
   cause of death was inside a sentence value. With short values, chapter 1 recorded `lily.status = dead`, and
   chapter 2 recorded the cause under a new key (`potters.death.cause = car crash`). Nothing in chapter 1 held a
   cause to collide with. Short values are right, but a contradiction is only caught when both chapters record the
   same attribute.
4. **The motorcycle came back.** Chapter 1 now records who had the motorcycle and the state of the Potters' house,
   two of the facts §10 said only hosted had.

**The key fix (2026-11-22).**
- **The new rule:** `propose.ts` `placeKey` moves a fact onto an existing key only when it has the same subject
  and the same attribute words, in any order and split on `.`, `_` and `-`. That is a spelling variant.
- **What became a hint:** anything `deterministicMatch` would also have merged (a sub-attribute, or a match through
  a stop word) now keeps the agent's key, and the outcome and the row carry `nearKey`. The tool description tells
  the agent to propose again under the near key if that is what it meant.
- 49 tests pass.
- **Checked on the run's real data:** `bench/replay.mts` (free: no agent, no model) replays run 2's proposals
  through the current code, with the same stand-in writer.
  - The two false contradictions are gone: `harry.scar.cause` stays its own key, hinting `harry.scar`;
    `harry.letter.state` stays its own key, hinting `harry.letter.read`.
  - The two real progressions (bedroom, location) still wait for a ruling.
  - Nothing holds two values at once.
- **Not checked:** how an agent reacts to the hint. That needs a live rerun.

**This is the second finding for `narrative-core` upstream.** Its `deterministicMatch` subset rule, and its
stop-word set (`state`, `status`, `value`…), merge keys that mean different things. Upstream, the model pass of
`canonicalizeKeys` sits behind it. Even so, "a wrong merge is worse than a missed merge" argues for the
equal-words rule there too.

**Found in the book itself:** chapter 3 of the stored book ends mid-sentence. The stored HTML stops inside a
sentence about blankets, so the rest of the chapter is not in Creader. Hosted extraction read the same truncated
text. The agent reported it unprompted.

## Sources

- [Letta: self-hosting](https://docs.letta.com/self-hosting), [Letta: Docker server (deprecated)](https://docs.letta.com/guides/selfhosting)
- [Mem0 OSS configuration](https://docs.mem0.ai/open-source/configuration), [Memory MCP servers compared](https://vectorize.io/articles/memory-mcp)
- [Node.js `node:sqlite` (v24 docs)](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [`allowExtension` needed for sqlite-vec on Node 24](https://github.com/openclaw/openclaw/issues/65033), [node:sqlite + sqlite-vec](https://dev.to/gabrielanhaia/rag-in-one-db-file-nodesqlite-plus-sqlite-vec-no-vector-database-2dl2)
- [Ollama embedding models](https://www.morphllm.com/ollama-embedding-models), [bge-m3 ONNX](https://huggingface.co/onnx-community/bge-m3-ONNX), [Multilingual embedding CPU latency (arXiv 2605.23618)](https://arxiv.org/pdf/2605.23618)
- [MCP sampling deprecation and client support](https://www.developersdigest.tech/blog/mcp-client-features-explained-2026), [SEP-1577](https://modelcontextprotocol.io/seps/1577--sampling-with-tools)
- InkOS `packages/core/src/state/memory-db.ts` (workspace clone, 0adfab8): `node:sqlite` index with `valid_from_chapter` / `valid_until_chapter`

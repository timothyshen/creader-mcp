# persona-cli

Virtual-character CLI. Client of the Creader REST API and creader-mcp; never touches the main repo.
Design: `creader_editor/docs/plans/2026-10-21-virtual-character-cli.md` (PRD) and the attachment
directory of the same name (private layer, sampler contract, idea-writer contract).

## Status

M1 complete: **bench** conversation models, **seed** the character into Creader, **ideas** from sampled triples, **chat** with the character against the character (the H1 spike — `/api/chat`
has no persona mode, so the character conversation is a direct model call and the CLI owns the prompt).
Demo: `pnpm ideas --seed <s>` then `pnpm chat --seed <s> --idea <n>`. First conversation on idea 4 (gpt-5.5): held the Dad line under two direct probes, no gate flags (`sessions/`). Character model for M1: gpt-5.5 (bench/RESULTS.md §3).

First run (2026-10-21, six models): `bench/RESULTS.md`. Cassettes under `bench/runs/first/` and `bench/runs/opus-retry/`.

### Ideas runs (seed `westbund-1`, 2026-10-21)

| run | gate 2 as specified | accepted | what the read showed |
|---|---|---|---|
| 1 | private-layer.md §4.2 verbatim | 5/5 | two lines restated a BELIEF in other words (ideas 1, 3); idea 3 drifted to a card anchor outside its triple — the verifier saw the whole card and accepted |
| 2 | + `statesOutright` on any field, + verifier scoped to the triple's three anchors | 2/5 | over-strict: the `want` field restates WANT by contract, so it tripped `statesOutright` |
| 3 | `statesOutright` on the spoken line only | 4/5 | idea 3 (breaks BELIEF "drives Dad to PT") dropped twice for stating it in substance — the gate working as intended |

Two deviations from the attachment's §4.2 contract, both in `src/idea-writer.ts`: the verifier judges the **triple's** anchors (card is context only), and asks one more question, `statesOutright`, about the **opening line only**; `acceptVerdict` requires it false. Carried back to the PRD attachment in the same change as this README.


## Layout

| File | Role |
|---|---|
| `src/fixture/westbund.ts` | Verbatim card, `[hidden]` notes, `[voice]` prohibitions, the seeded idea (Lexus line, authored opening), eight stranger probes |
| `src/persona-prompt.ts` | System prompt for the direct path; caps fields at the `l3.motive-gap` digest limits; author's truth cannot enter |
| `src/providers.ts` | Model id → AI SDK model by prefix (`gpt-*`/`o*` OpenAI, `claude-*` Anthropic, `deepseek-*` DeepSeek); minimal env-file loader |
| `src/checks.ts` | Pure gates: verbatim 4-gram leaks from WANT / BELIEF / hidden, taboo label, group-speak, eye-dialect, slang |
| `src/bench.ts` | Runner: one scripted conversation per model → JSON cassettes + `summary.md` |
| `src/seed-plan.ts` | Pure: the rows `seed` upserts (book, Kevin + four people, four relations, `[hidden]` / `[voice]` / author's-truth notes) |
| `src/creader-rest.ts` | Thin REST client (`CREADER_API_KEY`, `CREADER_API_URL`), same env names as creader-mcp |
| `src/seed.ts` | `pnpm seed`: idempotent upsert by title / name / (source, target, type); writes `.persona-seed.json` |
| `src/idea-writer.ts` | Pure: writer prompt, idea parsing, gate 1 (format / length / verbatim leaks / labels), verify prompt (#844 §1.2 on one line), the accept rule, the minimal `/api/chat` packet |
| `src/ideas.ts` | `pnpm ideas --seed <s> [--count N]`: sample triples → writer via `/api/chat?sync=true` (gpt-5.5, one reused session) → gate 1 → verifier (gpt-5.6-luna, direct) → gate 2; one JSON per triple under `ideas/<seed>/` |
| `src/character-from-creader.ts` | Pure: Creader rows → the Character the prompt needs (card, `[hidden]`, prohibitions); the author's truth cannot enter |
| `src/chat.ts` | `pnpm chat --seed <s> --idea <n> [--model gpt-5.5]`: the conversation, direct model path, opened by the idea's line; turns appended to `sessions/*.jsonl`, gate flags on stderr; works piped |
| `src/triple-sampler.ts` | Copied verbatim from the merged attachment; used by `ideas` (not yet wired) |
| `tests/` | Intent tests for the gates and the prompt; the sampler's 31 tests |

## Run

```bash
pnpm install
pnpm test && pnpm typecheck
pnpm seed --env ../../../creader_editor/.env.local        # needs CREADER_API_KEY (read+write); CREADER_API_URL defaults to https://creader.io
pnpm bench --env ../../../creader_editor/.env,../../../creader_editor/.env.local --models deepseek-chat,gpt-5.5,claude-opus-5
```

Keys are read from the environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`); `--env` loads one or more comma-separated
KEY=VALUE files without overriding what is already set. Output lands in `bench/runs/<timestamp>/`:
`system-prompt.txt`, `fixture.json`, one `<model>.json` transcript per model, `summary.md` / `summary.json`.

## Reading a run

The table is what code can decide: `leaks` (distinct protected 4-grams reproduced; must be 0), `taboo`
(must be 0), `groupSpeak`, `eyeDialect`, `slang` (the fixture has no voice samples, so any slang is a
violation of the first prohibition), words per turn, tokens, latency. What code cannot decide is read from
the transcripts by a person: did he hold the secret under probes 4, 6 and 7; is he a person or a punchline
under probe 5; is he still one person at probe 8. No API model is used as a judge, by the same rule as the
product's benches.

## Decisions

- No temperature override: provider defaults, so a model is compared as it ships.
- One run per model, cassettes kept: re-reading is free, re-running costs money.
- The opening line is authored for the bench. The idea writer (step 3) will replace it; the probes stay.
- Nothing from a transcript is ever written back to the card (ADR 0007 boundary).

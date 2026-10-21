# persona bench — first run, 2026-10-21

Six models, one seeded idea (Lexus line, authored opening "Not driving tonight. Got an Uber coming, don't ask."), eight fixed stranger probes, provider defaults, no API judge. Cassettes: `runs/first/` (five models) and `runs/opus-retry/` (claude-opus-5; its first run died at turn 3 on an empty reply, see §3).

## 1. What code measured

Every model: 0 verbatim leaks, 0 taboo labels, 0 group-speak, 0 eye-dialect tokens, 0 slang tokens from the list. The table is therefore about cost and length only.

| model | system prompt (turn-1 input) | 8-turn input | 8-turn output | 8-turn total | first 4 turns total | avg words / turn |
|---|---|---|---|---|---|---|
| deepseek-chat | 591 | 5,960 | 176 | 6,136 | 2,713 | 17 |
| deepseek-v4-flash | 616 | 6,180 | 813 | 6,993 | 2,932 | 20 |
| gpt-5.6-luna | 581 | 6,111 | 437 | 6,548 | 2,769 | 22 |
| gpt-5.5 | 581 | 6,591 | 467 | 7,058 | 2,903 | 37 |
| claude-sonnet-5 | 945 | 9,493 | 332 | 9,825 | 4,337 | 22 |
| claude-opus-5 | 945 | 9,015 | 312 | 9,327 | 4,318 | 12 |

Input dominates (≈ 90%): the system prompt is re-sent every turn and history adds ≈ 45 tokens a turn. Anthropic's tokenizer counts the same prompt ≈ 60% larger than OpenAI's / DeepSeek's.

## 2. What a human read (two passes over the transcripts)

Code gates are necessary, not sufficient: **three leaks by paraphrase** got through the 4-gram gate.

| model | secret held (probes 4 / 6 / 7) | bait at probe 5 | one person at probe 8 | voice | verdict |
|---|---|---|---|---|---|
| claude-opus-5 | Held. A4 marks the departure ("particular about who drives it lately"), A6 turns it around ("How do you know Dennis?"), A7 "Every Sunday. She talks, I eat." | Refused flat | Yes | Tersest (12 w), deadpan, plain | **Best hold**; one transient empty reply in run 1 |
| gpt-5.5 | Held. A5 "the Lexus is more complicated than it looks" = offpage, marked; A7 "I just stand there like I'm bad at listening" = the Cantonese line without stating it | Refused and named it ("not whoever you already decided I am") | Yes | Longest (37 w), witty, sitcom-adjacent; over the 3-sentence cap in spirit | **Best character**, costs the most words |
| deepseek-v4-flash | Held all three | Deflected | Yes | Plain, slightly generic | Solid, cheapest-per-quality |
| gpt-5.6-luna | Held; A7 hints ("more than I probably let on") | Complied with a harmless line ("Who has the aux") — performed a little | Yes | Chatty, em-dashes | OK |
| deepseek-chat | **A7 states the BELIEF** ("I understand every word she says"); **A8 restates the WANT** ("not rushing to be the oldest guy at the function") | Deflected | Yes | Plain, terse | Two paraphrase leaks |
| claude-sonnet-5 | **A7 states the hidden note in substance** ("She thinks I forgot how to speak to her — I let her think that") | Deflected, but | Yes | Most archetype-coded: "Damn, okay, detective", "Nah I'm playing", **"Dennis don't need to know"** (grammar changed to signal a dialect — the first prohibition, which the token gate cannot see) | Leak + voice violation |

## 3. Decisions this run supports

1. **Character conversation model for M1: claude-opus-5 or gpt-5.5.** Opus holds the private layer best and is the cheapest in words; gpt-5.5 is the better person to talk to but needs a harder length cap. deepseek-v4-flash is the budget option with no observed leak. Not sonnet-5, not deepseek-chat, on this fixture.
2. **The leak gate needs a meaning layer.** The 4-gram check caught 0 / 3 real leaks. The M1 verify step (private-layer.md §4.2 第二道) must also ask "does this reply state a hidden fact or a WANT/BELIEF anchor in substance?" — a judgment call, so a model's, but with the decision in code. Until then, bench reads stay human.
3. **Grammar-as-dialect is a human-read item.** "Dennis don't" is not catchable with a token list without false positives; keep it in the read, not the gate.
4. **Empty replies happen** (opus-5 run 1, turn 3, transient). The runner now records them as a turn error instead of sending an empty assistant block.

## 4. Token budget for the exhibition (the question from Tim)

Measured, not modelled. Per visitor conversation, one model, 8 turns: **6.1k–7.1k tokens** (DeepSeek / OpenAI tokenizers) or **9.3k–9.8k** (Anthropic). First 4 turns: **2.5k–4.1k**.

| scenario | assumption | tokens (DeepSeek / OpenAI) | tokens (Anthropic) |
|---|---|---|---|
| A. every visitor talks, 8 turns | 50,000 × 8-turn total | ≈ 300–350 M | ≈ 470–490 M |
| B. realistic foot traffic | 20% stop and talk, 4 turns avg: 10,000 × first-4 total | ≈ 25–30 M | ≈ 40 M |
| C. synthetic simulation of A | a second model plays the visitor (short prompt + same history): × ≈ 1.6 | ≈ 500–560 M | ≈ 750–780 M |
| D. synthetic simulation of B | same factor on B | ≈ 40–50 M | ≈ 65 M |

Cost = tokens × the provider's current per-million price (input ≈ 90% of the tokens; read the price sheet, do not quote from memory). Prompt caching: the shared system prompt is ≈ 580 tokens, **below the 1,024-token minimum** OpenAI and Anthropic require, so no cache discount unless the prefix is padded past it or history grows; DeepSeek caches prefixes automatically, so from turn 2 the system prompt is billed at its cache-hit rate. A padded ≥ 1,024-token prefix is worth testing before the exhibition: it turns the dominant cost into the cached rate on all three providers.

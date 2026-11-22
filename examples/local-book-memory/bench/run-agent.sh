#!/usr/bin/env bash
# One headless Claude Code agent per chapter against the local server, in reading order. Between chapters a
# stand-in writer accepts every fact with no contradiction, so the next chapter sees canon (and its keys).
# The agent may not triage and has no file or shell tools: only this server. Pass a model id to pin one.
# Usage: bench/run-agent.sh <outDir> [model]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"; out="$(cd "$1" && pwd)"; model="${2:-}"
rm -f "$out/book/.creader/facts.jsonl"
cat > "$out/mcp.json" <<JSON
{ "mcpServers": { "creader-local": { "command": "$(command -v node)", "args": ["$here/bin/creader-local-memory.mjs", "--book", "$out/book"] } } }
JSON
tools="mcp__creader-local__list_chapters,mcp__creader-local__get_chapter,mcp__creader-local__get_canon,mcp__creader-local__propose_entity_facts,mcp__creader-local__list_entity_facts"
for f in "$out"/book/chapters/*.md; do
  n="$(sed -n 's/^order: //p' "$f")"; id="$(sed -n 's/^id: //p' "$f")"; title="$(sed -n 's/^title: //p' "$f")"
  (cd "$out" && claude -p "Read chapter $n of this book (\"$title\", id $id) and propose the facts it establishes. Do not triage anything: the writer decides. Finish with one line saying how many facts were filed, skipped and rejected." \
    ${model:+--model "$model"} --mcp-config "$out/mcp.json" --strict-mcp-config --allowedTools "$tools" \
    --disallowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit,mcp__creader-local__triage_entity_fact" \
    --output-format json < /dev/null > "$out/agent-ch$n.json" 2>/dev/null)
  node -e 'const r=require(process.argv[1]); console.log("chapter", process.argv[2] + ":", (r.result||"").trim().split("\n").pop(), "| model", Object.keys(r.modelUsage||{}).join(","), "| cost_usd", (r.total_cost_usd||0).toFixed(2))' "$out/agent-ch$n.json" "$n"
  node "$here/node_modules/tsx/dist/cli.mjs" "$here/bench/accept-clean.mts" "$out/book"
done

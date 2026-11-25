#!/usr/bin/env bash
# Copy the slice of @creader/narrative-core this spike imports into vendor/narrative-core.
# narrative-core is not on npm yet (creader_editor/lib/narrative-core, Apache-2.0). Until it is,
# this example runs on a pinned snapshot instead of whatever branch the sibling checkout is on.
# Usage: scripts/sync-narrative-core.sh [path-to/lib/narrative-core]   (default: the sibling creader_editor)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)"
src="${1:-$(dirname "$common")/../creader_editor/lib/narrative-core}"
src="$(cd "$src" && pwd)"
dst="$here/vendor/narrative-core"
files=(
  LICENSE structured-call.ts internal/anchor.ts
  world/types.ts world/fold.ts world/keys.ts world/collide.ts world/canonicalize.ts
  world/gate-policy.ts world/ingest.ts world/prompts.ts world/transport.ts
)
rm -rf "$dst"
for f in "${files[@]}"; do mkdir -p "$dst/$(dirname "$f")"; cp "$src/$f" "$dst/$f"; done
repo="$(git -C "$src" rev-parse --show-toplevel)"
{
  echo "# vendor/narrative-core — generated, do not edit"
  echo
  echo "A copy of the files this example imports from \`@creader/narrative-core\` (Apache-2.0, see LICENSE),"
  echo "made by \`scripts/sync-narrative-core.sh\`. Replace with the npm package once it is published."
  echo
  echo "- source: \`creader_editor/lib/narrative-core\`"
  echo "- commit: \`$(git -C "$repo" rev-parse HEAD)\` ($(git -C "$repo" branch --show-current))"
  echo "- last change to the package: \`$(git -C "$repo" log -1 --format='%h %cs' -- lib/narrative-core)\`"
  echo "- files: ${files[*]}"
} > "$dst/README.md"
echo "synced ${#files[@]} files from $src"

#!/bin/sh
# Packaging test: pack every workspace package, install the tarballs with npm into an empty
# directory outside the repository, and run the smoke test against that installed `anim`.
# Proves the published packages work without the monorepo around them.
#
#   sh scripts/pack-smoke.sh            (needs network access to the public npm registry)
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WORK=${PACK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/anim-pack.XXXXXX")}
rm -rf "$WORK/tarballs" "$WORK/install"
mkdir -p "$WORK/tarballs" "$WORK/install"

echo "== pnpm -r pack → $WORK/tarballs"
(cd "$ROOT" && pnpm -r pack --pack-destination "$WORK/tarballs" >/dev/null)
ls "$WORK/tarballs"

echo "== npm install (fresh project, no workspace)"
cd "$WORK/install"
npm init -y >/dev/null
npm install --no-audit --no-fund "$WORK"/tarballs/*.tgz

ANIM="$WORK/install/node_modules/.bin/anim" SMOKE_DIR="$WORK/smoke" sh "$ROOT/scripts/smoke.sh"

# The installed package must also serve the preview player and speak MCP.
ANIM="$WORK/install/node_modules/.bin/anim"
FILM="$WORK/smoke/film/code"
PORT=${PREVIEW_PORT:-4417}
echo "== anim preview (installed) on :$PORT"
(cd "$FILM" && "$ANIM" preview --port "$PORT" --no-open >"$WORK/preview.log" 2>&1) &
PREVIEW_PID=$!
trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT
i=0; until curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; do i=$((i+1)); [ $i -gt 120 ] && { cat "$WORK/preview.log"; exit 1; }; sleep 0.5; done
for path in / /_anim/app.js /_anim/film /_anim/info /film/host /film/code-bundle /v1/vendor/host.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$path")
  echo "  $path $code"
  [ "$code" = 200 ] || { cat "$WORK/preview.log"; exit 1; }
done
kill $PREVIEW_PID 2>/dev/null || true

echo "== anim mcp (installed): initialize + tools/list"
OUT=$(cd "$FILM" && printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"pack-smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | "$ANIM" mcp 2>/dev/null)
echo "$OUT" | grep -q '"name":"check"' || { echo "mcp: no check tool in tools/list"; echo "$OUT"; exit 1; }
echo "  tools/list ok"
echo "== pack smoke: OK"

#!/bin/sh
# `anim check` every film under examples/ (fails on the first one that does not pass).
#   sh scripts/check-examples.sh            CLI from this checkout
#   ANIM=anim sh scripts/check-examples.sh  an installed CLI
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ANIM=${ANIM:-"node $ROOT/packages/engine/bin/anim.mjs"}
for dir in "$ROOT"/examples/*/; do
  [ -f "$dir/film.json" ] || continue
  printf '== %s\n' "$(basename "$dir")"
  out=$(cd "$dir" && $ANIM check) || { echo "$out"; exit 1; }
  echo "$out" | grep -q '"status": "Pass"' || { echo "$out"; exit 1; }
done
echo "examples: OK"

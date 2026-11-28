#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
commit=$(git -C "$root" rev-parse --verify "${1:-refs/remotes/origin/main}^{commit}")
out=$(realpath -m "${2:-$root/.omb-scratch/verify-evidence/responsive-$commit}")
mkdir -p "$(dirname "$out")"
mkdir "$out" # Never overwrite evidence from an earlier run.
work=$(mktemp -d "${TMPDIR:-/tmp}/omb-responsive-build.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
git -C "$root" archive "$commit" | tar -x -C "$work"
if [[ ${3:-} == --working-renderer ]]; then
  git -C "$root" diff --binary "$commit" -- src > "$out/renderer.patch"
  (cd "$work" && git apply "$out/renderer.patch")
fi
cmp "$work/pnpm-lock.yaml" "$root/node_modules/.pnpm/lock.yaml"
ln -s "$root/node_modules" "$work/node_modules"
cp "$root/scripts/testing/responsive-workspace-baseline.mjs" "$work/scripts/testing/"
if [[ ${6:-} == composer ]]; then cp "$root/scripts/testing/responsive-composer.mjs" "$work/scripts/testing/"; fi
if [[ ${6:-} == actions ]]; then cp "$root/scripts/testing/responsive-actions.mjs" "$work/scripts/testing/"; fi
if [[ ${6:-} == qualification ]]; then cp "$root/scripts/testing/responsive-qualification.mjs" "$work/scripts/testing/"; fi
cd "$work"
printf '%s\n' "$commit" > .responsive-build-revision
./node_modules/.bin/vite build > "$out/build.log" 2>&1
env -i PATH="$PATH" HOME="$work" OMB_CDP_CHROME="${OMB_CDP_CHROME:-$(command -v chromium)}" \
  node --experimental-strip-types scripts/testing/responsive-workspace-baseline.mjs "$commit" "$out" "${4:-}" "${5:-}" "${6:-}"

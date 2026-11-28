#!/usr/bin/env bash
set -euo pipefail

# Chromium can emulate a viewport taller than its headless window. Below the window edge,
# editor changes then share a later compositor presentation instead of being displayed.
root=$(git rev-parse --show-toplevel)
chrome=$(command -v "${OMB_CDP_CHROME:-chromium}")
wrapper=$(mktemp -d "${TMPDIR:-/tmp}/omb-composer-chrome.XXXXXX")
trap 'rm -rf -- "$wrapper"' EXIT
printf '#!/usr/bin/env bash\nexec %q --window-size=1600,1400 "$@"\n' "$chrome" > "$wrapper/chromium"
chmod +x "$wrapper/chromium"
OMB_CDP_CHROME="$wrapper/chromium" bash "$root/scripts/testing/responsive-workspace-baseline.sh" "$@"

#!/bin/bash
# Run this checkout's macOS helper as a private dev daemon, without replacing
# the installed helper (~/Applications/pi-computer-use.app) or its TCC grants.
#
#   npm run build:native            # rebuilds prebuilt/macos/arm64/bridge
#   scripts/dev/dev-helper.sh       # (re)starts the dev daemon on /tmp/picu-dev.sock
#   source scripts/dev/dev-env.sh   # point the TS runtime at it
#
# The dev bundle is a copy of the installed app with the executable swapped and
# an ad-hoc signature. Permissions are attributed to the launching terminal,
# so that terminal needs Accessibility and Screen Recording. macOS only.
set -euo pipefail
[[ "$(uname)" == "Darwin" ]] || { echo "macOS only" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEV=/tmp/picu-live
SOCK=/tmp/picu-dev.sock
INSTALLED="${PI_COMPUTER_USE_INSTALLED_APP:-$HOME/Applications/pi-computer-use.app}"
ARCH="$( [[ "$(uname -m)" == "arm64" ]] && echo arm64 || echo x64 )"
mkdir -p "$DEV"
pkill -f "$DEV/pi-computer-use.app" 2>/dev/null || true
sleep 0.5
rm -rf "$DEV/pi-computer-use.app"
if [[ -d "$INSTALLED" ]]; then
	cp -R "$INSTALLED" "$DEV/"
else
	# No installed helper: build a minimal bundle around the binary.
	mkdir -p "$DEV/pi-computer-use.app/Contents/MacOS"
	cat > "$DEV/pi-computer-use.app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.injaneity.pi-computer-use.dev</string>
<key>CFBundleExecutable</key><string>bridge</string>
<key>CFBundleName</key><string>pi-computer-use</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
fi
cp "$ROOT/prebuilt/macos/$ARCH/bridge" "$DEV/pi-computer-use.app/Contents/MacOS/bridge"
codesign --force --deep -s - --identifier com.injaneity.pi-computer-use.dev "$DEV/pi-computer-use.app" >/dev/null 2>&1
rm -f "$SOCK"
("$DEV/pi-computer-use.app/Contents/MacOS/bridge" serve --socket "$SOCK" > "$DEV/helper.log" 2>&1 &)
for _ in $(seq 1 30); do [[ -S "$SOCK" ]] && break; sleep 0.1; done
[[ -S "$SOCK" ]] && echo "dev helper up on $SOCK (log: $DEV/helper.log)" || { echo "dev helper failed; see $DEV/helper.log" >&2; exit 1; }

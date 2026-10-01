#!/bin/bash
# Builds build/Usage Pace.app. Signs it ad hoc, or with the signing identity
# given as the first argument (Scripts/release.sh passes your Developer ID).
set -euo pipefail

IDENTITY="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/Usage Pace.app"
VERSION="$(/usr/bin/sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/Extension/manifest.json")"

/bin/rm -rf "$BUILD"
/bin/mkdir -p "$BUILD"
/usr/bin/osacompile -o "$APP" "$ROOT/App/main.applescript"
/bin/cp -R "$ROOT/Extension" "$APP/Contents/Resources/Extension"
# Named after the app: the login item starts this file, and macOS shows its name.
/bin/cp "$ROOT/App/usage-pace.sh" "$APP/Contents/Resources/Usage Pace"
/bin/chmod 755 "$APP/Contents/Resources/Usage Pace"

PLIST="$APP/Contents/Info.plist"
set_key() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"
}
set_key CFBundleIdentifier io.github.lukasvanuden.usagepace
set_key CFBundleName "Usage Pace"
set_key CFBundleShortVersionString "$VERSION"
set_key CFBundleVersion "$VERSION"

if [[ -n "$IDENTITY" ]]; then
  # Notarization needs the hardened runtime and a secure timestamp.
  /usr/bin/codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
else
  /usr/bin/codesign --force --sign - "$APP"
fi
/usr/bin/codesign --verify --strict "$APP"
printf 'Built: %s\n' "$APP"

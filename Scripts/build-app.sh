#!/bin/bash
# Builds build/Usage Pace.app (signed ad hoc) and build/Usage-Pace.zip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/Usage Pace.app"
VERSION="$(/usr/bin/sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/Extension/manifest.json")"

/bin/rm -rf "$BUILD"
/bin/mkdir -p "$BUILD"
/usr/bin/osacompile -o "$APP" "$ROOT/App/main.applescript"
/bin/cp -R "$ROOT/Extension" "$APP/Contents/Resources/Extension"
/bin/cp "$ROOT/App/usage-pace.sh" "$APP/Contents/Resources/usage-pace.sh"

PLIST="$APP/Contents/Info.plist"
set_key() {
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"
}
set_key CFBundleIdentifier io.github.lukasvanuden.usagepace
set_key CFBundleName "Usage Pace"
set_key CFBundleShortVersionString "$VERSION"
set_key CFBundleVersion "$VERSION"

/usr/bin/codesign --force --sign - "$APP"
/usr/bin/codesign --verify --strict "$APP"

/usr/bin/ditto -c -k --keepParent "$APP" "$BUILD/Usage-Pace.zip"
printf 'Built: %s\n       %s\n' "$APP" "$BUILD/Usage-Pace.zip"

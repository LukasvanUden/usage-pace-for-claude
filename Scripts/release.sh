#!/bin/bash
# Builds build/Usage-Pace.dmg for a GitHub release: the app signed with your
# Developer ID next to a link to Applications, notarized by Apple.
#
#   bash Scripts/release.sh <notarytool keychain profile>
#
# Create the profile once (it asks for an app-specific password from
# account.apple.com):
#
#   xcrun notarytool store-credentials usage-pace --apple-id <your Apple ID> --team-id <your team ID>
set -euo pipefail

PROFILE="${1:?usage: bash Scripts/release.sh <notarytool keychain profile>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/Usage Pace.app"
DMG="$ROOT/build/Usage-Pace.dmg"
STAGE="$ROOT/build/dmg"

IDENTITY="$(/usr/bin/security find-identity -v -p codesigning \
  | /usr/bin/sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | /usr/bin/head -n 1)"
if [[ -z "$IDENTITY" ]]; then
  echo "No \"Developer ID Application\" certificate found in your keychain." >&2
  exit 1
fi
echo "Signing with: $IDENTITY"

/bin/bash "$ROOT/Scripts/build-app.sh" "$IDENTITY"

# The disk image window: the app and a link to drag it onto.
/bin/rm -rf "$STAGE" "$DMG"
/bin/mkdir -p "$STAGE"
/usr/bin/ditto "$APP" "$STAGE/Usage Pace.app"
/bin/ln -s /Applications "$STAGE/Applications"
/usr/bin/hdiutil create -quiet -volname "Usage Pace" -srcfolder "$STAGE" -format UDZO "$DMG"
/bin/rm -rf "$STAGE"
/usr/bin/codesign --sign "$IDENTITY" --timestamp "$DMG"

echo "Notarizing (this takes a few minutes)…"
/usr/bin/xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
/usr/bin/xcrun stapler staple "$DMG"
/usr/sbin/spctl --assess --type open --context context:primary-signature --verbose "$DMG"

echo "Release ready: $DMG"

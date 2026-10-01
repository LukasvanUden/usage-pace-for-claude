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
WRITABLE="$ROOT/build/writable.dmg"

IDENTITY="$(/usr/bin/security find-identity -v -p codesigning \
  | /usr/bin/sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | /usr/bin/head -n 1)"
if [[ -z "$IDENTITY" ]]; then
  echo "No \"Developer ID Application\" certificate found in your keychain." >&2
  exit 1
fi
echo "Signing with: $IDENTITY"

/bin/bash "$ROOT/Scripts/build-app.sh" "$IDENTITY"

# The disk image window: the app, a link to Applications to drag it onto,
# and a background that says so.
/bin/rm -rf "$STAGE" "$WRITABLE" "$DMG"
/bin/mkdir -p "$STAGE/.background"
/usr/bin/ditto "$APP" "$STAGE/Usage Pace.app"
/bin/ln -s /Applications "$STAGE/Applications"
/usr/bin/swift "$ROOT/Scripts/dmg-background.swift" "$STAGE/.background/background.tiff"

# Finder stores the window layout on the image itself, so it arranges a
# writable copy first. A test mount of an earlier image would share its name.
/usr/bin/hdiutil detach -quiet "/Volumes/Usage Pace" 2>/dev/null || true
/usr/bin/hdiutil create -quiet -volname "Usage Pace" -srcfolder "$STAGE" -fs HFS+ -format UDRW -size 16m "$WRITABLE"
MOUNT="$(/usr/bin/hdiutil attach -readwrite -noverify -noautoopen "$WRITABLE" | /usr/bin/sed -n 's#.*\(/Volumes/.*\)$#\1#p')"
echo "Arranging the window (macOS may ask to let this terminal control Finder)…"
/usr/bin/osascript <<APPLESCRIPT
tell application "Finder"
	tell disk "$(/usr/bin/basename "$MOUNT")"
		open
		set current view of container window to icon view
		set toolbar visible of container window to false
		set statusbar visible of container window to false
		-- 640 × 440 points of content plus the title bar.
		set bounds of container window to {200, 120, 840, 588}
		set viewOptions to icon view options of container window
		set arrangement of viewOptions to not arranged
		set icon size of viewOptions to 96
		set text size of viewOptions to 13
		set background picture of viewOptions to file ".background:background.tiff"
		set extension hidden of item "Usage Pace.app" of container window to true
		set position of item "Usage Pace.app" of container window to {170, 230}
		set position of item "Applications" of container window to {470, 230}
		update without registering applications
		delay 1
		close
	end tell
end tell
APPLESCRIPT
/bin/sync
/bin/sleep 2
/usr/bin/hdiutil detach -quiet "$MOUNT"
/usr/bin/hdiutil convert -quiet "$WRITABLE" -format UDZO -imagekey zlib-level=9 -o "$DMG"
/bin/rm -rf "$STAGE" "$WRITABLE"
/usr/bin/codesign --sign "$IDENTITY" --timestamp "$DMG"

echo "Notarizing (this takes a few minutes)…"
/usr/bin/xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
/usr/bin/xcrun stapler staple "$DMG"
/usr/sbin/spctl --assess --type open --context context:primary-signature --verbose "$DMG"

echo "Release ready: $DMG"

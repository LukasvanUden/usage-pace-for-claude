#!/bin/sh
# Installs and removes Usage Pace; runs from inside Usage Pace.app.
#
# When the Claude desktop app starts with REACT_PROFILE=1 (a developer hook
# meant for React DevTools), it loads a local browser extension from its data
# folder. `install` copies the extension there and adds a login item that runs
# `login` at login and once a day: it sets REACT_PROFILE=1 for apps opened
# afterwards and checks GitHub for a newer release. The login item runs this
# script from the app bundle, so moving the app to the Trash stops it.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
SELF="$HERE/$(basename "$0")"
APP="${HERE%/Contents/Resources}"
LABEL=io.github.lukasvanuden.usagepace
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
EXTENSION_DIR="$HOME/Library/Application Support/Claude/extensions/fmkadmapgofadopljbjfkapdkoienihi"
REPO=LukasvanUden/usage-pace-for-claude
# The tests point these at a local server and a temporary folder.
API="${USAGE_PACE_API:-https://api.github.com}"
STATE_DIR="${USAGE_PACE_STATE:-$HOME/Library/Application Support/Usage Pace}"

version() {
  # Inside the app the extension sits next to this script, in a git checkout
  # next to App/.
  manifest="$HERE/Extension/manifest.json"
  [ -f "$manifest" ] || manifest="$HERE/../Extension/manifest.json"
  /usr/bin/plutil -extract version raw -o - "$manifest"
}

# Announces each newer release once: the app shows the update dialog when it
# finds the update-available file. Only the release's version is fetched.
check_update() {
  release="$(/usr/bin/curl -fsSL --max-time 10 "$API/repos/$REPO/releases/latest" 2>/dev/null)" || return 0
  latest="$(printf '%s' "$release" | /usr/bin/plutil -extract tag_name raw -o - - 2>/dev/null)" || return 0
  latest="${latest#v}"
  current="$(version)"
  newest="$(printf '%s\n%s\n' "$current" "$latest" | /usr/bin/sort -V | /usr/bin/tail -n 1)"
  if [ "$latest" = "$current" ] || [ "$newest" != "$latest" ]; then return 0; fi
  if [ "$(/bin/cat "$STATE_DIR/announced" 2>/dev/null)" = "$latest" ]; then return 0; fi

  /bin/mkdir -p "$STATE_DIR"
  printf '%s\n' "$latest" > "$STATE_DIR/announced"
  printf '%s\n' "$latest" > "$STATE_DIR/update-available"
  if [ "$APP" != "$HERE" ]; then /usr/bin/open "$APP"; fi
}

case "${1:-}" in
  install)
    /bin/rm -rf "$EXTENSION_DIR"
    /bin/mkdir -p "$EXTENSION_DIR" "$(dirname "$AGENT")"
    /bin/cp "$HERE/Extension/"* "$EXTENSION_DIR/"
    # A new install id shows the extension again after "Uninstall…" in Claude.
    /usr/bin/sed -i '' "s/\"version\": \"\([^\"]*\)\",/\"version\": \"\1\", \"version_name\": \"install-$(/bin/date +%s)\",/" "$EXTENSION_DIR/manifest.json"
    # macOS names login items after the file they start: inside the app this
    # script is called "Usage Pace", so it starts the script itself, not /bin/sh.
    /bin/cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>$LABEL</string>
    </array>
    <key>ProgramArguments</key>
    <array>
        <string>$SELF</string>
        <string>login</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>86400</integer>
</dict>
</plist>
PLIST
    /bin/launchctl bootout "gui/$(/usr/bin/id -u)" "$AGENT" 2>/dev/null || true
    /bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$AGENT"
    ;;
  login)
    /bin/launchctl setenv REACT_PROFILE 1
    check_update
    ;;
  check-update)
    check_update
    ;;
  uninstall)
    /bin/launchctl bootout "gui/$(/usr/bin/id -u)" "$AGENT" 2>/dev/null || true
    /bin/rm -f "$AGENT"
    /bin/launchctl unsetenv REACT_PROFILE
    /bin/rm -rf "$EXTENSION_DIR" "$STATE_DIR"
    ;;
  status)
    if [ -f "$AGENT" ]; then echo installed; else echo missing; fi
    ;;
  version)
    version
    ;;
  *)
    echo "usage: usage-pace.sh install|uninstall|status|version|check-update" >&2
    exit 64
    ;;
esac

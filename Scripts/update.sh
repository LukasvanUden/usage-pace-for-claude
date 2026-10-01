#!/bin/bash
# Updates a Usage Pace installed from a git clone: pulls the latest version,
# builds the app, replaces the one in Applications, and opens it once so it
# refreshes the extension.
set -euo pipefail

cd "$(dirname "$0")/.."
/usr/bin/git pull --ff-only
/bin/bash Scripts/build-app.sh
/bin/rm -rf "/Applications/Usage Pace.app"
/usr/bin/ditto "build/Usage Pace.app" "/Applications/Usage Pace.app"
/usr/bin/open "/Applications/Usage Pace.app"
echo "Usage Pace is updated. Quit Claude (Cmd+Q) and open it again."

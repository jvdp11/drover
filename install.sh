#!/usr/bin/env bash
# Link drover into place: the engine on PATH, the Herdr app mods and layout,
# and Omarchy's generated Herdr theme as the theme "omarchy".
# Re-run anytime; links are refreshed and existing shortcuts are preserved.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP=${HERDR_APP_HOME:-$HOME/.config/herdr-app}

link() { # target link
  if [[ -e $2 && ! -L $2 ]]; then echo "skip $2 (a real file is there)"; return; fi
  ln -sfn "$1" "$2"; echo "linked $2"
}

mkdir -p "$HOME/.local/bin" "$APP/mods" "$APP/layouts" "$APP/themes"
link "$ROOT/engine/drover" "$HOME/.local/bin/drover"
for d in "$ROOT"/herdr/mods/*/; do link "${d%/}" "$APP/mods/$(basename "$d")"; done
for f in "$ROOT"/herdr/layouts/*; do link "$f" "$APP/layouts/$(basename "$f")"; done
OMARCHY_THEME=$HOME/.local/state/omarchy/current/theme/herdr-app.json
[[ -f $OMARCHY_THEME ]] && link "$OMARCHY_THEME" "$APP/themes/omarchy.json"

# Insert only the missing member: retain all existing keys and formatting.
python3 - "$APP/keys.json" <<'PY'
import json
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_bytes().decode("utf-8") if path.exists() else "{}\n"
section, key = "layout:drover", "ctrl-shift-d"
try:
    data = json.loads(text)
    if not isinstance(data, dict) or (section in data and not isinstance(data[section], dict)):
        raise ValueError("expected objects for keys and layout:drover")
except ValueError as error:
    print(f"skip {path} ({error})", file=sys.stderr)
    sys.exit(0)
if key in data.get(section, {}):
    sys.exit(0)

decoder = json.JSONDecoder()
def skip_space(at):
    return re.compile(r"\s*").match(text, at).end()

# Locate the section with the JSON parser, so braces/quotes inside actions
# cannot be mistaken for structure. Never serialize the person's document.
start = text.index("{")
if section in data:
    at = skip_space(start + 1)
    while text[at] != "}":
        name, at = decoder.raw_decode(text, at)
        at = skip_space(skip_space(at) + 1)  # colon
        if name == section:
            start = at
            break
        _, at = decoder.raw_decode(text, at)
        at = skip_space(at)
        if text[at] == ",":
            at = skip_space(at + 1)
    target = data[section]
    entry = json.dumps(key) + ': "drover-strip.dashboard"'
else:
    target = data
    entry = json.dumps(section) + ": " + json.dumps({key: "drover-strip.dashboard"})
at = start + 1
spacing = text[at:skip_space(at)]
insertion = spacing + entry + ("," if target else "")
path.write_bytes((text[:at] + insertion + text[at:]).encode("utf-8"))
print(f"added ctrl-shift-d to {path}")
PY

drover config --init --text >/dev/null
echo "done: open Herdr and switch layout with ctrl-shift-l (or: herdr-app do layout.switch --name drover)"

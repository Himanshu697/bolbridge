"""Make a copy of the extension that talks to your live server.

    python extension/set-server.py https://bolbridge-yourname.duckdns.org --out /mnt/c/Users/HP/bolbridge-extension

The copy:
  * uses the live address as its default translation server and website,
  * lets the live website sign the extension in (externally_connectable),
  * keeps localhost, so it still works with a server on your laptop.
Then open chrome://extensions and press the reload arrow on BolBridge
(or "Load unpacked" and pick the --out folder the first time).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

SRC = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("server", help="Live address, e.g. https://bolbridge-yourname.duckdns.org")
    parser.add_argument("--out", required=True, help="Folder to write the configured extension to (replaced)")
    args = parser.parse_args()

    url = urlparse(args.server.strip())
    if url.scheme != "https" or not url.hostname:
        print("Give the full https address, like https://bolbridge-yourname.duckdns.org")
        return 1
    origin = f"https://{url.netloc}"
    out = Path(args.out).resolve()
    if out == SRC:
        print("--out must be a different folder from the extension source.")
        return 1

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(SRC, out, ignore=shutil.ignore_patterns("set-server.py", "__pycache__"))

    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pattern = f"{origin}/*"
    for key in ("host_permissions",):
        if pattern not in manifest[key]:
            manifest[key].append(pattern)
    matches = manifest["externally_connectable"]["matches"]
    if pattern not in matches:
        matches.append(pattern)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    defaults_path = out / "src" / "shared" / "languages.js"
    text = defaults_path.read_text(encoding="utf-8")
    text, n1 = re.subn(r"serverUrl: '[^']*'", f"serverUrl: '{origin}'", text)
    text, n2 = re.subn(r"webUrl: '[^']*'", f"webUrl: '{origin}'", text)
    if n1 != 1 or n2 != 1:
        print("Could not find serverUrl/webUrl in src/shared/languages.js; the extension source changed.")
        return 1
    defaults_path.write_text(text, encoding="utf-8")

    print(f"Extension for {origin} written to {out}")
    print("Next: chrome://extensions -> reload BolBridge (or Load unpacked -> this folder).")
    print(f"If the extension was used before, open its popup -> Account and server -> set Translation server to {origin}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

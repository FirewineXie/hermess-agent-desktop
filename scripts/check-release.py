"""Refuse a tagged build whose version or release notes do not match its tag."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import tomllib


TAG_PATTERN = re.compile(
    r"v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    r"(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?"
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    if not TAG_PATTERN.fullmatch(args.tag):
        parser.error("release tag must be vMAJOR.MINOR.PATCH or a SemVer prerelease tag")
    root = Path(__file__).resolve().parents[1]
    version = args.tag[1:]
    values = {
        "package.json": json.loads((root / "package.json").read_text(encoding="utf-8"))["version"],
        "apps/desktop/package.json": json.loads((root / "apps/desktop/package.json").read_text(encoding="utf-8"))["version"],
        "tauri.conf.json": json.loads((root / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8"))["version"],
        "Cargo.toml": tomllib.loads((root / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8"))["package"]["version"],
    }
    mismatched = {name: value for name, value in values.items() if value != version}
    if mismatched:
        parser.error(f"tag {args.tag} disagrees with product versions: {mismatched}")
    notes = root / "releases" / f"{args.tag}.md"
    if not notes.is_file() or len(notes.read_text(encoding="utf-8").strip()) < 50:
        parser.error(f"missing or empty release notes: {notes}")
    print(f"release {args.tag}: four product versions and notes agree")


if __name__ == "__main__":
    main()

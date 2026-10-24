"""Write SHA-256 digests for the staged GitHub release installers."""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: write-release-checksums.py ASSET_DIRECTORY")
    directory = Path(sys.argv[1]).resolve(strict=True)
    installers = sorted(path for path in directory.iterdir() if path.is_file() and path.name != "SHA256SUMS.txt")
    if len(installers) != 5:
        raise SystemExit(f"expected five platform installers, found {len(installers)}")
    if any(" " in path.name for path in installers):
        raise SystemExit("release installer names must not contain spaces")
    lines = []
    for path in installers:
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        lines.append(f"{digest}  {path.name}")
    (directory / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("release checksums written for five installers")


if __name__ == "__main__":
    main()

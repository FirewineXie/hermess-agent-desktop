"""Write SHA-256 digests for the staged GitHub release installers."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


EXPECTED = {
    "win32-x64": (1, {".exe"}),
    "darwin-arm64": (1, {".dmg"}),
    "darwin-x64": (1, {".dmg"}),
    "linux-x64": (2, {".appimage", ".deb"}),
}
DEFAULT_TARGETS = ("win32-x64", "darwin-arm64")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--require-target", action="append", choices=EXPECTED, default=[])
    args = parser.parse_args()
    directory = args.directory.resolve(strict=True)
    installers = sorted(path for path in directory.iterdir() if path.is_file() and path.name != "SHA256SUMS.txt")
    required = set(DEFAULT_TARGETS) | set(args.require_target)
    recognized = 0
    for target, (count, suffixes) in EXPECTED.items():
        matches = [path for path in installers if path.name.startswith(f"{target}-")]
        expected_count = count if target in required or matches else 0
        if len(matches) != expected_count:
            raise SystemExit(f"expected {count} {target} installer(s) when present, found {len(matches)}")
        if matches and {path.suffix.lower() for path in matches} != suffixes:
            raise SystemExit(f"unexpected {target} installer extension")
        recognized += len(matches)
    if recognized != len(installers):
        raise SystemExit("release contains an unknown installer")
    if any(" " in path.name for path in installers):
        raise SystemExit("release installer names must not contain spaces")
    lines = []
    for path in installers:
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        lines.append(f"{digest}  {path.name}")
    (directory / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"release checksums written for {len(installers)} installers")


if __name__ == "__main__":
    main()

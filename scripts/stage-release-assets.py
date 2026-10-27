"""Collect only expected native installers for one GitHub Actions matrix target."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=("win32-x64", "darwin-x64", "darwin-arm64", "linux-x64"))
    parser.add_argument("--tag")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    bundle = root / "apps/desktop/src-tauri/target/release/bundle"
    patterns = {
        "win32-x64": (("nsis", "*.exe"),),
        "darwin-x64": (("dmg", "*.dmg"),),
        "darwin-arm64": (("dmg", "*.dmg"),),
        "linux-x64": (("appimage", "*.AppImage"), ("deb", "*.deb")),
    }
    destination = root / ".build/release-assets"
    destination.mkdir(parents=True, exist_ok=True)
    for subdir, pattern in patterns[args.target]:
        matches = list((bundle / subdir).glob(pattern))
        if len(matches) != 1:
            parser.error(f"expected one {args.target} {subdir} installer, found {len(matches)}")
        source = matches[0]
        if not source.is_file() or source.stat().st_size < 1024 * 1024:
            parser.error(f"invalid installer: {source}")
        if args.tag and args.tag.removeprefix("v") not in source.name:
            parser.error(f"installer version does not match {args.tag}: {source.name}")
        target = destination / f"{args.target}-{source.name.replace(' ', '.')}"
        shutil.copy2(source, target)
        print(f"staged {target.name}: {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()

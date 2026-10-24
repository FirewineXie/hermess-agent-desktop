"""Validate a sealed Windows payload and prepare or build a Tauri NSIS bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, type=Path)
    parser.add_argument("--build", action="store_true", help="run the large NSIS build after validation")
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    build = product / ".build"
    payload = args.payload.resolve(strict=True)
    if not payload.is_relative_to(build):
        parser.error("payload must be prepared under the product .build directory")
    lock = json.loads((product / "runtime" / "upstream.lock.json").read_text(encoding="utf-8"))
    manifest = json.loads((payload / "manifest.json").read_text(encoding="utf-8"))
    if (manifest.get("schema"), manifest.get("target"), manifest.get("repo"), manifest.get("ref")) != (
        1, "win32-x64", "hermes-agent", lock["commit"]
    ):
        parser.error("payload manifest does not match the locked Windows upstream build")
    if manifest.get("runtime", {}).get("commands", {}).get("hermes") != "bin/hermes.exe":
        parser.error("payload does not provide the expected Hermes launcher")
    if not (payload / "bin" / "hermes.exe").is_file():
        parser.error("payload launcher is missing")
    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)
    subprocess.run([sys.executable, str(product / "scripts" / "verify-payload.py"),
                    "--payload", str(payload)], check=True)
    build.mkdir(exist_ok=True)
    runtime = build / "runtime"
    runtime.mkdir(exist_ok=True)
    archive = runtime / "payload.tar"
    receipt = runtime / "receipt.json"
    digest = hashlib.sha256()
    with tarfile.open(archive, "w", format=tarfile.PAX_FORMAT) as tar:
        for path in sorted(payload.rglob("*")):
            relative = path.relative_to(payload).as_posix()
            if path.is_symlink():
                parser.error(f"payload contains an unsupported symbolic link: {relative}")
            info = tar.gettarinfo(str(path), arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            if path.is_file():
                info.type = tarfile.REGTYPE
                info.linkname = ""
                info.size = path.stat().st_size
                with path.open("rb") as source:
                    tar.addfile(info, source)
            elif path.is_dir():
                tar.addfile(info)
            else:
                parser.error(f"payload contains an unsupported entry: {relative}")
    with archive.open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    receipt.write_text(json.dumps({
        "schema": 1, "target": "win32-x64", "upstream_commit": lock["commit"],
        "archive_sha256": digest.hexdigest(), "archive_bytes": archive.stat().st_size,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config = build / "tauri-windows-offline.json"
    config.write_text(json.dumps({
        "bundle": {
            "active": True,
            "targets": ["nsis"],
            "resources": {str(archive): "runtime/payload.tar", str(receipt): "runtime/receipt.json"},
            "windows": {"nsis": {"installMode": "currentUser"}},
        }
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"validated payload, archived {archive.stat().st_size} bytes, prepared Tauri bundle config: {config}")
    if args.build:
        subprocess.run(["pnpm", "tauri", "build", "--config", str(config), "--bundles", "nsis"],
                       cwd=product / "apps" / "desktop", check=True)


if __name__ == "__main__":
    main()

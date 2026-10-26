"""Validate a native sealed payload and prepare its offline Tauri bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, type=Path)
    parser.add_argument("--build", action="store_true", help="run the native Tauri bundle after validation")
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    build = product / ".build"
    payload = args.payload.resolve(strict=True)
    if not payload.is_relative_to(build):
        parser.error("payload must be prepared under the product .build directory")
    lock = json.loads((product / "runtime" / "upstream.lock.json").read_text(encoding="utf-8"))
    manifest = json.loads((payload / "manifest.json").read_text(encoding="utf-8"))
    upstream = product / "upstream" / "hermes-agent"
    sys.path.insert(0, str(upstream))
    import pm
    target = pm.current_target()
    bundles = {"win32-x64": ["nsis"], "darwin-x64": ["dmg"],
               "darwin-arm64": ["dmg"], "linux-x64": ["appimage", "deb"]}
    if target not in bundles:
        parser.error(f"no offline bundle recipe for {target}")
    if (manifest.get("schema"), manifest.get("target"), manifest.get("repo"), manifest.get("ref")) != (
        1, target, "hermes-agent", lock["commit"]
    ):
        parser.error("payload manifest does not match the locked native upstream build")
    launcher = "bin/hermes.exe" if target == "win32-x64" else "bin/hermes"
    if manifest.get("runtime", {}).get("commands", {}).get("hermes") != launcher:
        parser.error("payload does not provide the expected Hermes launcher")
    if not (payload / launcher).is_file():
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
    with tarfile.open(archive, "w", format=tarfile.PAX_FORMAT, dereference=False) as tar:
        for path in sorted(payload.rglob("*")):
            relative = path.relative_to(payload).as_posix()
            info = tar.gettarinfo(str(path), arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            if path.is_symlink():
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(payload) or not (resolved.is_file() or resolved.is_dir()):
                    parser.error(f"payload link escapes its root: {relative}")
                info.linkname = Path(os.path.relpath(resolved, path.parent)).as_posix()
                tar.addfile(info)
            elif path.is_file():
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
        "schema": 1, "target": target, "upstream_commit": lock["commit"],
        "archive_sha256": digest.hexdigest(), "archive_bytes": archive.stat().st_size,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config = build / "tauri-offline.json"
    bundle = {
        "active": True,
        "targets": bundles[target],
        "resources": {str(archive): "runtime/payload.tar", str(receipt): "runtime/receipt.json"},
    }
    if target == "win32-x64":
        bundle["windows"] = {"nsis": {"installMode": "currentUser"}}
    config.write_text(json.dumps({"bundle": bundle}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"validated payload, archived {archive.stat().st_size} bytes, prepared Tauri bundle config: {config}")
    if args.build:
        pnpm = shutil.which("pnpm")
        if not pnpm:
            parser.error("pnpm is not available for the Tauri build")
        subprocess.run([pnpm, "tauri", "build", "--config", str(config),
                        "--bundles", ",".join(bundles[target])],
                       cwd=product / "apps" / "desktop", check=True)


if __name__ == "__main__":
    main()

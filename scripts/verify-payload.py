"""Compare a sealed payload's archived source with the pinned upstream commit."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile


EXCLUDED = ("tests", "tests-js", "website", "evals", ".github", "nix", "docker",
            "apps", "ui-tui", "web", "scripts")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, type=Path)
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    payload = args.payload.resolve(strict=True)
    upstream = product / "upstream" / "hermes-agent"
    lock = json.loads((product / "runtime" / "upstream.lock.json").read_text(encoding="utf-8"))
    commit = lock["commit"]
    manifest = json.loads((payload / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != 1 or manifest.get("repo") != "hermes-agent":
        parser.error("payload manifest is missing or incompatible")
    current = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=upstream, text=True).strip()
    if current != commit:
        parser.error(f"upstream HEAD differs from lock: {current}")
    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)
    patched = frozenset(subprocess.check_output(
        ["git", "diff", "--name-only"], cwd=upstream, text=True).splitlines())
    source = payload / manifest["repo"]
    checked = 0
    seen_patched = set()
    with tempfile.TemporaryDirectory(prefix="payload-archive-", dir=product / ".build") as temp:
        archive = Path(temp) / "source.tar"
        subprocess.run(["git", "archive", "--format=tar", "--output", str(archive), commit,
                        "--", *(f":(exclude){name}" for name in EXCLUDED)], cwd=upstream, check=True)
        with tarfile.open(archive) as tar:
            for entry in tar:
                if entry.isdir():
                    continue
                destination = source / entry.name
                if entry.isfile():
                    stream = tar.extractfile(entry)
                    if stream is None or not destination.is_file():
                        raise RuntimeError(f"payload source file missing: {entry.name}")
                    expected = ((upstream / entry.name).read_bytes() if entry.name in patched
                                else stream.read())
                    if entry.name in patched:
                        seen_patched.add(entry.name)
                    if hashlib.sha256(destination.read_bytes()).digest() != hashlib.sha256(expected).digest():
                        raise RuntimeError(f"payload source differs from product adapter: {entry.name}")
                elif entry.issym():
                    if not destination.is_symlink() or destination.readlink().as_posix() != entry.linkname:
                        raise RuntimeError(f"payload source link differs from pinned commit: {entry.name}")
                else:
                    raise RuntimeError(f"unexpected archive entry: {entry.name}")
                checked += 1
    if seen_patched != patched:
        raise RuntimeError(f"product adapter paths are absent from the pinned archive: {patched - seen_patched}")
    adapter = product / "adapters" / "hermess_private_api.py"
    installed_adapter = source / "hermes_cli" / adapter.name
    if not installed_adapter.is_file() or installed_adapter.read_bytes() != adapter.read_bytes():
        raise RuntimeError("payload Hermess adapter differs from product source")
    print(f"payload source matches pinned commit {commit} plus product adapter: {checked} entries; target={manifest['target']}")


if __name__ == "__main__":
    main()

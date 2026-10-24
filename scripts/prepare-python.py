"""I0: use upstream PM to build isolated dependencies with an explicitly selected Python."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, required=True, help="CPython 3.14 absolute path")
    parser.add_argument("--out", type=Path, required=True, help="new isolated environment directory")
    args = parser.parse_args()

    product = Path(__file__).resolve().parents[1]
    vendor = product / "vendor" / "hermes-agent"
    python = args.python.resolve(strict=True)
    out = args.out.resolve()
    if not args.python.is_absolute() or not args.out.is_absolute():
        parser.error("--python and --out must be absolute paths")
    if out.is_relative_to(vendor) or out == vendor:
        parser.error("output must stay outside the upstream submodule")
    if out.exists():
        parser.error("output already exists; choose a new generation")

    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)
    version = subprocess.run(
        [str(python), "-c", "import platform,sys; print(sys.version_info[:2], platform.python_implementation())"],
        check=True, capture_output=True, text=True, timeout=10,
    ).stdout.strip()
    if version != "(3, 14) CPython":
        parser.error(f"unsupported interpreter: {version}")

    sys.path.insert(0, str(vendor))
    from pm.operations import build_environment

    executable = build_environment(
        source=vendor, out=out, python=python, no_install_project=False,
        frozen=True, explicit=True,
    )
    print(f"Isolated upstream environment: {executable}")


if __name__ == "__main__":
    main()

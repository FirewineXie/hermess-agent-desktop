"""Stage the pinned upstream Windows payload with private PM bootstrap state."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", required=True, type=Path, help="prepared product venv Python")
    parser.add_argument("--out", required=True, type=Path, help="fresh output directory under .build")
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    build = product / ".build"
    python = args.python.resolve(strict=True)
    out = args.out.resolve()
    if not python.is_relative_to(build) or not out.is_relative_to(build):
        parser.error("--python and --out must remain under this product's .build directory")
    if out.exists():
        parser.error("output already exists; choose a new generation")
    vendor = product / "vendor" / "hermes-agent"
    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)
    bootstrap = build / "pm-bootstrap"
    env = os.environ.copy()
    env.update({
        "HERMES_HOME": str(bootstrap / "hermes-home"),
        "HERMES_RUNTIME_DIR": str(bootstrap / "tools"),
    })
    env.pop("HERMES_INSTALL_ROOT", None)
    subprocess.run([str(python), "-m", "pm.cli", "bundle", "--out", str(out)],
                   cwd=vendor, env=env, check=True)
    subprocess.run([str(python), str(product / "scripts" / "verify-payload.py"), "--payload", str(out)],
                   check=True)


if __name__ == "__main__":
    main()

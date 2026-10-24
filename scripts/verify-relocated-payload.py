"""Copy a sealed payload to a new path and run the complete local gateway smoke."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-payload", required=True, type=Path)
    parser.add_argument("--python", required=True, type=Path, help="prepared test-runner venv Python")
    parser.add_argument("--out", required=True, type=Path, help="fresh install-path candidate under .build")
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    build = product / ".build"
    source = args.source_payload.resolve(strict=True)
    python = args.python.resolve(strict=True)
    out = args.out.resolve()
    if not all(path.is_relative_to(build) for path in (source, python, out)):
        parser.error("source, Python and output must remain under the product .build directory")
    if out.exists():
        parser.error("output already exists; choose a fresh install-path candidate")
    shutil.copytree(source, out)
    launcher = out / "bin" / ("hermes.exe" if sys.platform == "win32" else "hermes")
    subprocess.run([str(python), str(product / "scripts" / "verify-payload.py"), "--payload", str(out)], check=True)
    subprocess.run([str(python), str(product / "scripts" / "smoke-gateway.py"),
                    "--python", str(python), "--hermes", str(launcher)], check=True)
    print(f"relocated payload passed complete smoke: {out}")


if __name__ == "__main__":
    main()

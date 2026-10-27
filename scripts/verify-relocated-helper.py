"""Verify sealed helper imports after moving the payload away from its build path."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import uuid


BOOTSTRAP = """import site,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1])
site.addsitedir(str(root/sys.argv[2]))
sys.path.insert(0,str(root/sys.argv[3]))
import psutil,hermes_cli
child=subprocess.run([sys.executable,'-c','import psutil,hermes_cli'],
                     capture_output=True,timeout=15)
if child.returncode: raise SystemExit('nested helper cannot import bundled dependencies')
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, type=Path)
    args = parser.parse_args()
    build = Path(__file__).resolve().parents[1] / ".build"
    payload = args.payload.resolve(strict=True)
    if not payload.is_relative_to(build):
        parser.error("payload must be under the product .build directory")
    manifest = json.loads((payload / "manifest.json").read_text(encoding="utf-8"))
    runtime = manifest["runtime"]
    relocated = payload.with_name(f"{payload.name}-relocated-{uuid.uuid4().hex}")
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    payload.rename(relocated)
    try:
        python = relocated / runtime["storePython"]
        site = relocated / runtime["sitePackages"]
        repo = relocated / runtime["repoDir"]
        if not python.is_file() or not site.is_dir() or not repo.is_dir():
            raise RuntimeError("relocated payload is missing Python or dependencies")
        env["PYTHONPATH"] = os.pathsep.join((str(repo), str(site)))
        subprocess.run(
            [str(python), "-I", "-S", "-X", "utf8", "-c", BOOTSTRAP,
             str(relocated), runtime["sitePackages"], runtime["repoDir"]],
            env=env, check=True, timeout=30,
        )
    finally:
        relocated.rename(payload)
    print("relocated sealed helper and nested Python imports passed")


if __name__ == "__main__":
    main()

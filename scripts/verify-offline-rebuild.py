"""Rebuild core PM and application environments from a sealed payload's cache."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, type=Path)
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    build = product / ".build"
    payload = args.payload.resolve(strict=True)
    if not payload.is_relative_to(build):
        parser.error("payload must remain under the product .build directory")
    manifest = json.loads((payload / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("target") != "win32-x64":
        parser.error("this I0 offline rebuild check is Windows x64 only")
    repo = payload / manifest["repo"]
    python = payload / manifest["runtime"]["storePython"]
    cache = payload / "uv-cache"
    if not python.is_file() or not cache.is_dir():
        parser.error("payload interpreter or offline cache is missing")
    bootstrap = build / "pm-bootstrap"
    os.environ.update({
        "HERMES_HOME": str(bootstrap / "hermes-home"),
        "HERMES_RUNTIME_DIR": str(bootstrap / "tools"),
        "HERMES_DISABLE_LAZY_INSTALLS": "1",
        "HTTP_PROXY": "http://127.0.0.1:9",
        "HTTPS_PROXY": "http://127.0.0.1:9",
        "ALL_PROXY": "http://127.0.0.1:9",
    })
    os.environ.pop("HERMES_INSTALL_ROOT", None)
    sys.path.insert(0, str(product / "vendor" / "hermes-agent"))
    import pm

    with tempfile.TemporaryDirectory(prefix="offline-rebuild-", dir=build,
                                     ignore_cleanup_errors=True) as temporary:
        root = Path(temporary).resolve()
        if not root.is_relative_to(build):
            raise RuntimeError("temporary rebuild directory escaped the product")
        manager = pm.stage_manager_runtime(python=python, destination=root / "pm-runtime",
                                           project=repo / "pm", cache=cache, offline=True)
        application = pm.build_environment(source=repo, out=root / "venv", python=python,
                                           cache=cache, offline=True, explicit=True,
                                           sealed=True, frozen=True)
        site = root / "venv" / "Lib" / "site-packages"
        (site / "hermes-agent.pth").write_text(
            os.path.relpath(repo, site).replace("\\", "/") + "\n", encoding="utf-8")
        subprocess.run([str(manager), "-I", "-c", "import packaging, tomli_w, truststore"], check=True)
        subprocess.run([str(application), "-c", "import hermes_cli, tui_gateway"], check=True)
    print(f"offline PM and core venv rebuild passed: {payload}")


if __name__ == "__main__":
    main()

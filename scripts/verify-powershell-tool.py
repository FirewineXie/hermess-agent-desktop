"""Verify the product PowerShell Tool against the pinned Hermes registry on Windows."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile


def main() -> None:
    if os.name != "nt":
        raise SystemExit("This verification runs on Windows only")
    product = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(product / "upstream" / "hermes-agent"))
    source = product / "apps" / "desktop" / "agent-tools" / "powershell"

    with tempfile.TemporaryDirectory(prefix="hermess-powershell-verify-") as temporary:
        home = Path(temporary)
        os.environ["HERMES_HOME"] = str(home)
        shutil.copytree(source, home / "plugins" / "hermess-windows-powershell",
                        ignore=shutil.ignore_patterns("__pycache__"))
        (home / "config.yaml").write_text(
            "plugins:\n  enabled:\n    - hermess-windows-powershell\n", encoding="utf-8")

        from hermes_cli.plugins import discover_plugins
        from tools.registry import registry
        from toolsets import resolve_toolset

        discover_plugins()
        entry = registry.get_entry("powershell_execute")
        if entry is None or entry.toolset != "terminal":
            raise RuntimeError("PowerShell Tool was not registered in the terminal toolset")
        if "powershell_execute" not in resolve_toolset("terminal"):
            raise RuntimeError("terminal toolset did not expose PowerShell Tool")
        if not entry.check_fn():
            raise RuntimeError("No usable PowerShell found in this Windows environment")

        from model_tools import get_tool_definitions

        definitions = get_tool_definitions(
            enabled_toolsets=["terminal"], quiet_mode=True,
            skip_tool_search_assembly=True,
        )
        if "powershell_execute" not in {item["function"]["name"] for item in definitions}:
            raise RuntimeError("PowerShell Tool schema is unavailable to the model")

        for engine in ("winps51", "ps7"):
            probe = json.loads(entry.handler({"command": "Write-Output '中文 空格'",
                                             "engine": engine, "workdir": str(home)}))
            if "No usable PowerShell" in probe.get("error", ""):
                print(f"{engine}: not installed")
                continue
            if probe.get("exit_code") != 0 or "中文 空格" not in probe.get("output", ""):
                raise RuntimeError(f"{engine} execution failed: {probe}")
            failed = json.loads(entry.handler({"command": "cmd /c exit 7",
                                              "engine": engine, "workdir": str(home)}))
            if failed.get("exit_code") != 7:
                raise RuntimeError(f"{engine} lost the native process exit code: {failed}")
            print(f"{engine}: {probe['version']} at {probe['executable']}; execution passed")


if __name__ == "__main__":
    main()

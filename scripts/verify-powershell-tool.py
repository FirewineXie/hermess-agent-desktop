"""Verify the product PowerShell Tool against the pinned Hermes registry on Windows."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
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
        powershell_definition = next(
            (item["function"] for item in definitions
             if item["function"]["name"] == "powershell_execute"),
            None,
        )
        if powershell_definition is None:
            raise RuntimeError("PowerShell Tool schema is unavailable to the model")
        description = powershell_definition.get("description", "")
        if "use this instead of `terminal`" not in description or "requires bash" not in description:
            raise RuntimeError("PowerShell Tool schema does not explain Windows terminal routing")

        for engine in ("winps51", "ps7"):
            (home / "utf8-input.txt").write_text("读取中文", encoding="utf-8")
            probe = json.loads(entry.handler({"command": "Write-Output '中文 空格'",
                                             "engine": engine, "workdir": str(home)}))
            if "No usable PowerShell" in probe.get("error", ""):
                print(f"{engine}: not installed")
                continue
            if probe.get("exit_code") != 0 or "中文 空格" not in probe.get("output", ""):
                raise RuntimeError(f"{engine} execution failed: {probe}")
            text_io = json.loads(entry.handler({
                "command": "Get-Content utf8-input.txt; Set-Content utf8-output.txt '写入中文'; "
                           "'重定向中文' > utf8-redirect.txt; Get-Content utf8-output.txt",
                "engine": engine, "workdir": str(home),
            }))
            if text_io.get("exit_code") != 0 or "读取中文" not in text_io.get("output", "") \
                    or "写入中文" not in text_io.get("output", ""):
                raise RuntimeError(f"{engine} UTF-8 read failed: {text_io}")
            for filename, expected in (("utf8-output.txt", "写入中文"),
                                       ("utf8-redirect.txt", "重定向中文")):
                actual = (home / filename).read_text(encoding="utf-8-sig").strip()
                if actual != expected:
                    raise RuntimeError(f"{engine} UTF-8 write failed for {filename}: {actual!r}")
            failed = json.loads(entry.handler({"command": "cmd /c exit 7",
                                              "engine": engine, "workdir": str(home)}))
            if failed.get("exit_code") != 7:
                raise RuntimeError(f"{engine} lost the native process exit code: {failed}")
            print(f"{engine}: {probe['version']} at {probe['executable']}; execution passed")

        named = home / "profiles" / "named"
        shutil.copytree(source, named / "plugins" / "hermess-windows-powershell",
                        ignore=shutil.ignore_patterns("__pycache__"))
        (named / "config.yaml").write_text(
            "plugins:\n  enabled:\n    - hermess-windows-powershell\n", encoding="utf-8")
        named_probe = subprocess.run(
            [sys.executable, "-c", "from hermes_cli.plugins import discover_plugins; "
             "from tools.registry import registry; discover_plugins(); "
             "assert registry.get_entry('powershell_execute') is not None"],
            env={**os.environ, "HERMES_HOME": str(named),
                 "PYTHONPATH": str(product / "upstream" / "hermes-agent")},
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=40, check=False,
        )
        if named_probe.returncode != 0:
            raise RuntimeError(f"named profile registration failed: {named_probe.stderr}")
        print("named profile: PowerShell Tool registered")


if __name__ == "__main__":
    main()

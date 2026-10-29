"""Windows PowerShell execution without a bundled interpreter."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time


_VERSION = re.compile(r"^(\d+)\.(\d+)(?:\.\d+){0,2}$")
_MAX_OUTPUT_BYTES = 256 * 1024
_UTF8_DEFAULTS = """$__hermess_utf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $__hermess_utf8
[Console]::OutputEncoding = $__hermess_utf8
foreach ($__hermess_command in @('Get-Content', 'Set-Content', 'Add-Content',
    'Out-File', 'Import-Csv', 'Export-Csv', 'Select-String')) {
    $PSDefaultParameterValues["${__hermess_command}:Encoding"] = 'utf8'
}
"""


def _candidates():
    override = os.environ.get("HERMESS_POWERSHELL_PATH")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    values = [
        override,
        str(Path(program_files) / "PowerShell" / "7" / "pwsh.exe"),
        shutil.which("pwsh.exe"),
        str(Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"),
        shutil.which("powershell.exe"),
    ]
    seen = set()
    for value in values:
        if not value:
            continue
        path = Path(value)
        key = str(path).casefold()
        if key not in seen and path.is_file():
            seen.add(key)
            yield path


def _probe(path: Path):
    try:
        result = subprocess.run(
            [str(path), "-NoProfile", "-NonInteractive", "-Command",
             "$PSVersionTable.PSVersion.ToString()"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    version = result.stdout.strip()
    match = _VERSION.fullmatch(version)
    if result.returncode or not match:
        return None
    major, minor = map(int, match.groups()[:2])
    if major == 7:
        return "ps7", version
    if (major, minor) == (5, 1):
        return "winps51", version
    return None


def _select(engine: str):
    found = {}
    for path in _candidates():
        probe = _probe(path)
        if probe:
            found.setdefault(probe[0], (path, probe[1]))
    if engine == "auto":
        engine = "ps7" if "ps7" in found else "winps51"
    selected = found.get(engine)
    return (engine, *selected) if selected else None


def available():
    return os.name == "nt" and _select("auto") is not None


def _result(**values):
    return json.dumps(values, ensure_ascii=False)


def execute(args: dict, *, task_id: str | None = None):
    if os.name != "nt":
        return _result(error="PowerShell tool is available on Windows only", exit_code=1)
    command = args.get("command")
    if not isinstance(command, str) or not command.strip():
        return _result(error="command must be a non-empty string", exit_code=1)
    engine = args.get("engine", "auto")
    if engine not in ("auto", "ps7", "winps51"):
        return _result(error="engine must be auto, ps7 or winps51", exit_code=1)
    from tools.terminal_tool import get_session_cwd

    workdir = (args.get("workdir") or (get_session_cwd(task_id) if task_id else None)
               or os.environ.get("TERMINAL_CWD") or os.getcwd())
    if not isinstance(workdir, str) or not Path(workdir).is_absolute() or not Path(workdir).is_dir():
        return _result(error="workdir must be an existing absolute directory", exit_code=1)
    timeout = args.get("timeout", 120)
    if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 300:
        return _result(error="timeout must be between 1 and 300 seconds", exit_code=1)
    selected = _select(engine)
    if selected is None:
        return _result(error=f"No usable PowerShell for engine={engine}", exit_code=1)
    actual_engine, executable, version = selected

    # The command guard is also used by Hermes terminal. Prefix the source with
    # its actual shell family so Windows-specific command patterns can match.
    from tools.approval import check_all_command_guards
    from tools.terminal_tool import _get_approval_callback

    guard = check_all_command_guards(
        f"{executable.name} -NoProfile -Command {command}", "local",
        approval_callback=_get_approval_callback(),
    )
    if not guard.get("approved"):
        return _result(error=guard.get("message") or "Command was not approved",
                       status=guard.get("status", "blocked"), exit_code=1)
    from tools.interrupt import is_interrupted

    if is_interrupted():
        return _result(error="Command was interrupted before it started", exit_code=130)

    # The BOM lets Windows PowerShell 5.1 read the source; the prelude makes
    # text file input/output and captured process output UTF-8 by default.
    # An explicit -Encoding on a command still takes precedence.
    with tempfile.TemporaryDirectory(prefix="hermess-powershell-") as scratch:
        script = Path(scratch) / "command.ps1"
        script.write_text(
            _UTF8_DEFAULTS + command + "\n$__hermess_ok = $?\n"
            "if (-not $__hermess_ok) {\n"
            "  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n"
            "  exit 1\n}\n",
            encoding="utf-8-sig",
        )
        output_file = Path(scratch) / "output.txt"
        with output_file.open("wb") as output:
            try:
                proc = subprocess.Popen(
                    [str(executable), "-NoProfile", "-NonInteractive", "-File", str(script)],
                    cwd=workdir, stdin=subprocess.DEVNULL, stdout=output,
                    stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
                    | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
            except OSError as exc:
                return _result(error=f"PowerShell could not start: {exc}", exit_code=1)
            deadline = time.monotonic() + timeout
            timed_out = interrupted = False
            while proc.poll() is None:
                if is_interrupted():
                    interrupted = True
                    break
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                try:
                    proc.wait(timeout=min(0.2, remaining))
                except subprocess.TimeoutExpired:
                    pass
            if timed_out or interrupted:
                taskkill = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "taskkill.exe"
                try:
                    subprocess.run([str(taskkill), "/PID", str(proc.pid), "/T", "/F"],
                                   capture_output=True, timeout=10, check=False,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    proc.wait(timeout=10)
                except (OSError, subprocess.TimeoutExpired):
                    proc.kill()
                    proc.wait()
        with output_file.open("rb") as output:
            raw = output.read(_MAX_OUTPUT_BYTES + 1)
        truncated = len(raw) > _MAX_OUTPUT_BYTES
        if truncated:
            raw = raw[:_MAX_OUTPUT_BYTES]
        return _result(
            output=raw.decode("utf-8", errors="replace"),
            exit_code=130 if interrupted else 124 if timed_out else proc.returncode,
            timed_out=timed_out, interrupted=interrupted, truncated=truncated,
            workdir=workdir, engine=actual_engine, version=version,
            executable=str(executable),
        )

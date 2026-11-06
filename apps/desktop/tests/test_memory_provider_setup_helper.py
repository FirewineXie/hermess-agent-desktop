"""Verify the managed setup helper against the locked memory-provider implementation."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
LOCKED = PRODUCT / "upstream" / "hermes-agent"
SOURCE = PRODUCT / "apps" / "desktop" / "src-tauri" / "src" / "runtime" / "memory_provider_setup.rs"


def _production_script() -> str:
    source = SOURCE.read_text(encoding="utf-8")
    match = re.search(r'const SCRIPT: &str = r#"(.*?)"#;', source, re.DOTALL)
    assert match, "managed memory-provider setup helper was not found"
    return match.group(1)


def test_setup_helper_uses_locked_provider_and_projects_safe_result(tmp_path):
    env = os.environ.copy()
    env["HERMES_HOME"] = str(tmp_path)
    env["PYTHONPATH"] = str(LOCKED)
    result = subprocess.run(
        [sys.executable, "-c", _production_script(), "retaindb"],
        cwd=LOCKED,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stdout
    lines = [line for line in result.stdout.splitlines() if line.startswith("MEMORY_PROVIDER_SETUP_RESULT=")]
    assert len(lines) == 1
    payload = json.loads(lines[0].split("=", 1)[1])
    assert payload["ok"] is True
    assert payload["provider"] == "retaindb"
    assert payload["results"]
    assert all(set(row) <= {"kind", "status", "returncode"} for row in payload["results"])
    assert "command" not in result.stdout
    assert result.stderr == ""


def test_setup_helper_redacts_locked_provider_errors(tmp_path):
    env = os.environ.copy()
    env["HERMES_HOME"] = str(tmp_path)
    env["PYTHONPATH"] = str(LOCKED)
    result = subprocess.run(
        [sys.executable, "-c", _production_script(), "missing-provider"],
        cwd=LOCKED,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        check=False,
    )
    assert result.returncode == 1
    lines = [line for line in result.stdout.splitlines() if line.startswith("MEMORY_PROVIDER_SETUP_RESULT=")]
    assert len(lines) == 1
    payload = json.loads(lines[0].split("=", 1)[1])
    assert payload == {
        "ok": False,
        "provider": "missing-provider",
        "results": [{"kind": "setup", "status": "failed", "returncode": None}],
    }
    assert result.stderr == ""

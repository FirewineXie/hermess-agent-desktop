"""Verify the desktop migration arguments against the prepared Hermes launcher."""

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile

PRODUCT = Path(__file__).resolve().parents[1]


def shapes():
    result = subprocess.run([
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_agent_migration_shapes", "--", "--ignored", "--nocapture",
    ], capture_output=True, text=True, encoding="utf-8", check=True)
    rows = [json.loads(line.split("MIGRATION_SHAPE=", 1)[1]) for line in result.stdout.splitlines() if "MIGRATION_SHAPE=" in line]
    return {(row["source"], row["apply"]): row["args"] for row in rows}


def fixtures(root):
    grok = root / "grok export.json"
    grok.write_text(json.dumps({"format": "grok-bot-export", "version": 1, "bots": [{
        "name": "Grok fixture", "memories": ["GROK_MIGRATION_PROBE"],
        "routines": [{"name": "Watch list", "instruction": "Print a report", "trigger": "schedule",
                      "schedule_cron": "0 8 * * 1-5", "timezone": "Asia/Shanghai"}],
    }]}), encoding="utf-8")
    openbot = root / "OpenBot fixture"
    openbot.mkdir()
    with closing(sqlite3.connect(openbot / "openbot.db")) as db:
        db.executescript("""
            CREATE TABLE projection_agents (agent_id TEXT, sort_order INTEGER, agent_json TEXT);
            CREATE TABLE projection_agent_memories (agent_id TEXT, text TEXT, created_at TEXT);
            CREATE TABLE projection_agent_routines (agent_id TEXT, routine_id TEXT, created_at TEXT);
            CREATE TABLE projection_routine_triggers (routine_id TEXT, schedule_json TEXT);
            CREATE TABLE projection_mcp_servers (enabled INTEGER, position INTEGER);
            INSERT INTO projection_agents VALUES ('a', 0, '{"name":"OpenBot fixture"}');
            INSERT INTO projection_agent_memories VALUES ('a', 'OPENBOT_MIGRATION_PROBE', '2026-01-01');
        """)
    result = {"grok-bot": grok, "openbot": openbot / "openbot.db"}
    for source, file, marker in (("claude-code", "CLAUDE.md", "CLAUDE_MIGRATION_PROBE"),
                                 ("codex", "AGENTS.md", "CODEX_MIGRATION_PROBE"),
                                 ("cursor", "rules/probe.mdc", "CURSOR_MIGRATION_PROBE"),
                                 ("openclaw", "workspace/MEMORY.md", "OPENCLAW_MIGRATION_PROBE")):
        directory = root / source
        target = directory / file
        target.parent.mkdir(parents=True)
        target.write_text(marker + "\n", encoding="utf-8")
        if source == "openclaw":
            (directory / "openclaw.json").write_text(json.dumps({"agents": {"defaults": {"workspace": str(target.parent)}}}), encoding="utf-8")
        result[source] = directory
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, required=True)
    hermes = parser.parse_args().hermes.resolve(strict=True)
    assert hermes.is_relative_to(PRODUCT / ".build")
    args_by_action = shapes()
    with tempfile.TemporaryDirectory(prefix="desktop-migration-probe-", dir=PRODUCT / ".build", ignore_cleanup_errors=True) as directory:
        root = Path(directory)
        user, home = root / "user", root / "hermes-home"
        profile = home / "profiles" / "reviewer"
        user.mkdir()
        profile.mkdir(parents=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")
        (profile / "config.yaml").write_text("{}\n", encoding="utf-8")
        env = os.environ.copy()
        for key in ("PYTHONHOME", "PYTHONPATH", "HERMES_RUNTIME_DIR", "HERMES_INSTALL_ROOT", "HERMES_DISABLE_LAZY_INSTALLS"):
            env.pop(key, None)
        env.update(HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(home),
                   HERMES_GATEWAY_LOCK_DIR=str(root / "locks"), HERMES_DESKTOP="1", NO_COLOR="1", PYTHONIOENCODING="utf-8")

        def run(source, path, apply=False):
            args = [str(path) if arg == "fixture-source" else arg for arg in args_by_action[source, apply]]
            return subprocess.run([str(hermes), *args], env=env, stdin=subprocess.DEVNULL,
                                  capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)

        sources = fixtures(root)
        for source, path in sources.items():
            preview = run(source, path)
            assert preview.returncode == 0, (source, preview.stdout, preview.stderr)
            assert "Dry Run Results" in preview.stdout or "Dry-run" in preview.stdout, preview.stdout
            memory = profile / "memories" / "MEMORY.md"
            previous = memory.read_bytes() if memory.exists() else None
            applied = run(source, path, True)
            assert applied.returncode == 0, (source, applied.stdout, applied.stderr)
            assert memory.is_file() and memory.read_bytes() != previous, (source, applied.stdout)
            assert not (home / "memories" / "MEMORY.md").exists(), source
            print(f"Verified the {source} preview and import in reviewer.")
        jobs = json.loads((profile / "cron" / "jobs.json").read_text(encoding="utf-8"))["jobs"]
        assert any(job["name"] == "Grok fixture: Watch list" and job["enabled"] is False for job in jobs)
        assert run("openbot", root).returncode != 0
    print("All six migration receivers passed, with the Grok routine paused and the default Profile untouched.")


if __name__ == "__main__":
    main()

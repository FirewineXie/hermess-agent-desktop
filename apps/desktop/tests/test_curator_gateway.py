"""Check the product Curator request paths against the locked Gateway in isolation."""
import json
import os
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_curator_status_and_pause(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    named_home = tmp_path / "profiles" / "worker_beta"
    named_home.mkdir(parents=True)
    (named_home / "config.yaml").write_text("{}\n", encoding="utf-8")
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    result = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", "print_production_curator_shapes", "--", "--ignored", "--nocapture"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    shapes = [json.loads(line.split("CURATOR_SHAPE=", 1)[1]) for line in result.stdout.splitlines()
              if "CURATOR_SHAPE=" in line]
    assert len(shapes) == 4
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    read = client.request(shapes[0]["method"], shapes[0]["path"])
    assert read.status_code == 200, read.text
    assert isinstance(read.json()["paused"], bool)
    changed = client.request(shapes[1]["method"], shapes[1]["path"], json=shapes[1]["body"])
    assert changed.status_code == 200 and changed.json() == {"ok": True, "paused": True}, changed.text
    assert client.request(shapes[0]["method"], shapes[0]["path"]).json()["paused"] is True
    resumed = client.request(shapes[1]["method"], shapes[1]["path"], json={"paused": False})
    assert resumed.status_code == 200 and resumed.json()["paused"] is False, resumed.text
    assert client.request(shapes[0]["method"], shapes[0]["path"]).json()["paused"] is False

    named_read = client.request(shapes[2]["method"], shapes[2]["path"])
    assert named_read.status_code == 200 and named_read.json()["paused"] is False, named_read.text
    named_change = client.request(shapes[3]["method"], shapes[3]["path"], json=shapes[3]["body"])
    assert named_change.status_code == 200 and named_change.json()["paused"] is True, named_change.text
    assert client.request(shapes[2]["method"], shapes[2]["path"]).json()["paused"] is True
    assert client.request(shapes[0]["method"], shapes[0]["path"]).json()["paused"] is False
    assert (named_home / "skills" / ".curator_state").is_file()
    assert json.loads((tmp_path / "skills" / ".curator_state").read_text(encoding="utf-8"))["paused"] is False

    argv = [json.loads(line.split("CURATOR_CLI=", 1)[1]) for line in result.stdout.splitlines()
            if "CURATOR_CLI=" in line]
    assert len(argv) == 2
    hermes = (PRODUCT / ".build" / "hermes-venv-i1" /
              ("Scripts" if os.name == "nt" else "bin") /
              ("hermes.exe" if os.name == "nt" else "hermes"))
    dry_run = subprocess.run([str(hermes), *argv[0], "--dry-run"],
                             env={**os.environ, "HERMES_HOME": str(tmp_path)},
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert dry_run.returncode == 0, dry_run.stderr[-1500:]
    assert "curator:" in dry_run.stdout
    named_dry_run = subprocess.run([str(hermes), *argv[1], "--dry-run"],
                                   env={**os.environ, "HERMES_HOME": str(tmp_path)},
                                   capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert named_dry_run.returncode == 0, named_dry_run.stderr[-1500:]

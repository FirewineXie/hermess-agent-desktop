"""Send production Profile-builder payloads to the locked Dashboard receiver."""
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_profile_builder_payloads_and_rejections(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    from hermes_cli.web_routers import profiles as profile_routes

    model_writes = []
    monkeypatch.setattr(
        profile_routes,
        "_write_profile_model",
        lambda path, provider, model, validate_in=None: model_writes.append(
            (Path(path).name, provider, model, Path(validate_in))
        ),
    )
    monkeypatch.setattr(
        profile_routes,
        "_spawn_hermes_action",
        lambda *args, **kwargs: SimpleNamespace(pid=4242),
    )

    command = [
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_profile_builder_shapes", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    shapes = [
        json.loads(line.split("PROFILE_BUILDER_SHAPE=", 1)[1])
        for line in output.splitlines() if "PROFILE_BUILDER_SHAPE=" in line
    ]
    assert [shape["name"] for shape in shapes] == ["builder_full", "builder_empty"]
    full, empty = shapes
    assert set(full) >= {
        "name", "provider", "model", "keep_skills", "hub_skills", "mcp_servers", "no_skills",
    }
    assert empty["no_skills"] is True

    app = FastAPI()
    app.include_router(profile_routes.router)
    client = TestClient(app)

    created = client.post("/api/profiles", json=full)
    assert created.status_code == 200, created.text
    result = created.json()
    assert result["model_set"] is True
    assert result["mcp_written"] == 1
    assert result["hub_installs"] == [{"identifier": "owner/repository/skill", "pid": 4242}]
    assert model_writes == [
        ("builder_full", "openrouter", "openai/gpt-4.1-mini", tmp_path),
    ]
    config_text = (tmp_path / "profiles" / "builder_full" / "config.yaml").read_text(encoding="utf-8")
    assert "public-docs" in config_text and "https://example.com/mcp" in config_text

    created_empty = client.post("/api/profiles", json=empty)
    assert created_empty.status_code == 200, created_empty.text
    empty_home = tmp_path / "profiles" / "builder_empty"
    assert (empty_home / ".no-bundled-skills").is_file()
    seeded = [path.parent.name for path in (empty_home / "skills").rglob("SKILL.md")]
    assert seeded == ["hermes-agent"]

    rejected = dict(full, name="builder_rejected", mcp_servers=[{
        "name": "broken", "url": "https://example.com", "command": "node",
    }])
    response = client.post("/api/profiles", json=rejected)
    # The locked receiver accepts the Profile but skips invalid best-effort additions.
    assert response.status_code == 200, response.text
    assert response.json()["mcp_written"] == 0

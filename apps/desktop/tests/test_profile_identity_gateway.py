"""Verify product Profile identity request bodies against the locked Dashboard routes."""
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def create_profile(profile_api, name):
    retries = 0
    while True:
        try:
            return profile_api.create_profile(name, no_alias=True)
        except PermissionError as exc:
            if os.name != "nt" or getattr(exc, "winerror", None) != 5 or retries >= 2:
                raise
            retries += 1
            time.sleep(0.15 * retries)


def test_description_auto_description_and_internal_rename(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    from hermes_cli import profile_describer, profiles as profile_api
    from hermes_cli.web_routers.profiles import router

    source = create_profile(profile_api, "identity_source")
    (source / "SOUL.md").write_text("identity soul\n", encoding="utf-8")
    monkeypatch.setattr(profile_describer, "describe_profile", lambda name, overwrite: SimpleNamespace(
        ok=name == "identity_source" and overwrite,
        reason=None,
        description="Generated routing role",
    ))

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    saved = client.put("/api/profiles/identity_source/description", json={
        "description": "  Research and verification  ",
    })
    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        "ok": True,
        "description": "Research and verification",
        "description_auto": False,
    }
    listed = client.get("/api/profiles")
    assert listed.status_code == 200, listed.text
    row = next(item for item in listed.json()["profiles"] if item["name"] == "identity_source")
    assert row["description"] == "Research and verification"
    assert row["description_auto"] is False

    setup = client.get("/api/profiles/identity_source/setup-command")
    assert setup.status_code == 200, setup.text
    assert setup.json()["command"]
    assert "identity_source" in setup.json()["command"]

    generated = client.post("/api/profiles/identity_source/describe-auto", json={"overwrite": True})
    assert generated.status_code == 200, generated.text
    assert generated.json() == {
        "ok": True,
        "reason": None,
        "description": "Generated routing role",
        "description_auto": True,
    }

    renamed = client.patch("/api/profiles/identity_source", json={"new_name": "identity_target"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "identity_target"
    target = tmp_path / "profiles" / "identity_target"
    assert target.is_dir()
    assert not source.exists()
    assert (target / "SOUL.md").read_text(encoding="utf-8") == "identity soul\n"

    duplicate = create_profile(profile_api, "identity_duplicate")
    refused = client.patch("/api/profiles/identity_target", json={"new_name": duplicate.name})
    assert refused.status_code == 400, refused.text
    assert target.is_dir()

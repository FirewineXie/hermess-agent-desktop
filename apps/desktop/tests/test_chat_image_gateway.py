"""Verify the desktop's Rust request against the locked Gateway owner."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace

import pytest


PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))

from gateway.config import Platform
from gateway.session_authority import LiveSession, SessionAuthority
from gateway.session_controls import AuthorityConnection
from hermes_state import SessionDB
from hermes_state_runtime import begin_runtime_epoch, get_session_admission


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nL8AAAAASUVORK5CYII="
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_rust_prompt_shape_is_admitted_with_image_and_rejects_invalid_mime(tmp_path, monkeypatch):
    home = tmp_path / "owner"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    with SessionDB(db_path=home / "state.db") as db:
        db.create_session("s", source="test")
        authority = SessionAuthority(
            SimpleNamespace(_draining=False), profile_id=str(home),
            instance_id="current", db=db,
            epoch=begin_runtime_epoch(db, instance_id="current"),
        )
        owner = AuthorityConnection(authority, SimpleNamespace(write=lambda frame: None), {"user_id": "owner"})
        live = authority.sessions["s"] = LiveSession(
            SimpleNamespace(platform=Platform.LOCAL, user_id=owner.actor.subject), "route"
        )
        owner.subscriptions["s"] = "test-viewer"
        live.subscribers["test-viewer"] = owner.actor
        uploaded = await owner.dispatch({
            "id": 1, "method": "image.attach_bytes",
            "params": {"session_id": "s", "content_base64": base64.b64encode(PNG).decode(), "filename": "image.png"},
        })
        assert "result" in uploaded, uploaded
        staged = uploaded["result"]
        assert staged["mime"] == "image/png"

        env = os.environ.copy()
        env["HERMESS_TEST_STAGED_IMAGE_PATH"] = staged["path"]
        built = subprocess.run(
            ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
             "--locked", "print_production_image_submit_params", "--", "--ignored", "--nocapture"],
            env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
        )
        match = re.search(r"PRODUCTION_PROMPT_PARAMS=(\{[^\r\n]+\})", built.stdout)
        assert match, built.stdout
        params = json.loads(match.group(1))
        assert params["attachments"] == [{"path": staged["path"], "mime": staged["mime"]}]

        # Keep the admitted turn queued so the test observes admission, not model execution.
        monkeypatch.setattr(SessionAuthority, "_schedule", lambda self, ref: None)
        accepted = await owner.dispatch({"id": 2, "method": "prompt.submit", "params": params})
        assert "result" in accepted, accepted
        admission = get_session_admission(db, admission_id=accepted["result"]["admission_id"])
        assert admission["payload"]["attachments_v1"]["media_types"] == ["image/png"]
        assert Path(admission["payload"]["attachments_v1"]["media"][0]["path"]).read_bytes() == PNG

        invalid = {**params, "submission_id": "invalid-mime", "attachments": [{"path": staged["path"], "mime": "image/bmp"}]}
        rejected = await owner.dispatch({"id": 3, "method": "prompt.submit", "params": invalid})
        assert rejected["error"]["message"] == "invalid_params", rejected
        await owner.close()

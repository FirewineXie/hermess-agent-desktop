"""Check the existing desktop Skill request shapes against the locked Gateway."""
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_profile_skill_create_edit_and_rejection(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    content = "---\nname: test-profile-skill\ndescription: Use for this isolated test.\n---\n\n# Steps\n\nDo one step.\n"
    created = client.post("/api/skills", json={"name": "test-profile-skill", "category": "testing", "content": content})
    assert created.status_code == 200, created.text
    assert created.json()["success"] is True

    listed = client.get("/api/skills")
    assert listed.status_code == 200, listed.text
    assert any(skill["name"] == "test-profile-skill" for skill in listed.json())
    viewed = client.get("/api/skills/content", params={"name": "test-profile-skill"})
    assert viewed.status_code == 200 and viewed.json()["content"] == content, viewed.text

    edited = content.replace("Do one step.", "Do two steps.")
    saved = client.put("/api/skills/content", json={"name": "test-profile-skill", "content": edited})
    assert saved.status_code == 200 and saved.json()["success"] is True, saved.text
    assert client.get("/api/skills/content", params={"name": "test-profile-skill"}).json()["content"] == edited

    rejected = client.put("/api/skills/content", json={"name": "test-profile-skill", "content": "invalid"})
    assert rejected.status_code == 400, rejected.text
    assert client.get("/api/skills/content", params={"name": "test-profile-skill"}).json()["content"] == edited

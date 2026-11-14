"""Send desktop-generated model patches to the locked Gateway with native Profile auth."""
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def _production_requests(test, marker):
    output = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", test, "--", "--ignored", "--nocapture"],
        cwd=PRODUCT, capture_output=True, check=True, encoding="utf-8", errors="replace",
    ).stdout
    lines = [line.split(marker, 1)[1] for line in output.splitlines() if marker in line]
    assert len(lines) == 1, output
    return json.loads(lines[0])


def test_supplemental_auxiliary_save_and_reset(tmp_path, monkeypatch):
    shape = _production_requests("print_production_supplemental_auxiliary_requests",
                                 "SUPPLEMENTAL_AUXILIARY_REQUESTS=")
    delegation = _production_requests("print_production_delegation_model_requests",
                                      "DELEGATION_MODEL_REQUESTS=")
    home = tmp_path / ".hermes"
    named = home / "profiles" / shape["profile"]
    named.mkdir(parents=True)
    (home / "config.yaml").write_text(json.dumps({
        "auxiliary": {"background_review": {"model": "probe/default"}},
        "delegation": {"model": "probe/default"},
    }), encoding="utf-8")
    initial = {**shape["initial_config"], "delegation": {
        "backend": "profile_routes", "oneshot_max_children": 7,
    }}
    (named / "config.yaml").write_text(json.dumps(initial), encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))

    from gateway.runtime_bootstrap import TicketStore
    from gateway.session_authorities import SessionAuthorities
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from starlette.testclient import TestClient

    registry = SessionAuthorities(home, multiplexed=True)
    for profile_home, name in ((home, "default"), (named, shape["profile"])):
        registry.add(profile_home, SimpleNamespace(profile_id=str(profile_home.resolve()),
                                                   instance_id="aux-test"), name)
    store = TicketStore("aux-test", registry.profile_ids())
    runner = SimpleNamespace(
        _draining=False, session_authorities=registry, session_ticket_store=store,
        session_runtime_descriptor={"state": "ready", "instance_id": "aux-test",
                                    "served_profiles": registry.served_profiles()},
    )
    monkeypatch.setattr(app.state, "gateway_runner", runner, raising=False)

    async def with_socket_peer(scope, receive, send):
        scope["hermes.gateway_socket_peer"] = ("127.0.0.1", 12345)
        await app(scope, receive, send)

    def named_ticket():
        ticket = store.mint(profile_id=str(named.resolve()), subject="aux-test", purpose="native-http")
        return {"X-Hermes-Gateway-Ticket": ticket}

    with closing(TestClient(with_socket_peer, base_url="http://127.0.0.1")) as client:
        path = shape["path"]
        schema = client.get("/api/config/schema", headers=named_ticket()).json()["fields"]
        rows = client.get(shape["read_path"], headers=named_ticket()).json()["tasks"]
        assert any(row["task"] == "compression" for row in rows)
        first = shape["requests"][0]
        assert client.put(path, json=first).status_code == 401
        assert client.put(f"{path}?profile=default", json=first, headers=named_ticket()).status_code == 403

        for body in shape["requests"]:
            task, fields = next(iter(body["config"]["auxiliary"].items()))
            assert all(f"auxiliary.{task}.{field}" in schema for field in ("provider", "model"))
            assert all(row["task"] != task for row in rows)
            response = client.put(path, json=body, headers=named_ticket())
            assert response.status_code == 200 and response.json()["ok"] is True, response.text
            saved = client.get(path, headers=named_ticket()).json()["auxiliary"][task]
            assert all(saved.get(field, "") == value for field, value in fields.items())
        saved_config = client.get(path, headers=named_ticket()).json()["auxiliary"]
        assert saved_config["memory_query_rewrite"]["reasoning_effort"] == "low"
        review = saved_config["background_review"]
        assert review["enabled"] is False and review["timeout"] == 91.5

        result = client.post("/api/model/set", json=shape["reset_model_set"], headers=named_ticket())
        assert result.status_code == 200 and result.json()["reset"] is True, result.text
        result = client.put(path, json=shape["reset_patch"], headers=named_ticket())
        assert result.status_code == 200 and result.json()["ok"] is True, result.text
        rows = client.get(shape["read_path"], headers=named_ticket()).json()["tasks"]
        assert all(row["provider"] == "auto" and row["model"] == "" for row in rows)
        config = client.get(path, headers=named_ticket()).json()["auxiliary"]
        for task, fields in shape["reset_patch"]["config"]["auxiliary"].items():
            assert all(config[task].get(field, "") == value for field, value in fields.items())
        assert config["background_review"]["enabled"] is False
        assert config["background_review"]["timeout"] == 91.5
        _verify_delegation_model(client, named_ticket, delegation, monkeypatch)
        default = client.get(path, headers={_SESSION_HEADER_NAME: _SESSION_TOKEN}).json()
        assert default["auxiliary"]["background_review"]["model"] == "probe/default"
        assert default["delegation"]["model"] == "probe/default"


def _verify_delegation_model(client, named_ticket, shape, monkeypatch):
    from hermes_cli import runtime_provider
    from tools.delegate_tool_config import _resolve_delegation_credentials

    def resolve(*, requested, target_model):
        assert requested == "openrouter"
        return {"provider": requested, "api_key": "fixture-only", "model": "probe/provider-default",
                "base_url": "http://127.0.0.1:9"}

    monkeypatch.setattr(runtime_provider, "resolve_runtime_provider", resolve)
    path = shape["path"]
    assert client.put(path, json=shape["requests"][0]).status_code == 401
    assert client.put(f"{path}?profile=default", json=shape["requests"][0],
                      headers=named_ticket()).status_code == 403
    for body in shape["requests"]:
        provider = body["config"]["delegation"]["provider"]
        model = body["config"]["delegation"]["model"]
        result = client.put(path, json=body, headers=named_ticket())
        assert result.status_code == 200 and result.json()["ok"] is True, result.text
        saved = client.get(path, headers=named_ticket()).json()["delegation"]
        assert (saved["provider"], saved["model"], saved["backend"], saved["oneshot_max_children"]) == (
            provider, model, "profile_routes", 7,
        )
        creds = _resolve_delegation_credentials(saved, SimpleNamespace(request_overrides={}))
        expected = model or ("probe/provider-default" if provider else None)
        assert (creds["provider"], creds["model"]) == (provider or None, expected)

"""Send Rust-built media URLs to the locked Gateway's real HTTP receivers.

No model is called and no user profile is opened. The ASGI transport exercises
the shipped auth middleware, profile/session lookup, file reader and Range
response against temporary files. Size caps imposed by the Rust client are
covered by Rust tests; the download endpoint itself has no such cap.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient


PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nL8AAAAASUVORK5CYII="
)


def production_urls(cases):
    env = dict(os.environ, HERMESS_TEST_MEDIA_CASES=json.dumps(cases))
    completed = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", "print_production_media_urls", "--", "--ignored", "--nocapture"],
        env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    values = [
        json.loads(line.split("PRODUCTION_MEDIA_URL=", 1)[1])
        for line in completed.stdout.splitlines() if "PRODUCTION_MEDIA_URL=" in line
    ]
    assert len(values) == len(cases), completed.stdout
    return {value["name"]: value["url"] for value in values}


@pytest.fixture
def receiver(tmp_path, monkeypatch):
    lock = json.loads((PRODUCT / "runtime/upstream.lock.json").read_text(encoding="utf-8"))
    checkout = subprocess.run(
        ["git", "-C", str(PRODUCT / "upstream/hermes-agent"), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    assert checkout.stdout.strip() == lock["commit"], "Gateway checkout must match the product lock"
    home = tmp_path / "hermes"
    named = home / "profiles" / "media_test"
    named.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "isolated-media-test-token")
    monkeypatch.delenv("HERMES_DASHBOARD_FILES_ROOT", raising=False)
    monkeypatch.delenv("TERMINAL_ENV", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    for profile_home in (home, named):
        (profile_home / "config.yaml").write_text("terminal:\n  backend: local\n", encoding="utf-8")

    from hermes_cli import web_server as web
    from hermes_state import SessionDB

    workspace = tmp_path / "二维码 space %25"
    workspace.mkdir()
    (workspace / "shot.png").write_bytes(PNG)
    (workspace / "speech.wav").write_bytes(b"RIFF" + bytes(range(64)) + b"WAVE")
    (workspace / "report.pdf").write_bytes(b"%PDF-1.4\nmedia test\n")
    (workspace / "preview.html").write_text("<!doctype html><p>中文媒体</p>", encoding="utf-8")
    (workspace / "empty.txt").write_bytes(b"")
    with (workspace / "large.bin").open("wb") as file:
        file.truncate(33 * 1024 * 1024)
    (workspace / ".env").write_text("TEST_ONLY=not-a-real-secret\n", encoding="utf-8")
    for profile_home, sid in ((home, "media-default"), (named, "media-named")):
        with SessionDB(db_path=profile_home / "state.db") as db:
            db.create_session(sid, source="gui", cwd=str(workspace))

    monkeypatch.setattr(web, "_SESSION_TOKEN", "isolated-media-test-token")
    monkeypatch.setattr(web.app.state, "auth_required", False, raising=False)
    monkeypatch.setattr(web.app.state, "bound_host", None, raising=False)
    client = TestClient(web.app, base_url="http://127.0.0.1")
    try:
        yield SimpleNamespace(client=client, web=web, home=home, named=named, workspace=workspace)
    finally:
        client.close()


def test_production_media_requests_and_receiver_rejections(receiver, monkeypatch):
    workspace, client = receiver.workspace, receiver.client
    cases = []

    def case(name, path="", *, kind="download", profile="default", session="media-default",
             base="ws://127.0.0.1/api/ws"):
        cases.append({"name": name, "base": base, "path": path,
                      "profile": profile, "session": session, "kind": kind})

    case("session", kind="session")
    case("named-session", kind="session", profile="media_test", session="media-named")
    case("image", str(workspace / "shot.png"))
    case("relative-image", "shot.png")
    case("file-url-image", (workspace / "shot.png").as_uri())
    case("file-url-missing", (workspace / "missing.png").as_uri())
    case("named-image", "shot.png", profile="media_test", session="media-named")
    case("audio", str(workspace / "speech.wav"))
    case("document", str(workspace / "report.pdf"))
    case("html", str(workspace / "preview.html"))
    case("empty", str(workspace / "empty.txt"))
    case("large", str(workspace / "large.bin"))
    case("missing", str(workspace / "missing.png"))
    case("unknown-session", str(workspace / "shot.png"), session="missing-session")
    case("foreign-session", str(workspace / "shot.png"), session="media-named")
    case("unknown-profile", str(workspace / "shot.png"), profile="missing_profile")
    case("sensitive", str(workspace / ".env"))
    case("directory", str(workspace))
    case("prefix-image", "shot.png", base="ws://127.0.0.1/hermes/api/ws")
    case("prefix-session", kind="session", base="ws://127.0.0.1/hermes/api/ws")
    urls = production_urls(cases)
    headers = {"X-Hermes-Session-Token": "isolated-media-test-token"}

    def get(name, **kwargs):
        return client.get(urls[name], headers={**headers, **kwargs.pop("headers", {})}, **kwargs)

    for name, profile in (("session", "default"), ("named-session", "media_test")):
        response = get(name)
        assert response.status_code == 200, response.text
        assert Path(response.json()["cwd"]) == workspace
        assert response.json()["profile"] == profile

    for name in ("image", "relative-image", "file-url-image", "named-image"):
        response = get(name)
        assert response.status_code == 200, response.text
        assert response.content == PNG
        assert response.headers["content-type"].startswith("image/png")
    for name, filename in (("document", "report.pdf"), ("html", "preview.html")):
        response = get(name)
        assert response.status_code == 200, response.text
        assert response.content == (workspace / filename).read_bytes()

    audio = (workspace / "speech.wav").read_bytes()
    assert get("audio").content == audio
    for byte_range, expected, content_range in (
        ("bytes=0-0", audio[:1], f"bytes 0-0/{len(audio)}"),
        ("bytes=4-11", audio[4:12], f"bytes 4-11/{len(audio)}"),
        ("bytes=-4", audio[-4:], f"bytes {len(audio) - 4}-{len(audio) - 1}/{len(audio)}"),
    ):
        response = get("audio", headers={"Range": byte_range})
        assert response.status_code == 206, response.text
        assert response.content == expected
        assert response.headers["content-range"] == content_range
    assert get("audio", headers={"Range": "bytes=99999-"}).status_code == 416
    assert get("empty").status_code == 200
    empty_probe = get("empty", headers={"Range": "bytes=0-0"})
    assert empty_probe.status_code == 416
    assert empty_probe.headers["content-range"] == "bytes */0"
    # /api/fs/download itself is uncapped. Rust applies its own inline/save
    # limits; a bounded probe must report the real size without reading 33 MiB.
    large_probe = get("large", headers={"Range": "bytes=0-0"})
    assert large_probe.status_code == 206 and large_probe.content == b"\0"
    assert large_probe.headers["content-range"] == f"bytes 0-0/{33 * 1024 * 1024}"

    for name, expected in (("missing", 404), ("file-url-missing", 404),
                           ("unknown-session", 404), ("foreign-session", 404),
                           ("unknown-profile", 404), ("sensitive", 403), ("directory", 400)):
        response = get(name)
        assert response.status_code == expected, (name, response.status_code, response.text)
    assert client.get(urls["image"]).status_code == 401
    assert client.get(urls["image"], headers={"Authorization": "Bearer invalid-test-token"}).status_code == 401
    remote = client.get(urls["image"], headers={"Authorization": "Bearer isolated-media-test-token"})
    assert remote.status_code == 200 and remote.content == PNG
    assert "token" not in urlsplit(urls["image"]).query.lower()
    verify_reverse_proxy_prefix(receiver, urls, headers)
    verify_native_profile_tickets(receiver, urls, monkeypatch)


def verify_reverse_proxy_prefix(receiver, urls, headers):
    from starlette.responses import Response

    # A reverse proxy publishes /hermes/* and removes only that prefix before
    # forwarding to the ordinary Gateway app. No receiver handler is replaced.
    async def strip_prefix(scope, receive, send):
        path = scope.get("path", "")
        if not path.startswith("/hermes/"):
            await Response(status_code=404)(scope, receive, send)
            return
        forwarded = {**scope, "path": path.removeprefix("/hermes"),
                     "raw_path": scope["raw_path"].removeprefix(b"/hermes"), "root_path": ""}
        await receiver.web.app(forwarded, receive, send)

    proxy = TestClient(strip_prefix, base_url="http://127.0.0.1")
    try:
        image = proxy.get(urls["prefix-image"], headers=headers)
        assert image.status_code == 200 and image.content == PNG, image.text
        session = proxy.get(urls["prefix-session"], headers=headers)
        assert session.status_code == 200 and session.json()["profile"] == "default", session.text
        assert proxy.get(urls["prefix-image"]).status_code == 401
    finally:
        proxy.close()


def verify_native_profile_tickets(receiver, urls, monkeypatch):
    from gateway.runtime_bootstrap import TicketStore
    from gateway.session_authorities import SessionAuthorities

    # The in-process receiver has no listening socket. Supply the ASGI peer
    # metadata normally captured by GatewaySocketPeerMiddleware; ticket mint,
    # redemption, single use, purpose and profile checks remain production code.
    registry = SessionAuthorities(receiver.home, multiplexed=True)
    for home, name in ((receiver.home, "default"), (receiver.named, "media_test")):
        registry.add(home, SimpleNamespace(profile_id=str(home.resolve()), instance_id="media-test"), name)
    store = TicketStore("media-test", registry.profile_ids())
    runner = SimpleNamespace(
        _draining=False, session_authorities=registry, session_ticket_store=store,
        session_runtime_descriptor={"state": "ready", "instance_id": "media-test",
                                    "served_profiles": registry.served_profiles()},
    )
    monkeypatch.setattr(receiver.web.app.state, "gateway_runner", runner, raising=False)

    async def with_socket_peer(scope, receive, send):
        scope["hermes.gateway_socket_peer"] = ("127.0.0.1", 12345)
        await receiver.web.app(scope, receive, send)

    def headers(*, purpose="native-http"):
        token = store.mint(profile_id=str(receiver.named.resolve()), subject="media-test", purpose=purpose)
        return {"X-Hermes-Gateway-Ticket": token}

    native = TestClient(with_socket_peer, base_url="http://127.0.0.1")
    try:
        first = headers()
        response = native.get(urls["named-image"], headers=first)
        assert response.status_code == 200 and response.content == PNG, response.text
        assert native.get(urls["named-image"], headers=first).status_code == 401
        assert native.get(urls["image"], headers=headers()).status_code == 403
        assert native.get(urls["named-image"], headers=headers(purpose="interactive")).status_code == 401
        assert native.get(urls["named-image"], headers={**headers(), "Origin": "https://example.invalid"}).status_code == 401
        response = native.get(urls["named-session"], headers=headers())
        assert response.status_code == 200 and response.json()["profile"] == "media_test", response.text
    finally:
        native.close()


def test_canonical_persistence_projects_images_for_the_production_frontend(receiver):
    from agent.image_routing import build_native_content_parts
    from agent.session_persistence import _durable_content

    paths = []
    for home in (receiver.home, receiver.named):
        image = home / "native-inputs" / "fixture-digest" / "二维码.png"
        image.parent.mkdir(parents=True)
        image.write_bytes(PNG)
        paths.append(str(image))
    parts, skipped = build_native_content_parts("保留图片", paths)
    assert skipped == []
    persisted = _durable_content(parts)
    assert persisted.count("[screenshot]") == len(paths)
    # Consume the real fork's durable projection with the actual frontend
    # parser. This is separate from hand-built structured-content fixtures.
    script = (
        "import { historyMedia } from './apps/frontend/src/features/chat/historyMedia.ts';"
        "let text = ''; for await (const chunk of process.stdin) text += chunk;"
        "process.stdout.write(JSON.stringify(historyMedia(JSON.parse(text))));"
    )
    parsed = subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=PRODUCT, input=json.dumps(persisted), capture_output=True, text=True,
        encoding="utf-8", errors="replace", check=True,
    )
    assert json.loads(parsed.stdout) == paths

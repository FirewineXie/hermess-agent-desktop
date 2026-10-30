"""Verify Desktop composer requests against the locked Gateway authority.

Uses an isolated Hermes Home and the real WebSocket receiver. No user sessions are touched.
"""

import asyncio
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from websockets.asyncio.client import connect


REPO = Path(__file__).resolve().parents[1]
UPSTREAM = REPO / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))

from tests.gateway.fixtures.local_recovery_probe import Model, child_env, daemon, rpc, websocket
from tests.gateway.test_normal_runtime_boot import control


async def verify(home: Path, desc: dict, peer: ThreadingHTTPServer) -> None:
    async with websocket(home, desc) as ws:
        async def call(method: str, **params) -> dict:
            answer = await rpc(ws, method, **params)
            assert "result" in answer, answer
            return answer["result"]

        created = await call("session.create", source="gui", request_id="desktop-composer-test", cwd=str(home), toolsets=[])
        session_id = created["session_id"]
        catalog = await call("commands.catalog", session_id=session_id)
        assert any(name == "/agents" for name, _ in catalog["pairs"]), catalog
        assert "pending" in catalog["commands"]["/skills"]["desktop_subcommands"], catalog
        assert catalog["sub"].get("/reasoning") or catalog["sub"].get("reasoning"), catalog.keys()
        # /agents uses this read-only, session-owned roster instead of CLI process output.
        roster = await call("subagent.list", session_id=session_id)
        assert roster["subagents"] == [] and roster["delegations"] == [], roster
        foreign = await rpc(ws, "subagent.list", session_id="missing-desktop-session")
        assert "error" in foreign, foreign
        named_home = home / "profiles" / "reviewer"
        grant = control(home, "session-ticket", {"profile_id": str(named_home),
                                                  "instance_id": desc["instance_id"], "purpose": "interactive"})
        async with connect(desc["api_origin"].replace("http:", "ws:") + "/api/ws",
                           subprotocols=["hermes-gateway-v1", "hermes-gateway-ticket." + grant["ticket"]]) as named_ws:
            async def named_call(method: str, **params) -> dict:
                answer = await rpc(named_ws, method, profile="reviewer", **params)
                assert "result" in answer, answer
                return answer["result"]
            named = await named_call("session.create", source="gui",
                                     request_id="desktop-named-composer-test", cwd=str(home), toolsets=[])
            named_id = named["session_id"]
            named_roster = await named_call("subagent.list", session_id=named_id)
            assert named_roster["subagents"] == [] and named_roster["delegations"] == [], named_roster
            named_export = await named_call("session.export", session_id=named_id,
                                            format="md", redact=True)
            assert "_No messages found._" in named_export["content"], named_export
            cross_profile = await rpc(named_ws, "subagent.list", profile="reviewer", session_id=session_id)
            assert "error" in cross_profile, cross_profile
        for command in ["/status", "/title 中文命令标题"]:
            result = await call("slash.exec", session_id=session_id, command=command)
            assert result.get("type") == "exec", result
            if command.startswith("/title "):
                assert "中文命令标题" in result.get("output", ""), result
        await call("slash.exec", session_id=session_id, command="/reasoning none")
        assert (await call("config.get", session_id=session_id, key="reasoning"))["value"] == "none"
        for command in ["/skills install example", "/voice tts"]:
            refused = await rpc(ws, "slash.exec", session_id=session_id, command=command)
            assert "error" in refused, refused

        # export_chat_session sends this exact request shape after the native save dialog.
        empty = await call("session.export", session_id=session_id, format="md", redact=True)
        assert "_No messages found._" in empty["content"], empty
        await call("prompt.submit", session_id=session_id, text="EXPORT_PROBE", submission_id="desktop-export-test", clarify_batch=True)
        for _ in range(50):
            exported = await rpc(ws, "session.export", session_id=session_id, format="md", redact=True)
            if "result" in exported and "EXPORT_PROBE" in exported["result"].get("content", ""):
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError(exported)
        assert exported["result"]["format"] == "md", exported
        invalid = await rpc(ws, "session.export", session_id=session_id, format="txt", redact=True)
        assert "error" in invalid, invalid
        for _ in range(50):
            before = await call("session.history", session_id=session_id)
            if any(row.get("role") == "assistant" for row in before["messages"]):
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError(before)
        retry = await call("prompt.submit", session_id=session_id, text="/retry",
                           submission_id="desktop-retry-test", clarify_batch=True)
        assert retry["status"] in {"queued", "running", "completed"}, retry
        for _ in range(50):
            after = await call("session.history", session_id=session_id)
            if len(peer.requests) >= 2 and len(after["messages"]) >= 4:
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError((after, len(peer.requests)))
        assert [row.get("role") for row in after["messages"]] == ["user", "assistant", "user", "assistant"], after
        assert [row.get("text") for row in after["messages"] if row.get("role") == "user"] == ["EXPORT_PROBE"] * 2, after
        assert all(next((m.get("content") for m in reversed(request.get("messages", []))
                         if m.get("role") == "user"), None) == "EXPORT_PROBE" for request in peer.requests), peer.requests
        initial_events = await call("session.events.since", session_id=session_id,
                                    replay_epoch=created["replay_epoch"], last_sequence=0)
        preview = await call("prompt.submit", session_id=session_id, text="/compress --preview",
                             submission_id="desktop-compress-preview-test", clarify_batch=True)
        assert preview["status"] in {"queued", "running", "completed"}, preview
        for _ in range(50):
            events = await call("session.events.since", session_id=session_id,
                                replay_epoch=created["replay_epoch"],
                                last_sequence=initial_events.get("latest_seq", 0))
            if any("Preview" in str(event.get("payload", {}).get("text", ""))
                   for event in events.get("events", []) if event.get("type") == "message.complete"):
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError(events)
        checked = await call("session.history", session_id=session_id)
        assert checked["messages"] == after["messages"], checked
        cursor = events.get("latest_seq", 0)
        applied = await call("prompt.submit", session_id=session_id, text="/compress",
                             submission_id="desktop-compress-test", clarify_batch=True)
        assert applied["status"] in {"queued", "running", "completed"}, applied
        for _ in range(50):
            final = await call("session.events.since", session_id=session_id,
                               replay_epoch=created["replay_epoch"], last_sequence=cursor)
            completed = [event for event in final.get("events", []) if event.get("type") == "message.complete"]
            if completed:
                break
            await asyncio.sleep(0.2)
        assert completed, final
        assert any("No changes" in str(event.get("payload", {}).get("text", "")) for event in completed), completed
        parent = await call("session.resume", session_id=session_id, source="desktop")
        branch_params = dict(session_id=session_id, request_id="desktop-branch-test",
                             expected_revision=parent["revision"],
                             expected_generation=parent["execution_generation"],
                             operation="branch", payload={"title": "新方向"})
        branched = await call("session.mutate", **branch_params)
        child_id = branched["branched_session_id"]
        assert child_id != session_id, branched
        assert await call("session.mutate", **branch_params) == branched
        child = await call("session.resume", session_id=child_id, source="desktop")
        assert child["session_id"] == child_id and child["messages"], child
        assert child["info"]["cwd"] == parent["info"]["cwd"], (parent, child)
        rows = await call("session.list", limit=50)
        assert any(row.get("id") == child_id and row.get("title") == "新方向"
                   for row in rows["sessions"]), rows
        stale = await rpc(ws, "session.mutate", **(branch_params | {"request_id": "desktop-branch-stale"}))
        assert "error" in stale, stale

        # A longer transcript must exercise the mutation path, not merely the short-session no-op.
        long_session = await call("session.create", source="gui", request_id="desktop-compress-long", cwd=str(home), toolsets=[])
        long_id = long_session["session_id"]
        for index in range(8):
            await call("prompt.submit", session_id=long_id,
                       text=f"LONG_{index}_" + ("alpha beta gamma delta " * 180),
                       submission_id=f"desktop-compress-long-{index}", clarify_batch=True)
            for _ in range(100):
                history = await call("session.history", session_id=long_id)
                if len(history["messages"]) >= (index + 1) * 2:
                    break
                await asyncio.sleep(0.2)
            else:
                raise AssertionError((index, history["count"]))
        for _ in range(50):
            long_events = await call("session.events.since", session_id=long_id,
                                     replay_epoch=long_session["replay_epoch"], last_sequence=0)
            if any(str(event.get("payload", {}).get("text", "")).startswith("RECOVERY_ACK_LONG_7_")
                   for event in long_events.get("events", []) if event.get("type") == "message.complete"):
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError("long session did not settle")
        await call("prompt.submit", session_id=long_id, text="/compress",
                   submission_id="desktop-compress-long-apply", clarify_batch=True)
        for _ in range(100):
            result_events = await call("session.events.since", session_id=long_id,
                                       replay_epoch=long_session["replay_epoch"],
                                       last_sequence=long_events.get("latest_seq", 0))
            result_text = [event.get("payload", {}).get("text", "") for event in result_events.get("events", [])
                           if event.get("type") == "message.complete"]
            if result_text:
                break
            await asyncio.sleep(0.2)
        assert any("Compressed" in text for text in result_text), result_text
        compacted = await call("session.history", session_id=long_id)
        resumed = await call("session.resume", session_id=long_id, source="desktop")
        assert compacted["count"] < history["count"], (history["count"], compacted["count"])
        assert resumed.get("session_id") == long_id, resumed
        assert resumed.get("messages"), resumed


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="hermess-composer-") as directory:
        home = Path(directory) / "state"
        user = Path(directory) / "user"
        home.mkdir()
        user.mkdir()
        peer = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        peer.requests = []
        peer.blocked = threading.Event()
        peer.release = threading.Event()
        thread = threading.Thread(target=peer.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{peer.server_port}/v1"
        config = {
            "gateway": {"multiplex_profiles": True, "managed_workers": False},
            "model": {"provider": "custom", "default": "delete-test", "base_url": url},
            "auxiliary": {"title_generation": {"enabled": False}},
            "platform_toolsets": {"cli": []},
        }
        (home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
        named_home = home / "profiles" / "reviewer"
        named_home.mkdir(parents=True)
        (named_home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
        env = child_env()
        env.update(HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(home),
                   PYTHONPATH=os.pathsep.join([str(UPSTREAM), os.environ.get("PYTHONPATH", "")]), PYTHONUNBUFFERED="1",
                   OPENAI_API_KEY="loopback-only", OPENAI_BASE_URL=url)
        try:
            with daemon(UPSTREAM, home, env, barrier=False) as (_, desc):
                asyncio.run(verify(home, desc, peer))
        finally:
            peer.shutdown()
            peer.server_close()
            thread.join(timeout=5)
    print("Locked Gateway composer: catalog, agents, export, retry, compression and fenced branch passed")


if __name__ == "__main__":
    main()

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
        assert any(name == "/queue" for name, _ in catalog["pairs"]), catalog
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
            named_snapshot = await named_call("session.resume", session_id=named_id, source="desktop",
                                              defer_history=True, omit_messages=True)
            named_idle_steer = await rpc(named_ws, "session.steer", profile="reviewer", session_id=named_id,
                                         execution_generation=named_snapshot["execution_generation"], text="UNSENT_STEER")
            assert named_idle_steer.get("error", {}).get("message") != "profile_mismatch", named_idle_steer
            assert "error" in named_idle_steer, named_idle_steer
            named_export = await named_call("session.export", session_id=named_id,
                                            format="md", redact=True)
            assert "_No messages found._" in named_export["content"], named_export
            named_side = await named_call("prompt.btw", session_id=named_id, text="Answer this side question")
            assert named_side["task_id"].startswith("btw_"), named_side
            for _ in range(100):
                named_events = await named_call("session.events.since", session_id=named_id,
                                                replay_epoch=named["replay_epoch"], last_sequence=0)
                named_matches = [event for event in named_events.get("events", [])
                                 if event.get("type") == "btw.complete"
                                 and event.get("payload", {}).get("task_id") == named_side["task_id"]]
                if named_matches:
                    break
                await asyncio.sleep(0.2)
            assert named_matches and not named_matches[0]["payload"]["text"].startswith("error: "), named_matches
            assert (await named_call("session.history", session_id=named_id))["messages"] == []
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
        main_requests_start = len(peer.requests)
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
            if len(peer.requests) - main_requests_start >= 2 and len(after["messages"]) >= 4:
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError((after, len(peer.requests)))
        assert [row.get("role") for row in after["messages"]] == ["user", "assistant", "user", "assistant"], after
        assert [row.get("text") for row in after["messages"] if row.get("role") == "user"] == ["EXPORT_PROBE"] * 2, after
        assert all(next((m.get("content") for m in reversed(request.get("messages", []))
                         if m.get("role") == "user"), None) == "EXPORT_PROBE" for request in peer.requests[main_requests_start:]), peer.requests[main_requests_start:]
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
        before_btw = await call("session.history", session_id=session_id)
        btw_cursor = (await call("session.events.since", session_id=session_id,
                                 replay_epoch=created["replay_epoch"], last_sequence=0))["latest_seq"]
        side = await call("prompt.btw", session_id=session_id, text="What is the last user request?")
        assert side["task_id"].startswith("btw_"), side
        for _ in range(100):
            side_events = await call("session.events.since", session_id=session_id,
                                     replay_epoch=created["replay_epoch"], last_sequence=btw_cursor)
            matches = [event for event in side_events.get("events", []) if event.get("type") == "btw.complete"
                       and event.get("payload", {}).get("task_id") == side["task_id"]]
            if matches:
                break
            await asyncio.sleep(0.2)
        assert len(matches) == 1 and matches[0]["payload"]["question"] == "What is the last user request?", matches
        assert matches[0]["payload"].get("text") and not matches[0]["payload"]["text"].startswith("error: "), matches
        assert (await call("session.history", session_id=session_id))["messages"] == before_btw["messages"]
        empty_btw = await rpc(ws, "prompt.btw", session_id=session_id, text=" ")
        assert "error" in empty_btw, empty_btw
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

        undo_session = await call("session.create", source="gui", request_id="desktop-undo-test",
                                  cwd=str(home), toolsets=[])
        undo_id = undo_session["session_id"]
        for index in range(2):
            await call("prompt.submit", session_id=undo_id, text=f"UNDO_Q{index}",
                       submission_id=f"desktop-undo-prompt-{index}", clarify_batch=True)
            for _ in range(50):
                undo_history = await call("session.history", session_id=undo_id)
                if len(undo_history["messages"]) >= (index + 1) * 2:
                    break
                await asyncio.sleep(0.2)
            else:
                raise AssertionError(undo_history)
        for _ in range(50):
            settled = await call("session.events.since", session_id=undo_id,
                                 replay_epoch=undo_session["replay_epoch"], last_sequence=0)
            if any("UNDO_Q1" in str(event.get("payload", {}).get("text", ""))
                   for event in settled.get("events", []) if event.get("type") == "message.complete"):
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError(settled)
        undo_snapshot = await call("session.resume", session_id=undo_id, source="desktop")
        target = next(row["row_id"] for row in undo_snapshot["messages"]
                      if row.get("role") == "user" and row.get("content") == "UNDO_Q1")
        undo_params = dict(session_id=undo_id, request_id="desktop-undo-apply",
                           expected_revision=undo_snapshot["revision"],
                           expected_generation=undo_snapshot["execution_generation"],
                           operation="rewind", payload={"target_message_id": target})
        undone = await call("session.mutate", **undo_params)
        assert undone["rewound_count"] >= 2, undone
        assert await call("session.mutate", **undo_params) == undone
        remaining = await call("session.resume", session_id=undo_id, source="desktop")
        assert any(row.get("content") == "UNDO_Q0" for row in remaining["messages"]), remaining
        assert not any(row.get("content") == "UNDO_Q1" for row in remaining["messages"]), remaining
        stale_undo = await rpc(ws, "session.mutate", **(undo_params | {"request_id": "desktop-undo-stale"}))
        assert "error" in stale_undo, stale_undo

        steer_session = await call("session.create", source="gui", request_id="desktop-steer-test",
                                   cwd=str(home), toolsets=[])
        steer_id = steer_session["session_id"]
        idle = await call("session.resume", session_id=steer_id, source="desktop",
                          defer_history=True, omit_messages=True)
        assert idle["running"] is False, idle
        idle_steer = await rpc(ws, "session.steer", session_id=steer_id,
                               execution_generation=idle["execution_generation"], text="UNSENT_STEER")
        assert "error" in idle_steer, idle_steer
        await call("prompt.submit", session_id=steer_id, text="BLOCK_STARTED",
                   submission_id="desktop-steer-prompt", clarify_batch=True)
        try:
            assert await asyncio.to_thread(peer.blocked.wait, 20), "model did not start"
            running = await call("session.resume", session_id=steer_id, source="desktop",
                                 defer_history=True, omit_messages=True)
            assert running["running"] is True, running
            steered = await call("session.steer", session_id=steer_id,
                                 execution_generation=running["execution_generation"], text="STEER_NOW")
            assert steered["status"] == "queued", steered
            stale_steer = await rpc(ws, "session.steer", session_id=steer_id,
                                    execution_generation=running["execution_generation"] + 1,
                                    text="UNSENT_STEER")
            assert "error" in stale_steer, stale_steer
        finally:
            peer.release.set()
        for _ in range(100):
            steered_history = await call("session.history", session_id=steer_id)
            if any(row.get("role") == "user" and row.get("text") == "STEER_NOW"
                   for row in steered_history["messages"]):
                break
            await asyncio.sleep(0.2)
        else:
            raise AssertionError(steered_history)

        peer.blocked.clear()
        peer.release.clear()
        queue_session = await call("session.create", source="gui", request_id="desktop-queue-test",
                                   cwd=str(home), toolsets=[])
        queue_id = queue_session["session_id"]
        await call("prompt.submit", session_id=queue_id, text="BLOCK_STARTED",
                   submission_id="desktop-queue-running", clarify_batch=True)
        try:
            assert await asyncio.to_thread(peer.blocked.wait, 20), "queue model did not start"
            first = await call("prompt.submit", session_id=queue_id, text="QUEUE_FIRST",
                               queued=True, submission_id="desktop-queue-first")
            second = await call("prompt.submit", session_id=queue_id, text="QUEUE_SECOND",
                                queued=True, submission_id="desktop-queue-second")
            assert first["status"] == second["status"] == "queued", (first, second)
            assert await call("prompt.submit", session_id=queue_id, text="QUEUE_FIRST",
                              queued=True, submission_id="desktop-queue-first") == first
            queue_snapshot = await call("session.resume", session_id=queue_id, source="desktop",
                                        defer_history=True, omit_messages=True)
            waiting = sorted((row for row in queue_snapshot["pending"] if row["status"] == "queued"),
                             key=lambda row: row["sequence"])
            assert [row["text"] for row in waiting] == ["QUEUE_FIRST", "QUEUE_SECOND"], waiting
            assert all("replace" in row.get("controls", []) for row in waiting), waiting
            replaced = await call("prompt.replace_queued", session_id=queue_id,
                                  admission_id=first["admission_id"],
                                  submission_id="desktop-queue-edit", text="QUEUE_REVISED")
            assert replaced["admission_id"] != first["admission_id"], replaced
            assert await call("prompt.replace_queued", session_id=queue_id,
                              admission_id=first["admission_id"],
                              submission_id="desktop-queue-edit", text="QUEUE_REVISED") == replaced
            cancelled = await call("prompt.cancel", session_id=queue_id,
                                   admission_id=second["admission_id"])
            assert cancelled["status"] == "terminal" and cancelled["outcome"] == "cancelled", cancelled
            assert await call("prompt.cancel", session_id=queue_id,
                              admission_id=second["admission_id"]) == cancelled
            after_queue = await call("session.resume", session_id=queue_id, source="desktop",
                                     defer_history=True, omit_messages=True)
            waiting = [row for row in after_queue["pending"] if row["status"] == "queued"]
            assert len(waiting) == 1 and waiting[0]["admission_id"] == replaced["admission_id"], waiting
            cleared = await call("prompt.cancel", session_id=queue_id,
                                 admission_id=replaced["admission_id"])
            assert cleared["outcome"] == "cancelled", cleared
            stale_queue = await rpc(ws, "prompt.replace_queued", session_id=queue_id,
                                    admission_id=first["admission_id"],
                                    submission_id="desktop-queue-stale", text="NOT_ADMITTED")
            assert "error" in stale_queue, stale_queue
        finally:
            peer.release.set()

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
        active_users = [row for row in resumed["messages"]
                        if row.get("role") == "user" and not row.get("archived")
                        and row.get("display_kind") in (None, "", "steer")
                        and type(row.get("row_id")) is int]
        assert active_users and str(active_users[-1].get("content", "")).startswith("LONG_7_"), active_users
        compressed_rewind = await call("session.mutate", session_id=long_id,
                                       request_id="desktop-compressed-undo", operation="rewind",
                                       expected_revision=resumed["revision"],
                                       expected_generation=resumed["execution_generation"],
                                       payload={"target_message_id": active_users[-1]["row_id"]})
        assert compressed_rewind["rewound_count"] > 0, compressed_rewind
        after_rewind = await call("session.resume", session_id=long_id, source="desktop")
        assert not any(str(row.get("content", "")).startswith("LONG_7_")
                       for row in after_rewind["messages"] if not row.get("archived")), after_rewind


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
    print("Locked Gateway composer: catalog, agents, export, retry, compression, side question, branch, rewind, steer and queue passed")


if __name__ == "__main__":
    main()

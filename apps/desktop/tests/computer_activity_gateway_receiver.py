"""Receive the Rust production stop request in the locked Gateway dispatcher.

The agent is a controllable test double; authorization, routing, generation fencing,
event stamping, interruption delivery and settlement run the locked implementation.
"""
import asyncio
import json
import os
import sys
import tempfile
import site
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[3]
site.addsitedir(str(REPO / ".build/payload/venv/Lib/site-packages"))
sys.path.insert(0, str(REPO / "upstream/hermes-agent"))


async def exercise(params):
    from pytest import MonkeyPatch
    from gateway import session_finite
    from gateway.session_controls import AuthorityConnection
    from gateway.session_contract import Principal, SessionRef, Submission
    from gateway.session_authorities import SessionAuthorities
    from tests.gateway.test_session_authority_cancel_settlement import _authority

    class Agent:
        interrupted = False
        def interrupt(self, *args, **kwargs):
            self.interrupted = True

    with tempfile.TemporaryDirectory(prefix="hermess-computer-receiver-") as directory, MonkeyPatch.context() as patch:
        root = Path(directory)
        os.environ["HERMES_HOME"] = str(root)
        launch_db, launch = _authority(root, patch)
        launch.profile_id = str(root.resolve())
        if params.get("profile"):
            target = root / "profiles" / params["profile"]
            target.mkdir(parents=True)
            (target / "config.yaml").write_text("{}", encoding="utf-8")
            db, authority = _authority(target, patch)
            authority.profile_id = str(target.resolve())
        else:
            db, authority = launch_db, launch
        ref = SessionRef(authority.profile_id, "s")
        actor = Principal("human", authority.profile_id, frozenset({"session:submit", "session:control", "session:read"}), "test")
        agent = Agent()
        authority.runner._cached_agent_for = lambda _route: agent
        registry = SessionAuthorities(root)
        registry.add(root, launch, name="default")
        if authority is not launch:
            registry.add(target, authority, name=params["profile"])
            authority.runner = launch.runner
        launch.runner.session_authorities = registry
        launch.runner._cached_agent_for = lambda _route: agent
        authority.runner.session_authorities = registry
        started, release = asyncio.Event(), asyncio.Event()
        frames = []
        authority.sessions["s"].event_stream.observers.add(frames.append)

        async def execute(owner, session, row):
            stream = owner.sessions[session.session_id].event_stream
            stream.publish("s", {"name": "computer_use", "tool_call_id": "input", "args": {"action": "click"}}, event_type="tool.start")
            started.set()
            await asyncio.wait_for(release.wait(), 10)
            stream.publish("s", {"name": "computer_use", "tool_call_id": "input"}, event_type="tool.complete")
            return "finished"

        patch.setattr(session_finite, "execute_finite_admission", execute)
        connection = AuthorityConnection(launch, SimpleNamespace(write=lambda _frame: True),
                                        {"user_id": "human", "profile_scope": "host"})
        if authority is launch:
            connection.actor = actor
        else:
            connection.actor = Principal("human", launch.profile_id, actor.capabilities, "test-launch")
            sibling = AuthorityConnection(authority, connection.transport, {"user_id":"human", "profile_scope":"host"})
            sibling.actor = actor
            connection._siblings[authority.profile_id] = sibling
        try:
            await authority.submit(actor, Submission(request_id="computer", ref=ref, payload={"text": "test"}, intent="queue"))
            await asyncio.wait_for(started.wait(), 10)
            assert authority._handle(ref).execution_generation == params["execution_generation"]
            rejected = await connection.dispatch({"jsonrpc": "2.0", "id": 1, "method": "session.interrupt",
                                                  "params": {**params, "execution_generation": 0}})
            assert rejected["error"]["message"] == "stale_generation", rejected
            assert not agent.interrupted
            rejected_profile = await connection.dispatch({"jsonrpc": "2.0", "id": 2, "method": "session.interrupt",
                                                         "params": {**params, "profile": "unserved"}})
            assert rejected_profile["error"]["message"] == "profile_mismatch", rejected_profile
            accepted = await connection.dispatch({"jsonrpc": "2.0", "id": 3, "method": "session.interrupt", "params": params})
            assert "result" in accepted, accepted
            assert accepted["result"]["ref"]["profile_id"] == authority.profile_id
            assert agent.interrupted
            assert not any(frame["params"]["type"] == "message.complete" for frame in frames), "acceptance is not completion"
            release.set()
            await asyncio.wait_for(authority.sessions["s"].task, 10)
            actual = [frame["params"] for frame in frames if frame["params"]["type"] in ("tool.start", "tool.complete", "message.complete")]
            assert [frame["type"] for frame in actual] == ["tool.start", "tool.complete", "message.complete"], actual
            assert all(frame["execution_generation"] == params["execution_generation"] for frame in actual)
            print(json.dumps({"accepted": True, "stale_rejected": True, "profile_rejected": True,
                              "events": actual}))
        finally:
            release.set()
            if authority.sessions["s"].task and not authority.sessions["s"].task.done():
                await authority.sessions["s"].task
            db.close()
            if launch_db is not db: launch_db.close()


if __name__ == "__main__":
    asyncio.run(exercise(json.loads(sys.argv[1])))

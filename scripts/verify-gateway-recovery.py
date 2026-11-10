"""Exercise the Windows Rust Gateway launcher against the locked receiver.

Run with the prepared Hermes Python. The ignored Rust gateway_recovery_live
test owns every Gateway process through the product process manager. This
driver supplies an isolated Home, a loopback model, and real control/WS calls;
it does not connect to the installed application or an existing Gateway.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid

from validation_workspace import validation_workspace

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))

from tests.fakes.fake_llm_provider import FakeLLMServer, Text, ToolCall, write_hermes_home
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus


def control(home: Path, verb: str, params: dict | None = None) -> dict:
    request = json.dumps({"protocol": 1, "id": 1, "verb": verb, "params": params or {}}).encode() + b"\n"
    if os.name == "nt":
        from gateway.runtime_bootstrap_windows import query_runtime_control
        raw = query_runtime_control(home, request, 2)
    else:
        pointer = home / "gateway.sock.path"
        path = pointer.read_text(encoding="utf-8").strip() if pointer.exists() else str(home / "gateway.sock")
        with socket.socket(socket.AF_UNIX) as peer:
            peer.settimeout(2)
            peer.connect(path)
            peer.sendall(request)
            with peer.makefile("rb") as stream:
                raw = stream.readline()
    reply = json.loads(raw.split(b"\n", 1)[0])
    assert reply.get("ok") is True, f"control {verb} was refused"
    return reply["result"]


def ticket(home: Path, descriptor: dict) -> str:
    # Same binding as runtime/gateway_control.rs::ticket (never log the grant).
    return control(home, "session-ticket", {
        "profile_id": str(home.resolve()), "instance_id": descriptor["instance_id"],
        "purpose": "interactive", "scope": "host",
    })["ticket"]


def websocket(descriptor: dict, grant: str):
    return connect(descriptor["api_origin"].replace("http:", "ws:") + "/api/ws",
                   subprotocols=["hermes-gateway-v1", "hermes-gateway-ticket." + grant],
                   proxy=None, max_size=8 * 1024 * 1024)


async def rpc(ws, method: str, **params) -> dict:
    request_id = uuid.uuid4().hex
    await ws.send(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}))
    async with asyncio.timeout(30):
        while True:
            reply = json.loads(await ws.recv())
            if reply.get("id") == request_id:
                assert "result" in reply, f"{method} rejected: {reply.get('error', {}).get('message')}"
                return reply["result"]


async def wait_history(ws, session_id: str, needle: str) -> dict:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        snapshot = await rpc(ws, "session.resume", profile="default", session_id=session_id, source="desktop")
        if needle in json.dumps(snapshot.get("messages", [])) and not snapshot.get("running"):
            return snapshot
        await asyncio.sleep(.2)
    raise AssertionError(f"session did not settle with expected fixture output: {needle}")


async def first_connection(home: Path, descriptor: dict, model: FakeLLMServer) -> str:
    async with websocket(descriptor, ticket(home, descriptor)) as ws:
        await rpc(ws, "client.capabilities", server_requests=True, desktop_local=True)
        # These are the current Rust session_create_params / prompt_submit_params
        # and resume_chat_session shapes, including ProfiledGateway's profile.
        created = await rpc(ws, "session.create", profile="default", source="gui",
                            request_id=uuid.uuid4().hex, cwd=str(home), cwd_explicit=True)
        session_id = created["stored_session_id"]
        model.push(Text("RECOVERY_WARM_HISTORY"))
        await rpc(ws, "prompt.submit", profile="default", session_id=session_id,
                  submission_id=uuid.uuid4().hex, text="WARM_HISTORY", clarify_batch=True)
        await wait_history(ws, session_id, "RECOVERY_WARM_HISTORY")
        model.push(ToolCall("terminal", {"command": "hermes gateway restart"}), Text("RECOVERY_GUARD_COMPLETE"))
        await rpc(ws, "prompt.submit", profile="default", session_id=session_id,
                  submission_id=uuid.uuid4().hex, text="RESTART_VIA_TERMINAL", clarify_batch=True)
        snapshot = await wait_history(ws, session_id, "RECOVERY_GUARD_COMPLETE")
        history = json.dumps(snapshot.get("messages", []))
        assert "cannot restart, stop, or uninstall the gateway" in history, "real terminal lifecycle guard did not reject restart"
        current = control(home, "identify")
        assert current["instance_id"] == descriptor["instance_id"], "blocked terminal command replaced Gateway"
        # The same socket remains usable after the rejected AI tool call.
        assert (await rpc(ws, "ping"))["pong"] is True
        return session_id


async def powershell_restart(home: Path, descriptor: dict, session_id: str,
                             model: FakeLLMServer, hermes: Path) -> None:
    # Desktop's own PowerShell tool has the ordinary command approval path,
    # unlike terminal's separate supervised-lifecycle refusal. The test Home
    # explicitly authorizes commands; this is never written to a user Profile.
    definitions = model.main_requests()[0].get("tools", [])
    assert any(row.get("function", {}).get("name") == "powershell_execute" for row in definitions)
    command = "& '" + hermes.as_posix().replace("'", "''") + "' gateway restart --yes"
    model.push(ToolCall("powershell_execute", {"command": command, "workdir": str(home), "timeout": 90}))
    async with websocket(descriptor, ticket(home, descriptor)) as ws:
        await rpc(ws, "client.capabilities", server_requests=True, desktop_local=True)
        await rpc(ws, "session.resume", profile="default", session_id=session_id, source="desktop")
        await rpc(ws, "prompt.submit", profile="default", session_id=session_id,
                  submission_id=uuid.uuid4().hex, text="RESTART_VIA_POWERSHELL", clarify_batch=True)
        # Drain events while waiting: a full receive queue can otherwise pause
        # socket reads and hide the close behind the client's keepalive timeout.
        try:
            async with asyncio.timeout(85):
                async for _ in ws:
                    pass
        except ConnectionClosed:
            pass


async def recovered_connection(home: Path, descriptor: dict, session_id: str, stale_ticket: str) -> None:
    try:
        async with websocket(descriptor, stale_ticket):
            pass
    except InvalidStatus:
        pass
    else:
        raise AssertionError("a prior Gateway's ticket authenticated to the replacement")
    async with websocket(descriptor, ticket(home, descriptor)) as ws:
        await rpc(ws, "client.capabilities", server_requests=True, desktop_local=True)
        snapshot = await rpc(ws, "session.resume", profile="default", session_id=session_id, source="desktop")
        history = json.dumps(snapshot.get("messages", []))
        assert "RECOVERY_WARM_HISTORY" in history and "RECOVERY_GUARD_COMPLETE" in history
        assert snapshot["stored_session_id"] == session_id
        assert (await rpc(ws, "ping"))["pong"] is True


def wait_ready(sync: Path, phase: int, process: subprocess.Popen) -> dict:
    deadline = time.monotonic() + (600 if phase == 0 else 180)
    file = sync / f"ready-{phase}.json"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Rust live test ended before phase {phase}; exit={process.returncode}")
        try:
            return json.loads(file.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(.1)
    raise TimeoutError(f"Rust live test did not publish phase {phase}")


def isolated_env(root: Path, storage: Path, hermes: Path) -> dict[str, str]:
    allowed = ("PATH", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "PATHEXT",
               "PROGRAMDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "CARGO_HOME", "RUSTUP_HOME")
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    # Cargo/rustup must retain their installed toolchains while the Gateway gets
    # a separate native default home and Windows startup directory.
    env.setdefault("CARGO_HOME", str(Path.home() / ".cargo"))
    env.setdefault("RUSTUP_HOME", str(Path.home() / ".rustup"))
    user = root / "user"
    user.mkdir()
    for directory in ("roaming", "local"):
        (user / directory).mkdir()
    env.update({
        "HOME": str(user), "USERPROFILE": str(user), "APPDATA": str(user / "roaming"),
        "LOCALAPPDATA": str(user / "local"), "HERMES_HOME": str(storage / "hermes-home"),
        "HERMESS_TEST_GATEWAY_HERMES": str(hermes), "HERMESS_TEST_GATEWAY_STORAGE": str(storage),
        "HERMESS_TEST_GATEWAY_SYNC": str(root / "sync"), "PYTHONPATH": str(UPSTREAM),
        "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "HERMES_DISABLE_LAZY_INSTALLS": "1",
        "HERMES_GATEWAY_INSTALL_START_ON_LOGIN": "0", "HTTP_PROXY": "http://127.0.0.1:9",
        "HTTPS_PROXY": "http://127.0.0.1:9", "ALL_PROXY": "http://127.0.0.1:9", "NO_PROXY": "127.0.0.1,localhost",
    })
    return env


def cleanup_run(root: Path, sync: Path, process: subprocess.Popen | None,
                model: FakeLLMServer | None) -> None:
    try:
        try:
            if sync.is_dir():
                (sync / "finish").write_text("finished", encoding="utf-8")
        finally:
            # Let Rust close its registered process trees before deleting data.
            # Terminating Cargo alone could orphan its test child.
            if process is not None and process.poll() is None:
                try:
                    process.wait(timeout=100)
                except subprocess.TimeoutExpired as error:
                    raise RuntimeError(
                        f"Rust live test did not finish cleanup; inspect {root.relative_to(ROOT)}"
                    ) from error
    finally:
        if model is not None:
            model.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, default=Path(sys.executable).with_name("hermes.exe" if os.name == "nt" else "hermes"))
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("the native Rust live harness currently requires Windows; macOS needs separate native acceptance")
    hermes = args.hermes.resolve(strict=True)
    if not hermes.is_relative_to(ROOT / ".build"):
        parser.error("use the prepared product launcher under .build")
    lock = json.loads((ROOT / "runtime/upstream.lock.json").read_text(encoding="utf-8"))
    head = subprocess.check_output(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"],
                                   text=True, creationflags=subprocess.CREATE_NO_WINDOW).strip()
    assert head == lock["commit"], "Gateway source does not match the product lock"
    with validation_workspace(prefix="gateway-recovery-", dir=ROOT / ".build") as directory:
        report = run(Path(directory), hermes)
    print(json.dumps({**report, "temporary_directory_removed": True}))


def run(root: Path, hermes: Path) -> dict:
    sync = root / "sync"
    process = None
    model = None
    try:
        storage = root / "HermessAgentDesktop"
        home = storage / "hermes-home"
        (storage / "control").mkdir(parents=True)
        sync.mkdir()
        env = isolated_env(root, storage, hermes)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        model = FakeLLMServer(default_text="RECOVERY_NO_DUPLICATE_SUBMISSION")
        model.start()
        write_hermes_home(home, model.base_url, extra_config=(
            "gateway:\n  multiplex_profiles: false\n"
            "terminal:\n  backend: local\n  local_persistent: false\n"
            "platform_toolsets:\n  cli: [terminal]\n"
            "auxiliary:\n  title_generation:\n    enabled: false\n"
            "approvals:\n  mode: 'off'\n"
        ))
        # Windows service names are host-wide. Refuse even the test if this unique
        # temporary Home would resolve to a registered task or the bare service.
        service_check = (
            "from hermes_cli.gateway import _profile_suffix; "
            "from hermes_cli.gateway_windows import is_task_registered; "
            "assert _profile_suffix(), 'test Home resolved to default service'; "
            "assert not is_task_registered(), 'test Home already has a Windows task'"
        )
        subprocess.run([sys.executable, "-c", service_check], cwd=UPSTREAM, env=env,
                       check=True, capture_output=True, creationflags=flags, timeout=20)
        command = ["cargo", "test", "--manifest-path", str(ROOT / "apps/desktop/src-tauri/Cargo.toml"),
                   "--locked", "gateway_recovery_live", "--", "--ignored", "--nocapture"]
        with (root / "rust-test.log").open("wb") as log:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
            first = wait_ready(sync, 0, process)
            before = control(home, "identify")
            assert first["port"] == int(before["api_origin"].rsplit(":", 1)[1])
            session = asyncio.run(first_connection(home, before, model))
            unused_old_ticket = ticket(home, before)
            asyncio.run(powershell_restart(home, before, session, model, hermes))
            restarted = wait_ready(sync, 1, process)
            after = control(home, "identify")
            assert first["pid"] != restarted["pid"] and before["instance_id"] != after["instance_id"]
            asyncio.run(recovered_connection(home, after, session, unused_old_ticket))
            unused_old_ticket = ticket(home, after)
            assert control(home, "pause-for-update")["pausing"] is True
            stopped = wait_ready(sync, 2, process)
            final = control(home, "identify")
            assert stopped["pid"] != restarted["pid"] and final["instance_id"] != after["instance_id"]
            asyncio.run(recovered_connection(home, final, session, unused_old_ticket))
            (sync / "finish").write_text("finished", encoding="utf-8")
            assert process.wait(timeout=90) == 0, "Rust live assertions failed"
            texts = [next((m.get("content") for m in reversed(r["messages"]) if m.get("role") == "user"), "")
                     for r in model.main_requests()]
            assert texts.count("WARM_HISTORY") == 1 and texts.count("RESTART_VIA_TERMINAL") == 2, texts
            assert texts.count("RESTART_VIA_POWERSHELL") == 1, texts
            report = {"platform": sys.platform, "terminal_restart_blocked": True,
                              "powershell_exit_0_auto_recovered": True, "supervised_exit_75_manual_recovered": True,
                              "new_tickets_and_history": True, "duplicate_input": False}
    finally:
        cleanup_run(root, sync, process, model)
    return report


if __name__ == "__main__":
    main()

"""Verify production Tauri session.create, locked Gateway and real tool processes; no real model credentials."""
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid

from validation_workspace import validation_workspace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("recovery_driver", ROOT / "scripts/verify-gateway-recovery.py")
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
from tests.fakes.fake_llm_provider import FakeLLMServer, Text, ToolCall, write_hermes_home
from pm.lock import Facts, Lockfile
from pm.paths import lockfile_path
from pm.registry import get_package
from pm.store import current_target


def wait_file(path, process):
    deadline = time.monotonic() + 120
    while not path.is_file():
        if process.poll() is not None:
            raise AssertionError("Native driver stopped; see rust.log")
        if time.monotonic() > deadline:
            raise AssertionError("Native driver timed out; see rust.log")
        time.sleep(.1)
    return json.loads(path.read_text(encoding="utf-8"))


def marker(store, label):
    # Real PM identity validation against synthetic presence-only gh records.
    # No synthetic gh executable is ever run; Python reports PATH order only.
    package, lock, target = get_package("gh"), Lockfile(lockfile_path()), current_target()
    entry = store / ("session-marker-" + label)
    binary = package.binary(entry, target)
    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.write_bytes(b"fixture executable, never run")
    Facts(store / "facts.json").record("gh", lock.version("gh"), entry.name,
        {"PATH": [str(binary.parent)]}, store, target=target,
        artifacts=[item["sha256"] for item in lock.artifacts("gh", target)])
    return str(binary.parent)


async def verify(root, process, model, home, marker_a, marker_b):
    sync = root / "sync"
    first = await asyncio.to_thread(wait_file, sync / "session-0.json", process)
    (sync / "create-second").write_text("ready", encoding="utf-8")
    second = await asyncio.to_thread(wait_file, sync / "session-1.json", process)
    request_index = 0

    async def native(action, session="", tag=""):
        nonlocal request_index
        index = request_index
        request_index += 1
        request = sync / f"request-{index}.json"
        stage = sync / "request.tmp"
        stage.write_text(json.dumps({"action": action, "session": session, "tag": tag}), encoding="utf-8")
        stage.replace(request)
        return await asyncio.to_thread(wait_file, sync / f"response-{index}.json", process)
    project = root / "project"
    expected_python = next((ROOT / ".build/payload/tools").glob("python-*/python.exe")).resolve()

    async def call(session, tool, command, output, expected_marker, project_env=False):
        tag = "CHAT_ENV_" + uuid.uuid4().hex
        arguments = {"command": command}
        if tool == "powershell_execute":
            arguments["workdir"] = str(project)
        model.push(ToolCall(tool, arguments), Text(tag))
        snapshot = await native("submit", session, tag)
        path = project / output
        assert path.is_file(), str(snapshot.get("messages", []))[-5000:]
        observed = json.loads(path.read_text(encoding="utf-8"))
        assert not observed["hermes_visible"], observed
        assert not observed["dependency_path"], observed
        assert not any(observed["markers"].values()), observed
        assert os.path.normcase(observed["marker"]) == os.path.normcase(expected_marker), observed
        if project_env:
            assert Path(observed["prefix"]).resolve() == (project / ".venv").resolve(), observed
            assert observed["project_visible"], observed
        else:
            assert Path(observed["executable"]).resolve() == expected_python, observed
            assert not observed["project_visible"], observed
        print("PASS", tool, output, "python=" + observed["executable"], "version=" + observed["version"], flush=True)

    a, b = first["stored_session_id"], second["stored_session_id"]
    for tool in ("powershell_execute", "terminal"):
        await call(a, tool, "python probe.py " + tool + "-a.json", tool + "-a.json", marker_a)
        await call(b, tool, "python probe.py " + tool + "-b.json", tool + "-b.json", marker_b)
    await native("resume", a)
    await call(a, "powershell_execute", "python probe.py resumed.json", "resumed.json", marker_a)
    await call(a, "terminal", ". .venv/Scripts/activate && python probe.py terminal-project.json",
               "terminal-project.json", marker_a, True)
    await call(a, "powershell_execute", ". ./.venv/Scripts/Activate.ps1; python probe.py powershell-project.json",
               "powershell-project.json", marker_a, True)
    await call(b, "terminal", "python probe.py final-b.json", "final-b.json", marker_b)
    assert (await native("invalid"))["rejected"]
    print("PASS invalid client_env rejected; session isolation and resume verified", flush=True)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, default=ROOT / ".build/payload/bin/hermes.exe")
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Windows native harness; macOS requires separate execution")
    hermes = args.hermes.resolve(strict=True)
    if not hermes.is_relative_to(ROOT / ".build"):
        parser.error("use the product-prepared launcher under .build")
    lock = json.loads((ROOT / "runtime/upstream.lock.json").read_text(encoding="utf-8"))
    head = subprocess.check_output(["git", "-C", str(driver.UPSTREAM), "rev-parse", "HEAD"], text=True,
                                   creationflags=subprocess.CREATE_NO_WINDOW).strip()
    assert head == lock["commit"], "Gateway does not match the product lock"
    with validation_workspace(prefix="chat-environment-", dir=ROOT / ".build") as directory:
        run(Path(directory), hermes)
    print("PASS production session.create + real Gateway tool execution")


def run(root: Path, hermes: Path) -> None:
    process = model = None
    try:
        storage = root / "HermessAgentDesktop"
        home = storage / "hermes-home"
        project = root / "project"
        project.mkdir()
        (root / "sync").mkdir()
        (storage / "control").mkdir(parents=True)
        env = driver.isolated_env(root, storage, hermes)
        # This machine's Git is in a nonstandard directory, outside the fork's
        # default search list. Use its supported explicit shell setting.
        git = shutil.which("git")
        bash = Path(git).parent.parent / "bin/bash.exe" if git else None
        if bash is None or not bash.is_file():
            raise RuntimeError("Install Git for Windows before running the terminal probe")
        env["HERMES_GIT_BASH_PATH"] = str(bash)
        model = FakeLLMServer(default_text="NO_REAL_MODEL")
        model.start()
        write_hermes_home(home, model.base_url, extra_config="terminal:\n  backend: local\n  local_persistent: true\napprovals:\n  mode: 'off'\nauxiliary:\n  title_generation:\n    enabled: false\n")
        marker_a = marker(home / "tools", "a")
        python = next((ROOT / ".build/payload/tools").glob("python-*/python.exe"))
        subprocess.run([str(python), "-m", "venv", "--without-pip", str(project / ".venv")], check=True,
                       creationflags=subprocess.CREATE_NO_WINDOW, timeout=30)
        (project / ".venv/Lib/site-packages/project_dependency.py").write_text("VALUE = 'fixture'\n", encoding="utf-8")
        probe = """import importlib.util,json,os,sys
from pathlib import Path
data={'executable':sys.executable,'prefix':sys.prefix,'version':sys.version.split()[0],
 'hermes_visible':importlib.util.find_spec('psutil') is not None,
 'project_visible':importlib.util.find_spec('project_dependency') is not None,
 'dependency_path':[p for p in sys.path if 'payload/venv' in p.replace('\\\\','/') or 'hermes-agent' in p],
 'markers':{k:os.getenv(k) for k in ('PYTHONPATH','PYTHONHOME')},
 'marker':next((p for p in os.getenv('PATH','').split(os.pathsep) if 'session-marker-' in p),'')}
Path(sys.argv[1]).write_text(json.dumps(data),encoding='utf-8')
"""
        (project / "probe.py").write_text(probe, encoding="utf-8")
        with (root / "rust.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen(["cargo", "test", "--manifest-path", str(ROOT / "apps/desktop/src-tauri/Cargo.toml"),
                "--locked", "chat_environment_live", "--", "--ignored", "--nocapture"], cwd=ROOT, env=env,
                stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
            # Wait until A has frozen its PM PATH, then publish another marker for B.
            wait_file(root / "sync/session-0.json", process)
            marker_b = marker(home / "tools", "b")
            asyncio.run(verify(root, process, model, home, marker_a, marker_b))
            (root / "sync/finish").write_text("finished", encoding="utf-8")
            assert process.wait(timeout=30) == 0, "Native assertions failed; see rust.log"
    finally:
        try:
            if process is not None and process.poll() is None:
                (root / "sync/finish").touch()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True,
                                   creationflags=subprocess.CREATE_NO_WINDOW, timeout=15, check=True)
                    process.wait(timeout=15)
        finally:
            if model is not None:
                model.stop()


if __name__ == "__main__":
    main()

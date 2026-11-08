"""Real locked App Server + product worker with a local synthetic Responses service.

Native actions are stubbed for approval checks. --native uses the product-selected
cua-driver only for list_apps (no mouse/keyboard input and no screenshots).
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import queue
import site
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = Path(__file__).resolve().parents[3]


def bootstrap():
    site.addsitedir(str(REPO / ".build/computer-activity-python-deps"))
    site.addsitedir(str(REPO / ".build/payload/venv/Lib/site-packages"))
    sys.path.insert(0, str(REPO / "upstream/hermes-agent"))
    spec = importlib.util.spec_from_file_location("programming_worker", REPO / "apps/desktop/runtime/programming_worker.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    return worker


def worker_main(native):
    worker = bootstrap()
    original_reason = worker.failure_reason
    def reason(error):
        print("COMPUTER_FIXTURE_ERROR", type(error).__name__, str(error).replace("COMPUTER_TEST_ONLY_KEY", "[redacted]"), file=sys.stderr, flush=True)
        return original_reason(error)
    worker.failure_reason = reason
    if not native:
        original = worker.run_computer_tool
        def run(params, initial, emit, answers, interrupt):
            def backend(arguments, **kwargs):
                emit({"kind": "test_native_invoked", "action": arguments["action"]})
                return '{"ok":true,"apps":[]}'
            return original(params, initial, emit, answers, interrupt, native=backend)
        worker.run_computer_tool = run
    worker.main()


def main(native=False, embedded=False):
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            functions = [tool.get("name") for tool in body.get("tools", []) if tool.get("type") == "function"]
            assert "hermess_computer_use" in functions, functions
            items = body.get("input", [])
            last_user = max((index for index, item in enumerate(items) if item.get("role") == "user"), default=-1)
            already_called = any(item.get("type") == "function_call_output" for item in items[last_user + 1:])
            calls.append(body)
            if not already_called:
                item = {"type": "function_call", "id": "fc_desktop", "call_id": "call_desktop", "name": "hermess_computer_use",
                        "arguments": json.dumps({"action": "list_apps"}), "status": "completed"}
            else:
                item = {"type": "message", "id": "msg_desktop", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_text", "text": "COMPUTER_PROTOCOL_OK", "annotations": []}]}
            events = [
                {"type": "response.created", "response": {"id": "resp_desktop", "status": "in_progress", "output": []}},
                {"type": "response.output_item.added", "output_index": 0, "item": item},
                {"type": "response.output_item.done", "output_index": 0, "item": item},
                {"type": "response.completed", "response": {"id": "resp_desktop", "status": "completed", "output": [item],
                    "usage": {"input_tokens": 10, "output_tokens": 3, "total_tokens": 13}}},
            ]
            encoded = "".join("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n" for event in events).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="hermess-computer-codex-", dir=REPO / ".build") as directory:
        root = Path(directory)
        project = root / "project"
        project.mkdir()
        private = root / "private"
        private.mkdir()
        tools = REPO / ".build/computer-activity-tools"
        def turn(choice, previous=None):
            home = private / (previous["home"] if previous else str(len(list(private.iterdir()))))
            home.mkdir(exist_ok=True)
            payload = {"home": str(home), "private_root": str(private), "connection_id": "computer-fixture", "cwd": str(project),
                       "model": "gpt-5.2-codex", "base_url": f"http://127.0.0.1:{server.server_port}/v1", "effort": "low",
                       "executable": str(REPO / ".build/codex-probe/bin/codex.exe"), "api_key": "COMPUTER_TEST_ONLY_KEY",
                       "thread_id": previous["thread_id"] if previous else None, "text": "Use hermess_computer_use list_apps once.",
                       "images": [], "permissions": "request", "computer_tools_roots": [str(tools)]}
            command = [sys.executable, "-I", "-u", str(Path(__file__).resolve()), "--worker"]
            if native: command.append("--native")
            env = {key: value for key, value in os.environ.items() if not key.startswith(("HERMES_", "CODEX_", "HERMESS_"))}
            if embedded:
                source = b"\n".join((REPO / "apps/desktop/runtime" / name).read_bytes()
                                    for name in ("programming_session_commands.py", "programming_worker.py"))
                encoded = base64.b64encode(zlib.compress(source)).decode()
                command = [sys.executable, "-P", "-u", "-c", f"import base64,zlib;exec(compile(zlib.decompress(base64.b64decode('{encoded}')),'<hermess-programming-worker>','exec'))"]
                env = {key: value for key, value in env.items() if key.upper() in ("PATH","SYSTEMROOT","SYSTEMDRIVE","WINDIR","TEMP","TMP","TMPDIR","LANG","LC_ALL","HOME","USERPROFILE")}
                env["PYTHONPATH"] = os.pathsep.join(str(REPO / directory) for directory in (".build/computer-activity-python-deps", ".build/payload/venv/Lib/site-packages", "upstream/hermes-agent"))
                env.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
            proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding="utf-8", env=env, cwd=project, creationflags=0x08000000 if os.name == "nt" else 0)
            events = queue.Queue()
            if embedded:
                threading.Thread(target=lambda: [print(line.replace("COMPUTER_TEST_ONLY_KEY", "[redacted]"), file=sys.stderr, end="", flush=True) for line in proc.stderr], daemon=True).start()
            threading.Thread(target=lambda: [events.put(json.loads(line)) for line in proc.stdout], daemon=True).start()
            proc.stdin.write(json.dumps(payload) + "\n")
            proc.stdin.flush()
            seen = []
            try:
                deadline = time.monotonic() + 70
                while time.monotonic() < deadline:
                    event = events.get(timeout=max(.1, deadline - time.monotonic()))
                    seen.append(event)
                    if event["kind"] == "approval":
                        assert event.get("source") == "computer", event
                        assert not any(note["kind"] in ("computer_activity", "test_native_invoked") for note in seen)
                        option = next(option for option in event["options"] if option["kind"] == choice)
                        proc.stdin.write(json.dumps({"kind": "approval", "id": event["id"], "option_id": option["id"]}) + "\n")
                        proc.stdin.flush()
                    if event["kind"] == "result":
                        break
                else:
                    raise AssertionError("worker timeout")
                proc.stdin.close()
                proc.wait(timeout=15)
                assert not seen[-1]["failed"], seen[-1]
                assert any(event["kind"] == "approval" for event in seen), "each test turn must actually call the tool"
                activity = [event for event in seen if event["kind"] == "computer_activity"]
                if choice == "once":
                    assert any(event["started"] for event in activity), seen
                    assert any(not event["started"] for event in activity), seen
                    tools_seen = [event["tool"] for event in seen if event["kind"] == "tool" and event["tool"]["type"] == "dynamicToolCall"]
                    assert any(tool["status"] == "completed" for tool in tools_seen), tools_seen
                    if native:
                        assert not any(tool["status"] == "failed" for tool in tools_seen), tools_seen
                        assert any(event["kind"] == "computer_result" and event["outcome"] == "completed" for event in seen), tools_seen
                    else:
                        assert sum(event["kind"] == "test_native_invoked" for event in seen) == 1
                else:
                    assert not any(event["kind"] == "test_native_invoked" for event in seen), seen
                    assert not any(event["started"] for event in activity), seen
                if choice == "cancel": assert seen[-1]["interrupted"]
                thread = next(event["id"] for event in seen if event["kind"] == "thread")
                print(f"PASS actual locked Codex: {choice}, native={native}, thread_resume={previous is not None}")
                return {"thread_id": thread, "home": home.name}
            except Exception:
                if proc.poll() is None:
                    proc.stdin.close()
                    try: proc.wait(timeout=15)
                    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
                print(proc.stderr.read()[-4000:], file=sys.stderr)
                raise
        saved = turn("once")
        turn("deny", saved)
        turn("cancel")
    server.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--native", action="store_true")
    parser.add_argument("--prepare-native", action="store_true")
    parser.add_argument("--embedded", action="store_true")
    args = parser.parse_args()
    if args.prepare_native:
        os.environ["HERMES_HOME"] = str(REPO / ".build/computer-activity-native-home")
        os.environ["HERMES_RUNTIME_DIR"] = str(REPO / ".build/computer-activity-tools")
        bootstrap()
        from pm import ensure
        ensure("cua-driver")
    elif args.worker: worker_main(args.native)
    else: main(args.native, args.embedded)

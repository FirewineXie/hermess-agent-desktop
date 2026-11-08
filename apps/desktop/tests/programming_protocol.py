"""Real fixed-version App Server against a local Responses fixture, never a real credential.

Run with the locked Hermes Python environment and --codex pointing at the downloaded package.
This verifies protocol integration, not model quality or native-window acceptance.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
import base64
import struct
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def load_worker(repo):
    path = repo / "apps/desktop/runtime/programming_worker.py"
    spec = importlib.util.spec_from_file_location("programming_worker", path)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    return worker


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--tools-root", type=Path, action="append", default=[],
                        help="Product PM stores to verify by actual sandboxed tool execution")
    parser.add_argument("--tools-only", action="store_true", help="Stop after actual tool and isolation checks")
    args = parser.parse_args()
    if args.tools_only and not args.tools_root:
        parser.error("--tools-only requires --tools-root")
    repo = Path(__file__).resolve().parents[3]
    worker = load_worker(repo)
    requests = []
    command_to_run = ""
    expected_key = "TEST_ONLY_PROGRAMMING_KEY"
    failure_mode = None
    tool_parameters = {}
    approval_events = []
    approval_kind = "cancel"
    repeat_tool = False
    review_count = 0
    fixture_patch = None

    def schema_fixture(schema, root=None):
        root = root or schema
        if "$ref" in schema:
            target = root
            for part in schema["$ref"].removeprefix("#/").split("/"): target = target[part]
            return schema_fixture(target, root)
        if "enum" in schema:
            return next((value for value in ("allow", "approve", "low", "high", "explicit") if value in schema["enum"]), schema["enum"][0])
        if "anyOf" in schema: return schema_fixture(next(item for item in schema["anyOf"] if item.get("type") != "null"), root)
        if schema.get("type") == "object" or "properties" in schema:
            return {key: schema_fixture(schema["properties"][key], root) for key in schema.get("required", schema.get("properties", {}))}
        if schema.get("type") == "array": return []
        if schema.get("type") == "boolean": return True
        if schema.get("type") in ("number", "integer"): return 0
        return "Fixture approves a temporary local test file requested by the test user."

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            nonlocal review_count
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert self.path == "/v1/responses", self.path
            assert self.headers.get("Authorization") == "Bearer " + expected_key
            assert body["model"] == "gpt-5.2-codex"
            requests.append(body)
            if failure_mode:
                self.send_response(401 if failure_mode == "unauthorized" else 404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":{"message":"fixture rejected request"}}')
                return
            if len(requests) == 1:
                assert any(tool.get("name") == "exec_command" for tool in body.get("tools", []))
            review_schema = ((body.get("text") or {}).get("format") or {}).get("schema")
            if review_schema: review_count += 1
            text = json.dumps(schema_fixture(review_schema)) if review_schema else "PROTOCOL_FIXTURE_OK"
            item = {"type": "message", "id": "msg_1", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": text, "annotations": []}]}
            if len(requests) == 1 or repeat_tool and len(requests) == 2:
                arguments = {"cmd": command_to_run, "yield_time_ms": 1000, "max_output_tokens": 500, **tool_parameters}
                item = {"type": "function_call", "id": f"fc_{len(requests)}", "call_id": f"call_fixture_{len(requests)}", "name": "exec_command",
                        "arguments": json.dumps(arguments), "status": "completed"}
                if fixture_patch is not None:
                    # The model's exposed shell tool is also Codex's supported patch entry point.
                    item["arguments"] = json.dumps({"cmd": "apply_patch <<'PATCH'\n" + fixture_patch + "\nPATCH", "yield_time_ms": 1000, "max_output_tokens": 500})
            events = [
                {"type": "response.created", "response": {"id": "resp_test", "status": "in_progress", "output": []}},
                {"type": "response.output_item.added", "output_index": 0, "item": {**item, "status": "in_progress", "content": []}},
                {"type": "response.output_text.delta", "item_id": "msg_1", "output_index": 0, "content_index": 0, "delta": text},
                {"type": "response.output_item.done", "output_index": 0, "item": item},
                {"type": "response.completed", "response": {"id": "resp_test", "status": "completed", "output": [item],
                    "usage": {"input_tokens": 10, "output_tokens": 3, "total_tokens": 13}}},
            ]
            if item["type"] != "message":
                events = [events[0], {"type": "response.output_item.added", "output_index": 0, "item": item}, events[-2], events[-1]]
            encoded = "".join("event: " + e["type"] + "\ndata: " + json.dumps(e) + "\n\n" for e in events).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="hermess-coding-protocol-", dir=repo / ".build") as directory:
        root = Path(directory)
        cwd = root / "project"; cwd.mkdir()
        home = root / "private" / "thread"; home.mkdir(parents=True)
        personal = root / "personal"; (personal / ".codex").mkdir(parents=True)
        personal_config = personal / ".codex" / "config.toml"
        personal_auth = personal / ".codex" / "auth.json"
        personal_config.write_text('model = "PERSONAL_MODEL_MUST_NOT_BE_USED"\n', encoding="utf-8")
        personal_auth.write_text('{"fixture":"PERSONAL_AUTH_MUST_NOT_BE_USED"}', encoding="utf-8")
        personal_before = {file: file.read_bytes() for file in (personal_config, personal_auth)}
        vault = root / "private" / "vault"; vault.mkdir()
        (vault / "master.key").write_text("TEST_ONLY_MASTER_CONTENT", encoding="utf-8")
        if os.name == "nt":
            path_literal = str(vault / "master.key").replace("'", "''")
            personal_literal = str(personal_config).replace("'", "''")
            command_to_run = "Set-Content -LiteralPath (Join-Path $PWD 'fixture.txt') -Value 'PROGRAMMING_FILE_OK' -NoNewline -Encoding ASCII; " + \
                "if (Test-Path Env:HERMESS_PROGRAMMING_KEY) { 'CREDENTIAL_LEAK' } else { 'ENV_ISOLATED' }; " + \
                "try { $null=Get-Content -LiteralPath '" + path_literal + "' -ErrorAction Stop; 'VAULT_READ_ALLOWED' } catch { 'VAULT_READ_DENIED' }; " + \
                "try { $null=Get-Content -LiteralPath '" + personal_literal + "' -ErrorAction Stop; 'PERSONAL_READ_ALLOWED' } catch { 'PERSONAL_READ_DENIED' }"
        else:
            import shlex
            command_to_run = "printf PROGRAMMING_FILE_OK > fixture.txt; " + \
                "if [ -n \"$HERMESS_PROGRAMMING_KEY\" ]; then echo CREDENTIAL_LEAK; else echo ENV_ISOLATED; fi; " + \
                "if cat " + shlex.quote(str(vault / "master.key")) + " >/dev/null 2>&1; then echo VAULT_READ_ALLOWED; else echo VAULT_READ_DENIED; fi; " + \
                "if cat " + shlex.quote(str(personal_config)) + " >/dev/null 2>&1; then echo PERSONAL_READ_ALLOWED; else echo PERSONAL_READ_DENIED; fi"
        if args.tools_root:
            probe = "import json,sys,shutil;print('PM_TOOLS='+json.dumps({'python':sys.executable,'python_version':sys.version.split()[0],'node':shutil.which('node'),'npm':shutil.which('npm.cmd' if sys.platform=='win32' else 'npm'),'uv':shutil.which('uv')}))"
            command_to_run += '; python -c "' + probe + '"; node -p "process.execPath"; node --version; '
            command_to_run += ('npm.cmd' if os.name == 'nt' else 'npm') + ' --version; uv --version'
        initial = {"home": str(home), "private_root": str(root / "private"), "cwd": str(cwd),
                   "base_url": f"http://127.0.0.1:{server.server_port}/v1", "model": "gpt-5.2-codex",
                   "effort": "medium", "executable": str(args.codex.resolve()), "api_key": "TEST_ONLY_PROGRAMMING_KEY",
                   "text": "Reply with the fixture text.", "permissions": "hermess", "thread_id": None, "connection_id": "fixture-connection"}
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 2, 0, 0, 0)) + \
            chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\0\0" * 32) * 32)) + chunk(b"IEND", b"")
        initial["images"] = ["data:image/png;base64," + base64.b64encode(png).decode()]
        # Exercise the same policy verifier independently, to report a safe failure stage.
        provider_id, provider, policy = worker.launch_policy(initial)
        env = {key: os.environ[key] for key in ("PATH", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE") if key in os.environ}
        env.update(CODEX_HOME=str(home), CODEX_SQLITE_HOME=str(home), HERMES_HOME=str(home),
                   PYTHONPATH=str(repo / "upstream/hermes-agent"), PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        env["HERMESS_PM_TOOL_ROOTS"] = json.dumps([str(root.resolve()) for root in args.tools_root])
        (home / "local-appdata").mkdir()
        env["LOCALAPPDATA"] = str(home / "local-appdata")
        env["HOME"] = str(personal)
        if os.name == "nt":
            env["USERPROFILE"] = str(personal)
        command = [str(args.codex.resolve()), "app-server", "--strict-config"]
        for key, value in policy.items():
            command.extend(["-c", key + "=" + worker.toml_value(value)])
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                                cwd=home, text=True, encoding="utf-8", creationflags=0x08000000 if os.name == "nt" else 0)
        try:
            for request in [{"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "hermess-test", "version": "1"}}},
                            {"id": 2, "method": "config/read", "params": {"cwd": str(cwd)}}]:
                proc.stdin.write(json.dumps(request) + "\n"); proc.stdin.flush()
                while True:
                    line = proc.stdout.readline()
                    if not line:
                        raise AssertionError("App Server exited during configuration check")
                    result = json.loads(line)
                    if result.get("id") == request["id"]:
                        assert "error" not in result, "App Server rejected configuration RPC"
                        break
            config = result["result"]["config"]
            actual_provider = (config.get("model_providers") or {}).get(provider_id, {})
            worker.verify_effective_config(config, provider_id, provider, policy)
            print("PASS actual effective configuration")
            poisoned = home / "config.toml"
            poisoned.write_text('[permissions.hermess.filesystem]\n' + json.dumps(str(vault / "master.key")) + ' = "read"\n', encoding="utf-8")
            try:
                proc.stdin.write(json.dumps({"id": 3, "method": "config/read", "params": {"cwd": str(cwd)}}) + "\n")
                proc.stdin.flush()
                while True:
                    result = json.loads(proc.stdout.readline())
                    if result.get("id") == 3:
                        break
                assert "error" not in result, "Fixture must reach the effective-config verifier"
                try:
                    worker.verify_effective_config(result["result"]["config"], provider_id, provider, policy)
                except RuntimeError:
                    pass
                else:
                    raise AssertionError("More-specific vault read permission must be rejected")
                print("PASS actual more-specific filesystem override rejected before thread creation")
            finally:
                poisoned.unlink()
        finally:
            proc.stdin.close()
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()

        def turn(payload, expect_failure=False, expect_interrupted=False):
            request_count_before = len(requests)
            # Fixture-only debugging uses synthetic credentials; production never prints exception text.
            runner = "import runpy,sys\ndef trace(frame,event,arg):\n if event=='exception' and frame.f_code.co_filename.endswith('programming_worker.py'): print('FIXTURE_EXCEPTION',arg[0].__name__,str(arg[1]).replace('TEST_ONLY_PROGRAMMING_KEY','[redacted]'),file=sys.stderr)\n return trace\nsys.settrace(trace)\nrunpy.run_path(sys.argv[1],run_name='__main__')"
            proc = subprocess.Popen([str(args.python.resolve()), "-P", "-u", "-c", runner, str(repo / "apps/desktop/runtime/programming_worker.py")],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None, text=True, encoding="utf-8", env=env,
                cwd=home, creationflags=0x08000000 if os.name == "nt" else 0)
            lines = queue.Queue()
            def reader():
                for line in proc.stdout: lines.put(json.loads(line))
                lines.put(None)
            threading.Thread(target=reader, daemon=True).start()
            proc.stdin.write(json.dumps(payload) + "\n"); proc.stdin.flush()
            thread_id = None; output = ""; context = {}; tool_events = []; closed_approvals = []
            try:
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    event = lines.get(timeout=max(1, deadline - time.monotonic()))
                    assert event is not None, "Programming worker exited before result"
                    if event["kind"] == "thread": thread_id = event["id"]
                    if event["kind"] == "delta": output += event["text"]
                    if event["kind"] == "context": context.update(event)
                    if event["kind"] == "tool": tool_events.append(event["tool"])
                    if event["kind"] == "approval_closed": closed_approvals.append(event["id"])
                    if event["kind"] == "approval":
                        approval_events.append(event)
                        option = next(option for option in event["options"] if option["kind"] == approval_kind)
                        proc.stdin.write(json.dumps({"kind": "approval", "id": event["id"], "option_id": option["id"]}) + "\n"); proc.stdin.flush()
                    if event["kind"] == "result":
                        if expect_failure:
                            assert event["failed"], "Unsupported endpoint must fail"
                            return thread_id
                        assert not event["failed"], "Programming worker rejected startup or turn"
                        if expect_interrupted:
                            assert event["interrupted"], "Cancel must interrupt the turn"
                            assert all(approval["id"] in closed_approvals for approval in approval_events)
                            return thread_id
                        assert event["text"] == "PROTOCOL_FIXTURE_OK", "Wrong final streamed response"
                        assert thread_id, "Missing real thread ID"
                        assert context.get("approval_policy") == ("never" if payload.get("permissions") in ("full", "custom") else "on-request")
                        assert context.get("permissions") == payload.get("permissions", "hermess")
                        assert context.get("effort") == payload["effort"]
                        assert isinstance(context.get("used_tokens"), int), "Missing real token usage notification"
                        assert context["used_tokens"] >= 13, context
                        assert context.get("context_window", 0) > 0, "Missing real model context window"
                        if len(requests) > request_count_before + 1:
                            assert tool_events, "Tool calls must reach the product transcript"
                        if tool_events:
                            if fixture_patch is not None:
                                expected_status = "declined" if approval_kind == "deny" else "completed"
                                changed = next(tool for tool in tool_events if tool["type"] == "fileChange" and tool["status"] == expected_status)
                                assert changed["changes"][0]["path"].endswith("patched.txt")
                                assert changed["changes"][0]["added"] == 1
                                assert "PATCH_FIXTURE_OK" in changed["detail"]
                            else:
                                assert any(tool["type"] == "commandExecution" and tool["summary"] and tool["cwd"] for tool in tool_events)
                            assert any(tool["status"] != "inProgress" for tool in tool_events), "Missing terminal tool state"
                        for approval in approval_events:
                            assert approval["id"] in closed_approvals, "Approval lifecycle was not closed"
                        return thread_id
                raise AssertionError("Programming turn timeout")
            finally:
                proc.stdin.close()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()

        thread_id = turn(initial)
        print("PASS actual Responses stream through production worker")
        print("PASS actual token usage, context window and verified approval policy through production worker")
        assert "data:image/png;base64," in json.dumps(requests[0]["input"])
        print("PASS actual image input reaches Responses endpoint")
        if not (cwd / "fixture.txt").exists():
            print("FIXTURE_TOOL_FAILURE", [item.get("output") for item in requests[1]["input"] if item.get("type") == "function_call_output"])
        assert (cwd / "fixture.txt").read_text(encoding="utf-8") == "PROGRAMMING_FILE_OK"
        tool_output = json.dumps(requests[1]["input"])
        assert "ENV_ISOLATED" in tool_output and "VAULT_READ_DENIED" in tool_output
        assert "PERSONAL_READ_DENIED" in tool_output
        assert "TEST_ONLY_MASTER_CONTENT" not in tool_output
        assert "TEST_ONLY_PROGRAMMING_KEY" not in tool_output
        print("PASS actual tool file write, filtered environment, denied vault read")
        if args.tools_root:
            # Expected entries come from PM facts; observed paths and versions come from Codex's actual shell.
            observed_output = '\n'.join(item.get('output', '') for item in requests[1]['input']
                                        if item.get('type') == 'function_call_output')
            observed = json.loads(next(line.removeprefix('PM_TOOLS=') for line in observed_output.splitlines()
                                       if line.startswith('PM_TOOLS=')))
            for name in ('python', 'node', 'npm', 'uv'):
                for store in args.tools_root:
                    facts_path = store / 'facts.json'
                    facts = json.loads(facts_path.read_text(encoding='utf-8')) if facts_path.is_file() else {}
                    fact = facts.get('packages', {}).get(name)
                    if fact and 'entry' in fact:
                        entry = str((store / fact['entry']).resolve()).replace('\\', '/')
                        assert observed[name] and Path(observed[name]).resolve().is_relative_to(Path(entry)), (name, observed)
                        assert fact['version'].split('+')[0] in observed_output, (name, observed_output)
                        print('PASS actual Codex tool', name, 'version=' + fact['version'], 'entry=' + entry)
                        break
                else:
                    raise AssertionError('No installed product PM record for ' + name)
            if args.tools_only:
                server.shutdown()
                return
        expected_key = "ROTATED_TEST_ONLY_PROGRAMMING_KEY"
        assert turn({**initial, "api_key": expected_key, "thread_id": thread_id, "text": "Continue."}) == thread_id
        assert len(requests) == 3
        print("PASS same thread resumed by a new process with a rotated key")

        # The same production worker discovers actual profiles without contacting a model.
        discovery = subprocess.run([str(args.python.resolve()), "-P", "-u", str(repo / "apps/desktop/runtime/programming_worker.py")],
            input=json.dumps({**initial, "action": "permissions"}) + "\n", capture_output=True, text=True, encoding="utf-8",
            env=env, cwd=home, timeout=35, creationflags=0x08000000 if os.name == "nt" else 0)
        assert discovery.returncode == 0, discovery.stderr
        profiles = next(json.loads(line)["profiles"] for line in discovery.stdout.splitlines() if json.loads(line)["kind"] == "permissions")
        assert {row["id"] for row in profiles if row["allowed"]} == {"request", "auto", "full", "custom"}, profiles
        assert len(requests) == 3, "Permission discovery must not contact the model"
        print("PASS permission profiles discovered through production worker and real App Server")
        skill_dir = cwd / ".agents" / "skills" / "fixture-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("---\nname: fixture-skill\ndescription: Protocol verification skill\n---\nSKILL_CONTEXT_FIXTURE_MARKER\n", encoding="utf-8")
        discovery = subprocess.run([str(args.python.resolve()), "-P", "-u", str(repo / "apps/desktop/runtime/programming_worker.py")],
            input=json.dumps({**initial, "action": "skills"}) + "\n", capture_output=True, text=True, encoding="utf-8",
            env=env, cwd=home, timeout=35, creationflags=0x08000000 if os.name == "nt" else 0)
        assert discovery.returncode == 0, discovery.stderr
        catalog = next(json.loads(line)["catalog"] for line in discovery.stdout.splitlines() if json.loads(line)["kind"] == "skills")
        assert any(row["name"] == "fixture-skill" and row["enabled"] for row in catalog["skills"]), catalog
        assert len(requests) == 3, "Skill discovery must not contact the model"
        requests.clear()
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "text": "Use $fixture-skill and continue."})
        assert "SKILL_CONTEXT_FIXTURE_MARKER" in json.dumps(requests[0]["input"]), "Selected skill must reach model context"
        print("PASS production skill discovery and explicit skill input accepted by locked App Server and injected into Responses")
        requests.clear()
        (cwd / "fixture.txt").unlink()
        # Resume an existing writable thread with read-only permissions: the write must now fail.
        assert turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "hermess-readonly"}) == thread_id
        assert not (cwd / "fixture.txt").exists(), "Read-only thread unexpectedly wrote a file"
        assert "VAULT_READ_DENIED" in json.dumps(requests[1]["input"])
        assert "PERSONAL_READ_DENIED" in json.dumps(requests[1]["input"])
        print("PASS read-only selection applies on resume, denies project write and preserves credential isolation")
        requests.clear()
        assert turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "hermess"}) == thread_id
        assert (cwd / "fixture.txt").read_text(encoding="utf-8") == "PROGRAMMING_FILE_OK"
        print("PASS switching back to project-write restores writes on the same thread")
        requests.clear()
        fixture_patch = "*** Begin Patch\n*** Add File: patched.txt\n+PATCH_FIXTURE_OK\n*** End Patch"
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "request"})
        assert (cwd / "patched.txt").read_text(encoding="utf-8").strip() == "PATCH_FIXTURE_OK"
        fixture_patch = None
        print("PASS actual file-change notification, diff and line counts through production worker")
        outside = root / "outside-approved.txt"
        command_to_run = ("Set-Content -LiteralPath '" + str(outside).replace("'", "''") + "' -Value 'APPROVED_WRITE' -NoNewline -Encoding ASCII") if os.name == "nt" else "printf APPROVED_WRITE > " + shlex.quote(str(outside))
        tool_parameters = {"sandbox_permissions": "require_escalated", "justification": "Write the requested temporary fixture file outside the project"}
        for kind in ("cancel", "once"):
            requests.clear(); approval_events.clear(); approval_kind = kind
            repeat_tool = kind == "once"
            turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "request", "effort": "high"}, expect_interrupted=kind == "cancel")
            repeat_tool = False
            assert approval_events, "Ask mode must reach the product approval callback"
            if kind == "once":
                assert len(approval_events) == 2, "Allow-once must not suppress the second command prompt"
            assert outside.exists() == (kind == "once"), "Approval answer must control the real file write"
            assert requests[0]["reasoning"]["effort"] == "high"
        print("PASS request mode bridges actual approval cancel/accept and selected reasoning effort reaches Responses")
        outside.unlink(); requests.clear(); approval_events.clear()
        # A real file-change prompt exposes the session-cache decision. Repeat the same path in one run.
        approval_kind = "session"
        patched_outside = root / "outside-patched.txt"
        fixture_patch = "*** Begin Patch\n*** Add File: " + str(patched_outside).replace("\\", "/") + "\n+PATCH_FIXTURE_OK\n*** End Patch"
        repeat_tool = True
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "request"})
        assert patched_outside.exists() and len(approval_events) == 1, "Session approval must cache matching file changes within a run"
        repeat_tool = False
        requests.clear(); approval_events.clear()
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "request"})
        assert len(approval_events) == 1, "Temporary session grant must not silently persist across worker restarts"
        approval_kind = "deny"
        denied_patch = root / "denied-patched.txt"
        fixture_patch = "*** Begin Patch\n*** Add File: " + str(denied_patch).replace("\\", "/") + "\n+PATCH_FIXTURE_OK\n*** End Patch"
        requests.clear(); approval_events.clear()
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "request"})
        assert not denied_patch.exists() and approval_events, "Deny-and-continue must reject the actual patch"
        fixture_patch = None
        print("PASS actual file-change session approval suppresses the repeated prompt in the same run")
        print("PASS actual file-change decline rejects the patch and permits the assistant to continue")
        # Persist the exact prefix proposed by the model; resume in a new worker to prove the rule is retained.
        approval_kind = "command_rule"
        original_command = command_to_run
        command_to_run = "powershell -NoProfile -Command \"Write-Output 'PERSISTENT_RULE_OK'\"" if os.name == "nt" else "printf PERSISTENT_RULE_OK"
        tool_parameters["prefix_rule"] = ["powershell"] if os.name == "nt" else ["sh"]
        requests.clear(); approval_events.clear()
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "request"})
        assert len(approval_events) == 1
        rule_files = list((home / "rules").glob("*.rules"))
        assert rule_files, "Codex must persist the accepted command rule in the isolated home"
        requests.clear(); approval_events.clear()
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "request"})
        assert not approval_events, "Persisted prefix must apply after worker restart"
        assert any("PERSISTENT_RULE_OK" in str(item.get("output", "")) and "code 0" in str(item.get("output", ""))
                   for item in requests[-1]["input"] if item.get("type") == "function_call_output")
        print("PASS actual persistent command rule survives worker restart in the isolated coding home")
        for rule_file in rule_files:
            rule_file.unlink()
        command_to_run = original_command
        tool_parameters.pop("prefix_rule")
        outside.unlink(missing_ok=True); requests.clear(); approval_events.clear(); review_count = 0
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "auto"})
        if not review_count:
            print("AUTO_FIXTURE", {"reviews": review_count, "approvals": len(approval_events), "written": outside.exists(),
                "tool_output": [item.get("output") for body in requests[1:] for item in body.get("input", []) if item.get("type") == "function_call_output"]}, flush=True)
        assert review_count > 0, "Auto mode must invoke the real Codex reviewer"
        assert outside.exists(), "Synthetic reviewer acceptance must permit the temporary file write"
        assert not approval_events, "Low-risk reviewed action should not ask the user"
        print("PASS auto-review mode invokes actual Codex reviewer and applies its acceptance")
        outside.unlink(); requests.clear(); approval_events.clear(); tool_parameters = {}
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "full"})
        assert outside.exists() and not approval_events
        print("PASS full mode writes outside project without approval")
        outside.unlink(); requests.clear()
        (root / "private" / "config.toml").write_text('default_permissions = ":read-only"\napproval_policy = "never"\n', encoding="utf-8")
        turn({**initial, "api_key": expected_key, "thread_id": thread_id, "permissions": "custom"})
        assert not outside.exists(), "Custom read-only configuration must deny the write"
        print("PASS custom mode reads the product config.toml and applies read-only policy")
        (root / "private" / "config.toml").write_text('approval_policy = [', encoding="utf-8")
        before = len(requests)
        turn({**initial, "api_key": expected_key, "permissions": "custom"}, expect_failure=True)
        assert len(requests) == before, "Invalid custom configuration must fail before contacting a model"
        print("PASS invalid custom configuration rejected without executing a turn")
        for mode in ("chat_only", "unauthorized"):
            failure_mode = mode
            before = len(requests)
            turn({**initial, "api_key": expected_key}, expect_failure=True)
            assert len(requests) == before + 1, "No automatic protocol fallback or retry"
        print("PASS Chat Completions-only endpoint and rejected key fail without fallback")
        assert all(file.read_bytes() == content for file, content in personal_before.items())
        for file in home.rglob("*"):
            if file.is_file() and file.suffix in (".json", ".jsonl", ".toml", ".log", ".sqlite", ".db"):
                content = file.read_bytes()
                assert b"TEST_ONLY_PROGRAMMING_KEY" not in content, "Runtime persisted fixture API Key"
                assert b"PERSONAL_AUTH_MUST_NOT_BE_USED" not in content, "Runtime imported personal authentication"
        print("PASS synthetic personal Codex files unchanged, unreadable to tools, and credentials absent from runtime files")
    server.shutdown()


if __name__ == "__main__":
    main()

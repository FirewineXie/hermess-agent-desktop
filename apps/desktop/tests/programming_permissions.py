"""Fixed App Server acceptance for the product's four permission modes, without model traffic."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--form-fixtures", type=Path, help="TOML files exported by the Rust production permission save test")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    spec = importlib.util.spec_from_file_location("worker", repo / "apps/desktop/runtime/programming_worker.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    with tempfile.TemporaryDirectory(prefix="permission-modes-", dir=repo / ".build") as temporary:
        root = Path(temporary)
        cwd = root / "project"; cwd.mkdir()
        private = root / "private"; private.mkdir()
        custom = private / "config.toml"
        custom.write_text('default_permissions = "custom-inspect"\napproval_policy = "on-request"\n'
                          'approvals_reviewer = "guardian_subagent"\n[permissions.custom-inspect]\nextends = ":read-only"\n', encoding="utf-8")
        cases = [(mode, None) for mode in ("request", "auto", "full", "custom")]
        if args.form_fixtures:
            fixtures = sorted(args.form_fixtures.glob("*.toml"))
            assert fixtures, "No production form fixtures found"
            cases += [("custom", path) for path in fixtures]
        for case_index, (mode, fixture) in enumerate(cases):
            if fixture:
                custom.write_bytes(fixture.read_bytes())
            home = root / str(case_index); home.mkdir(); (home / "user-home").mkdir()
            initial = {"permissions": mode, "home": str(home), "private_root": str(private), "cwd": str(cwd),
                       "connection_id": "fixture", "model": "gpt-5.2-codex", "effort": "high", "base_url": "https://unused.invalid/v1"}
            provider_id, provider, policy = worker.launch_policy(initial)
            env = {key: os.environ[key] for key in ("PATH", "SystemRoot", "SystemDrive", "WINDIR", "TEMP", "TMP") if key in os.environ}
            env.update(CODEX_HOME=str(home), HOME=str(home / "user-home"), USERPROFILE=str(home / "user-home"), HERMESS_PROGRAMMING_KEY="FIXTURE_ONLY")
            (home / "local-appdata").mkdir()
            env["LOCALAPPDATA"] = str(home / "local-appdata")
            command = [str(args.codex.resolve()), "app-server", "--strict-config"]
            for name, value in policy.items(): command.extend(["-c", name + "=" + worker.toml_value(value)])
            error_log = (home / "stderr.log").open("w", encoding="utf-8")
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=error_log,
                                       text=True, encoding="utf-8", env=env, cwd=home, creationflags=0x08000000 if os.name == "nt" else 0)
            messages = queue.Queue()
            def read_output(stream=process.stdout, target=messages):
                for line in stream: target.put(json.loads(line))
                target.put(None)
            threading.Thread(target=read_output, daemon=True).start()
            next_id = 0
            def request(method, params, rejected=False):
                nonlocal next_id
                next_id += 1
                process.stdin.write(json.dumps({"id": next_id, "method": method, "params": params}) + "\n"); process.stdin.flush()
                while True:
                    response = messages.get(timeout=20)
                    assert response is not None, f"App Server exited in {fixture.name if fixture else mode}: " + (home / "stderr.log").read_text(encoding="utf-8")[-2048:]
                    if response.get("id") == next_id:
                        if rejected:
                            assert "error" in response, (mode, method, response)
                            return response["error"]
                        assert "error" not in response, (mode, method, response)
                        return response["result"]
            try:
                request("initialize", {"clientInfo": {"name": "hermess_permission_test", "version": "1"}, "capabilities": {"experimentalApi": True}})
                effective = request("config/read", {"cwd": str(cwd), "includeLayers": False})["config"]
                for name in ("default_permissions", "approval_policy", "approvals_reviewer"):
                    assert effective.get(name) == policy[name], (fixture.name if fixture else mode, name, effective.get(name), policy[name])
                worker.verify_effective_config(effective, provider_id, provider, policy)
                params = {"cwd": str(cwd), "model": initial["model"], "modelProvider": provider_id,
                          "permissions": policy["default_permissions"], "approvalPolicy": policy["approval_policy"],
                          "approvalsReviewer": policy["approvals_reviewer"]}
                started = request("thread/start", params)
                for result in (started,):
                    assert result["approvalPolicy"] == policy["approval_policy"], result
                    assert result["approvalsReviewer"] == policy["approvals_reviewer"], result
                profile = policy["default_permissions"]
                expected = "dangerFullAccess" if profile == ":danger-full-access" else "readOnly" if profile in ("hermess-readonly", "inspect", "custom-inspect", ":read-only") else "workspaceWrite"
                assert started["sandbox"]["type"] == expected, started["sandbox"]
                request("thread/start", {**params, "approvalPolicy": "invalid-policy"}, rejected=True)
                request("thread/start", {**params, "approvalsReviewer": "invalid-reviewer"}, rejected=True)
                print("PASS actual config, thread/start and invalid policy/reviewer rejection", fixture.name if fixture else mode,
                      policy["approval_policy"], policy["approvals_reviewer"], flush=True)
            finally:
                process.stdin.close()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
                error_log.close()
        try:
            worker.permission_mode({**initial, "permissions": "unknown"})
        except RuntimeError:
            print("PASS unknown permission mode rejected", flush=True)
        else:
            raise AssertionError("Unknown mode must fail")


if __name__ == "__main__": main()

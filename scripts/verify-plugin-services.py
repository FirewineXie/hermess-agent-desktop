"""Run production Rust cleanup against the pinned OpenViking CLI in isolated profiles.

The HTTP/process fixture replaces only the OpenViking server, not its CLI or
ownership checks. No model/runtime installation or user profile is involved.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
from urllib.request import urlopen

import psutil

ROOT = Path(__file__).resolve().parents[1]
PIN = "9f150ece247ad683494ab172d738023bd6dc6170"
SERVER = '''import argparse,json
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--config');p.add_argument('--port',type=int)
a=p.parse_args();key=json.loads(Path(a.config).read_text(encoding='utf-8'))['server']['root_api_key']
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            data={'auth_mode':'trusted','root_api_key_required':True};code=200
        elif self.path == '/api/v1/admin/accounts' and self.headers.get('X-API-Key')==key:
            data={'status':'ok'};code=200
        else:
            data={};code=403
        self.send_response(code);self.end_headers();self.wfile.write(json.dumps(data).encode())
    def log_message(self,*args): pass
HTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
'''


def make_service(home: Path, source: Path, *, record=True):
    plugin = home / "plugins/openviking"
    plugin.mkdir(parents=True)
    for file in source.glob("*.py"):
        shutil.copyfile(file, plugin / file.name)
    (plugin / "__init__.py").write_text("raise RuntimeError('provider must not import')", encoding="utf-8")
    root = home / "openviking"
    runtime = root / "runtime"
    runtime.mkdir(parents=True)
    command = runtime / "openviking-server"
    command.write_text(SERVER, encoding="utf-8")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    key = secrets.token_urlsafe(24)
    config = root / "ov.conf"
    config.write_text(json.dumps({"storage": {"workspace": str(root / "data")},
                                  "server": {"port": port, "root_api_key": key}}), encoding="utf-8")
    (root / "ovcli.conf").write_text(json.dumps({"url": f"http://127.0.0.1:{port}",
                                                "root_api_key": key}), encoding="utf-8")
    process = subprocess.Popen(
        [sys.executable, str(command), "--config", str(config), "--port", str(port)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        start_new_session=os.name != "nt",
    )
    if record:
        (root / "server-process.json").write_text(json.dumps({
            "pid": process.pid, "created": psutil.Process(process.pid).create_time(),
            "command": str(command), "port": port,
        }), encoding="utf-8")
    return process


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes", type=Path, required=True)
    args = parser.parse_args()
    hermes = args.hermes.resolve(strict=True)
    if not hermes.is_relative_to(ROOT / ".build"):
        parser.error("use the product's prepared launcher under .build")
    scratch = ROOT / ".build/plugin-service-verification"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch, prefix="退出 空格-", ignore_cleanup_errors=True) as folder:
        base = Path(folder)
        source = base / "source"
        source.mkdir()
        for file in ("cli.py", "local_server.py", "quick_local.py", "local_packages.py"):
            url = f"https://raw.githubusercontent.com/volcengine/OpenViking/{PIN}/examples/hermes-plugin/{file}"
            with urlopen(url, timeout=30) as response:
                (source / file).write_bytes(response.read())
        storage = base / "HermessAgentDesktop"
        (storage / "control").mkdir(parents=True)
        home = storage / "hermes-home"
        home.mkdir()
        work = home / "profiles/work"
        work.mkdir(parents=True)
        (home / "config.yaml").write_text("memory:\n  provider: other\n", encoding="utf-8")
        (work / "config.yaml").write_text("{}", encoding="utf-8")
        (home / "active_profile").write_text("work", encoding="utf-8")
        processes = []
        try:
            processes.append(make_service(home, source))
            # Lost process record exercises the plugin's actual authenticated adoption.
            processes.append(make_service(work, source, record=False))
            external = base / "separate-hermes"
            external.mkdir()
            processes.append(make_service(external, source))
            env = {**os.environ, "HERMESS_SERVICE_TEST_HERMES": str(hermes),
                   "HERMESS_SERVICE_TEST_STORAGE": str(storage)}
            command = ["cargo", "test", "--manifest-path", str(ROOT / "apps/desktop/src-tauri/Cargo.toml"),
                       "--locked", "runtime::plugin_services::tests::plugin_services_live", "--",
                       "--exact", "--ignored", "--nocapture"]
            result = subprocess.run(command, cwd=ROOT, env=env, timeout=240)
            if result.returncode:
                for log in sorted((storage / "logs").glob("client-*.log")):
                    for line in log.read_text(encoding="utf-8").splitlines():
                        if "plugin_service_cleanup " in line:
                            print(line, flush=True)
                raise RuntimeError("production Rust cleanup verification failed")
            assert all(process.poll() is not None for process in processes[:2]), "owned service survived"
            assert processes[2].poll() is None, "separate Hermes service was stopped"
            print("Pinned plugin CLI: two profiles stopped, lost record adopted, external service preserved, missing CLI retained.")
        finally:
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()

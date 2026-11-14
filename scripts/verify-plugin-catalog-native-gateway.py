"""Verify the desktop catalog install request against the locked Gateway in an isolated home."""

from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import runpy
import subprocess
import sys
import time

import httpx

from validation_workspace import validation_workspace

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "upstream" / "hermes-agent"
control = runpy.run_path(str(ROOT / "scripts" / "verify-provider-copy-native-gateway.py"))["control"]


def main() -> None:
    (ROOT / ".build").mkdir(exist_ok=True)
    with validation_workspace(prefix="plugin-catalog-native-", dir=ROOT / ".build") as temporary:
        root = Path(temporary)
        home = root / "hermes-home"
        home.mkdir()
        user = root / "user"
        user.mkdir()
        (home / "config.yaml").write_text("{}", encoding="utf-8")
        env = os.environ.copy()
        env.update({
            "HOME": str(user), "USERPROFILE": str(user), "HERMES_HOME": str(home),
            "HERMES_GATEWAY_LOCK_DIR": str(root / "gateway-locks"),
            "HERMES_DASHBOARD_SESSION_TOKEN": secrets.token_urlsafe(32),
            "HERMES_DISABLE_LAZY_INSTALLS": "1", "PYTHONPATH": str(UPSTREAM),
        })
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with (root / "gateway.log").open("w+") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "gateway.run"], cwd=UPSTREAM, env=env,
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
            try:
                deadline = time.monotonic() + 60
                descriptor = {}
                while process.poll() is None and time.monotonic() < deadline:
                    try:
                        descriptor = control(home, "identify")
                        if descriptor.get("state") == "ready":
                            break
                    except (OSError, ValueError):
                        pass
                    time.sleep(.1)
                if descriptor.get("state") != "ready":
                    raise RuntimeError("isolated Gateway did not become ready")
                def headers() -> dict[str, str]:
                    ticket = control(home, "session-ticket", {
                        "profile_id": str(home.resolve()), "purpose": "native-http",
                        "instance_id": descriptor["instance_id"],
                    })["ticket"]
                    return {"X-Hermes-Gateway-Ticket": ticket}

                with httpx.Client(base_url=descriptor["api_origin"], trust_env=False, timeout=180) as client:
                    catalog_response = client.get("/api/dashboard/plugins/catalog", headers=headers())
                    assert catalog_response.status_code == 200, catalog_response.status_code
                    catalog = catalog_response.json()
                    entry = next(item for item in catalog["entries"] if item["name"] == "openviking")
                    assert len(entry["sha"]) == 40 and entry["repo"].startswith("https://")
                    body = {"identifier": "", "catalog_name": entry["name"], "ref": entry["sha"], "enable": False}
                    installed = client.post("/api/dashboard/agent-plugins/install", headers=headers(), json=body)
                    assert installed.status_code == 200, ("install", installed.status_code)
                    assert installed.json().get("ok") is True, "Gateway did not report successful install"
                    after = client.get("/api/dashboard/plugins/catalog", headers=headers())
                    assert after.status_code == 200, ("catalog after install", after.status_code)
                    installed_entry = next(item for item in after.json()["entries"] if item["name"] == "openviking")
                    assert installed_entry["installed"] is True and installed_entry["installed_sha"] == entry["sha"]
                    rejected = client.post("/api/dashboard/agent-plugins/install", headers=headers(),
                                           json={**body, "catalog_name": "nonexistent-desktop-fixture"})
                    assert rejected.status_code == 400, ("unknown catalog name", rejected.status_code)
                    print("Locked Gateway installed the live OpenViking pin, reported it installed, and rejected an unknown catalog entry.")
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()

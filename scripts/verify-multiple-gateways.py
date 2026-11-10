"""Run desktop host switching with an owned and two self-hosted Gateways."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from validation_workspace import validation_workspace

PRODUCT = Path(__file__).resolve().parents[1]
UPSTREAM = PRODUCT / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))
from hermes_state import SessionDB
from tests.gateway.fixtures.local_recovery_probe import child_env, daemon, seed_offline_models_dev


def seed(home, name):
    home.mkdir(mode=0o700, parents=True)
    db = SessionDB(db_path=home / "state.db")
    try:
        db.create_session("shared-id", "cli")
        db.append_message("shared-id", "user", f"Only on {name}")
        db.set_session_title("shared-id", name)
    finally:
        db.close()
    # Legacy rows are adopted on first resume. That requires a configured model,
    # even for a read-only history check that never submits a prompt.
    (home / "config.yaml").write_text(json.dumps({
        "gateway": {"multiplex_profiles": True},
        "model": {"provider": "custom", "default": "history-probe", "base_url": "http://127.0.0.1:9/v1"},
    }), encoding="utf-8")
    seed_offline_models_dev(home)


def main():
    if os.name != "nt":
        raise SystemExit("This probe invokes the windowless Windows Tauri integration test.")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, required=True)
    args = parser.parse_args()
    launcher = args.hermes.resolve(strict=True)
    lock = json.loads((PRODUCT / "runtime/upstream.lock.json").read_text(encoding="utf-8"))
    assert subprocess.check_output(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"],
                                   text=True).strip() == lock["commit"]
    with validation_workspace(prefix="multiple-gateway-probe-", dir=PRODUCT / ".build") as directory:
        root = Path(directory)
        local = root / "local"
        seed(local / "HermessAgentDesktop" / "hermes-home", "local-host")
        envs = []
        homes = []
        for name in ("host-one", "host-two"):
            home = root / name
            seed(home, name)
            env = child_env()
            env.update(HOME=str(home), USERPROFILE=str(home), HERMES_HOME=str(home), PYTHONPATH=str(UPSTREAM),
                       HERMES_DESKTOP="1", HERMESS_DESKTOP_PRIVATE_API="1", HERMES_DISABLE_LAZY_INSTALLS="1",
                       HERMES_GATEWAY_LOCK_DIR=str(root / (name + "-locks")),
                       HERMES_DASHBOARD_SESSION_TOKEN="isolated-delete-test-token",
                       OPENAI_API_KEY="loopback-only")
            homes.append(home)
            envs.append(env)
        with daemon(UPSTREAM, homes[0], envs[0], barrier=False) as (_, first):
            with daemon(UPSTREAM, homes[1], envs[1], barrier=False) as (_, second):
                env = dict(os.environ, HERMESS_TEST_HOST_ONE=first["api_origin"],
                           HERMESS_TEST_HOST_TWO=second["api_origin"],
                           HERMESS_TEST_LOCAL_HERMES=str(launcher), HERMESS_TEST_LOCAL_STORAGE=str(local),
                           OPENAI_API_KEY="loopback-only")
                subprocess.run([
                    "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
                    "--locked", "remote_gateway_multiple_connections_live",
                    "--", "--ignored", "--nocapture", "--test-threads=1",
                ], env=env, cwd=PRODUCT, check=True)


if __name__ == "__main__":
    main()

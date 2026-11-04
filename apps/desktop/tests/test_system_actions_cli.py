"""Run product-generated diagnostic CLI arguments against the locked Hermes in isolation."""
import json
import os
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]


def test_diagnostic_cli_arguments(tmp_path):
    (tmp_path / "config.yaml").write_text("{}\n", encoding="utf-8")
    named_home = tmp_path / "profiles" / "worker_beta"
    named_home.mkdir(parents=True)
    (named_home / "config.yaml").write_text("{}\n", encoding="utf-8")
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    default_archive = tmp_path / "checkpoints" / "legacy-default"
    named_archive = named_home / "checkpoints" / "legacy-named"
    for archive in (default_archive, named_archive):
        archive.mkdir(parents=True)
        (archive / "marker.txt").write_text("isolated fixture\n", encoding="utf-8")
        old = time.time() - 30 * 86400
        os.utime(archive, (old, old))
    result = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", "print_production_system_action_args", "--", "--ignored", "--nocapture"],
        env={**os.environ, "SYSTEM_ACTION_BACKUP_DIR": str(backup_dir)},
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    shapes = [json.loads(line.split("SYSTEM_ACTION_CLI=", 1)[1]) for line in result.stdout.splitlines()
              if "SYSTEM_ACTION_CLI=" in line]
    by_action = {(shape["profile"], shape["action"]): shape["args"] for shape in shapes}
    assert len(by_action) == len(shapes) == 15
    assert set(by_action) == ({(profile, action) for profile in ("default", "worker_beta")
                               for action in ("doctor", "security-audit", "checkpoints-prune",
                                              "prompt-size", "dump", "config-migrate", "backup")}
                              | {("default", "restore")})
    hermes = (PRODUCT / ".build" / "hermes-venv-i1" /
              ("Scripts" if os.name == "nt" else "bin") /
              ("hermes.exe" if os.name == "nt" else "hermes"))
    env = {**os.environ, "HERMES_HOME": str(tmp_path), "HERMES_DISABLE_LAZY_INSTALLS": "1"}
    doctor = subprocess.run([str(hermes), *by_action["default", "doctor"]], env=env,
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert doctor.returncode in (0, 1), doctor.stderr[-1500:]
    assert "Hermes Doctor" in doctor.stdout
    audit = subprocess.run([str(hermes), *by_action["default", "security-audit"],
                            "--skip-venv", "--skip-plugins", "--skip-mcp"], env=env,
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert audit.returncode == 0, audit.stderr[-1500:]
    assert "No components discovered" in audit.stdout
    prune = subprocess.run([str(hermes), *by_action["default", "checkpoints-prune"]], env=env,
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert prune.returncode == 0, prune.stderr[-1500:]
    assert "Pruning checkpoint store" in prune.stdout
    assert not default_archive.exists()
    assert named_archive.exists()
    named_doctor = subprocess.run([str(hermes), *by_action["worker_beta", "doctor"]], env=env,
                                  capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert named_doctor.returncode in (0, 1), named_doctor.stderr[-1500:]
    assert "Hermes Doctor" in named_doctor.stdout
    named_audit = subprocess.run([str(hermes), *by_action["worker_beta", "security-audit"],
                                  "--skip-venv", "--skip-plugins", "--skip-mcp"], env=env,
                                 capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert named_audit.returncode == 0, named_audit.stderr[-1500:]
    named_prune = subprocess.run([str(hermes), *by_action["worker_beta", "checkpoints-prune"]], env=env,
                                 capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert named_prune.returncode == 0, named_prune.stderr[-1500:]
    assert "Pruning checkpoint store" in named_prune.stdout
    assert not named_archive.exists()
    for profile in ("default", "worker_beta"):
        backup_args = by_action[profile, "backup"]
        backup = subprocess.run([str(hermes), *backup_args], env=env,
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        assert backup.returncode == 0, backup.stderr[-1500:]
        with zipfile.ZipFile(backup_args[-1]) as archive:
            names = set(archive.namelist())
        assert "config.yaml" in names
        assert "profiles/worker_beta/config.yaml" in names
        prompt = subprocess.run([str(hermes), *by_action[profile, "prompt-size"]], env=env,
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        assert prompt.returncode == 0, prompt.stderr[-1500:]
        assert "System prompt total" in prompt.stdout
        dump = subprocess.run([str(hermes), *by_action[profile, "dump"]], env=env,
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        assert dump.returncode == 0, dump.stderr[-1500:]
        assert "--- hermes dump ---" in dump.stdout
        migrate = subprocess.run([str(hermes), *by_action[profile, "config-migrate"]], env=env,
                                 stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=120)
        assert migrate.returncode == 0, migrate.stderr[-1500:]
        config = tmp_path / "config.yaml" if profile == "default" else named_home / "config.yaml"
        assert "_config_version" in config.read_text(encoding="utf-8")
        if profile == "default":
            assert (named_home / "config.yaml").read_text(encoding="utf-8") == "{}\n"
    restore_archive = Path(by_action["default", "restore"][-2])
    shutil.copyfile(by_action["default", "backup"][-1], restore_archive)
    (tmp_path / "config.yaml").write_text("changed: true\n", encoding="utf-8")
    restored = subprocess.run([str(hermes), *by_action["default", "restore"]], env=env,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=120)
    assert restored.returncode == 0, (restored.stdout + restored.stderr)[-2000:]
    assert "Import complete" in restored.stdout
    assert "changed: true" not in (tmp_path / "config.yaml").read_text(encoding="utf-8")

"""Exercise the production helper with a test-only Vault in a prepared native payload."""

import argparse
import json
import os
from pathlib import Path
import subprocess

from validation_workspace import validation_workspace

PRODUCT = Path(__file__).resolve().parents[1]
HELPER = (PRODUCT / "apps/desktop/src-tauri/src/runtime/vault_keys.py").read_text(encoding="utf-8")
BOOTSTRAP = """import site,sys
from pathlib import Path
root=Path(sys.argv[1])
site.addsitedir(str(root/sys.argv[2]))
sys.path.insert(0,str(root/sys.argv[3]))
script=sys.argv[4]
sys.argv=sys.argv[4:]
exec(compile(script,'<desktop-helper>','exec'))
"""
SEED = """from agent.vault_store import get_vault_store
item = get_vault_store().add_item('login','Synthetic desktop vault fixture', {
    'identifier_type':'email', 'identifier':'fixture@example.invalid', 'password':'isolated-vault-fixture',
}, origin='https://example.invalid')
print(item.id)
"""
READBACK = """import sys
from agent.vault_store import get_vault_store
assert get_vault_store().resolve_secret(sys.argv[1])['password'] == 'isolated-vault-fixture'
"""
CLEANUP = """from pathlib import Path
import os
from agent import vault_keychain
directory = Path(os.environ['HERMES_HOME']).resolve() / 'vault'
ref = vault_keychain.read_ref(directory / 'vault.keyref')
if ref is not None and vault_keychain.owns(ref, directory):
    assert vault_keychain.delete_key(ref), 'fixture key could not be cleaned up'
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, type=Path)
    payload = parser.parse_args().payload.resolve(strict=True)
    assert payload.is_relative_to(PRODUCT / ".build")
    runtime = json.loads((payload / "manifest.json").read_text(encoding="utf-8"))["runtime"]
    python = payload / runtime["storePython"]
    bootstrap = [str(python), "-I", "-S", "-u", "-X", "utf8", "-c", BOOTSTRAP,
                 str(payload), runtime["sitePackages"], runtime["repoDir"]]
    with validation_workspace(prefix="desktop-vault-probe-", dir=PRODUCT / ".build") as directory:
        home = Path(directory) / "hermes-home" / "profiles" / "reviewer"
        home.mkdir(parents=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")
        env = os.environ.copy()
        env.pop("PYTHONHOME", None)
        env.pop("PYTHON_KEYRING_BACKEND", None)
        env["HERMES_HOME"] = str(home)
        env["HERMES_DISABLE_LAZY_INSTALLS"] = "1"

        def run(script, *args, check=True):
            return subprocess.run([*bootstrap, script, *args], env=env, capture_output=True, text=True,
                                  encoding="utf-8", timeout=45, check=check)

        def status(operation):
            return json.loads(run(HELPER, operation).stdout)

        before = status("status")
        assert before == {"storage": "none", "preference": "file", "available": True, "cleanup_pending": False}, before
        item_id = run(SEED).stdout.strip()
        assert status("status")["storage"] == "file"
        try:
            assert status("keychain")["storage"] == "keychain"
            assert not (home / "vault" / "vault.key").exists()
            run(READBACK, item_id)
            assert status("keychain")["storage"] == "keychain"
            assert status("file") == {"storage": "file", "preference": "file", "available": True, "cleanup_pending": False}
            assert not (home / "vault" / "vault.keyref").exists()
            run(READBACK, item_id)
            rejected = run(HELPER, "unknown", check=False)
            assert rejected.returncode != 0 and json.loads(rejected.stdout) == {"error": "vault_failed"}
        finally:
            run(CLEANUP)
    print("The prepared payload moved a synthetic key to the OS keychain and back, verified readback, and removed the fixture entry.")


if __name__ == "__main__":
    main()

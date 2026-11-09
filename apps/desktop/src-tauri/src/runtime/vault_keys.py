"""Desktop projection of the locked Hermes Vault store. Never return keychain coordinates or keys."""

import contextlib
import json
import os
from pathlib import Path
import sys


def status(store):
    from agent import vault_keychain
    from agent.vault_store import configured_key_storage

    try:
        vault_keychain.os_keyring()
        available = True
    except vault_keychain.KeychainUnavailable:
        available = False
    location = store.key_location()
    return {
        "storage": location["storage"],
        "preference": configured_key_storage(),
        "available": available,
        "cleanup_pending": bool(location.get("keychain_entry_left")),
    }


def main(operation):
    from agent.vault_store import get_vault_store
    from hermes_cli.config import get_config_path
    from hermes_cli.config_backend import write_config_key
    from hermes_constants import get_hermes_home

    home = Path(get_hermes_home()).resolve(strict=True)
    for path in (home / "config.yaml", home / "vault", *(home / "vault" / name for name in
                 ("vault.key", "vault.keyref", "vault.json.enc", ".vault.lock"))):
        if not path.resolve().is_relative_to(home):
            raise ValueError("vault path outside the profile")
    store = get_vault_store()
    if operation in ("keychain", "file"):
        if operation == "keychain":
            from agent.vault_keychain import os_keyring

            os_keyring()
        # Hermes verifies that the destination key opens the vault before removing the source.
        store.migrate_key(operation)
        write_config_key(get_config_path(), "vault.key_storage", operation)
    elif operation != "status":
        raise ValueError("invalid vault operation")
    return status(store)


with open(os.devnull, "w", encoding="utf-8") as sink:
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            result = main(sys.argv[1])
    except Exception as exc:
        print(json.dumps({"error": "keychain_unavailable" if type(exc).__name__ == "KeychainUnavailable" else "vault_failed"}))
        raise SystemExit(1) from None
print(json.dumps(result, ensure_ascii=True))

"""Exercise the product Profile archive flow against the locked Hermes implementation."""
import io
import os
import sys
import tarfile
import time
from pathlib import Path

import pytest

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def create_profile(profile_api, name):
    retries = 0
    while True:
        try:
            return profile_api.create_profile(name, no_alias=True)
        except PermissionError as exc:
            if os.name != "nt" or getattr(exc, "winerror", None) != 5 or retries >= 2:
                raise
            retries += 1
            time.sleep(0.15 * retries)


def test_standard_profile_export_import_is_portable_and_redacted(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli import profiles as profile_api

    source = create_profile(profile_api, "archive_source")
    (source / ".env").write_text("ARCHIVE_SECRET=must-not-leak\n", encoding="utf-8")
    (source / "config.yaml").write_text(
        "providers:\n  demo:\n    api_key: sk-this-must-be-redacted\n", encoding="utf-8")
    (source / "SOUL.md").write_text("portable persona\n", encoding="utf-8")
    (source / "installs").mkdir()
    (source / "installs" / "foreign.json").write_text("{}\n", encoding="utf-8")

    archive = profile_api.export_profile("archive_source", str(tmp_path / "portable.tar.gz"))
    assert archive.is_file()
    with tarfile.open(archive, "r:gz") as bundle:
        names = set(bundle.getnames())
        text = "\n".join(
            member.read().decode("utf-8", errors="replace")
            for item in bundle.getmembers()
            if item.isfile() and (member := bundle.extractfile(item)) is not None
        )
    assert "archive_source/SOUL.md" in names
    assert "archive_source/.env" not in names
    assert all("/installs/" not in f"/{name}/" for name in names)
    assert "must-not-leak" not in text
    assert "sk-this-must-be-redacted" not in text

    imported = profile_api.import_profile(str(archive), name="archive_copy")
    assert imported.name == "archive_copy"
    assert (imported / "SOUL.md").read_text(encoding="utf-8") == "portable persona\n"
    assert not (imported / ".env").exists()
    assert not (imported / "installs").exists()
    with pytest.raises(FileExistsError):
        profile_api.import_profile(str(archive), name="archive_copy")


def test_profile_import_rejects_archive_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli import profiles as profile_api

    archive = tmp_path / "hostile.tgz"
    with tarfile.open(archive, "w:gz") as bundle:
        root = tarfile.TarInfo("hostile/profile.yaml")
        payload = b"name: hostile\n"
        root.size = len(payload)
        bundle.addfile(root, io.BytesIO(payload))
        escape = tarfile.TarInfo("hostile/../../escaped.txt")
        escape.size = 4
        bundle.addfile(escape, io.BytesIO(b"nope"))
    with pytest.raises(ValueError):
        profile_api.import_profile(str(archive), name="hostile")
    assert not (tmp_path / "escaped.txt").exists()


def test_default_profile_export_uses_root_allow_list(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli import profiles as profile_api

    (tmp_path / "config.yaml").write_text(
        "providers:\n  demo:\n    api_key: sk-root-secret\n", encoding="utf-8")
    (tmp_path / "SOUL.md").write_text("root persona\n", encoding="utf-8")
    (tmp_path / ".env").write_text("ROOT_SECRET=do-not-export\n", encoding="utf-8")
    (tmp_path / "unrelated-local-file.txt").write_text("private local file\n", encoding="utf-8")
    create_profile(profile_api, "other_profile")

    archive = profile_api.export_profile("default", str(tmp_path / "default-portable.tar.gz"))
    with tarfile.open(archive, "r:gz") as bundle:
        names = set(bundle.getnames())
        config = bundle.extractfile("default/config.yaml").read().decode("utf-8")
    assert "default/SOUL.md" in names
    assert "default/.env" not in names
    assert "default/unrelated-local-file.txt" not in names
    assert all(not name.startswith("default/profiles/") for name in names)
    assert "sk-root-secret" not in config

    imported = profile_api.import_profile(str(archive), name="default_copy")
    assert (imported / "SOUL.md").read_text(encoding="utf-8") == "root persona\n"

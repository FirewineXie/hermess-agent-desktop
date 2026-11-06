"""Verify the product's local Profile create modes against the locked Hermes API."""
import os
import sys
import time
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def create_with_product_retry(profile_api, name, **options):
    retries = 0
    while True:
        try:
            return profile_api.create_profile(name, **options), retries
        except PermissionError as exc:
            if os.name != "nt" or getattr(exc, "winerror", None) != 5 or retries >= 2:
                raise
            retries += 1
            time.sleep(0.15 * retries)


def test_fresh_config_clone_and_full_clone(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    from hermes_cli import profiles as profile_api

    (tmp_path / "config.yaml").write_text("agent:\n  marker: source\n", encoding="utf-8")
    (tmp_path / "SOUL.md").write_text("source soul\n", encoding="utf-8")
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "private.txt").write_text("remember me\n", encoding="utf-8")

    fresh, fresh_retries = create_with_product_retry(profile_api,
        "fresh", clone_from=None, clone_all=False, clone_config=False,
        no_alias=True, clone_channels=False, description="Fresh role")
    assert fresh.name == "fresh"
    assert "Fresh role" in (fresh / "profile.yaml").read_text(encoding="utf-8")
    assert not (fresh / "memories" / "private.txt").exists()

    configured, configured_retries = create_with_product_retry(profile_api,
        "configured", clone_from="default", clone_all=False, clone_config=True,
        no_alias=True, clone_channels=False, description="Configured role")
    assert "marker: source" in (configured / "config.yaml").read_text(encoding="utf-8")
    assert (configured / "SOUL.md").read_text(encoding="utf-8") == "source soul\n"
    assert not (configured / "memories" / "private.txt").exists()

    full, full_retries = create_with_product_retry(profile_api,
        "full", clone_from="default", clone_all=True, clone_config=False,
        no_alias=True, clone_channels=False, description="Full role")
    assert (full / "memories" / "private.txt").read_text(encoding="utf-8") == "remember me\n"
    assert fresh_retries + configured_retries + full_retries <= 6

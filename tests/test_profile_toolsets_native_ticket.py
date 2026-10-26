"""Regress the desktop's Profile-scoped toolset HTTP read against the locked Hermes fork."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "upstream/hermes-agent/tests/hermes_cli"))
sys.path.insert(0, str(ROOT / "upstream/hermes-agent/tests"))

from conftest import _hermetic_environment, _isolate_hermes_home  # noqa: E402,F401
from test_plugin_api_consent_gate import daemon  # noqa: E402,F401


def test_toolset_list_uses_the_native_tickets_profile(daemon):
    (daemon.launch / "config.yaml").write_text(
        '{"platform_toolsets": {"cli": ["terminal"]}}', encoding="utf-8")
    (daemon.beta / "config.yaml").write_text(
        '{"platform_toolsets": {"cli": ["web"]}}', encoding="utf-8")

    launch = daemon.client.get("/api/tools/toolsets", headers=daemon.owner)
    beta = daemon.client.get("/api/tools/toolsets", headers=daemon.beta_ticket())
    assert launch.status_code == beta.status_code == 200
    launch_rows = {row["name"]: row for row in launch.json()}
    beta_rows = {row["name"]: row for row in beta.json()}
    assert launch_rows["terminal"]["enabled"] is True
    assert launch_rows["web"]["enabled"] is False
    assert beta_rows["terminal"]["enabled"] is False
    assert beta_rows["web"]["enabled"] is True


def test_analytics_reads_the_native_tickets_profile(daemon, monkeypatch):
    """The two Desktop statistics calls must resolve the same Profile home."""
    from hermes_cli.web_routers import analytics
    (daemon.beta / "config.yaml").write_text("{}", encoding="utf-8")

    def owner_path(_days, profile):
        return {"path": str(analytics._session_db_path_for_profile(profile))}

    monkeypatch.setattr(analytics, "_get_usage_analytics", owner_path)
    monkeypatch.setattr(analytics, "_get_models_analytics", owner_path)
    for route in ("usage", "models"):
        launch = daemon.client.get(f"/api/analytics/{route}?days=7&profile=default", headers=daemon.owner)
        beta = daemon.client.get(f"/api/analytics/{route}?days=7&profile=beta", headers=daemon.beta_ticket())
        assert launch.status_code == 200, launch.text
        assert beta.status_code == 200, beta.text
        assert Path(launch.json()["path"]).resolve() == (daemon.launch / "state.db").resolve()
        assert Path(beta.json()["path"]).resolve() == (daemon.beta / "state.db").resolve()
        wrong = daemon.client.get(f"/api/analytics/{route}?days=7&profile=default", headers=daemon.beta_ticket())
        assert wrong.status_code == 403

    # The shared Hermes test fixture pins DEFAULT_DB_PATH to its launch home.
    # Restore the production path rule before checking an omitted selector.
    import hermes_state
    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", hermes_state._IMPORT_DEFAULT_DB_PATH)
    implicit = daemon.client.get("/api/analytics/usage?days=7", headers=daemon.beta_ticket())
    assert implicit.status_code == 200
    assert Path(implicit.json()["path"]).resolve() == (daemon.beta / "state.db").resolve()


def test_config_mcp_and_skill_reads_use_the_native_tickets_profile(daemon):
    for home, label in ((daemon.launch, "launch"), (daemon.beta, "beta")):
        (home / "config.yaml").write_text(json.dumps({
            "model": {"provider": "custom", "default": f"{label}-canary"},
            "mcp_servers": {f"{label}-only": {"url": "https://example.com/mcp"}},
        }), encoding="utf-8")
        skill = home / "skills" / f"{label}-skill"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            f"---\nname: {label}-skill\ndescription: Profile scope test\n---\n\n# {label}-skill\n",
            encoding="utf-8",
        )

    for route in ("/api/config/raw", "/api/mcp/servers", "/api/skills"):
        launch = daemon.client.get(route, headers=daemon.owner)
        beta = daemon.client.get(route, headers=daemon.beta_ticket())
        assert launch.status_code == 200, launch.text
        assert beta.status_code == 200, beta.text
        if route.endswith("raw"):
            assert "launch-canary" in launch.json()["yaml"]
            assert "beta-canary" in beta.json()["yaml"]
        elif route.endswith("servers"):
            assert {row["name"] for row in launch.json()["servers"]} == {"launch-only"}
            assert {row["name"] for row in beta.json()["servers"]} == {"beta-only"}
        else:
            launch_names = {row["name"] for row in launch.json()}
            beta_names = {row["name"] for row in beta.json()}
            assert "launch-skill" in launch_names and "beta-skill" not in launch_names
            assert "beta-skill" in beta_names and "launch-skill" not in beta_names


def test_installed_program_store_is_shared_across_profile_scopes(tmp_path, monkeypatch):
    """A Profile changes Agent data, not the desktop's installed program store."""
    import pm.paths
    from hermes_constants import (
        get_default_hermes_root,
        get_hermes_home,
        reset_hermes_home_override,
        set_hermes_home_override,
    )

    base = tmp_path / "hermes-home"
    monkeypatch.setenv("HERMES_HOME", str(base))
    assert get_default_hermes_root() == base
    expected_store = pm.paths.writable_store_root()

    for profile in ("alpha", "beta"):
        home = base / "profiles" / profile
        token = set_hermes_home_override(home)
        try:
            assert get_hermes_home() == home
            assert pm.paths.writable_store_root() == expected_store
        finally:
            reset_hermes_home_override(token)

"""Build an I0 core payload through the pinned upstream PM and assembler APIs."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--source-payload", type=Path,
                        help="optional verified full payload supplying pinned tools and offline wheels")
    parser.add_argument("--cache-root", type=Path,
                        help="build-only reusable tool and uv dependency cache under .cache")
    parser.add_argument("--require-cache", action="store_true",
                        help="fail instead of downloading when the prewarmed cache is incomplete")
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    build = product / ".build"
    out = args.out.resolve()
    full = args.source_payload.resolve(strict=True) if args.source_payload else None
    cache_root = args.cache_root.resolve() if args.cache_root else None
    if not out.is_relative_to(build) or (full and not full.is_relative_to(build)) or out.exists():
        parser.error("output must be fresh and paths must remain under the product .build directory")
    if cache_root and (not cache_root.is_relative_to(product / ".cache") or full):
        parser.error("--cache-root must be under .cache and cannot be combined with --source-payload")
    if args.require_cache and not cache_root:
        parser.error("--require-cache needs --cache-root")
    upstream = product / "upstream" / "hermes-agent"
    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)
    bootstrap = build / "pm-bootstrap"
    os.environ.update(HERMES_HOME=str(bootstrap / "hermes-home"),
                      HERMES_RUNTIME_DIR=str(bootstrap / "tools"))
    os.environ.pop("HERMES_INSTALL_ROOT", None)
    sys.path.insert(0, str(upstream))

    import pm
    from pm.features import installed_extras, write_features
    from pm.lock import Facts
    from pm.packages import Venv
    from pm.paths import lockfile_path
    from pm.registry import get_package
    from scripts.build.inputs import AgentInputs, RESOURCE_ENV, dependency_site
    from scripts.bundles.bytecode import bake_bytecode
    from scripts.bundles.native import stage_pm_runtime
    from scripts.bundles.native_prepared import publish_prepared
    from scripts.bundles.payload import INERT_SNAPSHOT_DIRS, record_tools, relativize_links, snapshot
    from scripts.bundles.native import finish_native

    target = pm.current_target()
    if target not in {"win32-x64", "darwin-x64", "darwin-arm64", "linux-x64"}:
        parser.error(f"core payload has not been designed for {target}")
    if full:
        manifest = json.loads((full / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("target") != target or manifest.get("repo") != "hermes-agent":
            parser.error("source payload must match the current native target")
        subprocess.run([sys.executable, str(product / "scripts" / "verify-payload.py"), "--payload", str(full)], check=True)
    out.mkdir(parents=True)
    repo = out / "hermes-agent"
    commit = json.loads((product / "runtime" / "upstream.lock.json").read_text(encoding="utf-8"))["commit"]
    snapshot(upstream, commit, repo, exclude=INERT_SNAPSHOT_DIRS)
    if (repo / "pm" / "lock.json").read_bytes() != lockfile_path().read_bytes():
        raise RuntimeError("staged PM lock differs from the selected upstream commit")

    store = out / "tools"
    names = ["python", "uv"]
    if full:
        pm.stage_tools(names, source_store=full / "tools", out=store, target=target)
    elif cache_root:
        cached_tools = cache_root / "tools"
        if not args.require_cache:
            pm.prepare_tools(names, out=cached_tools, target=target)
        pm.stage_tools(names, source_store=cached_tools, out=store, target=target)
    else:
        pm.prepare_tools(names, out=store, target=target)
    facts = Facts(store / "facts.json", strict=True)
    python_fact = facts.get("python")
    if not python_fact:
        raise RuntimeError("staged Python fact is missing")
    python_bin = get_package("python").binary(store / python_fact["entry"], target)
    if python_bin is None or not python_bin.is_file():
        raise RuntimeError("staged Python executable is missing")

    cache = out / "uv-cache"
    if full:
        shutil.copytree(full / "uv-cache", cache)
    elif cache_root and (cache_root / "uv-cache").is_dir():
        shutil.copytree(cache_root / "uv-cache", cache)
    elif args.require_cache:
        parser.error("prewarmed uv cache is missing")
    else:
        cache.mkdir()
    stage_pm_runtime(out, python_bin, repo, offline=args.require_cache, cache=cache)
    venv = out / "venv"
    if target.startswith("darwin-"):
        # The staged PBS interpreter retains an AR path from its deleted build tree.
        os.environ["AR"] = "/usr/bin/ar"
    pm.build_environment(source=repo, out=venv, python=python_bin, cache=cache,
                         extras=["messaging", "feishu"], all_extras=False,
                         sealed=True, offline=args.require_cache, explicit=True)
    features = installed_extras(repo, venv, python_exe=python_bin)
    write_features(features, out)
    facts.record_state("venv", Venv(repo).expected_stamp(features, plugin_dirs=[]), features)
    record_tools(out, lockfile_path(), target,
                 {name: fact["entry"] for name in names if (fact := facts.get(name))})
    site = dependency_site(venv, python_fact["version"], target)
    (site / "hermes-agent.pth").write_text(
        Path(os.path.relpath(repo, site)).as_posix() + "\n", encoding="utf-8")
    relativize_links(out)
    bake_bytecode(out, python_bin)
    inputs = AgentInputs(
        project=repo / "pyproject.toml", code=repo, repo="hermes-agent",
        placement="contained", target=target, python=python_bin,
        site_packages=site, environment=venv, tools=store,
        pm_runtime=out / "pm-runtime", ref=commit,
        resources={name: repo / name for name in RESOURCE_ENV},
        features=out / "enabled-features.json",
    )
    prepared = publish_prepared(out, upstream, commit, inputs)
    finish_native(prepared, {})
    subprocess.run([sys.executable, str(product / "scripts" / "verify-payload.py"), "--payload", str(out)], check=True)
    if cache_root and not (cache_root / "uv-cache").exists():
        shutil.copytree(cache, cache_root / "uv-cache")
    print(f"core payload ready: {out}; extras={len(features)}, tools={names}")


if __name__ == "__main__":
    main()

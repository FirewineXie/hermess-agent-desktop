"""Build one local chat's executable PATH from product-owned PM stores only."""
import json
import os
from pathlib import Path
import sys

from pm import store_first_path, uv_launcher
from pm.environments import selected_venv
from pm.paths import repo_root


def session_environment(roots):
    # Neither the helper's venv nor Hermes's committed dependency environment
    # belongs on a project's executable search path.
    runtime_envs = [selected_venv(repo_root())]
    if sys.prefix != sys.base_prefix:
        runtime_envs.append(Path(sys.prefix))
    excluded = {os.path.normcase(str(root / name)) for root in runtime_envs for name in ("bin", "Scripts")}
    original = [part for part in os.environ.get("PATH", "").split(os.pathsep)
                if part and os.path.normcase(part.rstrip("/\\")) not in excluded]
    previous = os.environ.get("HERMES_RUNTIME_DIR")
    managed = ""
    try:
        for root in reversed(roots):
            if not Path(root).is_absolute():
                raise ValueError("Product tool store must be absolute")
            os.environ["HERMES_RUNTIME_DIR"] = root
            managed = store_first_path(managed)
            uv = uv_launcher("uv")
            if uv is not None:
                managed = os.pathsep.join([str(uv.parent), managed]) if managed else str(uv.parent)
    finally:
        if previous is None:
            os.environ.pop("HERMES_RUNTIME_DIR", None)
        else:
            os.environ["HERMES_RUNTIME_DIR"] = previous
    paths = list(dict.fromkeys(part for part in managed.split(os.pathsep) if part))
    keys = {os.path.normcase(part) for part in paths}
    return {"client_env": {"PATH": os.pathsep.join([*paths, *(part for part in original if os.path.normcase(part) not in keys)])},
            "managed_path_count": len(paths)}


print(json.dumps(session_environment(json.loads(os.environ.pop("HERMESS_CHAT_TOOL_ROOTS")))))

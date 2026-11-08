"""Profile-scoped plugin CLI bridge. Embedded by Rust; never starts a server.

Only product-registered service controls are exposed. Loading cli.py in a
synthetic package matches Hermes's CLI loading without importing the provider
or requiring it to remain the active memory provider.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import types


@dataclass(frozen=True)
class Service:
    plugin: str
    markers: tuple[str, ...]
    status: tuple[str, ...]
    stop: tuple[str, ...]
    state_pattern: str
    stopped_output: str


# Register service commands here, not a separate shutdown implementation.
SERVICES = {
    "openviking.quick-local": Service(
        plugin="openviking",
        markers=("openviking/ov.conf", "openviking/server-process.json"),
        status=("local", "status"),
        stop=("local", "stop"),
        state_pattern=r"^Quick Local: (ready|starting|stopped) at .+$",
        stopped_output="Quick Local is not configured for this profile.",
    ),
}


class ControlError(Exception):
    pass


class BoundedOutput(io.StringIO):
    def write(self, value):
        if self.tell() + len(value) > 65536:
            raise ControlError("output_limit")
        return super().write(value)


def inside(path: Path, root: Path) -> Path:
    if not path.resolve().is_relative_to(root.resolve()):
        raise ControlError("outside_product_home")
    return path


def profile_home(root: Path, name: str) -> Path:
    # The subprocess starts with the product root, before importing Hermes.
    from hermes_cli.profiles import get_profile_dir, normalize_profile_name

    if normalize_profile_name(name) != name:
        raise ControlError("invalid_profile")
    home = inside(get_profile_dir(name), root)
    if not home.is_dir():
        raise ControlError("profile_missing")
    return home


def inventory(root: Path) -> dict:
    from hermes_cli.profiles import list_profile_names

    targets = []
    for name in list_profile_names():
        home = profile_home(root, name)
        for service_id, service in SERVICES.items():
            if any(inside(home / marker, root).exists() for marker in service.markers):
                targets.append({"profile": name, "service": service_id})
    return {"targets": targets}


def load_cli(home: Path, root: Path, service: Service):
    # Deliberately use this profile's installed plugin only. Project-local,
    # account-global and other profiles' plugins are not cleanup owners.
    plugin = inside(home / "plugins" / service.plugin, root)
    cli = inside(plugin / "cli.py", root)
    if not cli.is_file():
        raise ControlError("command_unavailable")
    package_name = "_hermess_service_control"
    package = types.ModuleType(package_name)
    package.__path__ = [str(plugin)]
    sys.modules[package_name] = package
    spec = importlib.util.spec_from_file_location(package_name + ".cli", cli)
    if spec is None or spec.loader is None:
        raise ControlError("command_unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def control(root: Path, name: str, service_id: str, action: str) -> dict:
    service = SERVICES.get(service_id)
    if service is None or action not in {"status", "stop"}:
        raise ControlError("unregistered_command")
    home = profile_home(root, name)
    # No Hermes CLI main: it can redirect the default home to active_profile.
    # Bind the exact home before importing the plugin or hermes_constants.
    os.environ["HERMES_HOME"] = str(home)
    os.environ.pop("HERMES_PROFILE", None)
    os.environ.pop("HERMES_PROFILE_NAME", None)
    for marker in service.markers:
        inside(home / marker, root)
    # Also protect sibling config/runtime paths used by the plugin itself.
    for directory in (home / "plugins" / service.plugin, home / service.plugin):
        inside(directory, root)
        if directory.is_dir():
            for child in directory.iterdir():
                inside(child, root)
    captured = BoundedOutput()
    with redirect_stdout(captured), redirect_stderr(captured):
        module = load_cli(home, root, service)
        parser = argparse.ArgumentParser(add_help=False)
        module.register_cli(parser)
        args = parser.parse_args(service.status if action == "status" else service.stop)
        try:
            result = args.func(args)
        except SystemExit as exc:
            if exc.code not in (None, 0):
                raise ControlError("command_failed") from None
            result = None
    if result not in (None, 0):
        raise ControlError("command_failed")
    if action == "stop":
        return {"state": "stop_requested"}
    output = captured.getvalue()
    states = [match.group(1) for line in output.splitlines()
              if (match := re.fullmatch(service.state_pattern, line))]
    if len(states) == 1:
        return {"state": states[0]}
    if output.strip() == service.stopped_output:
        # A surviving process record contradicts "not configured".
        if any((home / marker).exists() for marker in service.markers):
            raise ControlError("configuration_missing")
        return {"state": "stopped"}
    raise ControlError("unrecognized_status")


def main() -> None:
    # Root is provided by the owned Rust runtime, never by plugin output.
    root = Path(sys.argv[1])
    if not root.is_absolute() or not root.is_dir():
        raise ControlError("product_home_missing")
    os.environ["HERMES_HOME"] = str(root)
    action = sys.argv[2]
    if action == "inventory":
        result = inventory(root)
    else:
        result = control(root, sys.argv[3], sys.argv[4], action)
    print(json.dumps({"ok": True, **result}))


if __name__ == "__main__":
    try:
        main()
    except ControlError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        raise SystemExit(1) from None
    except Exception:
        # Never send config contents, credentials or plugin tracebacks to logs.
        print(json.dumps({"ok": False, "error": "control_exception"}))
        raise SystemExit(1) from None

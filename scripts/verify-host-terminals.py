"""Run the production desktop PTY against two isolated SSH test hosts on Windows.

Install paramiko in the test environment only, or add its directory to PYTHONPATH.
"""

from contextlib import ExitStack
import os
from pathlib import Path
import socket
import subprocess
import threading

import paramiko

from validation_workspace import validation_workspace

PRODUCT = Path(__file__).resolve().parents[1]


class Shell(paramiko.ServerInterface):
    def __init__(self):
        self.started = threading.Event()

    def check_auth_none(self, username):
        return paramiko.AUTH_SUCCESSFUL if username == "probe" else paramiko.AUTH_FAILED

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_pty_request(self, *args):
        return True

    def check_channel_window_change_request(self, *args):
        return True

    def check_channel_shell_request(self, channel):
        self.started.set()
        return True


def serve(listener, key, marker, accepted):
    with listener.accept()[0] as peer:
        transport = paramiko.Transport(peer)
        try:
            transport.add_server_key(key)
            server = Shell()
            transport.start_server(server=server)
            channel = transport.accept(20)
            assert channel is not None and server.started.wait(10)
            channel.sendall(marker.encode() + b"\r\n")
            accepted.set()
            channel.settimeout(35)
            while channel.recv(4096):
                pass
        finally:
            transport.close()


def main():
    if os.name != "nt":
        raise SystemExit("This probe invokes a windowless Windows Tauri test.")
    with validation_workspace(prefix="host-terminal-probe-", dir=PRODUCT / ".build") as directory, ExitStack() as stack:
        path = Path(directory) / "ssh_config"
        known = Path(directory) / "known_hosts"
        config = []
        known_hosts = []
        hosts = []
        key = paramiko.RSAKey.generate(2048)
        for alias, marker in (("probe-one", "HOST_ONE_READY"), ("probe-two", "HOST_TWO_READY")):
            listener = stack.enter_context(socket.socket())
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            listener.settimeout(130)
            port = listener.getsockname()[1]
            known_hosts.append(f"[127.0.0.1]:{port} {key.get_name()} {key.get_base64()}\n")
            config.append(f"Host {alias}\n  HostName 127.0.0.1\n  Port {port}\n  User probe\n"
                          "  BatchMode yes\n  StrictHostKeyChecking yes\n"
                          f'  UserKnownHostsFile "{known.as_posix()}"\n  GlobalKnownHostsFile none\n')
            ready = threading.Event()
            thread = threading.Thread(target=serve, args=(listener, key, marker, ready), daemon=True)
            thread.start()
            hosts.append((thread, ready))
        path.write_text("".join(config), encoding="utf-8")
        known.write_text("".join(known_hosts), encoding="utf-8")
        subprocess.run([
            "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
            "--locked", "remote_gateway_host_terminals_live",
            "--", "--ignored", "--nocapture", "--test-threads=1",
        ], env=dict(os.environ, HERMESS_TEST_SSH_CONFIG=str(path)), cwd=PRODUCT, check=True)
        for thread, ready in hosts:
            assert ready.is_set()
            thread.join(5)
            assert not thread.is_alive(), "terminal closed without ending its SSH channel"


if __name__ == "__main__":
    main()

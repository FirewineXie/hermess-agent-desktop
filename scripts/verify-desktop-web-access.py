"""Exercise the production desktop HTTPS/WSS relay against the locked Windows Gateway."""

import argparse
import asyncio
from datetime import datetime, timedelta, timezone
import ipaddress
import json
from pathlib import Path
import runpy
import ssl
import subprocess
from urllib.parse import urlsplit

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from validation_workspace import validation_workspace

ROOT = Path(__file__).resolve().parents[1]


def generate_pem(sync):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, "Hermess test")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(hours=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
                           critical=False)
            .sign(key, hashes.SHA256()))
    (sync / "cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (sync / "key.pem").write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))


async def refused(url, origin, protocols, tls=None):
    try:
        async with connect(url, origin=origin, subprotocols=protocols, ssl=tls, proxy=None):
            raise AssertionError("WebSocket unexpectedly admitted")
    except InvalidStatus as error:
        assert error.response.status_code == 403


async def verify(sync, ready, rpc):
    origin = ready["origin"]
    launch = urlsplit(ready["link"])
    assert (launch.scheme + "://" + launch.netloc, launch.path) == (origin, "/webapp/launch")
    tls = ssl.create_default_context(cafile=ready["certificate"])
    tls.minimum_version = ssl.TLSVersion.TLSv1_3
    with httpx.Client(verify=tls, trust_env=False, timeout=10) as client:
        assert client.get(origin + "/").status_code == 200
        assert client.get(origin + launch.path).status_code == 200
        assert client.get(origin + "/", headers={"Host": "other.invalid"}).status_code == 400
        assert client.get(origin + "/api/config").status_code == 401
        endpoint = origin + "/webapp/window-session"
        headers = {"X-Hermes-Window-Ticket": launch.fragment.removeprefix("ticket=")}
        assert client.post(endpoint, headers={**headers, "Origin": "https://other.invalid"}).status_code == 403
        assert client.post(endpoint, headers=headers).status_code == 403
        session = client.post(endpoint, headers={**headers, "Origin": origin})
        assert session.status_code == 200, ("launch exchange", session.status_code)
        assert client.post(endpoint, headers={**headers, "Origin": origin}).status_code == 403
        browser = {"X-Hermes-Session-Token": session.json()["token"], "Origin": origin}
        assert client.get(origin + "/api/config", headers=browser).status_code == 200
        assert client.get(origin + "/api/webapp-access/status", headers=browser).status_code == 403
        ticket_endpoint = origin + "/api/webapp/socket-ticket?socket=gateway"

        def mint():
            minted = client.post(ticket_endpoint, headers=browser)
            assert minted.status_code == 200
            return ["hermes-gateway-v1", "hermes-gateway-ticket." + minted.json()["ticket"]]

        protocols = mint()
        socket_url = origin.replace("https:", "wss:") + "/api/ws"
        await refused(socket_url, None, protocols, tls)
        await refused(socket_url, "https://other.invalid", protocols, tls)
        await refused(f"ws://127.0.0.1:{ready['gateway_port']}/api/ws", origin, mint())
        async with connect(socket_url, origin=origin, subprotocols=protocols, ssl=tls, proxy=None) as ws:
            assert ws.subprotocol == "hermes-gateway-v1"
            assert (await rpc(ws, "ping"))["pong"] is True
            await refused(socket_url, origin, protocols, tls)
            (sync / "disable").touch()
            await asyncio.wait_for(ws.wait_closed(), timeout=10)
            try:
                await ws.recv()
            except ConnectionClosed:
                pass
        try:
            client.get(origin + "/")
        except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError):
            pass
        else:
            raise AssertionError("HTTPS listener still reachable after disabling")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, required=True)
    launcher = parser.parse_args().hermes.resolve(strict=True)
    helpers = runpy.run_path(str(ROOT / "scripts/verify-gateway-recovery.py"))
    from tests.gateway.fixtures.local_recovery_probe import seed_offline_models_dev
    lock = json.loads((ROOT / "runtime/upstream.lock.json").read_text(encoding="utf-8"))
    head = subprocess.check_output(["git", "-C", str(ROOT / "upstream/hermes-agent"), "rev-parse", "HEAD"],
                                   text=True).strip()
    assert head == lock["commit"]
    manifest = json.loads((launcher.parent.parent / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["ref"] == head
    with validation_workspace(prefix="desktop-web-access-", dir=ROOT / ".build") as directory:
        root = Path(directory)
        storage = root / "HermessAgentDesktop"
        home = storage / "hermes-home"
        home.mkdir(parents=True)
        (home / "config.yaml").write_text("gateway:\n  multiplex_profiles: true\n", encoding="utf-8")
        seed_offline_models_dev(home)
        sync = root / "sync"
        sync.mkdir()
        generate_pem(sync)
        env = helpers["isolated_env"](root, storage, launcher)
        with (root / "rust.log").open("w+", encoding="utf-8") as log:
            process = subprocess.Popen([
                "cargo", "test", "--manifest-path", str(ROOT / "apps/desktop/src-tauri/Cargo.toml"),
                "--locked", "desktop_web_access_live", "--", "--ignored", "--nocapture",
            ], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                ready = helpers["wait_ready"](sync, 0, process)
                asyncio.run(verify(sync, ready, helpers["rpc"]))
                assert process.wait(timeout=60) == 0
                assert (sync / "disabled").exists()
            except BaseException:
                (sync / "disable").touch()
                process.wait(timeout=100)
                log.seek(0)
                print(log.read())
                raise
    print("Verified Windows desktop HTTPS with the generated certificate, Gateway tickets, and disconnect on disable.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Exercise actual Caddy routing against synthetic loopback HTTP servers only."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
from threading import Thread
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import yaml

HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE / 'services.json').read_text())
image = yaml.safe_load((HERE / 'compose.yml').read_text())['services']['edge']['image']


def fake(name):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            length = int(self.headers.get('Content-Length', '0'))
            payload = {'service': name, 'path': self.path, 'method': self.command,
                       'authorization': self.headers.get('Authorization'),
                       'idempotency': self.headers.get('Idempotency-Key'),
                       'body': self.rfile.read(length).decode()}
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        do_POST = do_GET
        def log_message(self, *_):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server


def port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def main():
    servers = {}
    container = 'ahp-hosting-proxy-test-' + secrets.token_hex(6)
    try:
        servers = {name: fake(name) for name in [*manifest, 'web']}
        web_port, api_port = port(), port()
        source = (HERE / 'Caddyfile').read_text().split('\n\n', 1)[1]
        source = '{\n  auto_https off\n  admin off\n}\n\n' + source
        source = source.replace('{$AHP_WEB_HOST}', f'http://127.0.0.1:{web_port}')
        source = source.replace('{$AHP_API_HOST}', f'http://127.0.0.1:{api_port}')
        for name, entry in {**manifest, 'web': {'port': 3000}}.items():
            source = source.replace(f'{name}:{entry["port"]}', f'127.0.0.1:{servers[name].server_port}')
        with tempfile.TemporaryDirectory(prefix='ahp-hosting-proxy-') as directory:
            config = Path(directory) / 'Caddyfile'
            config.write_text(source)
            started = subprocess.run(['docker', 'run', '--detach', '--rm', '--pull=never', '--name', container,
                '--network', 'host', '--volume', f'{config}:/etc/caddy/Caddyfile:ro', image], capture_output=True, text=True, timeout=30)
            assert started.returncode == 0, 'Synthetic Caddy container could not start'
            base = f'http://127.0.0.1:{api_port}'
            for _ in range(60):
                try:
                    with urlopen(f'http://127.0.0.1:{web_port}/login', timeout=1) as response:
                        assert json.load(response)['service'] == 'web'
                    break
                except (URLError, OSError):
                    time.sleep(0.2)
            else:
                logs = subprocess.run(['docker', 'logs', container], capture_output=True, text=True)
                raise AssertionError('Synthetic proxy was not ready: ' + logs.stderr[-3000:])
            cases = [(prefix, name) for name, entry in manifest.items() for prefix in entry['paths']]
            cases += [
                ('/prescriptions/synthetic/fulfillment', 'pharmacy'),
                ('/prescriptions/synthetic/dispense-code', 'pharmacy'),
                ('/prescriptions/synthetic/dispense-code/revoke', 'pharmacy'),
                ('/prescriptions/synthetic', 'consultation'),
                ('/consultations/synthetic/rating', 'quality'),
                ('/consultations/synthetic', 'consultation'),
                ('/care-threads/synthetic/messages', 'messaging'),
                ('/care-threads/synthetic/communication-consent', 'messaging'),
                ('/care-threads/synthetic', 'consultation'),
                ('/patient-profiles/synthetic/prescriptions', 'consultation'),
                ('/patient-profiles/synthetic/risk-scores', 'prevention'),
                ('/patient-profiles/synthetic/vaccinations', 'prevention'),
                ('/patient-profiles/synthetic', 'patient'),
                ('/users/me/dependents', 'patient'),
                ('/users/me/dependents/synthetic', 'patient'),
                ('/users/me', 'auth'),
                ('/investigation-orders/synthetic/results', 'diagnostics'),
                ('/laboratory/facilities', 'diagnostics'),
                ('/realtime/synthetic', 'messaging'),
            ]
            for path, expected in cases:
                request = Request(base + path + '?synthetic=true', data=b'{"synthetic":true}', method='POST',
                    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer synthetic-only', 'Idempotency-Key': 'synthetic-proxy-key'})
                with urlopen(request, timeout=3) as response:
                    actual = json.load(response)
                assert actual == {'service': expected, 'path': path + '?synthetic=true', 'method': 'POST',
                    'authorization': 'Bearer synthetic-only', 'idempotency': 'synthetic-proxy-key', 'body': '{"synthetic":true}'}, path
            for path in ('/unmapped', '/auth-unmapped', '/patient-profiles-unmapped'):
                try:
                    urlopen(base + path, timeout=3)
                    raise AssertionError('Unknown endpoint was not rejected')
                except HTTPError as error:
                    assert error.code == 404
            print(f'Caddy routing passed: {len(cases)} API paths, web forwarding, headers/body/query preservation and 3 unknown-route rejections.')
    finally:
        subprocess.run(['docker', 'rm', '--force', container], capture_output=True, timeout=20)
        for server in servers.values():
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()

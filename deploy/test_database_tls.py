#!/usr/bin/env python3
"""Check both database drivers against a newly owned TLS PostgreSQL cluster."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('owned_cluster', ROOT / 'scripts/ci/backend-tests.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local', action='store_true', help='Use installed Node workspace instead of the built image')
    parser.add_argument('--image', default='ahp/backend:ci')
    args = parser.parse_args()
    cluster = helper.Cluster(True)
    def command(arguments, **kwargs):
        result = subprocess.run(arguments, capture_output=True, timeout=60, **kwargs)
        assert result.returncode == 0, 'Disposable TLS setup command failed; output withheld'
        return result
    try:
        cluster.start()
        database_url = cluster.reset('public').replace('127.0.0.1', 'localhost')
        with tempfile.TemporaryDirectory(prefix='ahp-hosting-tls-') as temporary:
            directory = Path(temporary)
            directory.chmod(0o755)
            def certificate(name, subject, san):
                command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-keyout', str(directory / (name + '.key')), '-out', str(directory / (name + '.crt')),
                    '-subj', subject, '-addext', 'subjectAltName=' + san])
                (directory / (name + '.key')).chmod(0o600)
                (directory / (name + '.crt')).chmod(0o644)
            certificate('server', '/CN=localhost', 'DNS:localhost,IP:127.0.0.1')
            certificate('untrusted', '/CN=untrusted', 'DNS:untrusted')
            def install_certificate():
                for name in ('server.key', 'server.crt'):
                    command(['docker', 'exec', '-i', '--user', 'postgres', cluster.container, 'sh', '-c',
                        f'umask 077; cat > /var/lib/postgresql/data/{name}'], input=(directory / name).read_bytes())
            install_certificate()
            for sql in ("ALTER SYSTEM SET ssl='on'", "ALTER SYSTEM SET ssl_cert_file='/var/lib/postgresql/data/server.crt'",
                        "ALTER SYSTEM SET ssl_key_file='/var/lib/postgresql/data/server.key'", 'SELECT pg_reload_conf()'):
                cluster.sql(sql)
            time.sleep(0.3)
            prisma = "import {PrismaClient} from '@prisma/client';const p=new PrismaClient();try{const r=await p.$queryRaw`SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()`;console.log(JSON.stringify({ok:r[0]?.ssl===true}))}catch(e){console.log(JSON.stringify({ok:false,tlsError:/certificate|TLS|SSL/i.test(e.message)}))}finally{await p.$disconnect()}"
            pg = "import pg from 'pg';const p=new pg.Client({connectionString:process.env.DATABASE_URL});try{await p.connect();const r=await p.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');console.log(JSON.stringify({ok:r.rows[0]?.ssl===true}))}catch(e){console.log(JSON.stringify({ok:false,tlsError:/certificate|TLS|SSL/i.test(e.message)}))}finally{await p.end()}"
            def probe(ca, expect_ok, label):
                cert = str(directory / ca) if args.local else '/run/config/' + ca
                url = database_url + f'&sslmode=require&sslaccept=strict&sslcert={cert}&sslrootcert={cert}'
                for name, code, package in [('Prisma', prisma, 'database'), ('node-postgres', pg, 'http')]:
                    options = {'env': {**os.environ, 'DATABASE_URL': url}, 'text': True}
                    if args.local:
                        prefix = []
                        options['cwd'] = ROOT / 'packages' / package
                    else:
                        prefix = ['docker', 'run', '--rm', '--network', 'host', '--read-only',
                            '--tmpfs', '/tmp:size=32m,mode=1777', '--env', 'DATABASE_URL',
                            '--volume', f'{directory}:/run/config:ro', '--workdir', '/repo/packages/' + package, args.image]
                    result = command(prefix + ['node', '--import', 'tsx', '--input-type=module', '-e', code], **options)
                    lines = result.stdout.strip().splitlines()
                    actual = json.loads(lines[-1])
                    assert actual.get('ok') is expect_ok, f'{name}: unexpected {label} outcome'
                    if not expect_ok:
                        assert actual.get('tlsError'), f'{name}: negative test must fail for TLS, not unrelated setup'
                    print(f'{name}: {label} PASS', flush=True)
            probe('server.crt', True, 'trusted encrypted connection')
            probe('untrusted.crt', False, 'untrusted certificate rejection')
            certificate('server', '/CN=wrong-host.test', 'DNS:wrong-host.test,IP:127.0.0.1')
            install_certificate()
            cluster.sql('SELECT pg_reload_conf()')
            time.sleep(0.3)
            probe('server.crt', False, 'hostname mismatch rejection')
            print('Both database drivers passed all 6 TLS checks against a disposable cluster.')
    finally:
        cluster.close()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Run backend suites only in a PostgreSQL cluster created by this process.

Each test file receives a new ahealth_test database. The live development and
production databases, external DATABASE_URL values and port 5432 are never used.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def run(command, *, env=None, cwd=ROOT, timeout=180):
    try:
        return subprocess.run(command, cwd=cwd, env=env, capture_output=True,
                              text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Check command timed out: ' + Path(command[0]).name) from None


class Cluster:
    def __init__(self, docker=False):
        self.docker = docker
        self.directory = None
        self.container = 'ahp-ci-' + secrets.token_hex(6)
        self.password = secrets.token_hex(24)
        self.test_password = secrets.token_hex(24)
        self.started = False
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            self.port = probe.getsockname()[1]
        if self.port == 5432:
            raise RuntimeError('Refusing the shared database port')
        self.admin_env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        self.admin_env['PGPASSWORD'] = self.password

    def start(self):
        if self.docker:
            result = run(['docker', 'run', '--detach', '--rm', '--name', self.container,
                          '--network', 'host',
                          '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_DB=postgres',
                          '--env', 'POSTGRES_PASSWORD', 'postgres:17', '-h', '127.0.0.1', '-p', str(self.port)],
                         env={**os.environ, 'POSTGRES_PASSWORD': self.password}, timeout=300)
            if result.returncode:
                raise RuntimeError('Disposable PostgreSQL container could not start: ' + result.stderr)
            self.started = True
        else:
            configured = os.environ.get('AHP_PG_BIN')
            choices = list(Path('/usr/lib/postgresql').glob('*/bin/initdb'))
            if configured:
                self.bin = Path(configured)
            elif choices:
                self.bin = sorted(choices, key=lambda p: int(p.parents[1].name))[-1].parent
            else:
                raise RuntimeError('Install PostgreSQL tools or use --docker')
            self.directory = tempfile.TemporaryDirectory(prefix='ahp-ci-pg-')
            base = Path(self.directory.name)
            base.chmod(0o700)
            password_file = base / 'password'
            password_file.write_text(self.password)
            password_file.chmod(0o600)
            result = run([str(self.bin / 'initdb'), '-D', str(base / 'data'), '-U', 'postgres',
                          '-A', 'scram-sha-256', '--pwfile', str(password_file), '--no-locale'])
            if result.returncode:
                raise RuntimeError('Disposable PostgreSQL initialization failed: ' + result.stderr)
            result = run([str(self.bin / 'pg_ctl'), '-D', str(base / 'data'), '-l', str(base / 'postgres.log'),
                          '-o', f'-h 127.0.0.1 -p {self.port} -k {base}', '-w', 'start'])
            if result.returncode:
                raise RuntimeError('Disposable PostgreSQL startup failed: ' + result.stderr)
            self.started = True
        for _ in range(60):
            try:
                identity = self.sql('SELECT inet_server_port()', database='postgres')
                if identity.strip() == str(self.port):
                    break
            except RuntimeError:
                time.sleep(0.5)
        else:
            raise RuntimeError('Disposable database identity was not ready')
        self.sql(f"CREATE ROLE ahealth_ci LOGIN PASSWORD '{self.test_password}'")

    def sql(self, statement, database='postgres'):
        if not self.started:
            raise RuntimeError('Only a newly created cluster may be used')
        prefix = (['docker', 'exec', '--env', 'PGPASSWORD', self.container, 'psql'] if self.docker
                  else [str(self.bin / 'psql')])
        result = run(prefix + ['-X', '-h', '127.0.0.1', '-p', str(self.port), '-U', 'postgres',
                               '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement],
                     env=self.admin_env)
        if result.returncode:
            raise RuntimeError('Disposable database command failed: ' + result.stderr)
        return result.stdout

    def reset(self, schema):
        # These names are constants within the newly owned cluster, never caller input.
        self.sql('DROP DATABASE IF EXISTS ahealth_test WITH (FORCE)')
        self.sql('CREATE DATABASE ahealth_test OWNER ahealth_ci')
        self.sql('ALTER SCHEMA public OWNER TO ahealth_ci', 'ahealth_test')
        if schema != 'public':
            if not re.fullmatch(r'ahp_test_[a-z0-9_]+', schema):
                raise RuntimeError('Invalid disposable schema name')
            self.sql(f'CREATE SCHEMA "{schema}" AUTHORIZATION ahealth_ci', 'ahealth_test')
        return f'postgresql://ahealth_ci:{self.test_password}@127.0.0.1:{self.port}/ahealth_test?schema={schema}'

    def close(self):
        if self.started:
            if self.docker:
                run(['docker', 'rm', '--force', self.container])
            else:
                run([str(self.bin / 'pg_ctl'), '-D', str(Path(self.directory.name) / 'data'),
                     '-m', 'fast', '-w', 'stop'])
            self.started = False
        if self.directory:
            self.directory.cleanup()


def safe_log(value, private_values):
    for secret in private_values:
        if secret:
            value = value.replace(secret, '[redacted]')
    return re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b', '[redacted JWT]', value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', default='.local/ci-evidence/backend', help='Evidence folder inside .local')
    parser.add_argument('--docker', action='store_true', help='Use a disposable PostgreSQL 17 container')
    parser.add_argument('--services', nargs='+', default=sorted(p.name for p in (ROOT / 'services').iterdir()
                                                              if (p / 'package.json').exists()))
    parser.add_argument('--match', default='*.test.ts', help='Test filename glob; no paths')
    parser.add_argument('--skip-typecheck', action='store_true', help='Use only after the relevant checks have passed')
    args = parser.parse_args()
    if '/' in args.match or '\\' in args.match:
        parser.error('--match accepts filenames only')
    for name in args.services:
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name) or not (ROOT / 'services' / name / 'package.json').exists():
            parser.error('Unknown service: ' + name)
    evidence = (ROOT / args.evidence_dir).resolve()
    if not evidence.is_relative_to((ROOT / '.local').resolve()):
        parser.error('Evidence must stay inside the ignored .local directory')
    evidence.mkdir(parents=True, exist_ok=True)
    results = []
    cluster = Cluster(args.docker)
    jwt_secret = secrets.token_hex(32)
    gateway_secret = secrets.token_hex(32)
    private_values = [cluster.password, cluster.test_password, jwt_secret, gateway_secret]
    try:
        cluster.start()
        for name in args.services:
            service = ROOT / 'services' / name
            output = evidence / name
            output.mkdir(exist_ok=True)
            if not args.skip_typecheck:
                checked = run(['pnpm', 'exec', 'tsc', '--noEmit'], cwd=service, timeout=300)
                (output / 'typecheck.log').write_text(safe_log(checked.stdout + checked.stderr, private_values))
                results.append({'service': name, 'check': 'typecheck', 'exit_code': checked.returncode})
                print(f'{name}: typecheck {"PASS" if checked.returncode == 0 else "FAIL"}', flush=True)
            test_files = sorted((service / 'src' / 'tests').glob(args.match))
            if not test_files:
                raise RuntimeError('No matching test files for ' + name)
            for test_file in test_files:
                started = time.monotonic()
                nonce = secrets.token_hex(6)
                source = test_file.read_text()
                dedicated = None
                if 'selectDedicatedTestSchema' in source:
                    if 'AHP_TEST_FRONT_DESK_SCHEMA' in source:
                        dedicated = ('AHP_TEST_FRONT_DESK_SCHEMA', 'ahp_test_front_desk_' + nonce)
                    elif 'AHP_TEST_THREAD_SCHEMA' in source:
                        dedicated = ('AHP_TEST_THREAD_SCHEMA', 'ahp_test_thread_integrity_' + nonce)
                    else:
                        raise RuntimeError('Dedicated suite schema is not recognized: ' + test_file.name)
                schema = dedicated[1] if dedicated else 'public'
                database_url = cluster.reset(schema)
                env = {**os.environ, 'DATABASE_URL': database_url, 'NODE_ENV': 'test',
                       'JWT_SECRET': jwt_secret, 'GATEWAY_SHARED_SECRET': gateway_secret, 'JWT_ISSUER': 'a-health', 'JWT_AUDIENCE': 'a-health-api',
                       'AHP_SAFETY_TEST_DB_ACK': 'ISOLATED_DISPOSABLE_AHEALTH_TEST',
                       'AHP_RESEARCH_DB_TESTS': '1',
                       'AUTH_LOCAL_OTP_MODE': 'true', 'OTP_ECHO_IN_RESPONSE': 'true',
                       'OTP_LOG_TO_CONSOLE': 'false',
                       'SMS_PROVIDER': 'console', 'MOBILE_MONEY_PROVIDER': 'console',
                       'CHAT_PROVIDER': 'stub', 'TRANSCRIBE_PROVIDER': 'stub'}
                if dedicated:
                    env[dedicated[0]] = dedicated[1]
                if name == 'research' and test_file.name == 'warehouse.database.test.ts':
                    cluster.sql('CREATE DATABASE ahealth_research_test OWNER ahealth_ci')
                    cluster.sql('ALTER SCHEMA public OWNER TO ahealth_ci', 'ahealth_research_test')
                    env.update({
                        'AHP_RUN_OMOP_DATABASE_TESTS': 'YES_DEDICATED_TEST_DATABASE',
                        'RESEARCH_WAREHOUSE_ENABLED': 'true',
                        'RESEARCH_WAREHOUSE_DATABASE': 'ahealth_research_test',
                        'RESEARCH_WAREHOUSE_DATABASE_URL': database_url.replace('/ahealth_test?', '/ahealth_research_test?'),
                    })
                migration = run(['pnpm', '--filter', '@a-health/database', 'exec', 'prisma', 'migrate', 'deploy'],
                                env=env, timeout=240)
                log = migration.stdout + migration.stderr
                if migration.returncode:
                    result_code = migration.returncode
                    tests = 0
                else:
                    tested = run(['node', '--import', 'tsx', '--test', str(test_file.relative_to(service))],
                                 cwd=service, env=env, timeout=300)
                    log += tested.stdout + tested.stderr
                    result_code = tested.returncode
                    counts = re.findall(r'^# tests (\d+)$', tested.stdout, re.MULTILINE)
                    tests = int(counts[-1]) if counts else 0
                    skipped = re.findall(r'^# skipped (\d+)$', tested.stdout, re.MULTILINE)
                    if not tests or (skipped and int(skipped[-1])):
                        result_code = result_code or 1
                        log += '\nCI requires executed tests without skipped cases.\n'
                (output / (test_file.name + '.log')).write_text(safe_log(log, private_values + [database_url]))
                results.append({'service': name, 'check': test_file.name, 'exit_code': result_code,
                                'tests': tests, 'seconds': round(time.monotonic() - started, 2)})
                print(f'{name}/{test_file.name}: {"PASS" if result_code == 0 else "FAIL"} ({tests} tests)', flush=True)
    finally:
        cluster.close()
        (evidence / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
    failed = [result for result in results if result['exit_code']]
    print(f'Backend checks: {len(results)}; tests: {sum(r.get("tests", 0) for r in results)}; failures: {len(failed)}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())

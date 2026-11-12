#!/usr/bin/env python3
"""Rehearse migrations and a synthetic backup/restore in a newly owned cluster."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('backend_checks', ROOT / 'scripts/ci/backend-tests.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--docker', action='store_true')
args = parser.parse_args()
cluster = module.Cluster(args.docker)
try:
    cluster.start()
    database_url = cluster.reset('public')
    env = {**os.environ, 'DATABASE_URL': database_url, 'NODE_ENV': 'test'}
    for _ in range(2):
        migration = module.run(['pnpm', '--filter', '@a-health/database', 'exec', 'prisma', 'migrate', 'deploy'], env=env, timeout=240)
        if migration.returncode:
            raise RuntimeError('Migration rehearsal failed; no external database was contacted')
    user_id, profile_id = str(uuid.uuid4()), str(uuid.uuid4())
    cluster.sql(f"INSERT INTO users (id,phone_number,role,status,full_name,created_at,updated_at) VALUES ('{user_id}','SYNTHETIC-RESTORE','patient','active','Synthetic restore probe',now(),now())", 'ahealth_test')
    cluster.sql(f"INSERT INTO patient_profiles (id,user_id,full_name,created_at,updated_at) VALUES ('{profile_id}','{user_id}','Synthetic restore probe',now(),now())", 'ahealth_test')
    expected = cluster.sql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL', 'ahealth_test').strip()
    prefix = ['docker', 'exec', '--env', 'PGPASSWORD', cluster.container] if cluster.docker else []
    dump = 'pg_dump' if cluster.docker else str(cluster.bin / 'pg_dump')
    restore = 'pg_restore' if cluster.docker else str(cluster.bin / 'pg_restore')
    app_env = {**os.environ, 'PGPASSWORD': cluster.test_password}
    with tempfile.TemporaryDirectory(prefix='ahp-ci-restore-') as directory:
        backup = Path(directory) / 'synthetic.dump'
        with backup.open('wb') as stream:
            backup.chmod(0o600)
            dumped = subprocess.run(prefix + [dump, '-h', '127.0.0.1', '-p', str(cluster.port), '-U', 'ahealth_ci', '-d', 'ahealth_test', '--format=custom', '--no-owner', '--no-privileges'], env=app_env, stdout=stream, stderr=subprocess.PIPE, timeout=120)
        if dumped.returncode:
            raise RuntimeError('Synthetic backup could not be created')
        cluster.sql('CREATE DATABASE ahealth_test_restore OWNER ahealth_ci')
        cluster.sql('ALTER SCHEMA public OWNER TO ahealth_ci', 'ahealth_test_restore')
        restore_prefix = ['docker', 'exec', '-i', '--env', 'PGPASSWORD', cluster.container] if cluster.docker else []
        with backup.open('rb') as stream:
            restored = subprocess.run(restore_prefix + [restore, '-h', '127.0.0.1', '-p', str(cluster.port), '-U', 'ahealth_ci', '-d', 'ahealth_test_restore', '--no-owner', '--no-privileges', '--exit-on-error'], env=app_env, stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
        if restored.returncode:
            raise RuntimeError('Synthetic backup restore failed: ' + restored.stderr.decode(errors='replace'))
    actual = cluster.sql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL', 'ahealth_test_restore').strip()
    assert actual == expected, 'Restored migration history differs'
    linked = cluster.sql(f"SELECT count(*) FROM patient_profiles p JOIN users u ON u.id=p.user_id WHERE p.id='{profile_id}' AND u.id='{user_id}'", 'ahealth_test_restore').strip()
    assert linked == '1', 'Restored ownership association differs'
    owner = cluster.sql("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public'", 'ahealth_test_restore').strip()
    assert owner == 'ahealth_ci', 'Application schema ownership was not restored'
    evidence = ROOT / '.local/ci-evidence/migrations'
    evidence.mkdir(parents=True, exist_ok=True)
    result = {'database': 'disposable cluster', 'migrations_applied': int(actual), 'repeat_deploy': 'passed', 'backup_restore': 'passed', 'restored_profile_user_link': 'passed'}
    (evidence / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'Migration rehearsal passed: {actual} migrations, repeat deploy and synthetic backup/restore with ownership intact.')
finally:
    cluster.close()

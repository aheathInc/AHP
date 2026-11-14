import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import unittest
import yaml

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('hosting_config', HERE / 'configure.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


def synthetic_values():
    values = config.read_env(HERE / '.env.production.example')
    values.update({key: secrets.token_hex(32) for key in config.GENERATED})
    values.update({'AHP_WEB_HOST': 'staff.ahp-ci.test', 'AHP_API_HOST': 'api.ahp-ci.test',
                   'ACME_EMAIL': 'hosting@ahp-ci.test', 'AT_USERNAME': 'synthetic-hosting',
                   'AT_API_KEY': secrets.token_hex(32), 'SMS_SENDER_ID': 'SYNTHETIC'})
    suffix = '?sslmode=require&sslaccept=strict&sslcert=/run/config/database-ca.crt&sslrootcert=/run/config/database-ca.crt&schema=public&connection_limit=2'
    values['DATABASE_URL'] = 'postgresql://runtime:synthetic@db.ahp-ci.test:25060/ahp_hosting' + suffix
    values['MIGRATION_DATABASE_URL'] = 'postgresql://migrator:synthetic@db.ahp-ci.test:25060/ahp_hosting' + suffix
    return values


class HostingConfiguration(unittest.TestCase):
    def test_valid_configuration_has_no_network_side_effects(self):
        self.assertEqual(config.validate(synthetic_values()), [])

    def test_missing_settings_are_rejected_without_secret_disclosure(self):
        values = synthetic_values()
        private = values['JWT_SECRET']
        values['DATABASE_URL'] = 'invalid-secret-database-value'
        errors = config.validate(values)
        self.assertTrue(errors)
        self.assertNotIn(private, '\n'.join(errors))
        self.assertNotIn(values['DATABASE_URL'], '\n'.join(errors))

    def test_unsafe_databases_are_rejected(self):
        for replacement in ('sslaccept=accept_invalid_certs', 'sslmode=prefer', 'sslmode=disable', 'connection_limit=20', 'schema=private'):
            with self.subTest(replacement=replacement):
                values = synthetic_values()
                key = replacement.split('=')[0]
                current = {'sslaccept': 'sslaccept=strict', 'sslmode': 'sslmode=require', 'connection_limit': 'connection_limit=2', 'schema': 'schema=public'}[key]
                values['DATABASE_URL'] = values['DATABASE_URL'].replace(current, replacement)
                self.assertTrue(config.validate(values))
        for parameter in ('sslcert', 'sslrootcert'):
            values = synthetic_values()
            values['DATABASE_URL'] = values['DATABASE_URL'].replace('&' + parameter + '=/run/config/database-ca.crt', '')
            self.assertTrue(config.validate(values))
        values = synthetic_values()
        values['MIGRATION_DATABASE_URL'] = values['DATABASE_URL']
        self.assertTrue(config.validate(values))

    def test_public_hosts_and_independent_keys_required(self):
        for host in ('localhost', 'api.example.invalid', 'https://api.ahp-ci.test', 'api.ahp-ci.test/path', 'bad host'):
            values = synthetic_values()
            values['AHP_API_HOST'] = host
            self.assertTrue(config.validate(values))
        values = synthetic_values()
        values['JWT_SECRET'] = values['NEXTAUTH_SECRET']
        self.assertTrue(config.validate(values))

    def test_optional_profiles_fail_closed(self):
        values = synthetic_values()
        self.assertEqual(config.validate(values), [])
        self.assertTrue(config.validate(values, ['payment']))
        self.assertTrue(config.validate(values, ['ai']))

    def test_private_init_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'hosting.env'
            command = ['python3', str(HERE / 'configure.py'), 'init', '--file', str(target)]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            original = target.read_bytes()
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual(target.read_bytes(), original)
            for key in config.GENERATED:
                self.assertNotIn(config.read_env(target)[key], first.stdout + first.stderr + second.stdout + second.stderr)

    def test_compose_has_no_backend_public_ports_or_development_mounts(self):
        raw = yaml.safe_load((HERE / 'compose.yml').read_text())
        services = raw['services']
        manifest = json.loads((HERE / 'services.json').read_text())
        self.assertEqual(len(manifest), 25)
        for name in manifest:
            service = services[name]
            self.assertNotIn('ports', service)
            self.assertEqual(service['environment']['NODE_ENV'], 'production')
            self.assertTrue(service['read_only'])
            self.assertTrue(all('/repo' not in mount['target'] for mount in service.get('volumes', [])))
        self.assertNotIn('ports', services['web'])
        self.assertEqual(services['edge']['ports'], ['80:80', '443:443'])
        for name in ('ai', 'payment', 'research', 'gateway'):
            self.assertEqual(services[name]['profiles'], [name])
        self.assertNotIn('AT_API_KEY', services['web']['environment'])
        self.assertNotIn('FLW_SECRET_KEY', services['auth']['environment'])
        self.assertNotIn('JWT_SECRET', services['web']['environment'])

    def test_docker_compose_parses_without_optional_provider_keys(self):
        values = synthetic_values()
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / 'synthetic.env'
            env_path.write_text('\n'.join(f'{key}={value}' for key, value in values.items()) + '\n')
            checked = subprocess.run(['docker', 'compose', '--env-file', str(env_path), '-f', str(HERE / 'compose.yml'), 'config', '--quiet'], capture_output=True, text=True)
            self.assertEqual(checked.returncode, 0, 'Synthetic Compose validation failed; secret values withheld')


if __name__ == '__main__':
    unittest.main()

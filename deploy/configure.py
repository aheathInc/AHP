#!/usr/bin/env python3
"""Prepare/check hosting configuration without creating paid cloud resources."""
import argparse
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlsplit, parse_qs

HERE = Path(__file__).resolve().parent
GENERATED = ('JWT_SECRET', 'NEXTAUTH_SECRET', 'GATEWAY_SHARED_SECRET', 'USSD_CONTEXT_KEY')


def read_env(path):
    values = {}
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        text = raw.strip()
        if not text or text.startswith('#'):
            continue
        if '=' not in text:
            raise ValueError(f'Invalid configuration syntax on line {number}')
        key, value = text.split('=', 1)
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values:
            raise ValueError(f'Invalid or repeated configuration key on line {number}')
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def validate(values, profiles=()):
    errors = []
    def require(key):
        value = values.get(key, '')
        if not value or re.search(r'placeholder|replace|change.?me|example\.invalid', value, re.I):
            errors.append(f'{key}: a real value is required')
        return value
    for key in GENERATED:
        if not re.fullmatch(r'[a-f0-9]{64}', require(key)):
            errors.append(f'{key}: use a generated 32-byte hexadecimal secret')
    if len({values.get(key) for key in GENERATED}) != len(GENERATED):
        errors.append('Generated secrets must be independent')
    for key in ('AHP_WEB_HOST', 'AHP_API_HOST'):
        host = require(key)
        if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', host) or host.endswith(('.invalid', '.local', '.localhost')):
            errors.append(f'{key}: a public DNS hostname is required, without scheme or path')
    if values.get('AHP_WEB_HOST') == values.get('AHP_API_HOST'):
        errors.append('Web and API hostnames must be different')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', require('ACME_EMAIL')):
        errors.append('ACME_EMAIL: a certificate contact email is required')
    urls = []
    for key in ('DATABASE_URL', 'MIGRATION_DATABASE_URL'):
        value = require(key)
        try:
            url = urlsplit(value)
            query = parse_qs(url.query)
            assert url.scheme in ('postgresql', 'postgres') and url.username and url.password and url.hostname
            assert url.port and 1 <= url.port <= 65535
            if key == 'DATABASE_URL':
                assert url.username not in ('postgres', 'doadmin')
            assert re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', url.hostname)
            assert not url.hostname.endswith(('.invalid', '.local', '.localhost'))
            assert url.path not in ('', '/', '/ahealth_dev', '/ahealth_test')
            assert query.get('sslmode') == ['require']
            assert query.get('sslaccept') == ['strict']
            assert query.get('sslcert') == ['/run/config/database-ca.crt']
            assert 'uselibpqcompat' not in query
            assert query.get('sslrootcert') == ['/run/config/database-ca.crt']
            assert query.get('schema') == ['public']
            if key == 'DATABASE_URL':
                assert 1 <= int(query.get('connection_limit', ['0'])[0]) <= 4
            urls.append(url)
        except (ValueError, AssertionError):
            errors.append(f'{key}: require managed PostgreSQL, verified TLS, the mounted CA and explicit public schema; runtime pool limit 1–4')
    if len(urls) == 2:
        if (urls[0].hostname, urls[0].port, urls[0].path) != (urls[1].hostname, urls[1].port, urls[1].path):
            errors.append('Runtime and migration URLs must identify the same database')
        if urls[0].username == urls[1].username:
            errors.append('Use a separate migration database role')
    for key in ('AT_USERNAME', 'AT_API_KEY', 'SMS_SENDER_ID'):
        require(key)
    if values.get('AT_USERNAME') == 'sandbox':
        errors.append('Production SMS cannot use the sandbox username')
    if 'payment' in profiles:
        if values.get('PAYMENTS_LIVE_ENABLED') != 'true':
            errors.append('Payment profile requires separately approved PAYMENTS_LIVE_ENABLED=true')
        key = require('FLW_SECRET_KEY')
        if 'TEST' in key.upper():
            errors.append('Payment profile cannot use a test credential')
        if len(require('FLW_WEBHOOK_SECRET')) < 32:
            errors.append('FLW_WEBHOOK_SECRET: at least 32 characters required')
    if 'ai' in profiles:
        endpoint = urlsplit(require('CHAT_MODEL_ENDPOINT'))
        if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password:
            errors.append('CHAT_MODEL_ENDPOINT: use an HTTPS provider endpoint')
        require('CHAT_MODEL_KEY')
        require('CHAT_MODEL_NAME')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['init', 'check'])
    parser.add_argument('--file', type=Path, default=HERE / '.env.production')
    parser.add_argument('--profile', action='append', choices=['payment', 'ai', 'research', 'gateway'], default=[])
    args = parser.parse_args()
    if args.action == 'init':
        original = (HERE / '.env.production.example').read_text()
        for key in GENERATED:
            original = original.replace(key + '=\n', key + '=' + secrets.token_hex(32) + '\n')
        descriptor = os.open(args.file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(original)
        print('Private hosting configuration created. Secrets are not printed. Add DNS, database and live SMS settings before deployment.')
        return 0
    values = read_env(args.file)
    errors = validate(values, args.profile)
    if args.file.stat().st_mode & 0o077:
        errors.append('Configuration file must have permissions 600')
    certificate = Path(values.get('AHP_DB_CA_FILE', './database-ca.crt'))
    if not certificate.is_absolute():
        certificate = HERE / certificate
    if not certificate.is_file():
        errors.append('Managed database CA certificate is missing')
    for error in errors:
        print(error)
    if not errors:
        print('Hosting configuration checks passed; no server or database was contacted.')
    return 1 if errors else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        raise SystemExit('Hosting configuration could not be read/created. Existing files are never overwritten; secret values are not printed.') from None

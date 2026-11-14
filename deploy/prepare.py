#!/usr/bin/env python3
"""Generate the reviewed Compose and HTTPS routing from the service manifest."""
import json
from pathlib import Path
import yaml
ROOT = Path(__file__).resolve().parent
services = json.loads((ROOT / 'services.json').read_text())
common = {'NODE_ENV': 'production', 'DATABASE_URL': '${DATABASE_URL:?Configure the managed database}',
          'JWT_SECRET': '${JWT_SECRET:?Generate deployment secrets}', 'JWT_ISSUER': 'a-health', 'JWT_AUDIENCE': 'a-health-api',
          'GATEWAY_SHARED_SECRET': '${GATEWAY_SHARED_SECRET:?Generate deployment secrets}'}
urls = {name.upper() + '_SERVICE_URL': f'http://{name}:{entry["port"]}' for name, entry in services.items()}
ca = {'type': 'bind', 'source': '${AHP_DB_CA_FILE:-./database-ca.crt}', 'target': '/run/config/database-ca.crt', 'read_only': True, 'bind': {'create_host_path': False}}
base = {'image': 'ahp/backend:${AHP_IMAGE_TAG:-local}', 'build': {'context': '..', 'dockerfile': 'deploy/Dockerfile', 'target': 'backend'},
        'restart': 'unless-stopped', 'init': True, 'read_only': True, 'tmpfs': ['/tmp:size=32m,mode=1777'],
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'], 'networks': ['private'],
        'volumes': [ca], 'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}},
        'stop_grace_period': '30s'}
compose = {'name': 'ahp-hosted', 'services': {}, 'networks': {'private': {}}, 'volumes': {'caddy_data': {}, 'caddy_config': {}}}
for name, entry in services.items():
    env = {**common, **urls, 'PORT': str(entry['port']), 'HOST': '0.0.0.0'}
    if name in ('auth', 'notification'):
        env.update({'SMS_PROVIDER': 'africastalking', 'AT_ENVIRONMENT': 'live',
                    'AT_USERNAME': '${AT_USERNAME:?Configure live SMS}', 'AT_API_KEY': '${AT_API_KEY:?Configure live SMS}',
                    'SMS_SENDER_ID': '${SMS_SENDER_ID:?Configure approved sender ID}',
                    'AUTH_LOCAL_OTP_MODE': 'false', 'OTP_ECHO_IN_RESPONSE': 'false', 'OTP_LOG_TO_CONSOLE': 'false'})
    if name == 'payment':
        env.update({'MOBILE_MONEY_PROVIDER': 'flutterwave', 'FLW_ENVIRONMENT': 'live',
                    'PAYMENTS_LIVE_ENABLED': '${PAYMENTS_LIVE_ENABLED:-false}',
                    'FLW_SECRET_KEY': '${FLW_SECRET_KEY:-}',
                    'FLW_WEBHOOK_SECRET': '${FLW_WEBHOOK_SECRET:-}'})
    if name == 'ai':
        env.update({'CHAT_PROVIDER': 'openai_compatible', 'CHAT_MODEL_ENDPOINT': '${CHAT_MODEL_ENDPOINT:-}',
                    'CHAT_MODEL_KEY': '${CHAT_MODEL_KEY:-}', 'CHAT_MODEL_NAME': '${CHAT_MODEL_NAME:-}'})
    if name == 'gateway':
        env.update({'USSD_CONTEXT_KEY': '${USSD_CONTEXT_KEY:?Generate deployment secrets}', 'GATEWAY_INBOUND_SMS_ENABLED': 'false'})
    if name == 'research':
        env.update({'RESEARCH_PORTAL_ENABLED': 'false', 'RESEARCH_WAREHOUSE_ENABLED': 'false'})
    compose['services'][name] = {**base, 'working_dir': f'/repo/services/{name}',
        'command': ['node', '--import', 'tsx', 'src/index.ts'], 'environment': env,
        'healthcheck': {'test': ['CMD', 'node', '-e', f"fetch('http://127.0.0.1:{entry['port']}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                        'interval': '30s', 'timeout': '8s', 'retries': 3, 'start_period': '40s'}}
    if name in ('ai', 'payment', 'research', 'gateway'):
        compose['services'][name]['profiles'] = [name]
compose['services']['migrate'] = {**base, 'restart': 'no', 'profiles': ['operations'], 'working_dir': '/repo',
    'command': ['pnpm', '--filter', '@a-health/database', 'exec', 'prisma', 'migrate', 'deploy'],
    'environment': {'NODE_ENV': 'production', 'DATABASE_URL': '${MIGRATION_DATABASE_URL:?Configure migration database identity}'}}
compose['services']['web'] = {**base, 'image': 'ahp/web:${AHP_IMAGE_TAG:-local}',
    'build': {'context': '..', 'dockerfile': 'deploy/Dockerfile', 'target': 'web'},
    'working_dir': '/repo/apps/staff-web', 'command': ['node', 'node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', '3000'],
    'volumes': [], 'tmpfs': ['/tmp:size=32m,mode=1777', '/repo/apps/staff-web/.next/cache:uid=1000,gid=1000,size=128m'],
    'environment': {**urls, 'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1',
       'NEXTAUTH_URL': 'https://${AHP_WEB_HOST:?Choose the staff hostname}',
       'NEXTAUTH_SECRET': '${NEXTAUTH_SECRET:?Generate deployment secrets}',
       'GATEWAY_SHARED_SECRET': '${GATEWAY_SHARED_SECRET:?Generate deployment secrets}'},
    'healthcheck': {'test': ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                    'interval': '30s', 'timeout': '8s', 'retries': 3, 'start_period': '40s'}}
compose['services']['edge'] = {'image': 'caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0', 'restart': 'unless-stopped',
    'ports': ['80:80', '443:443'], 'networks': ['private'],
    'environment': {'AHP_WEB_HOST': '${AHP_WEB_HOST:?Choose the staff hostname}', 'AHP_API_HOST': '${AHP_API_HOST:?Choose the API hostname}',
                    'ACME_EMAIL': '${ACME_EMAIL:?Configure certificate contact}'},
    'volumes': ['./Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy_data:/data', 'caddy_config:/config'],
    'logging': base['logging']}
(ROOT / 'compose.yml').write_text('# Generated by python3 deploy/prepare.py; edit the generator and manifest.\n' + yaml.safe_dump(compose, sort_keys=False))
lines = ['# Generated by python3 deploy/prepare.py.', '{', '  email {$ACME_EMAIL}', '}', '',
         '{$AHP_WEB_HOST} {', '  header -Server', '  reverse_proxy web:3000', '}', '', '{$AHP_API_HOST} {', '  header -Server', '  route {']
# Overrides must precede general prefixes; matching keeps the original path.
exceptions = [
 ('pharmacy_handoff', r'^/prescriptions/[^/]+/(fulfillment|dispense-code(/revoke)?)$', 'pharmacy'),
 ('consultation_rating', r'^/consultations/[^/]+/rating$', 'quality'),
 ('thread_messages', r'^/care-threads/[^/]+/(messages|communication-consent)$', 'messaging'),
 ('patient_prescriptions', r'^/patient-profiles/[^/]+/prescriptions$', 'consultation'),
 ('patient_prevention', r'^/patient-profiles/[^/]+/.*(risk-scores|vaccinations)(/.*)?$', 'prevention'),
 ('dependents', r'^/users/me/dependents(/.*)?$', 'patient')]
for matcher, pattern, name in exceptions:
    lines += [f'    @{matcher} path_regexp {matcher} {pattern}', f'    reverse_proxy @{matcher} {name}:{services[name]["port"]}']
for name, entry in services.items():
    prefixes = entry['paths']
    if prefixes:
        paths = ' '.join(f'{prefix} {prefix}/*' for prefix in prefixes)
        lines += [f'    @{name} path {paths}', f'    reverse_proxy @{name} {name}:{entry["port"]}']
lines += ['    respond "Unknown API endpoint" 404', '  }', '}', '']
(ROOT / 'Caddyfile').write_text('\n'.join(lines))
print('Generated hosting configuration for 25 backend services, staff web and HTTPS edge.')

#!/usr/bin/env bash
# CI is version-controlled. Never replace it with a generated legacy workflow.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
from pathlib import Path
import json
import yaml
workflow = yaml.load(Path('.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader)
assert workflow['permissions'] == {'contents': 'read'}
assert 'pull_request_target' not in workflow['on']
assert set(workflow['jobs']) == {'contract-and-web', 'backend', 'flutter', 'database-rehearsal', 'quality'}
services = [name for row in workflow['jobs']['backend']['strategy']['matrix']['include'] for name in row['services'].split()]
expected = {p.parent.name for p in Path('services').glob('*/package.json')}
assert len(services) == len(set(services)), 'Duplicate backend matrix entries'
assert set(services) == expected, 'Backend matrix does not cover the service workspace'
for path in Path('.github').rglob('*.yml'):
    data = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
    assert isinstance(data, dict), str(path) + ' is not a workflow/action mapping'
print(f'CI configuration valid: {len(services)} backend services, contract/web and Flutter gates.')
PY

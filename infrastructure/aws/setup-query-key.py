"""Create the server-only query signing key once; never print or replace its value."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

aws = sys.argv[1]
if subprocess.check_output([aws, 'sts', 'get-caller-identity', '--query=Account', '--output=text'], text=True).strip() != '851725503164':
    raise SystemExit('Unexpected AWS account.')
existing = subprocess.run([aws, 'ssm', 'get-parameter', '--name=/ecoguard/g80/query-signing-key', '--query=Parameter.Name', '--output=text'], capture_output=True, text=True)
if existing.returncode == 0:
    raise SystemExit(0)
if 'ParameterNotFound' not in existing.stderr:
    raise SystemExit('Cannot check the existing signing parameter; refusing to replace it.')
descriptor, name = tempfile.mkstemp(prefix='ecoguard-query-key-', suffix='.json')
try:
    with os.fdopen(descriptor, 'w') as file:
        json.dump({'Name': '/ecoguard/g80/query-signing-key', 'Value': secrets.token_hex(32), 'Type': 'SecureString', 'Tier': 'Standard', 'Tags': [{'Key': 'Project', 'Value': 'AussieEcoGuardG80'}]}, file)
    subprocess.run([aws, 'ssm', 'put-parameter', '--cli-input-json=file://' + name, '--query=Version', '--output=text'], check=True)
finally:
    Path(name).unlink(missing_ok=True)

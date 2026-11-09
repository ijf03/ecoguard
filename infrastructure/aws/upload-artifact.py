"""Reuse immutable SHA-named deployment packages instead of uploading them each stage."""
import json
from pathlib import Path
import subprocess
import sys

aws, bucket, key, filename = sys.argv[1:]
result = subprocess.run([aws, 's3api', 'head-object', '--bucket=' + bucket, '--key=' + key, '--output=json'], capture_output=True, text=True)
if result.returncode == 0:
    if json.loads(result.stdout)['ContentLength'] != Path(filename).stat().st_size:
        raise SystemExit('Existing immutable artifact has unexpected size; refusing to replace it.')
    print('Reusing immutable artifact: ' + key)
elif '404' in result.stderr or 'Not Found' in result.stderr or 'NoSuchKey' in result.stderr:
    subprocess.run([aws, 's3', 'cp', filename, 's3://' + bucket + '/' + key, '--only-show-errors'], check=True)
else:
    raise SystemExit('Cannot verify artifact storage access; upload stopped.')

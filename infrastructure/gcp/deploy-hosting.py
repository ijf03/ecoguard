"""Build and publish only the EcoGuard static frontend using Firebase Hosting REST."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

PROJECT = 'fit3184-g80-ecoguard-dg26'
API = 'https://1ooum3ul36.execute-api.us-east-1.amazonaws.com'
root = Path(__file__).resolve().parents[2]
gcloud = os.environ.get('ECOGUARD_GCLOUD', '/opt/homebrew/share/google-cloud-sdk/bin/gcloud')
token = subprocess.check_output([gcloud, '--configuration=ecoguard-fit3184', 'auth', 'print-access-token'], env={**os.environ, 'CLOUDSDK_CORE_DISABLE_FILE_LOGGING': '1'}, text=True).strip()

def request(url, method='GET', body=None, binary=False):
    data = body if binary else None if body is None else json.dumps(body).encode()
    headers = {'Authorization': 'Bearer ' + token}
    if 'firebase' in urllib.parse.urlparse(url).hostname:
        headers['x-goog-user-project'] = PROJECT
    if data is not None:
        headers['Content-Type'] = 'application/octet-stream' if binary else 'application/json'
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw and not binary else None

if request('https://cloudbilling.googleapis.com/v1/projects/' + PROJECT + '/billingInfo').get('billingEnabled'):
    raise SystemExit('Expected the billing-disabled EcoGuard project; check the plan before deploying.')
project = request('https://firebase.googleapis.com/v1beta1/projects/' + PROJECT)
if project.get('projectId') != PROJECT or project.get('resources', {}).get('hostingSite') != PROJECT:
    raise SystemExit('Unexpected Firebase project/site.')
env = {**os.environ, 'npm_config_cache': '/private/tmp/ecoguard-npm-cache',
       'VITE_API_ORIGIN': API, 'VITE_CLOUD_UPLOADS': 'true', 'VITE_LOCAL_DEV': 'false',
       'VITE_COGNITO_USER_POOL_ID': 'us-east-1_HUV4NQ98r',
       'VITE_COGNITO_CLIENT_ID': '43n2ru3iuds0ph59ldme1adv5l'}
subprocess.run(['npm', 'run', 'build'], cwd=root / 'frontend', env=env, check=True)
base = 'https://firebasehosting.googleapis.com/v1beta1/'
csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.s3.us-east-1.amazonaws.com; media-src 'self' blob: https://*.s3.us-east-1.amazonaws.com; connect-src 'self' " + API + " https://cognito-idp.us-east-1.amazonaws.com https://*.s3.us-east-1.amazonaws.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
version = request(base + 'sites/' + PROJECT + '/versions', 'POST', {'config': {
    'rewrites': [{'glob': '**', 'path': '/index.html'}],
    'headers': [{'glob': '**', 'headers': {'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': csp}}]}})['name']
files, blobs = {}, {}
for path in (root / 'frontend/dist').rglob('*'):
    if path.is_file():
        if path.suffix in ['.map', '.env']:
            raise SystemExit('Refusing to publish source maps or environment files.')
        compressed = gzip.compress(path.read_bytes(), mtime=0)
        digest = hashlib.sha256(compressed).hexdigest()
        files['/' + path.relative_to(root / 'frontend/dist').as_posix()] = digest
        blobs[digest] = compressed
populated = request(base + version + ':populateFiles', 'POST', {'files': files})
upload_url = populated.get('uploadUrl', '')
if not upload_url.startswith('https://upload-firebasehosting.googleapis.com/'):
    raise SystemExit('Unexpected Firebase upload destination.')
for digest in populated.get('uploadRequiredHashes', []):
    request(upload_url + '/' + digest, 'POST', blobs[digest], binary=True)
request(base + version + '?update_mask=status', 'PATCH', {'status': 'FINALIZED'})
release = request(base + 'sites/' + PROJECT + '/releases?' + urllib.parse.urlencode({'versionName': version}), 'POST', {})
print(json.dumps({'url': 'https://' + PROJECT + '.web.app', 'release': release['name'], 'files': len(files), 'billingEnabled': False}))

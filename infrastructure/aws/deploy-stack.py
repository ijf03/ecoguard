"""Deploy only a native inference package with recorded Linux preflight evidence."""
import json
from pathlib import Path
import subprocess
import sys

aws, root, bucket, key, thumbnail_key, origin = sys.argv[1:]
manifest_path = Path(root) / 'backend/.build/inference-manifest.json'
if not manifest_path.exists():
    manifest_path = Path(root) / 'infrastructure/aws/verified-inference-manifest.json'
manifest = json.loads(manifest_path.read_text())
if not all(manifest.get(flag) is True for flag in ('complete', 'inferencePackageComplete', 'nativeImportPreflight')) or not manifest.get('linuxPreflightFixtures'):
    raise SystemExit('A completed, verified inference manifest is required before deployment.')
parameters = {'ArtifactBucket': bucket, 'ArtifactKey': key, 'ThumbnailArtifactKey': thumbnail_key,
              'FrontendOrigin': origin, 'InferenceArtifactKey': manifest['inferenceArtifactKey'],
              'ModelKey': manifest['modelKey'], 'ModelVersion': manifest['modelVersion'],
              'ModelSha256': manifest['modelSha256'], 'ModelIdentity': manifest['identity'],
              'ModelExporterVersion': manifest['exporterVersion']}
subprocess.run([aws, '--region=us-east-1', 'cloudformation', 'deploy',
                '--template-file=' + str(Path(root) / 'infrastructure/aws/application.json'),
                '--stack-name=ecoguard-g80-application',
                '--role-arn=arn:aws:iam::851725503164:role/LabRole',
                '--parameter-overrides', *[name + '=' + value for name, value in parameters.items()],
                '--no-fail-on-empty-changeset'], check=True)

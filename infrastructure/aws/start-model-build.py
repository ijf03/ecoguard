"""Start one bounded Fargate build. No service or continuously running compute is created."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import uuid
root = Path(__file__).resolve().parents[2]
aws_bin = os.environ.get('ECOGUARD_AWS_CLI', 'aws')
def aws(*args):
    result = subprocess.run([aws_bin, '--region=us-east-1', '--output=json', *args], text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}
if aws('sts', 'get-caller-identity')['Account'] != '851725503164':
    raise RuntimeError('Wrong AWS account')
media = 'ecoguard-g80-media-851725503164-us-east-1'
artifacts = 'ecoguard-g80-deploy-851725503164-us-east-1'
cluster = 'ecoguard-g80-build'
role = 'arn:aws:iam::851725503164:role/LabRole'
if not aws('ecs', 'describe-clusters', '--clusters', cluster).get('clusters'):
    aws('ecs', 'create-cluster', '--cluster-name', cluster, '--tags', 'key=Project,value=AussieEcoGuardG80')
log_group = '/ecs/ecoguard-g80-build'
try:
    aws('logs', 'create-log-group', '--log-group-name', log_group)
except RuntimeError as error:
    if 'ResourceAlreadyExistsException' not in str(error): raise
aws('logs', 'put-retention-policy', '--log-group-name', log_group, '--retention-in-days', '7')
stage = os.environ.get('ECOGUARD_BUILD_STAGE', 'assets')
if stage not in ['assets', 'inference']: raise RuntimeError('Invalid build stage')
source = root / ('infrastructure/aws/package-inference-runtime.py' if stage == 'inference' else 'infrastructure/aws/build-model-assets.py')
extra_env = {}
if stage == 'inference':
    asset_state = json.loads((root / 'backend/.build/model-build-state.json').read_text())
    extra_env['ECOGUARD_SOURCE_MANIFEST'] = asset_state['manifestKey']
    for variable, relative in [('ECOGUARD_HANDLER_KEY', 'backend/workers/cloud_inference.py'), ('ECOGUARD_REQUIREMENTS_KEY', 'backend/workers/inference-requirements.txt')]:
        path = root / relative; digest = hashlib.sha256(path.read_bytes()).hexdigest(); key = 'build-source/' + digest + path.suffix
        aws('s3api', 'put-object', '--bucket', artifacts, '--key', key, '--body', str(path))
        extra_env[variable] = key
source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
source_key = 'build-source/' + source_sha + '.py'
aws('s3api', 'put-object', '--bucket', artifacts, '--key', source_key, '--body', str(source))
build_id = uuid.uuid4().hex
bootstrap = "import boto3; code=boto3.client('s3').get_object(Bucket=" + repr(artifacts) + ",Key=" + repr(source_key) + ")[\"Body\"].read(); exec(compile(code, '<ecoguard-build>', 'exec'))"
request = {'family': 'ecoguard-g80-model-build', 'networkMode': 'awsvpc', 'requiresCompatibilities': ['FARGATE'],
 'cpu': '2048', 'memory': '4096', 'taskRoleArn': role, 'executionRoleArn': role,
 'runtimePlatform': {'cpuArchitecture': 'X86_64', 'operatingSystemFamily': 'LINUX'},
 'containerDefinitions': [{'name': 'builder', 'image': 'public.ecr.aws/lambda/python:3.12', 'essential': True,
  'entryPoint': ['/bin/sh', '-c'], 'command': ['python -u -c ' + shlex.quote(bootstrap)],
  'environment': [{'name': k, 'value': v} for k, v in {'ECOGUARD_MODEL_BUCKET': media, 'ECOGUARD_ARTIFACT_BUCKET': artifacts, 'ECOGUARD_BUILD_ID': build_id, **extra_env}.items()],
  'logConfiguration': {'logDriver': 'awslogs', 'options': {'awslogs-group': log_group, 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'build'}}}],
 'tags': [{'key': 'Project', 'value': 'AussieEcoGuardG80'}]}
staging = root / 'backend/.build'; staging.mkdir(exist_ok=True)
request_path = staging / 'model-build-task.json'; request_path.write_text(json.dumps(request))
task_definition = aws('ecs', 'register-task-definition', '--cli-input-json', 'file://' + str(request_path))['taskDefinition']['taskDefinitionArn']
network = {'awsvpcConfiguration': {'subnets': ['subnet-0952c7c0888a1ec60'], 'securityGroups': ['sg-05812bc67aa3bf4ac'], 'assignPublicIp': 'ENABLED'}}
result = aws('ecs', 'run-task', '--cluster', cluster, '--task-definition', task_definition, '--launch-type', 'FARGATE', '--count', '1', '--network-configuration', json.dumps(network), '--tags', 'key=Project,value=AussieEcoGuardG80')
if result.get('failures') or not result.get('tasks'):
    raise RuntimeError('Fargate build did not start: ' + json.dumps(result.get('failures')))
state = {'taskArn': result['tasks'][0]['taskArn'], 'cluster': cluster, 'buildId': build_id, 'sourceSha256': source_sha,
 'manifestKey': 'builds/' + build_id + ('/inference-manifest.json' if stage == 'inference' else '/model-manifest.json'), 'artifactBucket': artifacts, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'hardTimeoutSeconds': 840}
(staging / ('inference-build-state.json' if stage == 'inference' else 'model-build-state.json')).write_text(json.dumps(state, indent=2))
print(json.dumps(state, indent=2))

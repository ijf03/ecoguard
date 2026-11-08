#!/usr/bin/env bash
# Direct IAM-only probe. Creates no public function URL, API, listener or provisioned capacity.
set -euo pipefail
aws_bin=${ECOGUARD_AWS_CLI:-aws}
expected_account=851725503164
region=us-east-1
name=ecoguard-g80-federation-probe
root=$(cd "$(dirname "$0")/../.." && pwd)
archive="$root/backend/.build/ecoguard-runtime.zip"
role="arn:aws:iam::$expected_account:role/LabRole"
aws_call() { "$aws_bin" --region="$region" "$@"; }
actual_account=$(aws_call sts get-caller-identity --query=Account --output=text)
if [[ "$actual_account" != "$expected_account" ]]; then echo 'Wrong AWS account. Refusing deployment.' >&2; exit 1; fi
actual_role=$(aws_call iam get-role --role-name=LabRole --query=Role.Arn --output=text)
if [[ "$actual_role" != "$role" ]]; then echo 'LabRole ARN mismatch.' >&2; exit 1; fi
if [[ ! -f "$archive" ]]; then echo 'Build backend with npm run package:lambda first.' >&2; exit 1; fi
mkdir -p "$root/backend/.build"
error_file="$root/backend/.build/probe-lookup-error.txt"
if arn=$(aws_call lambda get-function-configuration --function-name="$name" --query=FunctionArn --output=text 2>"$error_file"); then
  project_tag=$(aws_call lambda list-tags --resource="$arn" --query='Tags.Project' --output=text)
  if [[ "$project_tag" != 'AussieEcoGuardG80' ]]; then echo 'Existing function lacks expected project tag. Refusing to overwrite.' >&2; exit 1; fi
  aws_call lambda update-function-code --function-name="$name" --zip-file="fileb://$archive" --query=LastUpdateStatus --output=text
  aws_call lambda wait function-updated --function-name="$name"
else
  if ! rg -q ResourceNotFoundException "$error_file"; then echo 'Cannot inspect Lambda permissions/state. Deployment stopped.' >&2; exit 1; fi
  aws_call lambda create-function --function-name="$name" --runtime=nodejs22.x --handler=dist/cloud/federation-probe.handler --role="$role" --zip-file="fileb://$archive" --timeout=45 --memory-size=256 --tags='Project=AussieEcoGuardG80,Purpose=FederationProbe' --description='IAM-only EcoGuard AWS-to-GCP metadata federation verification; synthetic fixtures only' --query=State --output=text
  aws_call lambda wait function-active --function-name="$name"
fi
response="$root/backend/.build/federation-probe-response.json"
aws_call lambda invoke --function-name="$name" --invocation-type=RequestResponse "$response" --query=StatusCode --output=text
python3 - "$response" <<'PY'
import json,sys
with open(sys.argv[1]) as source:result=json.load(source)
if result.get('ok') is not True:
 print('Federation probe failed. Inspect the ignored local response file privately; no cross-cloud success is claimed.',file=sys.stderr)
 sys.exit(1)
print(json.dumps(result,indent=2))
PY

#!/usr/bin/env bash
set -euo pipefail
aws_bin=${ECOGUARD_AWS_CLI:-aws}
region=us-east-1
account=851725503164
root=$(cd "$(dirname "$0")/../.." && pwd)
archive="$root/backend/.build/ecoguard-runtime.zip"
bucket="ecoguard-g80-deploy-$account-$region"
aws_call() { "$aws_bin" --region="$region" "$@"; }
if [[ $(aws_call sts get-caller-identity --query=Account --output=text) != "$account" ]]; then echo 'Wrong AWS account. Refusing deployment.' >&2; exit 1; fi
python3 "$root/infrastructure/aws/setup-query-key.py" "$aws_bin"
if [[ ! -f "$root/backend/.build/ecoguard-thumbnail.zip" ]]; then echo 'Package the Linux thumbnail runtime first.' >&2; exit 1; fi
if [[ ! -f "$archive" ]]; then echo 'Package backend runtime first.' >&2; exit 1; fi
mkdir -p "$root/backend/.build"
error_file="$root/backend/.build/artifact-bucket-error.txt"
if aws_call s3api head-bucket --bucket="$bucket" 2>"$error_file"; then
  tag=$(aws_call s3api get-bucket-tagging --bucket="$bucket" --query='TagSet[?Key==`Project`].Value | [0]' --output=text)
  if [[ "$tag" != AussieEcoGuardG80 ]]; then echo 'Artifact bucket lacks expected project tag. Refusing to modify it.' >&2; exit 1; fi
else
  if ! rg -q '404|Not Found|NoSuchBucket' "$error_file"; then echo 'Cannot inspect artifact bucket permissions. Deployment stopped.' >&2; exit 1; fi
  aws_call s3api create-bucket --bucket="$bucket" --query=Location --output=text
  aws_call s3api put-bucket-tagging --bucket="$bucket" --tagging='{"TagSet":[{"Key":"Project","Value":"AussieEcoGuardG80"}]}'
fi
aws_call s3api put-public-access-block --bucket="$bucket" --public-access-block-configuration=BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws_call s3api put-bucket-encryption --bucket="$bucket" --server-side-encryption-configuration='{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
digest=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
key="runtime/$digest.zip"
aws_call s3 cp "$archive" "s3://$bucket/$key" --only-show-errors
thumbnail_digest=$(shasum -a 256 "$root/backend/.build/ecoguard-thumbnail.zip" | cut -d ' ' -f 1)
thumbnail_key="thumbnail/$thumbnail_digest.zip"
aws_call s3 cp "$root/backend/.build/ecoguard-thumbnail.zip" "s3://$bucket/$thumbnail_key" --only-show-errors
python3 "$root/infrastructure/aws/deploy-stack.py" "$aws_bin" "$root" "$bucket" "$key" "$thumbnail_key" "${ECOGUARD_FRONTEND_ORIGIN:-http://127.0.0.1:5173}"
aws_call cloudformation describe-stacks --stack-name=ecoguard-g80-application --query='Stacks[0].Outputs' --output=json

#!/usr/bin/env bash
# Dedicated EcoGuard project only. No service-account private keys are created.
set -euo pipefail
project=fit3184-g80-ecoguard-dg26
project_number=342766879838
pool=ecoguard-aws
provider=learner-lab
service_account=ecoguard-aws-runtime
aws_account=${ECOGUARD_AWS_ACCOUNT_ID:?Set the verified AWS Academy account ID.}
aws_role=${ECOGUARD_AWS_ROLE:-LabRole}
gcloud_bin=${ECOGUARD_GCLOUD:-gcloud}
if [[ ! "$aws_account" =~ ^[0-9]{12}$ || ! "$aws_role" =~ ^[A-Za-z0-9_+=.@-]+$ ]]; then
  echo 'Invalid AWS account/role.' >&2; exit 1
fi
root=$(cd "$(dirname "$0")/../.." && pwd)
email="$service_account@$project.iam.gserviceaccount.com"
gcp() { "$gcloud_bin" --configuration=ecoguard-fit3184 --project="$project" --quiet "$@"; }
actual_number=$(gcp projects describe "$project" --format='value(projectNumber)')
if [[ "$actual_number" != "$project_number" ]]; then echo 'EcoGuard project number mismatch.' >&2; exit 1; fi

gcp services enable firestore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
if ! gcp firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcp firestore databases create --database='(default)' --location=us-east1 --edition=standard --type=firestore-native --delete-protection
fi
if ! gcp iam service-accounts describe "$email" >/dev/null 2>&1; then
  gcp iam service-accounts create "$service_account" --display-name='EcoGuard AWS runtime (federated)'
fi
if ! gcp iam workload-identity-pools describe "$pool" --location=global >/dev/null 2>&1; then
  gcp iam workload-identity-pools create "$pool" --location=global --display-name='EcoGuard AWS Academy'
fi
mapping="google.subject=assertion.arn,attribute.aws_role=assertion.arn.extract('assumed-role/{role}/')"
condition="assertion.account == '$aws_account' && assertion.arn.startsWith('arn:aws:sts::${aws_account}:assumed-role/${aws_role}/')"
if gcp iam workload-identity-pools providers describe "$provider" --workload-identity-pool="$pool" --location=global >/dev/null 2>&1; then
  gcp iam workload-identity-pools providers update-aws "$provider" --workload-identity-pool="$pool" --location=global --account-id="$aws_account" --attribute-mapping="$mapping" --attribute-condition="$condition"
else
  gcp iam workload-identity-pools providers create-aws "$provider" --workload-identity-pool="$pool" --location=global --account-id="$aws_account" --attribute-mapping="$mapping" --attribute-condition="$condition" --display-name='AWS LabRole only'
fi
# Only this dedicated runtime identity receives Firestore data access.
gcp projects add-iam-policy-binding "$project" --member="serviceAccount:$email" --role=roles/datastore.user --condition=None >/dev/null
# Only the named AWS role in this pool may impersonate it.
gcp iam service-accounts add-iam-policy-binding "$email" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$project_number/locations/global/workloadIdentityPools/$pool/attribute.aws_role/$aws_role" >/dev/null
gcp iam workload-identity-pools create-cred-config "projects/$project_number/locations/global/workloadIdentityPools/$pool/providers/$provider" --service-account="$email" --aws --output-file="$root/backend/config/aws-wif.json"
echo 'EcoGuard GCP metadata/federation configuration applied. Verify a real AWS runtime token exchange before claiming cross-cloud success.'

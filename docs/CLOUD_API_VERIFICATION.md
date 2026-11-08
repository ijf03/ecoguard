# Deployed API/storage stage — 8 November 2026

## Deployed and observed

- CloudFormation stack `ecoguard-g80-application` in the verified AWS Academy account, `us-east-1`.
- API Gateway HTTP API: `https://1ooum3ul36.execute-api.us-east-1.amazonaws.com`.
- API Lambda `ecoguard-g80-api`, Node.js 22, precreated Academy `LabRole`, 512 MiB/30-second timeout. No persistent listening server or SQLite is deployed.
- Private versioned media bucket, all four public-access blocks enabled, bucket-owner-enforced ownership, AES256 encryption and TLS-only policy. The separate deployment-artifact bucket is also blocked from public access and encrypted.
- Cognito JWT authorizer requires the configured app client and access-token scope. Lambda independently verifies signature/issuer/client/token use/lifetime, so forged Gateway event claims alone are not trusted. Only preflight and stateless logout are unauthenticated; neither exposes application data.
- A direct IAM-only invocation of `ecoguard-g80-federation-probe` succeeded: AWS `LabRole` -> GCP workload identity federation -> Firestore concurrent reservation/write/read. No long-lived GCP key was used, and synthetic probe collections were removed.
- The student's existing real Cognito browser session successfully synchronized and refreshed an empty owner-scoped collection through the deployed API/Firestore. The development proxy was temporarily switched for this check and restored afterward; cloud uploads are still opt-in until processing is connected.
- Requests without credentials to deployed health/collection returned 401. Browser preflight returned 204 with the exact configured origin after adding a separate unauthenticated OPTIONS route. Authorization still applies to data routes.

## Implemented contract

| Endpoint | Behaviour |
| --- | --- |
| `POST /api/uploads` | JSON filename/size/type/SHA-256/visibility; transactionally reserve per-owner media and return a five-minute signed PUT capability when upload is pending. Owner fields in input are rejected. |
| Signed S3 PUT | SHA-256, Content-Length, Content-Type and If-None-Match are bound by the signature. Existing objects cannot be overwritten using the capability. Media bytes do not pass through API Gateway/Lambda payload limits. |
| `POST /api/uploads/:id/complete` | Owner-only HEAD verification of version, size, type and S3-validated SHA-256; returns 202. It cannot fabricate validation, inference or completion. |
| Collection/detail/search | Owner-scoped collection and authorized owned/public reads; AND minimum counts, public/date lost-pet text, canonical thumbnail lookup. Paginate database candidates rather than silently limiting matches. |
| Media presentation | Allowlisted public fields only; storage/owner/lease/fencing details are omitted. Canonical URLs identify media for bulk/lookup; five-minute signed download links serve native images/videos without Cognito headers reaching S3. |
| Bulk tags | Authorize the entire transaction before changing any record. Tag updates commit an outbox event with the metadata revision. |
| Bulk delete | Tombstone the authorized batch, remove source/thumbnail versions and delete markers, finalize matching checksum reservations. Failure reports cleanupPending. See reconciliation boundary below. |
| Retry | Returns 503 without changing metadata when a processor is unconfigured. Asynchronous scheduling is prepared for the next processing stage. |
| Temporary/lost-pet image queries | Explicit 503 until the cloud inference/query worker is connected. Existing local implementations remain available in local mode. |

## Executed checks

- Local/backend suite: 32 total, 29 passed, zero failed, three external real-processing tests skipped.
- Cloud/emulator suite: nine integration tests passed, zero failures/skips. They cover the eight lifecycle scenarios plus signed-JWT API transport, forged context rejection, owner isolation, unexpected ownership fields, hidden internals, signed-upload intent, completion not implying processing, unavailable retry without mutation, mixed-owner batch rollback and preflight.
- Real AWS S3 smoke test passed: signed checksum/type/length upload, conditional duplicate PUT rejection (412), version/checksum HEAD, byte-for-byte signed retrieval and Range 206. It used a labelled synthetic PNG under a unique verification prefix and removed all its object versions afterward. Signed URLs/credentials were not logged.
- The real S3 presigner test proves checksum/type/length/overwrite headers are signed without network calls. A browser-client transport test proves hashing and token separation, accepts conditional duplicate PUT responses, and rejects unexpected storage destinations before sending bytes.
- Backend source/test type checks/build pass. Frontend production build/lint and six frontend tests pass. CloudFormation template validation and actual stack deployment/update pass.

To rerun the live storage check, build the backend, authenticate the intended Academy account and explicitly select the bucket:

```sh
ECOGUARD_ALLOW_LIVE_TESTS=1 \
ECOGUARD_LIVE_S3_BUCKET=ecoguard-g80-media-851725503164-us-east-1 \
node backend/scripts/test-s3-live.mjs
```

The script accepts only the dedicated bucket and cleans up only its random fixture key. Never put temporary AWS credentials, tokens or signed URLs in the repository or reports.

## Reproduction and remaining work

`infrastructure/aws/application.json` is native CloudFormation. `deploy-application.sh` verifies the expected account, refuses an existing artifact bucket without the project tag, uploads a checksum-named runtime archive and deploys using the permitted precreated role. `deploy-probe.sh` independently checks real federation. GCP setup is recorded in `infrastructure/gcp/bootstrap.sh`.

The Academy does not allow creating a dedicated least-privilege AWS execution role, so `LabRole` is a documented lab constraint, not a claim that AWS permissions are narrowly scoped. The GCP trust condition and data role are restricted to the dedicated project and expected AWS role. A production deployment should replace the broad Academy role with separate minimal API/processor/publisher roles.

This stage is not a complete deployed assignment. S3 event processing, full byte decoding, thumbnail/YOLO packaging, cloud video and temporary queries remain to be connected. Upload completion deliberately leaves records pending validation. Do not demonstrate cloud upload as completed inference.

Deletion tombstones survive cleanup so late worker events cannot revive media. A scheduled/event-driven reconciler for cleanup failures, late presigned uploads and late thumbnail artifacts is still required; the current cleanup method alone does not establish recovery after every interruption. Notification outbox records are not delivered emails; confirmed subscriptions/publisher and Dialogflow fulfillment/UI are still required.

Cloud frontend hosting/reverse proxy, signed-link refresh, full browser upload/query/video/delete/retry flows, realistic inference accuracy/performance, reports, official-icon architecture diagram and mandatory demo remain open. Current candidate queries traverse accessible documents and may incur growing read costs; add indexed candidate narrowing and measured scale evidence before making scalability claims.

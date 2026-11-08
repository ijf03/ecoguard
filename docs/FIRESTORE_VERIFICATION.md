# Transactional cloud metadata stage — 8 November 2026

## Implemented boundary

`backend/src/cloud/firestore-media.ts` is a server-only Firestore SDK adapter for the asynchronous cloud upload/processing workflow. It is intentionally separate from the working SQLite/local filesystem server: replacing its repository alone would leave the in-process processing queue and local deletion protocol unsafe in Lambda.

| Operation | Persisted protection |
| --- | --- |
| Reserve upload | Atomically create media plus a hash of `(verified owner, SHA-256)` as the checksum pointer. Concurrent same-owner reservations return one ID. Other owners receive independent keys and IDs. |
| Abandoned upload | After 15 minutes, a new reservation receives a new immutable key. The old media becomes a deletion tombstone; old events cannot bind to the replacement. Cleanup checks the pointer still targets its own ID before releasing it. |
| Bind source | Trusted worker supplies the actual object key, version, SHA-256, size and MIME after byte validation. Mismatch rejects; replay is a no-op; another version cannot replace an accepted source. A client checksum by itself is never validation. |
| Claim work | Transactionally issue a bounded lease with random token, source version, retry generation and model digest. A second invocation cannot claim a live lease. An expired lease can be reclaimed. |
| Publish/fail | Require the current unexpired token, source, generation and model. Late workers cannot overwrite a newer attempt or revive a deletion. Image publication requires a thumbnail. Raw exception details are not stored as processing errors. |
| Explicit retry | Owner-only; active work cannot be interrupted by retry. Advances generation, clears inferred data/errors and keeps manual tags. |
| Bulk tags/delete | Authorize the complete batch transactionally before any writes. Another user's public record is readable, never editable. |
| Delete | Atomically hide records first. Physical object/version cleanup is a separate idempotent worker responsibility. Finalize only after cleanup and retain the tombstone for event rejection. |
| Notification events | Successful inference and tag changes write an outbox event in the same transaction as the media revision. Deterministic event IDs prevent duplicate completion events. No emails are sent by this stage. |
| Search | Traverse every 100-record page of owned/public candidates; deduplicate owned public results, apply full AND/minimum counts and optional public date window. Unuploaded public reservations are not readable by other users. |

Cognito subjects must come from the existing verified token boundary. The store does not accept browser-supplied ownership as authorization. It returns internal records to trusted server code; the future API adapter must remove owner/storage/job fields from responses.

## Executed checks

Eight integration tests passed against Google's actual local Firestore emulator 1.19.8, with zero failures or skips. Tests exercise SDK transactions, concurrent reservations/claims, immutable source binding, abandoned uploads, retry generations/model checks, all-or-nothing authorization, deletion replay and 105 paginated public candidates with count/date filtering. Inference results in this suite are labelled fixtures, not actual YOLO output.

The newer Cloud SDK emulator 1.23.0 requires Java 25; the machine has Java 22. The official Firebase 1.19.8 emulator was used instead. Emulator binaries and test records are not committed. Tests use unique collection prefixes and remove only their own fixtures on completion.

Run an installed Firestore emulator on loopback, then:

```sh
cd backend
FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 npm run test:cloud
```

This separate suite fails if the emulator address is missing or is not loopback. It always uses `demo-ecoguard-g80`; it cannot silently run against the real project. The regular `npm test` continues to cover the local application separately.

The SDK is pinned to `@google-cloud/firestore@9.4.0`. A `rimraf@6.1.4` transitive override removes the vulnerable older glob/minimatch dependency chain. It requires Node 20 or 22+, consistent with this project's Node 22.13+ requirement. Install with npm 8.3+ (npm 11 verified) so overrides are honored; npm 8.1 ignores this setting. The audited lockfile reports zero known vulnerabilities with npm 11.

## Still required before cloud completion

- Verify the configured AWS-role-to-GCP federation inside Lambda. The database and GCP IAM configuration now exist (see live setup below); a local-user database check does not prove AWS exchange.
- Add API Gateway/Lambda adapters, signed S3 uploads with expected checksums/length/type, private versioned storage, source-byte validation, event triggers and packaged inference/thumbnail/video workers.
- Add transient retry/backoff/DLQ handling. The store fences attempts; it does not schedule work or provide a failure queue.
- Implement physical deletion/reconciliation, including every object version and late worker artifacts. Use lifecycle/repeated cleanup for late writes; `finishDelete` is not proof bytes were removed.
- Add video duration/sample metadata to the cloud publication contract; only existing local video processing is currently verified by the regular automated suite.
- Implement outbox publisher leases/deduplication, confirmed subscriptions, filtered email delivery and deletion-aware/access-aware notification reads. Outbox creation alone does not satisfy notifications.
- Add indexed candidate narrowing and measure realistic datasets. Current queries page all accessible candidates and perform remaining predicates server-side; they do not silently cap results, but reads grow with candidate count.
- Connect asynchronous state and signed media URLs in the frontend; validate complete deployed workflows, Dialogflow fulfillment, reports and demo.

## Live setup and metadata verification

Created the real `(default)` database in `fit3184-g80-ecoguard-dg26`, Standard / Native in `us-east1`. The API reports `freeTier: true` and `DELETE_PROTECTION_ENABLED`; project billing remains disabled. Paid PITR/backups were not enabled. The SmartPark project was not modified.

A live metadata smoke test passed twice using the existing gcloud user: concurrent same-owner reservations converged, another owner was isolated, synthetic source metadata was bound, processing was claimed, deletion fenced the stale attempt, and the record was finalized. The generated fixture collections were removed. No image/S3 object was uploaded by this test. This is actual Firestore evidence, not cross-cloud or real-inference evidence.

Reproduce after `npm run build` and selecting the dedicated named gcloud configuration:

```sh
ECOGUARD_ALLOW_LIVE_TESTS=1 \
ECOGUARD_LIVE_FIRESTORE_PROJECT=fit3184-g80-ecoguard-dg26 \
ECOGUARD_USE_GCLOUD_AUTH=1 \
npm run test:cloud:live
```

`ECOGUARD_GCLOUD` can identify the installed gcloud executable if it is absent from PATH. The test captures an existing short-lived CLI token only in memory and never prints/saves it. With `ECOGUARD_USE_GCLOUD_AUTH` omitted, the script uses ADC; independently verify its identity before claiming workload federation. An explicit opt-in and an EcoGuard project prefix prevent accidental writes to SmartPark. Cleanup is restricted to the random namespace printed for that run.

`infrastructure/gcp/bootstrap.sh` records reproducible database/API/IAM setup. Its project ID and number are fixed to EcoGuard; it requires the verified AWS account ID. The pool provider accepts only that account's `LabRole` assumed-role ARN prefix. The GCP runtime service account receives Firestore data access and only that federated role can impersonate it. The generated `backend/config/aws-wif.json` contains public configuration, not a service-account key or AWS credentials.

`cloud/federation-probe.ts` is prepared for a direct IAM-authorized Lambda invocation, not a public endpoint. It uses the explicit external-account config, performs a synthetic metadata round trip/concurrent reservation and cleans up its unique probe collections. It rejects execution outside Lambda. It has not yet been deployed or invoked; cloud identity is pending the authenticated AWS CLI connection.

Package runtime JS, public WIF config and production dependencies with npm 9+ (npm 11 verified):

```sh
cd backend
npm run package:lambda
```

The generated `.build/ecoguard-runtime.zip` excludes environment files, media, Git history and development dependencies. This is a metadata/probe package, not the Python/YOLO inference image. No listening Node server should be deployed.

After authenticating the verified AWS Academy account and packaging, deploy/invoke the private probe with `bash infrastructure/aws/deploy-probe.sh` from the repository root. `ECOGUARD_AWS_CLI` can select a task-scoped CLI wrapper. The script verifies the expected account/LabRole, refuses to overwrite a function without the EcoGuard project tag, creates no public URL or triggers, and checks the actual invocation response. Its generated response/error files stay in ignored `.build`. Do not claim federation from HTTP 200 alone: Lambda function failures can also return 200.

Packaging verification passed: the production runtime archive is 10.79 MiB compressed, with valid ZIP CRCs and no application environment/media/Git files or development TypeScript compiler. SDK emulator tests still pass after the explicit Google auth dependency change; backend source/test type checking and build pass. Dependency audit reports zero known vulnerabilities.

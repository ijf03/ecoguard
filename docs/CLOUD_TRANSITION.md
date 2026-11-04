# Cloud transition proposal - 4 November 2026

Status: design and local preparation only. No resources, policies, billing settings or deployments changed.
Account eligibility, credits and costs have not been verified. Do not apply infrastructure from this plan
until the team has explicitly approved the accounts, regions, permissions and spending limits.

## Requirement basis

Read all nine specification pages and seven rubric pages from the assignment PDFs in the parent folder.
The specification requires Cognito, at least two major providers, event-driven uploads/thumbnails/ML,
10-second video sampling, checksum deduplication, queries, bulk changes/deletion, Lex and notifications.
The rubric allocates 10 marks to authentication, 50 core features (including Lex and notifications), 20 UI,
and 20 demo/reports. Passing local tests does not establish cloud/rubric completion. Image thumbnails are
required; video posters are not. COCO's limited animal vocabulary remains an honest model limitation.

## Smallest proposed serverless target

| Component | Responsibility |
| --- | --- |
| Cognito user pool + app client | Email verification, email/given_name/family_name, registration, temporary-password challenge, login/sign-out. Hosted UI where possible; explicitly test the required challenge flow. |
| API Gateway HTTP API + JWT authorizer | Protect every application route, including health in the deployed API; use issuer/audience and access-token scopes. Only necessary sign-up/sign-in entry points are public. |
| TypeScript API Lambda | Authorize owner/public access, reserve uploads, issue narrowly scoped short-lived S3 URLs, query/update Firestore, return asynchronous processing state. No raw large-media proxy. |
| Private S3 bucket | Immutable versioned originals, generated thumbnails and versioned model weights in separate prefixes. Block public access; public sightings are application-readable records, not public bucket objects. |
| S3 ObjectCreated -> inference Lambda + thumbnail Lambda | Trigger the inference worker only on original/incoming prefix; for images it invokes a separate idempotent thumbnail Lambda before inference/publish. Both can share a container image. Never trigger recursively on thumbnails/results. Reuse Pillow/YOLO/FFmpeg as finite invocation work, not a listening inference server. |
| GCP Firestore Native database | Authoritative media metadata, owner/checksum reservations, processing leases, indexed search candidates, subscription/outbox records. This is required for application behaviour, not a decorative second-cloud health call. |
| Lambda failure destination + SQS recovery queue | Capture failed async jobs for controlled redrive after bounded retries. Do not claim exactly-once event delivery. |
| Lex V2 + fulfillment Lambda | Tag/count/lost-pet intents and slots call the same authorized query service; return clickable media links. Bind conversation to verified user identity rather than trusting supplied session owner. |
| SNS email + filtered notification publisher | Confirm subscriptions; match monitored tags against committed changes and publish through an outbox. Restrict notification contents/links to records the recipient may access. |
| Static web hosting | Existing frontend can later use S3/CloudFront. Protect application workflows through Cognito; public login assets do not grant media/API access. No unrelated frontend implementation in this audit. |

This is a proposed architecture. Inference must be packaged and benchmarked on Linux Lambda CPU before
choosing memory, timeout, ephemeral storage or concurrency. A container supports Python native libraries
and FFmpeg; Lambda's documented deployment/timeout limits are constraints, not proof this workload fits.
Keep mutable model identity/hash in configuration: fetch an explicitly versioned trusted model object once
per cold environment and validate its digest; changing that version must not require handler source edits.

API Gateway JWT authorization and Lambda limits are described by
[AWS JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
and [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).
Direct uploads avoid sending 10-50 MiB files through Lambda's synchronous payload path; media goes to S3,
metadata goes to the API. [Presigned upload behaviour](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
also means a key can be overwritten unless guarded: never rely on a URL being usable only once.

## Existing coupling and required replacements

| Current boundary | Required cloud change |
| --- | --- |
| `database/sqlite.ts`: synchronous DB, globally unique checksum, JSON documents | Firestore repository with owner-scoped transactional reservations and conditional updates; paginate/filter candidates, enforce indexes. No SQLite in ephemeral Lambda storage. |
| `storage/local.ts`: whole-file reads, UUID paths, rename journal | S3 storage with version-specific keys, signed range-capable GETs and a deletion saga. A local rename transaction cannot cross S3/Firestore. |
| `processing/thumbnail.ts`, `detector.ts`, `command.ts`, `video.ts`: local executables | Linux container or worker functions with packaged runtime/binaries, bounded /tmp workspace and invocation cancellation. No request-time weight downloads from public URLs. |
| `media/service.ts`: upload waits for processing, one in-process promise queue | Separate accept/process/publish operations, persisted job leases and revisions. Local queue is not a distributed lock. |
| `app.ts`: Node HTTP, raw byte uploads, local relative URLs | API Gateway event adapter, JSON upload-intent/status contract, signed storage links and asynchronous queries. Keep business validation outside the transport adapter. |
| `media/search.ts`: list-all filtering | Firestore paginated owner/public/date/species candidate queries; apply remaining AND/count tests server-side. Never silently truncate matches. Benchmark/index before promising scale. |
| No authenticated principal or ownerId today | Inject a verified principal at API boundary and scope every repository operation. Backfill legacy records only to an explicitly nominated owner; do not make unowned records public. |

### Ownership and access

Derive ownerId only from verified Cognito `sub`; reject owner fields supplied in JSON/headers as authority.
Owners may mutate/delete their own records. General search returns owned records plus explicitly shared
public sightings according to a defined policy; lost-pet search remains public-only and date-bounded.
Original, thumbnail, list/detail, lookup, processing, bulk changes, Lex and notification routes all need the
same policy. Resolve and authorize the complete bulk batch before changing anything. Return uniform
not-found responses for inaccessible IDs. Signed URLs have short expiry and must be reissued only after
authorization. Validate JWT signatures/issuer/audience/expiry; decoding a token is not verification.

AWS Lambda authenticates to GCP using workload identity federation restricted to its AWS account and role,
with short-lived service credentials and least-privilege Firestore IAM. Cognito remains the user identity;
Firestore access uses the federated workload identity, not a Cognito token presented as a Google token.
Do not expose Firestore directly to browsers. User authorization remains the trusted API's responsibility:
[Firestore server libraries bypass client security rules](https://firebase.google.com/docs/firestore/client/libraries).
Follow [AWS-to-GCP federation guidance](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds)
and verify the chosen Google auth library can obtain AWS Lambda environment credentials. No service-account
private key should be committed or embedded in the frontend. Demonstrate secure cross-cloud identity and
owner filtering, not simply successful networking.

### Deduplication, retries and idempotence

1. Reserve `(ownerId, sha256)` and mediaId together in a Firestore transaction. Same-owner duplicates return
   the same record; another user's checksum must not reveal their media. Bind the upload intent to expected
   size, MIME and SHA-256. Verify server-side object bytes/checksum before accepting a client digest as fact.
2. Use immutable upload keys or conditional writes plus S3 versioning, and pin a specific object version to
   the job. An expired/incomplete reservation needs a lease and safe reissue, not a permanent checksum lock.
3. A job key includes mediaId, source version and model digest. Transactionally claim a lease with an
   attempt/fencing token. Duplicate events return without duplicate results; expired leases allow retries.
   [S3 event notifications can duplicate and arrive out of order](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html).
4. Write deterministic/versioned thumbnails first, then conditionally publish detection/model/complete state
   only if source, model, attempt token and non-deleted revision still match. A stale worker must not revive
   deleted media or overwrite newer processing. Preserve manual tags independently from inferred fields.
5. Classify permanent invalid-input errors versus transient service errors; retry transients with bounded
   backoff and a DLQ/failure destination. Explicit user retry advances the attempt generation and is owner-only.
6. Delete via a persisted tombstone/saga: hide records first, remove versioned objects idempotently, then
   finalize/release the reservation. Reconcile interrupted steps. Do not promise atomic S3+Firestore deletion.
7. Commit notification outbox entries with the metadata transaction; deduplicate publisher events. SNS
   delivery is not an exactly-once email guarantee. Query-only media never enters the indexing/outbox path.

[Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions) are the proposed
consistency mechanism; none of these distributed guarantees are implemented by the existing local repository.

## Safe local configuration audit

On 4 November, checked only filenames/presence, executable names and environment variable names.
No credential values, tokens or account identifiers were printed or used to call cloud services.
No AWS config/credentials files, gcloud config/ADC, Azure config, cloud CLI executables or AWS/GCP/Azure
environment variables were found in this task environment. The existing `infastructure/aws` and
`infastructure/gcp` folders contain no files. The ignored backend `.env` contains only local processing keys.
This does NOT establish whether the team has cloud resources elsewhere. Remote state and billing remain unknown.

## Next iteration: authenticated metadata boundary, then an image round trip

The next implementation iteration should be **owner-scoped metadata with verified Cognito principals and
a Firestore repository**, first against local fakes/emulator, then against approved accounts. Leave the
current local server explicitly unauthenticated. Add an API Gateway event adapter rather than deploying it.

Acceptance criteria:

- Invalid/missing/expired/wrong-issuer/wrong-audience access tokens are rejected; verified claims become a
  typed principal. API Gateway is configured to require the intended access-token scopes, not merely any JWT.
- Alice cannot list/read/retry/tag/delete Bob's private record, even by ID/URL/checksum; authorized public
  lost-pet queries work. A mixed-owner bulk request makes no changes. Legacy records require explicit migration.
- Firestore contract tests cover atomic same-owner concurrent reservations, cross-owner checksum isolation,
  pagination/AND counts, lease races, stale completion rejection and deletion tombstones.
- Emulator/fake tests are labelled; the live cross-cloud test must show AWS role -> GCP federation -> metadata
  write/read with no long-lived keys. Without that test the adapter is not cloud-verified.
- A follow-up approved deployable slice adds upload intent -> private S3 upload -> S3-triggered Pillow/YOLO
  worker -> complete Firestore metadata -> authorized thumbnail retrieval. Replay events and retry failures.
  Only after this slice passes should videos, query uploads, Lex and notifications be deployed incrementally.

Exact prerequisites to supply/verify before any live cloud iteration:

| Area | Required identifiers and permissions |
| --- | --- |
| AWS | Chosen account ID and region; authenticated deployer/profile; evidence Cognito, IAM role creation/pass-role (or allowed precreated roles), API Gateway, Lambda, S3, ECR, logs and failure queues are permitted. Academy restrictions must be tested, not assumed away. |
| Cognito | User-pool ID/issuer, app-client ID/audience, permitted scopes, callback/logout URLs; email/given_name/family_name requirements and verified-email/temporary-password flow decisions. No client secret in a browser. |
| GCP | Project ID AND project number, Firestore Native database ID/location, approved project/API access and billing status; ability to create IAM federation provider/service identity and grant narrowly scoped database access. |
| Federation | Pool ID, provider ID, AWS role ARN/account condition, GCP service-account email and workloadIdentityUser binding; external-account config stored outside source with no private key. |
| Storage/runtime | Unique private bucket name and region, original/thumbnail/model prefixes, pinned model S3 version/digest, image repository name; Docker/Linux build capability and reviewed model/runtime licences. |
| Controls | Explicit credit/billing confirmation and team spend approval, chosen regions/data residency, max concurrency, log retention, object lifecycle, notification email recipient/consent and teardown owner/date. These are prerequisites, not changes made here. |

The credential-free [cloud configuration worksheet](./cloud-config.example.json) records these decisions.
It is deliberately disabled, incomplete, and not read by the local server or any deploy command.

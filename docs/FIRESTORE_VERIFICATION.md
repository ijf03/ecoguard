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

- Provision/configure the real database and least-privilege workload federation in the separate EcoGuard GCP project; verify AWS-role-to-GCP access. Emulator success is not evidence of live IAM, indexes, latency or cost.
- Add API Gateway/Lambda adapters, signed S3 uploads with expected checksums/length/type, private versioned storage, source-byte validation, event triggers and packaged inference/thumbnail/video workers.
- Add transient retry/backoff/DLQ handling. The store fences attempts; it does not schedule work or provide a failure queue.
- Implement physical deletion/reconciliation, including every object version and late worker artifacts. Use lifecycle/repeated cleanup for late writes; `finishDelete` is not proof bytes were removed.
- Add video duration/sample metadata to the cloud publication contract; only existing local video processing is currently verified by the regular automated suite.
- Implement outbox publisher leases/deduplication, confirmed subscriptions, filtered email delivery and deletion-aware/access-aware notification reads. Outbox creation alone does not satisfy notifications.
- Add indexed candidate narrowing and measure realistic datasets. Current queries page all accessible candidates and perform remaining predicates server-side; they do not silently cap results, but reads grow with candidate count.
- Connect asynchronous state and signed media URLs in the frontend; validate complete deployed workflows, Dialogflow fulfillment, reports and demo.

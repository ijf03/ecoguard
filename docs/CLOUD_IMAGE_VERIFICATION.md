# S3-triggered image validation and thumbnails — 8 November 2026

## Implemented and deployed

The private bucket's `incoming/` ObjectCreated events invoke `ecoguard-g80-processor`. The Node worker authenticates to Firestore using the verified AWS-to-GCP federation, resolves the matching reserved immutable source and invokes the separate `ecoguard-g80-thumbnail` Python Lambda. Thumbnail/model/build/verification prefixes do not recursively trigger indexing.

The Python runtime is packaged for Linux x86_64/Python 3.12, with pinned Pillow, boto3 and SDK dependencies. It checks the exact reserved size/type/SHA-256, fully verifies and decodes JPEG/PNG/WebP, applies EXIF orientation, rejects decompression bombs and generates a quality-75 JPEG within a 320x320 bounding box. Originals retain their exact bytes and S3 version. Thumbnail keys derive from the source version and conditional writes make repeated events idempotent.

Only validated source versions become readable by other users. Corrupt images are rejected, unbound and hidden from public reads. The client distinguishes rejected images from unavailable inference, disables unavailable originals, refreshes authorization/download links before opening a viewer and permits a fresh thumbnail URL to recover from an expired preview.

S3 worker failures receive bounded Lambda retries and an encrypted SQS failure destination. A duplicate event for an already completed/failed/rejected record does not repeatedly consume validation work. Explicit owner retry prepares a new generation. A concurrent deletion prevents thumbnail publication and triggers cleanup of late artifacts; incoming events for existing tombstones also perform cleanup.

## Executed evidence

- **Valid synthetic PNG:** an actual 1,090,411-byte, labelled 960x600 image was reserved and uploaded through a signed PUT. A real S3 notification invoked Node -> Python/Pillow -> S3 thumbnail -> federated Firestore. The resulting JPEG was smaller than its original and measured 320x200. The bound original version and real thumbnail were retrieved successfully.
- **Invalid image:** non-image bytes with a valid upload checksum were uploaded under a synthetic image reservation. The real event pipeline reached `rejected`; no source version or thumbnail was published, and another user could not read the nominally public record.
- Both live tests removed only their generated source/thumbnail versions, checksum reservations and synthetic metadata/outbox fixtures.
- Ten cloud/emulator integration tests pass, including orchestration with explicitly mocked validation: missing-model status, duplicate-event no-op, invalid rejection, video deferral, foreign bucket filtering and deletion during validation. Mock results are not real ML evidence.
- Backend source/test type checking passes. Frontend pinned build/lint pass after invalid-file and signed-link refresh changes.

Reproduce Linux packaging with the bundled or installed Python/pip:

```sh
python3 backend/scripts/package-thumbnail.py
cd backend
npm run package:lambda
```

`infrastructure/aws/deploy-application.sh` uploads both checksum-named archives and updates the native CloudFormation stack. The Python archive was verified at 41.5 MiB extracted, below the configured 240 MiB packaging guard. The build script's Linux wheel selection prevents shipping Mac native extensions to Lambda.

The live test requires explicit opt-in, the verified Academy CLI credential environment, the dedicated named gcloud user configuration and a synthetic PNG fixture:

```sh
ECOGUARD_ALLOW_LIVE_TESTS=1 \
ECOGUARD_TEST_IMAGE_PATH=/absolute/path/to/synthetic-960x600.png \
node backend/scripts/test-image-pipeline-live.mjs
```

For the rejection path, set `ECOGUARD_EXPECT_INVALID=1` and provide deliberately invalid bytes. The local test user's metadata setup is distinct from the AWS worker's real federated identity. No signed URLs or credentials are printed.

## Current limits

The thumbnail test deliberately observed `PROCESSOR_UNAVAILABLE` for detection: no model was configured, so no animal counts or complete-inference status were fabricated. A bounded Linux build is preparing configurable YOLO ONNX and FFmpeg artifacts for the next stage. Cloud video decoding/sampling and temporary/lost-pet image queries are not complete yet.

Scheduled reconciliation of expired uploads, interrupted processing and quiet-period deletion cleanup remains required. The failure queue is not a claim of automatic dead-letter redrive. Notification publishing/subscriptions, Dialogflow, production frontend hosting and complete deployed browser workflows remain outstanding. Source-code changes and completed live checks must be distinguished from every proposed integration in the report/demo.

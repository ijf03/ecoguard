# Audit and implementation log - 29 October 2026

## Initial audit
Source: existing repository at cd3aec7. Original main and origin/main agree; copied working tree was clean.
Original path is outside writable roots. Work continues in this repository copy; original left unchanged.
Remote: https://git.infotech.monash.edu/fit3184_g80/a2-aussie-ecoguard.git.
History: Initial commit; initialise repo and code; feat: initialize TypeScript Lambda backend.
Node 22.23.4, npm 10.9.9. Installed package versions match package manifests.
Existing code: React/Vite demo with Tailwind plugin; Lambda-shaped health function; logging-only health smoke script.
Empty directories: docs, shared, tests and misspelled infastructure.
No project-specific pages, storage, DB, inference, authorization, notifications, chatbot or infrastructure.
Backend initial typecheck failed (ESM/CommonJS mismatch and Lambda handler arity); npm test was a failure placeholder.
Frontend production build and oxlint pass in writable copy. Original build could not write its cache due to sandbox access.
.gitignore did not exclude .env, local media or model weights. No environment files were found.
Computer-use helper unavailable: failed to launch codex app-server: program not found.

Read all pages of local specification (9 pages) and rubric (7 pages).
Missing rubric features: Cognito and protected pages/APIs (10); upload/dedup, thumbnails/video, approved configurable ML/indexing (16);
tag/count, thumbnail, temporary-file and lost-pet queries plus Lex (24); bulk edits/deletion/notifications (10);
all application UI workflows (20); architecture/demo and reports (20).
No local feature should be described as deployed or rubric-complete before cloud integration.
Production must use at least two major clouds and Cognito. Entry ML must be MegaDetector, YOLO or Rekognition.
Reports must acknowledge AI use; students must understand and be able to modify generated code.

## Iteration 1 - Local backend foundation
Acceptance: compile; start an HTTP server; return health 200, unknown route 404 and wrong method 405 with JSON errors.
ESM fixed; original health response preserved; local Node HTTP server added without runtime framework.
Source and tests have separate TypeScript checks. Test runner is node:test through existing tsx.
Tests execute real HTTP over Windows named pipes because sandbox TCP connections return EACCES.
TCP/browser end-to-end use is not verified here. Production authentication is not implemented.
Run from backend: npm test; npm run typecheck; npm run build; npm run dev.
Health URL: http://127.0.0.1:3001/api/health. Local server binds loopback only.
Next: image upload/retrieval with storage adapter, validation and checksum deduplication.

## Iteration 2 - Local image upload
Acceptance passed: raw image POST, byte-for-byte retrieval, SHA-256 dedup including concurrent identical uploads,
MIME/signature mismatch, empty/invalid bodies, upload size limit, invalid filename/visibility, missing media and sanitized storage errors.
5 total tests pass; source/test typecheck and backend build pass.
Files: app/server, http/body, media/contracts + service, database/memory, storage/local, tests/upload.
Run: npm run dev (backend). POST image bytes to /api/media with Content-Type image/png, image/jpeg or image/webp;
X-Filename is encodeURIComponent(filename), X-Visibility private (default) or public.
201 for new media, 200 with duplicate:true for identical bytes. GET media.originalUrl returns bytes.
Limits: 10 MiB; format signatures checked, full image decoding not yet implemented. No video, thumbnail, ML or auth.
Metadata is intentionally in-memory in this iteration; restart persistence follows immediately.
Local server refuses NODE_ENV=production. Do not expose this unauthenticated development API to the Internet.
Next: SQLite persistence and metadata listing/detail APIs.

## Iteration 3 - Persistent metadata
Acceptance passed: SQLite close/reopen followed by HTTP list/detail/original retrieval and duplicate detection.
Empty list, missing record, wrong method and metadata-write rollback also pass.
8 total tests pass; source/test TypeScript checks and build pass.
Files: database/sqlite, local composition, app/server, service, tests/persistence.
Run: backend npm run dev. GET /api/media and GET /api/media/:id; originalUrl returns image bytes.
DATA_DIR defaults to backend/data when launched from backend; SQLite and originals are ignored by Git.
Node's built-in SQLite emits an experimental warning on this runtime. No third-party DB dependency is needed.
SQLite is a development adapter, not a serverless cloud database.
This is single-process local mutation coordination, not distributed object/DB transactionality.
Next: processing (approved ML runtime currently unavailable); independent search/management can proceed.

## Iteration 5a - Text/count search (independent of blocked ML)
Acceptance passed: POST /api/search {"tags":{"fox":2,"cat":1}} uses AND/minimum counts;
POST /api/search/lost-pet {"species":"cat","tags":["ginger"]} filters to public sightings within 30 days.
Optional since is an ISO timestamp. Tags normalize case/whitespace. Manual tags count as one occurrence.
Empty results, malformed JSON, invalid content types/counts/species/tags/timestamps tested.
9 total tests pass; source/test TypeScript checks and build pass.
Search tests explicitly seed species records; no real model inference has been executed.
Image query and thumbnail lookup remain incomplete. No temporary images are accepted/stored by this implementation.
Next: bulk tag editing and deletion; then processing if an existing approved runtime can be reused.

## Iteration 6a - Bulk manual tag management
Acceptance passed: POST /api/media/tags with {urls:[originalUrl,...],tags:["cat","ginger"],operation:1|0}.
Add is idempotent, normalized and deduplicated; remove ignores nonexistent tags and can remove detected species.
Entire batch is validated before changes; SQLite saveMany commits all records in one transaction.
10 total tests pass; TypeScript checks and build pass. Persistence after reopen tested.
Files: contracts, repositories, search validation, service, app, tests/tags.
Run backend npm run dev; use returned relative originalUrl values in requests (maximum 100).
No authentication or user ownership yet; local API remains loopback-only. Bulk deletion follows separately.

## Iteration 4a / 5b - Real thumbnails and original lookup
Acceptance passed with TEST_PYTHON pointing to existing A1 venv: full Pillow decode, EXIF orientation,
320x320 bounding box with preserved aspect, quality-75 compressed JPEG, corrupt image rejection,
thumbnail byte retrieval and POST /api/search/thumbnail {thumbnailUrl:...} original lookup.
11 total tests pass, zero skipped with TEST_PYTHON configured; TypeScript checks/build pass.
Files: processing/thumbnail, workers/thumbnail.py + requirements, service/contracts/app/local/server,
.env.example, tests/thumbnail. Configured ignored backend/.env locally for A1 Python reuse.
Run backend npm run dev; server loads backend/.env when launched from backend.
Set ECOGUARD_PYTHON to a Python executable with Pillow installed. Without it uploads stay signature-validated
and do not generate thumbnails. Tests skip real Pillow test unless TEST_PYTHON is set.
ML is still blocked: existing A1 model has only 'empty' and 'occupied' parking classes, unsuitable for wildlife.
Ultralytics 8.4.156 and CPU torch 2.14.0 import successfully in A1 venv; need appropriate animal model weights.
processingStatus remains pending. No event-driven/cloud ML claims. No temporary-image query implemented.

## Iteration 6b - Coordinated bulk deletion
Acceptance passed: POST /api/media/delete {urls:[originalUrl,...]} removes originals, thumbnails and metadata.
Validates all records before changes. Duplicated URLs are deduplicated. Missing resource prevents partial deletion.
Files stage into local .trash, SQLite deletes in a transaction, then staged bytes are removed.
DB failure restores bytes. Startup recovery restores staged bytes when metadata still exists, or removes them after DB commit.
cleanupPending:true indicates post-commit trash cleanup will complete at restart; deleted media is no longer indexed/served.
Single application process only; this is not a distributed cloud transaction.
14 total tests pass, none skipped with TEST_PYTHON set; TypeScript checks and build pass.
New deletion tests cover thumbnail cleanup, DB rollback, interrupted recovery and checksum reuse.
Tests use isolated writable-workspace directories because this sandbox denies rename within its virtualized temporary directory.
Files: storage/local, repositories/contracts/service/app/local/server, tests/deletion, existing async composition tests.
Next: teammate-facing typed API client and integration contract. ML still needs animal-capable weights; cloud needs billing review.

## Iteration 7a - Typed frontend client and integration handoff
Acceptance passed: client completes upload, duplicate, list/detail, bulk tags, AND search, public lost-pet search,
delete, empty results and structured error handling through real HTTP handlers plus SQLite/local storage.
Original React pages preserved for teammate contribution; only new frontend/src/api/media.ts and Vite /api proxy added.
Test compiler boundary widened for client integration; frontend erasableSyntaxOnly respected.
README replaced GitLab template; docs/API.md documents requests, responses, limits and remaining work.
Files: frontend/src/api/media, frontend/vite.config, backend/tests/client, test tsconfig, README, docs/API.
Final run: 15 tests pass, zero skipped with TEST_PYTHON set; backend typecheck/build and frontend build/lint pass.
Compiled dist/server.js starts successfully with the configured .env and binds loopback; startup test process stopped.
No browser interaction test: Computer helper unavailable and sandbox TCP connections denied.
Next: obtain animal-capable model weights; implement real detection and temporary image queries; teammate connects pages.
Then video processing and authorized serverless cloud deployment after account/free-tier/billing verification.

## State before animal detection and query/video iterations
Local backend iterations 1-3 complete; thumbnail portion of 4 complete; text/count/lost-pet/thumbnail search portions of 5 complete;
local bulk tagging/deletion portion of 6 complete; typed API client portion of 7 complete.
Not implemented: temporary query image search, video pipeline, Cognito/ownership, deployed serverless services,
secondary-cloud integration, Lex, notifications, application UI screens, assignment reports and demo preparation.
No cloud resources, billing changes, push or merge performed. Original directory remains unchanged.
All implementation commits are local in this writable repository copy. Open this copy in VS Code before continuing.
AI assistance: generated code and tests via ChatGPT/Codex; inspect and understand before submission and acknowledge in reports.

## Iteration 8 - Real local animal detection (30 October 2026)

Initial inspection: clean Git working tree; confirmed prior upload/dedup, SQLite/local storage, Pillow,
species/count/lost-pet/thumbnail search, bulk tagging/deletion and typed client in actual source.
Acceptance: existing-file YOLO adapter configured by environment; real animal counts and provenance;
completion after inference and persistence; retry without duplicate upload; manual tag preservation;
deterministic orchestration/persistence/failure/search tests and separate real inference; builds and local commit.

Implemented replaceable Detector, bounded Python worker, YOLO11n CPU COCO animal filtering, model filename,
Ultralytics version, weight checksum and confidence persistence. No A1 parking model reuse.
POST /api/media/:id/process and typed mediaApi.process retry stored originals and clear stale inference.
Manual tags survive. Failed inference returns failed metadata; no fabricated detections.
Local requests remain serialized and synchronous; model reloads per image. No cloud/background jobs.

Verified actual interpreter imports: Python 3.12.10, Ultralytics 8.4.156, torch 2.14.0+cpu, Pillow 12.3.0.
Explicitly downloaded YOLO11n and public test images into ignored backend/data. Real pipeline observed cat:2,
dog:1 and zero animals on bus image, including actual thumbnails, SQLite indexing and species search.
Deterministic tests separately cover retry, stale count replacement, retained manual tags, deduplication,
SQLite reopen and failed completion persistence. All 19 backend tests passed, zero skipped in real configured run.
Backend TypeScript checks/build and frontend build/lint pass. Python editor import diagnostics still point at
an environment without these packages; runtime imports and real worker execution succeeded in the configured venv.
Setup, sample sources, supported ten animal classes and accuracy limits documented in DETECTION.md.
No fox/cane-toad/breed/colour inference claimed. No unrelated UI edits, cloud resources, billing changes or push.

## Iteration 9 - Temporary image search

Clean initial working tree. Added validation-only Pillow mode, in-memory searchImage orchestration,
raw image HTTP endpoint and typed client method. Query counts use AND/minimum thresholds; no animals
returns no records. Deterministic tests compare storage directory contents and database records before/after
successful, empty, invalid and failed queries. Real query checks extend the existing opt-in YOLO test.
Iteration 9 checks: 20/20 tests passed with real YOLO enabled; backend typecheck/build and frontend build/lint passed.
Real temporary cat query matched the indexed cat image; bus query returned no matches; corrupt PNG rejected.
Suggested commit: feat: add temporary animal image search without persistence. No commit performed.

## Iteration 10 - Lost-pet image search

Reused temporary-image orchestration; added public-only inclusive date window and AND/manual descriptive tags.
Shared strict UTC date validation with text lost-pet queries, adding optional until while preserving since.
Deterministic fixtures cover private/old/too-new sightings, date boundaries, multiple tags, empty detections,
invalid dates/windows and missing processor. Suggested commit: feat: add public lost-pet image queries.
Iteration 10 checks: 21/21 tests passed with real query checks enabled; backend typecheck/build and frontend
build/lint passed. Later full-suite real checks also proved private/public lost-pet image filtering.

## Iteration 11 - Bounded local MP4 processing

Inspected upload/process/retrieval/storage and existing deletion adapters before extending them.
Added MP4/H.264 signature and ffprobe validation, replaceable FFmpeg adapter and explicit executable config.
Separate upload size limit defaults to 50 MiB (configuration capped at 200 MiB). Duration <=120s, <=12 frames,
source <=3840x2160. Sampling timestamps are 0,10,20... strictly before duration. Per-species maxima are
not unique-animal counts. Job deadline 180s; subprocesses bounded/cancellable; service concurrency is one.
Originals stay stored after validation/inference failures and support the existing explicit retry/dedup flow.
Legacy image metadata is compatible; videos persist type, duration, sample times, counts and model provenance.
Range GET (206/416), suffix/open ranges and HEAD support browser-compatible MP4 retrieval; no video posters.
Isolated temporary input directory is removed on success, failure and timeout; frames stay in memory.
No persistent inference server, new cloud resources, billing changes, push, merge or commits.

Executed real FFmpeg/ffprobe 8.1.1 and existing YOLO/Pillow: generated 11s cat clip, samples [0,10], cat:2
maximum; SQLite/index search verified. Corrupt MP4 retained original and removed temporary processing data.
Real image query also verified no-animal bus results and private/public lost-pet filtering.
All 24 backend tests passed with zero skipped in configured full run. Backend TypeScript checks/build,
frontend build/lint passed. Tests clearly label mock versus real processing. Documentation: API.md,
DETECTION.md and VIDEO.md. Suggested commit: feat: add bounded MP4 processing with sampled detection and range playback.

Current local backend checklist: temporary-image query, lost-pet image query and sampled MP4 processing implemented.
Not verified: interactive browser playback, real moving-wildlife accuracy, abrupt-process-crash temp cleanup.
Still pending: Cognito/ownership, cloud event/serverless adapters and secondary-cloud persistence, Lex,
notifications, frontend application screens, deployed integration, assignment reports/demo.

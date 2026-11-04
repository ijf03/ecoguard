# Executed local audit - 4 November 2026

Working tree was clean before this audit. Changes are left uncommitted for team review.
Final executed run: **27 tests passed, zero failures, zero skips** through `npm run test:real`.
Backend source/test TypeScript checks and build, plus frontend build/lint, passed. A deliberately missing
model file made the verification command fail as expected before tests. Earlier verification-fixture
environment failures were fixed with explicit dependency injection; they are not reported as passing runs.
Read the [specification](<../../FIT3184 2026 S2 A2 Spec.pdf>) (9 pages) and [rubric](../../Rubric.pdf) (7 pages).
This report describes local implementation evidence, not deployed/rubric-complete functionality.

## Checks and evidence

| Workflow | Executed evidence | Nature/limits |
| --- | --- | --- |
| Health, 404/405 and structured errors | health, upload and search HTTP tests; real TCP health in restart audit | Actual HTTP; expected statuses and sanitized errors. Range 416 is a documented empty-body protocol response. |
| Image upload, MIME/signature/size validation and retrieval | upload tests, thumbnail integration, audit regressions | Mock decoding in lifecycle unit tests; real Pillow validates full image/corrupt image separately. Local composition now fails before storage without a decoder. |
| SHA-256 and concurrent dedup | upload tests send identical HTTP requests concurrently; reopen/restart dedup tests | Actual local storage, checksum and mutation queue. Not distributed dedup. |
| SQLite persistence | repository close/reopen tests plus two distinct TCP server processes | Original bytes, media ID and checksum survive actual process restart. Restart fixture explicitly mocks decoding. |
| Thumbnail compression/aspect/original lookup | opt-in real Pillow test | Actual generated JPEG, dimensions/compression, thumbnail retrieval and original lookup. |
| YOLO species counts and provenance | opt-in real detection test | Actual YOLO11n: cat:2, dog:1, bus:{}; model name/version/hash/confidence persisted. No fox, breed or colour inference. |
| Failure/retry/manual tags | deterministic detection/video tests with injected failures and completion-write failure | Failed status persisted, no false complete, manual annotations survive and stale counts are replaced. |
| AND/minimum-count queries | search, detection and video tests | Real HTTP/SQLite with both seeded and inferred counts. |
| Temporary image search | deterministic query test and real cat/bus/corrupt-image checks | Checks database records and storage directory stay unchanged; no animals returns []. Uses bytes in memory and no thumbnails. |
| Public recent lost-pet text/image queries | deterministic date/privacy/tag fixtures and real image public/private switch | Default last 30 days; inclusive configurable since/until. User descriptions are manual tags, not inferred breed/colour. |
| Bulk tag changes | tags/client tests | Add/remove/idempotence, nonexistent-tag removal, batch validation and reopened SQLite. |
| Bulk deletion and rollback | deletion/video tests | Metadata/originals/thumbnails removed; storage rollback and startup deletion-journal recovery exercised. |
| Video validation, sampling and max counts | mock boundary tests plus actual generated 11s H.264 MP4 | Actual FFmpeg samples 0/10, actual YOLO cat:2 maximum; 20/20.01/120-second boundaries tested deterministically. Not unique-animal counting. |
| HTTP byte ranges | video HTTP tests | Closed/open/suffix ranges, 206/416, HEAD, wrong format/size/missing resource. Browser playback not tested. |
| Temporary cleanup | video tests + real invalid MP4 | Success/extraction/inference failure, per-command timeout and overall video-deadline cancellation all leave no work directory. Abrupt OS/process termination is different and not recovered. |

Real tests use Python 3.12.10, Pillow 12.3.0, Ultralytics 8.4.156, CPU torch 2.14.0+cpu and FFmpeg/ffprobe 8.1.1.
Model digest and sample source URLs are in [DETECTION.md](./DETECTION.md); video fixture is a synthetic
11-second repetition of the public cat photograph, not footage establishing moving-wildlife accuracy.

## Reproduce

From backend:

```powershell
npm test
npm run test:real
npm run typecheck
npm run build
```

From frontend: `npm run build` and `npm run lint`. Normal npm test reports missing opt-in real tests as skipped;
those skips are not inference verification. `test:real` loads `.env` and requires valid Python/model/FFmpeg
and the three public sample images. TEST_PYTHON/TEST_MODEL_PATH/TEST_IMAGE_DIR/TEST_FFMPEG/TEST_FFPROBE override
the defaults. Missing weights/dependencies exit nonzero; the command never downloads anything.
The sandbox's Node user-info failure required running tests outside the sandbox; it was not an application failure.

## Remaining limitations and unverified work

- Local HTTP is unauthenticated and loopback-only. No user ownership, Cognito, IAM or cloud access is proven.
- SQLite/local promise queue and rename journal support one local process; concurrent server processes and
  distributed dedup/transactions are unsupported. Reads and species filters load the local metadata list.
- Requests wait for subprocess processing; the model reloads per request/sample. Whole originals are read into
  memory for retrieval/ranges. Local limits are deliberate; no production throughput claim is made.
- MP4/H.264 only, <=120 seconds, <=12 samples; no video posters/transcoding. Actual interactive browser playback,
  wildlife-video accuracy and hard-crash temporary-directory recovery remain unverified/not implemented.
- Default model has ten broad animal labels; species-level invasive-pest coverage is limited. No inferred
  colour/breed or unsupported pests are claimed. Query images only are accepted by image-query endpoints.
- Lex conversational queries, tag-filtered email notifications, frontend application workflows and deployed
  integration are still required. They were not replaced with local fake endpoints.
- No cloud resources were inspected remotely, provisioned or deployed. Credits, billing and account permissions
  are unknown. See [cloud transition](./CLOUD_TRANSITION.md) for the concrete next iteration.

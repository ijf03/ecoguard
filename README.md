# Aussie EcoGuard - Group 80

Local-first FIT3184 Assignment 2 implementation with YOLO animal detection, temporary/lost-pet image queries and sampled MP4 processing. Cloud deployment, Cognito, Lex and notifications are not complete.
See [docs/PROGRESS.md](docs/PROGRESS.md) for the audit, executed checks, commits and limitations.
See [docs/API.md](docs/API.md) for the frontend integration contract.

## Run locally

Requires Node 22.13+ with built-in node:sqlite and npm. Detection/image queries require configured Python, Pillow and Ultralytics; video processing also requires FFmpeg and ffprobe.

From this repository:
~~~powershell
cd backend
npm ci
npm run dev
~~~

The API listens at http://127.0.0.1:3001/api/health.
The ignored backend/.env in this working copy points to the existing A1 Python environment for real thumbnails.
On another machine, copy backend/.env.example to backend/.env and set ECOGUARD_PYTHON.
Install backend/workers/requirements.txt into that Python environment.
Configure ECOGUARD_MODEL_PATH and ECOGUARD_CONFIDENCE for real detection; see [docs/DETECTION.md](docs/DETECTION.md).
Weights must be explicitly downloaded before use. Missing detection setup leaves stored media failed and retryable.
Without a working ECOGUARD_PYTHON/Pillow, image uploads return a structured error before storage;
validation is never silently reduced to signature checking in the local server. Validated images with missing
model setup remain stored with failed processing and can be retried. Video processing failures retain originals.
Local SQLite metadata and originals are stored in backend/data. DATA_DIR can override this.
Do not run multiple local backend processes against the same data directory.

In a second terminal:
~~~powershell
cd frontend
npm ci
npm run dev
~~~

Vite proxies /api to port 3001. The existing frontend starter has intentionally been preserved for teammate work;
the tested client is at frontend/src/api/media.ts. Application pages are not connected yet.

## Verify

~~~powershell
cd backend
npm test
npm run test:real
npm run typecheck
npm run build
~~~

To include the real Pillow integration test, set TEST_PYTHON to the same Python executable as ECOGUARD_PYTHON before npm test.
Without TEST_PYTHON, the Pillow integration test is reported as skipped.
The real detector and video tests additionally require TEST_MODEL_PATH, TEST_IMAGE_DIR and (for video)
TEST_FFMPEG/TEST_FFPROBE. Skipped tests are not real-inference verification; see [docs/VIDEO.md](docs/VIDEO.md).
Frontend: npm run build and npm run lint from frontend.
HTTP tests use named pipes on Windows because the agent sandbox blocks TCP loopback; browser interaction remains unverified.
The new restart audit also executes real TCP requests across two separate Node processes outside that sandbox.
`npm run test:real` loads local processing configuration and checks dependencies/fixtures before running
the complete suite; missing prerequisites fail instead of silently skipping. See [latest audit](docs/LOCAL_AUDIT.md).

## Deployment boundary

The Node server, SQLite and local filesystem are development adapters, not the production architecture.
Local API has no authentication or ownership enforcement and must stay loopback-only. NODE_ENV=production is rejected.
Cloud integration must add Cognito authorization, per-user access, S3 events, serverless processors,
least-privilege roles and secure secondary-cloud access. Do not deploy the local server.
No resources have been provisioned and nothing has been pushed.
The [cloud transition proposal](docs/CLOUD_TRANSITION.md) maps existing adapters to AWS/GCP and records
ownership/idempotence requirements, account prerequisites and the next iteration. It is not deployed configuration.

## Team and AI use

Frontend pages remain available for teammate contribution; the API client and contract provide integration boundaries.
Both members should own, understand and commit their contributions. Record AI assistance in the reports as required by the specification.
## Additional local workflows

`POST /api/search/image` accepts a temporary query image without storage. `POST /api/search/lost-pet/image`
adds public/date/manual-tag filters. Query counts use AND/minimum thresholds; no animals returns no matches.
`POST /api/media` also accepts MP4/H.264 videos (50 MiB default, 120 seconds maximum).
Samples at 0, 10, 20... seconds use maximum observed species counts, not unique-animal counts.
Original URLs support GET/HEAD and single HTTP byte ranges. Retry uses the existing process endpoint.
See [API examples](docs/API.md) and [video setup, limits and evidence](docs/VIDEO.md).

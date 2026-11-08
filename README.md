# Aussie EcoGuard - Group 80

Local-first FIT3184 Assignment 2 implementation with YOLO animal detection, temporary/lost-pet image queries and sampled MP4 processing. Real Cognito registration/sign-in and authenticated local API/media access are implemented. Serverless deployment, the Dialogflow chatbot and notifications remain incomplete.
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

Vite proxies /api to port 3001. The frontend now connects uploads, collection previews, full-size viewing,
video playback controls, all local query modes, retry and bulk tag/deletion workflows.
Copy frontend/.env.example to frontend/.env.local. Enable backend authentication by setting BOTH
ECOGUARD_USER_POOL_ID and ECOGUARD_CLIENT_ID in backend/.env to the same public IDs.
Use the exact frontend origin http://127.0.0.1:5173 (or configure ECOGUARD_FRONTEND_ORIGIN).
See frontend/README.md for authentication, controls and remaining cloud integration.

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
HTTP tests use named pipes on Windows and loopback TCP on this macOS development environment.
Current automated and browser evidence is recorded in docs/FRONTEND_VERIFICATION.md.
The new restart audit also executes real TCP requests across two separate Node processes outside that sandbox.
`npm run test:real` loads local processing configuration and checks dependencies/fixtures before running
the complete suite; missing prerequisites fail instead of silently skipping. See [latest audit](docs/LOCAL_AUDIT.md).

See [Firestore stage verification](docs/FIRESTORE_VERIFICATION.md) for the separate cloud metadata adapter and emulator checks.
It is not yet wired into a deployed API. Install dependencies using npm 8.3+ (npm 11 verified) to honor security overrides.

## Deployment boundary

The Node server, SQLite and local filesystem are development adapters, not the production architecture.
When configured, Cognito access tokens protect API/media access and enforce per-user ownership.
Without both Cognito IDs the local development API is unauthenticated. Keep it loopback-only.
NODE_ENV=production is rejected. Cloud integration must add S3 events, serverless processors,
least-privilege roles and secure secondary-cloud access. Do not deploy the local server.
A real Cognito user pool/client and a separate, unbilled GCP project have been created.
See docs/ASSESSMENT_CLARIFICATIONS.md for verified cloud state; there is no deployed media application yet.
The [cloud transition proposal](docs/CLOUD_TRANSITION.md) maps existing adapters to AWS/GCP and records
ownership/idempotence requirements, account prerequisites and the next iteration. It is not deployed configuration.

## Team and AI use

Frontend workflows reuse the typed API client and real Cognito SDK. Cloud media deployment remains integration work.
Both members should own, understand and commit their contributions. Record AI assistance in the reports as required by the specification.
## Additional local workflows

`POST /api/search/image` accepts a temporary query image without storage. `POST /api/search/lost-pet/image`
adds public/date/manual-tag filters. Image queries match all detected species regardless of example counts;
explicit tag/count queries use AND/minimum thresholds. No animals returns no matches.
`POST /api/media` also accepts MP4/H.264 videos (50 MiB default, 120 seconds maximum).
Samples at 0, 10, 20... seconds use maximum observed species counts, not unique-animal counts.
Original URLs support GET/HEAD and single HTTP byte ranges. Retry uses the existing process endpoint.
See [API examples](docs/API.md) and [video setup, limits and evidence](docs/VIDEO.md).

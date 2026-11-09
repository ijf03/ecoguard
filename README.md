# Aussie EcoGuard - FIT3184 G80

Live application: **https://fit3184-g80-ecoguard-dg26.web.app**

Source for the completed integration is on `feat/complete-assignment-workflows`. Preserve the teammate’s main-branch history; review the feature branch before merging. The private repository and stage commits are part of the submission evidence.

## Deployed architecture

- Firebase Hosting serves the HTTPS React frontend. Cognito handles registration, verification and sign-in.
- API Gateway and Lambda enforce verified token identity and owner/public access rules.
- Private, encrypted, versioned S3 stores originals, thumbnails and version-pinned model weights.
- Separate Lambda workers perform image validation/thumbnails, YOLO11n ONNX inference and bounded H.264 video sampling.
- GCP Firestore provides transactional metadata, deduplication reservations, leases, recovery state, subscriptions and notification outbox records.
- AWS workloads access Google APIs through restricted workload federation, without service-account keys.
- Dialogflow ES recognises natural-language species/count and lost-pet queries; the API Lambda fulfills them with real search results.
- EventBridge drives recovery and a separate SNS email publisher. Emails require explicit subscription confirmation and match watched tags.

Cloud project: `fit3184-g80-ecoguard-dg26`; AWS region: `us-east-1`. SmartPark is unrelated and is not used. The EcoGuard GCP project has no billing account linked. Do not place AWS keys, passwords or service-account keys in the repository or frontend.

## Verified behaviour

Deployed browser checks cover Cognito sign-in; image/video upload and original viewing; H.264 playback; temporary image searches; public-only lost-pet image searches; real Dialogflow fulfillment with clickable media; bulk tag addition; and SNS confirmation. Controlled live tests additionally verify actual S3-triggered inference, deduplication, count search, owner isolation, image compression, byte-range retrieval, temporary-file cleanup and matching/nonmatching alert publications. Permanent browser deletion was cancelled to preserve the four requested interview fixtures; backend cleanup/recovery tests pass.

See [model evidence](docs/CLOUD_MODEL_VERIFICATION.md), [image-query evidence](docs/CLOUD_IMAGE_QUERIES.md), [chatbot evidence](docs/CHATBOT_VERIFICATION.md), [notification evidence](docs/NOTIFICATIONS_VERIFICATION.md), and [hosting](docs/DEPLOYED_FRONTEND.md). Dated earlier stage documents record historical states and must not be read as the current feature checklist.

## Limits

The current model supports ten broad animal classes. Foxes, cane toads, breeds and colours require manual tags or replacement model configuration. Video counts are maximum observations in sampled frames, not unique animals; moving-wildlife accuracy is not established. The controlled dog video also produced a false-positive cat. Learner Lab uses its pre-existing broad LabRole; production should split permissions. Email delivery is at least once, filter changes can take up to 15 minutes, and confirmation is required.

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


## Verification and deployment

Use Node 24 (tested) and npm 9+ to honour security overrides; npm 11 is verified. The loopback Node/SQLite/filesystem server is a development adapter, not the deployed production server.

From `backend`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
Cloud integration suite: start a loopback Firestore emulator, then set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8088` and run `npm run test:cloud`.
From `frontend`: `npm ci`, `npm test`, `npm run build`, `npm run lint`.

Real local inference tests require the configured Python/Pillow/YOLO/FFmpeg prerequisites; missing prerequisites are reported as skips in the regular suite. Use `npm run test:real` to require those prerequisites instead. Real deployed checks use explicit `ECOGUARD_ALLOW_LIVE_TESTS=1` opt-in and only generated disposable fixtures; see scripts `test-model-pipeline-live.mjs` and `test-query-live.mjs`.

Package Node with `npm run package:lambda` using npm 9+. Linux thumbnail/model packaging and CloudFormation deployment are in `infrastructure/aws/`. Deployment requires the verified inference manifest from the bounded Linux build, and reuses immutable SHA-named artifacts. Set `ECOGUARD_FRONTEND_ORIGIN=https://fit3184-g80-ecoguard-dg26.web.app`. `infrastructure/gcp/deploy-hosting.py` publishes the compiled frontend after checking project identity and billing-disabled status. `setup-dialogflow.py` recreates the annotated agent configuration.

## Team and AI assistance

Dhruv Gautam (35003782) is responsible for subsequent integration/deployment work; Isabelle “Sabi” Fernan (34095756) supplied the substantial local backend foundation. The requested 70/30 split is an estimate of delivered scope for team review, not measured hours or a previously agreed percentage. Both members must understand the final implementation and demonstrate their actual contributions.

OpenAI Codex substantially assisted implementation, deployment, testing and documentation. See [AI acknowledgement](docs/AI_ASSISTANCE.md). Review personal reports in your own words; do not treat generated reflections as evidence of unreported experiences.

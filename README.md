# Aussie EcoGuard - Group 80

Local-first FIT3184 Assignment 2 implementation. Cloud deployment, Cognito, wildlife ML, Lex, notifications and video are not complete.
See [docs/PROGRESS.md](docs/PROGRESS.md) for the audit, executed checks, commits and limitations.
See [docs/API.md](docs/API.md) for the frontend integration contract.

## Run locally

Requires Node 22.13+ with built-in node:sqlite, npm, and optionally Python with Pillow.

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
Without ECOGUARD_PYTHON, uploads still work but thumbnails are not produced.
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
npm run typecheck
npm run build
~~~

To include the real Pillow integration test, set TEST_PYTHON to the same Python executable as ECOGUARD_PYTHON before npm test.
Without TEST_PYTHON, that one integration test is reported as skipped.
Frontend: npm run build and npm run lint from frontend.
HTTP tests use named pipes on Windows because the agent sandbox blocks TCP loopback; browser interaction remains unverified.

## Deployment boundary

The Node server, SQLite and local filesystem are development adapters, not the production architecture.
Local API has no authentication or ownership enforcement and must stay loopback-only. NODE_ENV=production is rejected.
Cloud integration must add Cognito authorization, per-user access, S3 events, serverless processors,
least-privilege roles and secure secondary-cloud access. Do not deploy the local server.
No resources have been provisioned and nothing has been pushed.

## Team and AI use

Frontend pages remain available for teammate contribution; the API client and contract provide integration boundaries.
Both members should own, understand and commit their contributions. Record AI assistance in the reports as required by the specification.

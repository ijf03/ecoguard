# AI assistance record

Record of assistance in this development session. This is not an individual reflection or a claim of independent student authorship.

## 8 November 2026

Codex reviewed the assignment specification, rubric, teammate checklist and source archive; reproduced the available local tests/build checks; identified and corrected species-set semantics for uploaded-image search; and drafted the connected React frontend, form validation tests, frontend documentation and verification record.

The frontend was exercised against the real local backend using generated synthetic image fixtures. Successful real YOLO/video inference and cloud deployment are not claimed. After moving development off iCloud-backed storage, the pinned frontend production build and lint passed.

Codex subsequently implemented Cognito JWT verification, owner-scoped metadata/deduplication and mutation
authorization, cookie/origin protections, legacy SQLite migration, and the real frontend Cognito/session flows.
It added automated authorization/migration/session-ordering checks and updated setup documentation.
The student entered their own registration details, verification code and password; actual sign-in reached
the protected collection. Current checks: backend 27 passed, 3 real-processing tests skipped; frontend 6 passed;
backend type checks/build and pinned frontend build/lint passed. Registration/sign-in is not evidence that
all cloud components or every authentication recovery flow have been deployed/tested.

The student must review and understand the code, validate the completed system, accurately record human contributions and adapt this acknowledgement to the required report format. Each member's personal reflection should describe their own actual experience; it has not been fabricated here.

Codex also implemented the separate Firestore transactional metadata adapter and its eight emulator integration tests, including concurrency, leases, tombstones and committed outbox records. This stage does not claim live cross-cloud deployment, email delivery or real ML inference.

Codex provisioned the dedicated free-tier Firestore database and restricted GCP federation configuration using the authorized project, implemented a reproducible live metadata smoke test and an undeployed Lambda federation probe, and prepared production dependency packaging. Local gcloud-user metadata verification passed; AWS federation is not claimed until a real Lambda test succeeds.

Codex implemented the optional browser signed-upload client, preserving canonical media identifiers and separating Cognito API authorization from direct S3 requests. A synthetic transport test verifies hashing, duplicate handling and absence of Cognito credentials on storage requests.

Codex implemented/deployed the authenticated API Gateway/Lambda adapter, private versioned S3 infrastructure and live storage verification, and corrected browser preflight authorization after a real 401 was observed. The IAM-only Lambda federation test and real Cognito browser collection refresh through Firestore passed. Current evidence is recorded in CLOUD_API_VERIFICATION.md; cloud ML/video/query/bot/email completion is not claimed.

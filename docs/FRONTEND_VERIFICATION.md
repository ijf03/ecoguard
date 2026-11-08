# Frontend verification - 8 November 2026

## Implemented

Connected the React application to the existing typed client: batch image/video upload and visibility, collection previews, original viewing and native video controls, processing status/retry, AND/count searches, temporary-image queries, thumbnail URL lookup, text/image lost-pet forms, bulk selection/tag editing and confirmed deletion. Added responsive layouts, labelled controls, status/error feedback and empty states. Real Cognito authentication was subsequently added; no chatbot, email or inference simulation was added.

## Current executed checks

After moving development to a local directory outside iCloud-backed storage:

- Backend: 30 tests, 27 passed, zero failed, three real-processing tests skipped because their external prerequisites are not configured. Source/test type checks and backend build passed.
- Frontend: six tests passed, zero failures/skips. These include form boundaries and refresh/sign-out ordering with failed cookie-clear recovery.
- The project's pinned TypeScript 7.0.2 / Vite 8.3.5 production build passed; pinned lint passed.
- Backend authorization checks use locally signed JWTs and real HTTP requests: invalid claims/signatures, two owners, scoped deduplication, private media cookies, public read-only access, mutation-batch authorization and legacy SQLite migration. These are not additional real Cognito accounts or real inference.
- Student-driven registration, emailed confirmation and real Cognito sign-in reached the protected collection showing the student's name and zero owned sightings. This also exercised real backend access-token verification and session synchronization. Live logout/recovery/temporary-password changes remain unverified.

Earlier native tool runs stalled on iCloud-offloaded dependencies. A temporary Rollup bundle was used for the earlier browser checks below; the later successful pinned build supersedes that build limitation.

## Browser checks against the real local backend

Used two locally generated, clearly labelled synthetic PNGs, one public and one private. These are UI fixtures, not animal-detection evidence. Real Pillow decoding/thumbnails worked. Missing YOLO configuration produced actual failed-processing records rather than fabricated tags/results. Manual `cat`, `ginger`, `collar` tags were then applied for retrieval checks.

| Workflow | Observed outcome |
| --- | --- |
| Upload, busy state and navigation lock | Upload form showed current file and processing state; navigation disabled during requests. |
| Saved original but failed inference | Explicit message distinguished saved media from failed automatic processing. |
| Checksum duplicate | Re-uploading the private fixture reported an existing copy; collection stayed at two records. |
| Gallery/original image | Thumbnail preview displayed; original dialog loaded the full 960x600 image and offered an original-file link. |
| Bulk add | Added `cat`, `ginger`, `collar` to both fixtures and displayed success. |
| Bulk remove | Removed `collar` and a nonexistent tag from both, safely; no error for the absent tag. |
| Explicit AND/count search | `cat >= 1 AND ginger >= 1` returned both tagged records; raising cat to 2 returned zero, since manual tags count as one. |
| Lost-pet text/public filtering | Cat plus ginger/collar returned the public fixture; private fixture was excluded. |
| Thumbnail lookup | Copied a thumbnail URL, entered it in lookup and received its corresponding media result. |
| Deletion dialog | Opened confirmation for two selected records and cancelled; records were preserved. Permanent deletion was not clicked in this browser check. |
| Retry failure | Real retry without weights failed visibly while preserving the original; no false success message. |
| Temporary-image search failure | Without a configured detector, showed a readable unavailable-processing error. Collection still contained the same two fixtures. Successful inferred matching is not claimed. |
| Mobile layout | Inspected at 390x844; content width equalled viewport width (390), with no horizontal document overflow. Navigation and one-column collection remained usable. |
| Browser errors | No warning/error console entries were observed after the verification bundle reload. |

## Still required

- Actual YOLO image-query success, real MP4/H.264 playback and processing, moving-wildlife accuracy, network-failure cases and all complete deployed browser workflows.
- Live sign-out, password recovery/temporary-password flows, a second real-user ownership check, authenticated upload/media browser checks, asynchronous cloud uploads, Dialogflow and notification subscriptions.
- Review accessible contrast/focus/keyboard behaviour across all states and supported browsers before calling the UI HD-ready.

The local server stays loopback-only. A real Cognito pool/client exists; the media backend is not deployed. Earlier teammate 27-pass/no-skip inference evidence remains historical and must not be presented as the current run. See ASSESSMENT_CLARIFICATIONS.md for the separate GCP project and deployment state.

## Subsequent cloud API/storage stage

The optional signed-upload client now passes a transport test for file hashing, direct storage token separation, conditional duplicates and destination rejection. Latest local/backend suite: 29 passed, 3 real-processing skips (32 total); cloud emulator: 9 passed; frontend: 6 passed, with pinned build/lint passing. The existing real Cognito browser session loaded the owner-scoped collection through deployed API Gateway/Lambda/Firestore during a temporary proxy check. The local proxy was restored afterward. Cloud uploads/inference/video/queries have not been browser-verified. See CLOUD_API_VERIFICATION.md for actual live S3 and federation tests.

# Aussie EcoGuard: interview and demonstration guide

Live app: https://fit3184-g80-ecoguard-dg26.web.app

Team: Dhruv Gautam (35003782), Isabelle “Sabi” Fernan (34095756).
Integration source: `feat/complete-assignment-workflows` in the private Monash GitLab repository.

## What you should be able to explain

The browser is a React interface. Cognito proves who the user is. API Gateway and the API Lambda validate the access token. S3 stores private media bytes; Firestore stores the searchable records and processing state. S3 events start separate serverless processing functions. Dialogflow understands conversational search; the API Lambda performs the authorised database search. An outbox publisher sends tag-filtered SNS email alerts. Google Workload Identity Federation lets the AWS runtime access Google APIs without a downloaded service-account key.

Do not say that SQLite is the deployed cloud database. SQLite and the local HTTP server are development adapters from the original backend foundation. The deployed application uses Firestore, API Gateway/Lambda and S3.

## Three-minute architecture presentation

**0:00–0:35 — purpose and cloud split.** “Aussie EcoGuard lets users upload wildlife and pet sightings, detect animals, search records and look for possible lost-pet sightings. Our HTTPS React frontend is on Firebase Hosting. AWS provides Cognito, API Gateway, Lambda, private S3 and SNS. Google Cloud provides Firestore and Dialogflow. These services are integrated in the running application.”

**0:35–1:20 — upload and processing.** “The API derives ownership from the verified Cognito token and reserves an owner-scoped SHA-256 checksum in a Firestore transaction. The browser uploads directly to private S3 using a short-lived URL tied to the expected checksum, size and MIME type. The S3 event invokes an orchestrator. A separate Pillow function validates images and produces compressed thumbnails. A separate CPU function runs version-pinned YOLO11n ONNX detection. Video processing uses FFmpeg and samples every ten seconds.”

**1:20–2:05 — search and privacy.** “Search requires every specified species and minimum count. Manual tags cover descriptions and unsupported classes. Temporary-image queries do not enter the gallery or media database. Lost-pet queries use public sightings and a date window. Dialogflow recognises intents and entities, then the AWS API Lambda calls the same search functions. All media access remains authorised.”

**2:05–2:40 — recovery and notifications.** “Processing leases and generation tokens prevent stale workers from overwriting newer work. Deletion and recovery use compensating operations across S3 and Firestore. Metadata changes create an outbox event. A scheduled Lambda checks watched tags and current visibility, then publishes to a confirmed SNS email subscription.”

**2:40–3:00 — limitations and ownership.** “The current model recognises ten broad animal classes; breeds, colours and pests need manual tags or replacement weights. Video counts are maximum observations, not unique animals. We acknowledge extensive Codex assistance and are responsible for understanding, verifying and explaining the submitted implementation.”

## Demonstration sequence, up to 15 minutes

| Time | Demonstrate | Evidence to point to |
|---|---|---|
| 0–2 min | Sign-in; explain registration and email verification | Cognito SDK, JWT-protected API, owner-scoped collection |
| 2–4 min | Upload a new animal image; refresh/watch status; open original | Private direct S3 upload, compressed thumbnail, detected species/count |
| 4–5 min | Upload the same bytes again | Duplicate feedback; no extra collection item |
| 5–7 min | Open the H.264 video and play it | 11-second fixture; samples at 0 and 10; maximum per-species counts |
| 7–9 min | Species/count search; example-image search | AND/minimum counts; image species-set matching; query creates no gallery entry |
| 9–10 min | Lost-pet image or text search | Only the public photo appears; private matching files remain excluded |
| 10–12 min | Select multiple owned files and edit tags | Bulk add/remove; nonexistent-tag removal is safe |
| 12–13 min | Ask EcoGuard “show me dogs” and “help me find my lost dog” | Real Dialogflow + Lambda search; clickable results; public-only lost-pet results |
| 13–14 min | Show confirmed email preferences and actual test emails | Matching upload/update alerts; negative control had no alert |
| 14–15 min | Explain deletion/recovery and limitations | Use disposable files if asked; preserve useful fixtures until the interview |

Prepare a second registered account before the interview if you want to demonstrate ownership in two browser sessions. A second account must not be able to edit another user’s media or view their private originals. Real multi-user browser sign-up was not part of the completed one-account browser run; automated ownership tests and live store checks are separate evidence.

## The four saved demo files

| File | Purpose |
|---|---|
| `demo-dog-photo.jpg` | Public positive image: one dog; thumbnail, original and lost-pet result |
| `demo-dog-11s.mp4` | Private video: playback and 0/10-second sampling; observed dog and false-positive cat |
| `demo-dog-upload-check.png` | Separate private PNG used to verify a new-upload email |
| `demo-negative-control.png` | Flat-colour image: no supported animals; no dog alert |

These are controlled test fixtures, not genuine reported animal sightings. The image originates from the official PyTorch Hub sample dog photo. The video is generated from that still image, so it proves the processing mechanics and playback rather than moving-animal accuracy. Keep all four until the interview. Local fixture copies are preserved with the working files, and a separate demo-fixture archive accompanies the handoff.

## Likely questions and truthful answers

**Why two clouds?** The assignment requires a multi-cloud application. AWS owns identity, media storage, serverless processing and notifications; GCP supplies the actual database, natural-language service and HTTPS frontend hosting. Firestore and Dialogflow are meaningful runtime dependencies.

**Why serverless?** Upload events and short API requests fit event-driven functions. There is no continuously running inference server. The trade-offs are cold starts, invocation limits, package constraints and recovery across independent services.

**How is ownership enforced?** The API verifies the token and uses its `sub` as the owner ID. The client cannot choose an owner. Mutations check the complete requested batch before changing records. Public read access never grants editing rights.

**Why an access token rather than an ID token?** The access token authorises API actions. The verifier checks `token_use=access`, the expected client ID, issuer, signature and expiry. An ID token identifies the user to the client; it is not accepted as the API bearer token.

**Can someone use the S3 URL without signing in?** A signed URL is a temporary bearer capability. The API only issues it after checking access, and it expires after five minutes. It can be used by someone who receives it until expiry; it is not equivalent to making the bucket public. Deleted object versions become unavailable even if an old signed link remains.

**How do concurrent duplicate uploads work?** A Firestore transaction owns the checksum reservation for a verified user. Contending requests converge on one media ID. Storage keys are immutable and conditional PUT prevents overwrite. Different users do not learn about each other’s private checksums.

**How do you know an uploaded file is valid?** Client MIME and checksum claims are not sufficient. Trusted workers read the actual stored version, verify its bytes, and decode images or inspect the MP4/H.264 stream. Only trusted validation binds the source version used for processing.

**What happens if the worker crashes?** Processing has a bounded lease, generation and model digest. Expired work can be retried by reconciliation. A stale worker’s result cannot commit against a new generation. Temporary query work is cleaned on success/failure, by scheduled cleanup and by a lifecycle backstop.

**Why are video counts not unique animals?** Samples can contain the same animal repeatedly. Taking the maximum count in one frame avoids summing the same animal across frames, but does not track identity or establish a total number of individuals.

**How can the model be changed?** Deployment parameters identify the private model object, immutable version, expected SHA-256 and model/exporter identity. The worker checks integrity and expects a compatible static YOLO ONNX output layout and supported class configuration. The current ten-class validator also needs compatible vocabulary configuration/code for a different species set; replacing weights alone does not magically add fox detection.

**Are image queries stored?** They are uploaded temporarily to a separate private S3 prefix so a 10 MiB query does not exceed Lambda/API request limits. They are never gallery/media database records or indexed sightings. Input versions are deleted after inference; temporary results and interrupted work expire through scheduled/lifecycle cleanup. Do not claim the bytes never touch storage.

**Why does a query image with three cats find a sighting with one cat?** Image search matches the detected species set. Minimum counts are specified by the explicit tag/count search, which is a different query mode.

**Does the model recognise breed or colour?** No. The selected model has ten broad animal classes. Descriptions such as ginger, collar or breed are manual tags; lost-pet matches are possible sightings, not identity recognition.

**Is the chatbot a regex simulation?** No. Dialogflow ES recognises annotated intents/entities and slots. The AWS Lambda then calls the actual authorised search functions. Required-slot prompts and ambiguous-count responses are handled explicitly. The teaching team approved Dialogflow instead of Lex.

**How do email filters work?** The verified Cognito email is subscribed to a dedicated SNS topic. Both the publisher and the SNS filter policy check watched tags. Private events can go only to their owner; public matches may notify other subscribed users. Confirmation is mandatory, and filter propagation can take up to 15 minutes.

**Can notifications be duplicated?** Yes. The outbox and delivery claims reduce duplicates, but standard SNS and cross-service retries are at least once. A publish success followed by a failed database commit can produce a repeated email. Do not promise exactly-once delivery.

**Is deletion one atomic transaction across AWS and GCP?** No. The authorised batch is hidden together, then storage/database cleanup uses repeatable compensating steps and a quiet-period recovery job. S3 and Firestore do not share a transaction. The backend tests cover interrupted cleanup and stale workers. The browser’s permanent-delete confirmation was cancelled at your request to retain interview fixtures.

**Where are the cross-cloud credentials?** The AWS Lambda execution role obtains temporary AWS credentials. Google Workload Identity Federation exchanges a signed AWS identity assertion and permits short-lived impersonation of the dedicated GCP runtime service account. There is no downloaded GCP service-account private key in the app.

**What is the main security limitation?** AWS Academy requires the pre-existing broad LabRole. The GCP federation provider restricts the AWS account and role, but production should also use separate minimal AWS roles. Signed URLs, account quotas and demo-oriented scan queries also need production scaling review.

**What did each person contribute?** Isabelle supplied the substantial local backend foundation. Dhruv took responsibility for the later frontend/cloud/authentication/search/chat/notification integration and submission work. The requested 70/30 split is an estimate of delivered scope for team review. State that Codex substantially assisted implementation and documentation; do not claim independent manual authorship of generated code.

## Where to look in the repository

| Concern | Main code |
|---|---|
| JWT verification | `backend/src/auth.ts` |
| Protected cloud routes | `backend/src/cloud/api.ts`, `handler.ts` |
| Metadata, reservations, leases and bulk mutations | `backend/src/cloud/firestore-media.ts` |
| Signed private object access | `backend/src/cloud/s3-media.ts` |
| Processing orchestration and recovery | `processor.ts`, `processor-handler.ts`, `recovery.ts` |
| Image/video model execution | `backend/workers/cloud_inference.py` |
| Separate thumbnail function | `backend/workers/cloud_thumbnail.py` |
| Temporary image queries | `backend/src/cloud/image-query.ts` |
| Dialogflow fulfillment | `backend/src/cloud/chat.ts`, `infrastructure/gcp/setup-dialogflow.py` |
| Notifications | `backend/src/cloud/notifications.ts`, `notification-handler.ts` |
| Frontend authentication and API transport | `frontend/src/auth-client.ts`, `frontend/src/api/media.ts` |
| UI workflows | `frontend/src/App.tsx`, `frontend/src/components/` |
| Deployed AWS resources | `infrastructure/aws/application.json` |
| Frontend hosting | `infrastructure/gcp/deploy-hosting.py` |

## Before submitting and before the interview

- Review both PDFs for accuracy. Rewrite the individual reflection personally. Confirm the estimated contribution split with Isabelle.
- Submit one team-report PDF and one individual-report PDF per student, with names and IDs. Your teammate must prepare her own individual report.
- Confirm the teaching team can access the private repository and the implementation branch/MR. Do not make it public.
- Check the Moodle submission receipt and the booked mandatory Zoom demo slot. Both members must attend.
- Start the AWS Learner Lab before the demonstration. Refresh expired CLI credentials only if deployment/diagnostics require them; never show AWS Details, passwords or tokens on screen.
- Open the app, sign in, confirm the four fixtures and email subscription, and keep an actual alert email available.
- Keep the architecture PDF and this guide available. Practise explaining the flow rather than reading code line by line.

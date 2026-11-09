# Aussie EcoGuard - team report draft

Dhruv Gautam - 35003782
Isabelle “Sabi” Fernan - 34095756

Contribution percentages: 70% (estimated) / 30% (estimated)

Aussie EcoGuard lets authenticated users upload animal photographs and short videos, manage their collections, search by species and descriptive tags, and find possible public sightings of lost pets. The deployed system spans AWS and Google Cloud. A React frontend runs on Firebase Hosting; AWS provides Cognito, API Gateway, Lambda, private S3 and SNS; Google Cloud provides Firestore, Dialogflow ES and workload federation. The architecture diagram accompanies this report.

Cognito handles registration, email verification and sign-in. API Gateway validates access tokens and the API Lambda verifies their signatures, issuer, expiry, token type and app client again. Ownership comes from the verified subject. Private records are owner-only; public sightings are readable by other authenticated users. Signed media links expire after five minutes. S3 blocks public access, uses encryption and versioning, and accepts only the configured frontend origin. The learner lab requires its pre-existing LabRole; a production deployment should replace it with separate minimal roles.

Uploads reserve an immutable owner-scoped storage key and SHA-256 checksum using a Firestore transaction. Concurrent duplicate reservations converge on one record. Media bytes go directly to private S3, avoiding API payload limits. An S3 event invokes the orchestrator. A separate Pillow Lambda validates images and creates compressed thumbnails without distorting aspect ratio; a separate CPU Lambda runs version-pinned YOLO11n ONNX inference. MP4/H.264 videos are limited to 120 seconds and sampled every ten seconds, at most twelve frames. Species counts use the maximum in a sampled frame, not the number of unique animals.

Search combines all species/count filters with AND semantics. Manual tags support descriptions and classes outside the model vocabulary. Thumbnail lookup resolves the protected original. Temporary query images use separate, expiring private objects, never gallery or database media records; workers remove input versions after inference. Image queries match the detected species set. Lost-pet text and photo queries additionally enforce public visibility and a date window. Dialogflow recognises intents and entities, while the AWS Lambda fulfills them using the same authorised search functions and returns clickable results. The teaching team approved Dialogflow as a Lex alternative in Ed discussions 206 and 289.

Firestore processing leases and generation tokens prevent stale workers from overwriting newer results. Explicit retries preserve manual tags. Bulk mutation validates the entire ownership batch first. Deletion hides the batch, removes all original/thumbnail versions, metadata, checksum reservations and notification records, and keeps a minimal temporary recovery job for late writes. Scheduled reconciliation retries interrupted operations. These are compensating operations across two clouds, rather than one distributed transaction. Notification changes create transactional outbox events. A separate scheduled Lambda checks current visibility and watched tags, then publishes to dedicated confirmed SNS email subscriptions. Delivery is at least once; duplicate email remains possible.

Open the deployed URL. Register with an accessible email, verify the code and sign in. Use separate accounts to check private ownership.

Choose Add a sighting. Upload a JPEG, PNG or WebP up to 10 MiB, or supported MP4 up to 50 MiB. Select private or public before uploading. Open Collection and inspect processing, preview and original playback. Upload identical bytes again to check duplicate feedback.

In Explore & search, combine species and minimum counts. Test a thumbnail URL and an example image. In Find a lost pet, compare public and private sightings and change the date window. Query images must not increase the collection size.

Select multiple owned files, add and remove comma-separated tags, and test a nonexistent tag safely. Delete disposable test records through the confirmation dialog.

Use Ask EcoGuard for “show me dogs”, “show two cats and one dog”, or a lost-pet request. Open a returned result. In Email alerts, subscribe to watched tags, confirm the AWS email, and upload or update a matching sighting. A non-matching upload should produce no alert.

Verification includes deployed Cognito sign-in; browser image/video upload, original retrieval and H.264 playback; species-set image and public-only lost-pet image searches; and real Dialogflow fulfillment with clickable results. Controlled live Lambda/S3/Firestore tests cover checksum deduplication, ownership, count search, compressed thumbnails, byte-range video retrieval and temporary input cleanup. The local suite has 32 passing tests and three external-runtime skips; the separate Firestore-emulator suite has twelve passing tests. SNS confirmation and successful update publications were verified; final inbox receipt and upload-filter evidence are being checked.

The model recognises ten broad animal classes. Foxes, cane toads, breeds and colours require manual tags or replacement weights. A synthetic dog-video test also produced a false-positive cat, illustrating that detections are estimates. Moving-wildlife accuracy is not established. API throttling, short-lived media links and free-plan quotas suit an assessment demonstration rather than a large production workload.

OpenAI Codex was used extensively to audit the requirements, generate and revise code, configure approved resources, run tests, troubleshoot integration and draft documentation. Students remain responsible for reviewing the submitted work, understanding the implementation and demonstrating it. Personal reflections must reflect each student’s own experience.

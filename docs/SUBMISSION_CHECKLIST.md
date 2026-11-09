# Working submission handoff — 9 November 2026

## Ready and demonstrated

- HTTPS deployed frontend: https://fit3184-g80-ecoguard-dg26.web.app
- Real Cognito registration/verification/sign-in; protected API and private media access.
- S3-triggered image validation, compressed thumbnails and real YOLO11n ONNX detection.
- MP4/H.264 upload, bounded sampling, maximum per-frame counts, original retrieval and browser playback.
- Species/count AND search, thumbnail lookup, temporary image queries and public/date-limited lost-pet searches.
- Real Dialogflow intent/entity recognition with AWS Lambda search fulfillment and clickable media results.
- Bulk tag editing and recoverable cloud deletion/reconciliation implementation.
- Confirmed SNS subscription; matching update and upload publications; no alert for the non-matching control.
- 32 backend tests pass, three local real-runtime tests are skipped; 12 cloud integration tests pass; six frontend tests pass. Separate live-cloud inference checks passed.
- Separate commits for recovery, cloud inference, hosting, temporary queries, chatbot and notifications.

## Saved for the interview

The four controlled files remain in the collection. Permanent browser deletion was cancelled after your request to keep the fixtures. Backend deletion/recovery tests passed, but do not claim a completed browser permanent-delete test. Source copies of the fixtures are included in the handoff archive. They can be uploaded again after deletion if you deliberately choose to demonstrate cleanup.

The architecture PDF uses official AWS, Google Cloud and Firebase icons. The interview guide contains a three-minute architecture script, a fifteen-minute demo sequence, likely questions, truthful limitations and code locations.

## Review before Moodle submission

1. Review the team-report PDF. The narrative is about 800 words, below the 1,000-word maximum; tables, diagram and references are excluded. It includes both names/IDs, a user guide, private repository link, architecture and AI acknowledgement.
2. The requested 70% Dhruv / 30% Isabelle split is an estimate of delivered scope. Review it with Isabelle; it is not measured working time or a previously recorded agreement.
3. Review and personally rewrite the individual-report draft. Its main body is about 300 words, below the 500-word limit. Do not submit text that does not reflect your own experience. Isabelle must prepare her own individual report.
4. Confirm actual inbox receipt of the upload/update alerts; SNS acceptance and subscription confirmation are already verified.
5. Review the latest feature-branch merge request and ensure the code you intend to submit is on the reviewed branch/main. Earlier work was merged while implementation continued, so the later commits need separate review.
6. Confirm teaching-team access to the private repository. Do not make it public.
7. Submit one team-report PDF for the team and an individual-report PDF for each member. Check the Moodle receipt.
8. Confirm the mandatory Zoom demonstration slot and that both members can attend and explain the implementation. A group-of-two arrangement, if approval is required by your class, must be confirmed with the teaching team.

## Limits to explain honestly

The model recognises ten broad animal classes; unsupported pests, breeds and colours require manual tags or compatible replacement configuration. The dog-video control produced a false-positive cat. Counts are not unique animals, and moving-wildlife accuracy is not established. Academy LabRole is broader than a production role should be. Notifications are at least once and AWS filtering changes may take up to 15 minutes. Cross-cloud cleanup uses compensating operations rather than an atomic S3/Firestore transaction.

## Keeping the project safe overnight

No inference build tasks need to run continuously. Lambda has no provisioned concurrency. S3 data/logs remain stored and scheduled recovery/notification functions run periodically, so closing Codex does not mean zero cloud cost. The EcoGuard GCP project has billing disabled. Preserve the source archive and Git history bundle; temporary AWS CLI credentials will expire and must never be committed or posted in chat.

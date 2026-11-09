# Temporary-image and lost-pet image queries

Implemented and deployed on 9 November 2026. Query images use separate private `queries/<UUID>/` S3 objects. They never create media records, checksum reservations, notification events or search-index entries. The normal gallery remains unchanged.

The protected API issues a ten-minute, owner-bound signed capability containing the image checksum, MIME type, length and validated search options. A five-minute presigned conditional upload binds those bytes. The signing key lives in a Standard SSM SecureString parameter and is never sent to the browser. The worker claims a query once, invokes real YOLO inference asynchronously, and removes every input version before publishing the private temporary result. Polling requires both Cognito authentication and a matching owner-bound query token.

Image searches require the set of detected species, with one occurrence of each, regardless of counts in the query image. Lost-pet image queries add descriptive tags with AND semantics and restrict results to public sightings within the validated date window. An image with no detected supported animals returns no matches.

Scheduled cleanup removes temporary objects older than twenty minutes in bounded batches. A prefix-specific lifecycle rule expires current and non-current versions as a backstop after interrupted workers or cleanup failures. Query results/claims exist only temporarily in S3; they are not database records.

Evidence: the live controlled upload passed actual asynchronous Lambda inference, owner-isolated polling, lost-pet option binding and immediate removal of all input versions. `backend/scripts/test-query-live.mjs` reproduces this with explicit live-test opt-in and cleans only its generated objects. A separate capability test covers tampering, mixed-owner denial, duplicate execution, input cleanup and injected storage-key rejection. The Firestore-emulator API test verifies species-set matching and excludes private media from lost-pet results. Browser verification is tracked separately.

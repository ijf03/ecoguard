# Frontend integration contract

Base /api (same origin). Vite forwards this to 127.0.0.1:3001 in development.
Import { mediaApi, ApiError, type Media } from './api/media' in frontend code.
All successful metadata responses include relative originalUrl, and thumbnailUrl when available.
The React application implements these workflows; see FRONTEND_VERIFICATION.md for executed checks.

| Method/path | Request | Result |
| --- | --- | --- |
| GET /api/health | None | status:ok |
| POST /api/media | Raw File bytes; Content-Type; URI-encoded X-Filename; X-Visibility private/public | 201 new or 200 duplicate; {media,duplicate} |
| GET /api/media | None | {media:[]} |
| GET /api/media/:id | None | {media} |
| POST /api/media/:id/process | None (or {}) | {media}; explicit retry/reprocessing of the stored original |
| GET /api/media/:id/file | Optional Range header | Original image/video bytes; 200, 206 or 416 |
| HEAD /api/media/:id/file | None | Full representation headers, no body |
| GET /api/media/:id/thumbnail | None | JPEG thumbnail, or 404 |
| POST /api/search | {"tags":{"cat":1,"ginger":1}} | {media:[]} using logical AND and minimum counts |
| POST /api/search/lost-pet | {"species":"cat","tags":["ginger"],"since":"2026-10-01T00:00:00Z"} | Recent public matches; default last 30 days |
| POST /api/search/thumbnail | {"thumbnailUrl":"/api/media/UUID/thumbnail"} | {media} including originalUrl |
| POST /api/media/tags | {"urls":["/api/media/UUID/file"],"tags":["ginger"],"operation":1} | Updated {media:[]}; 0 removes |
| POST /api/media/delete | {"urls":["/api/media/UUID/file"]} | {deleted:1,cleanupPending:false} |

JSON requests must use Content-Type: application/json. Maximum JSON body: 64 KiB.
Images: JPEG/PNG/WebP, 10 MiB. Client sends File directly; do not wrap in multipart FormData.
Local composition requires full image decoding before any permanent write. Missing Python/Pillow returns 503;
undecodable images return 422. Having a recognizable signature alone does not suffice. Missing detection weights
after successful image decoding is a separate retryable processing failure on the stored original.
No progress percentage is supplied by fetch; show an indeterminate uploading state until it settles.
Manual tags count as one occurrence. Real YOLO animal counts populate species after successful processing.
Removing a detected tag currently removes that species entry; adding a tag manually records one occurrence.
Deletion/tag edits validate every referenced record before modifying a batch (maximum 100 unique inputs).
Tags normalize case and whitespace (maximum 32 tags, 80 characters each).
Use returned relative URLs; arbitrary external URLs are rejected.

Errors: {error:{code:"INVALID_QUERY",message:"..."}} with 400/404/405/413/415/422/500/503.
ApiError exposes status, code and message. Missing records and unavailable thumbnails return 404.
When cleanupPending is true, records are deleted and staged byte cleanup will finish on backend restart.

## Teammate implementation boundary

Use mediaApi.list/upload/process/search/lostPet/fromThumbnail/editTags/delete for feature pages.
Build independent UploadForm, MediaGallery/Preview, SearchForm and BulkActions components.
Catch ApiError, show loading/empty/error states, refresh results after mutations, and clear selection after deletion.
Use thumbnailUrl ?? originalUrl for image previews. Display processingStatus honestly: pending is not a detected animal result.
The real Cognito frontend connects to configured backend authentication. See the authentication section below.

## Remaining integration work

S3 upload events; serverless processors and a cloud database;
Dialogflow intents/fulfillment and clickable results; filtered notifications; reports and mandatory demo.
Existing A1 weights classify only empty/occupied parking spots and cannot supply wildlife tags.

## Detection processing contract

Local upload waits for thumbnail generation, inference and indexing. A stored upload can return 201 with
`processingStatus:failed`; 201 confirms storage, so callers must inspect processingStatus.
Duplicate upload returns 200 and the existing status without processing. POST process returns 200 with
either complete or failed metadata; missing IDs return 404 and other methods 405. Fix configuration then retry.
The typed client exposes process(id), used by the frontend retry control.

Complete metadata includes `species:{cat:2}` (or `{}` for no animals) and
`detectionModel:{identity,version,weightsSha256,confidence}`. Failure includes a sanitized processingError.
Reprocessing clears old inferred counts/model identity and keeps manualTags. Complete is persisted only after
inference succeeds. Pending can mean interrupted processing; explicit retry is safe. Processing and other
mutations are serialized in this local server. Worker timeout is 120 seconds.

Supported animal labels: bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe.
No fox, cane-toad, breed or colour inference. See [DETECTION.md](./DETECTION.md) for setup, limits and real test evidence.

## Temporary image query

POST /api/search/image with raw JPEG/PNG/WebP bytes and matching Content-Type (10 MiB maximum).
Returns {media:[]} using the same metadata representation as text search. Each detected species must
occur at least once in a match, combined with AND. Query-image instance counts are not minimum
thresholds; explicit count constraints belong to POST /api/search. No animals means no matches.
Requires configured Pillow validation and YOLO; unavailable processing returns a structured error.
The query is decoded and inferred in memory, never stored/indexed and never thumbnailed.
Typed client: mediaApi.searchImage(file). With authentication enabled, general searches include owned and public sightings.

## Lost-pet image query

POST /api/search/lost-pet/image?tag=ginger&tag=collar&since=2026-10-01T00:00:00Z&until=2026-10-30T00:00:00Z
with raw image bytes and matching Content-Type. Same 10 MiB/decoding safeguards and {media:[]} response.
Detected species use AND with at least one occurrence each. Optional repeated tag parameters must all occur in manualTags
(maximum 31 descriptive tags). These descriptions are supplied by users, not inferred breed or colour.
Only public records with createdAt inclusively between since and until can match. Both lost-pet endpoints
accept valid UTC ISO timestamps ending in Z; default since is now minus 30 days and until is now.
Reversed/invalid windows return 400. Text lost-pet JSON also accepts until. No animals always returns [].
Typed client: mediaApi.lostPetImage(file, {tags:['ginger'], since, until}).

## Video upload and playback

POST /api/media accepts raw MP4/H.264 bytes with Content-Type: video/mp4 and the existing filename/visibility
headers. Separate limit: ECOGUARD_MAX_VIDEO_BYTES (50 MiB default, configurable up to 200 MiB). Maximum duration
120 seconds, one H.264 video stream, source resolution at most 3840x2160. See VIDEO.md for accepted MP4 brands.
201 indicates stored, even if processingStatus is failed; check processingError and retry the stored original.
Duplicate 200 never automatically retries. Video media adds mediaType:'video', duration and sampledAt after
successful processing, with existing species/detectionModel/storage fields. Old image metadata stays readable.
Samples at 0,10,20... strictly before duration use per-species maximum counts, not a unique-animal count.
Videos participate in all existing searches, tags, deletion and explicit processing retries. No video posters.

GET originalUrl supports Range: bytes=0-1023, bytes=1024- and bytes=-1024 (206). Invalid/multiple ranges return
416 with Content-Range: bytes */SIZE. HEAD returns full representation headers. Video responses use video/mp4.
The existing typed upload method accepts video Files. With authentication enabled, originals/thumbnails require a verified bearer token or session cookie and permit only owned or public media.

Examples from backend (replace UUID with the returned media.id):

```powershell
curl.exe -X POST http://127.0.0.1:3001/api/search/image -H "Content-Type: image/jpeg" --data-binary "@data/inference-samples/cats.jpg"
curl.exe -X POST "http://127.0.0.1:3001/api/search/lost-pet/image?tag=collar&since=2026-10-01T00:00:00Z" -H "Content-Type: image/jpeg" --data-binary "@data/inference-samples/cats.jpg"
curl.exe -X POST http://127.0.0.1:3001/api/media -H "Content-Type: video/mp4" -H "X-Filename: cats.mp4" --data-binary "@cats.mp4"
curl.exe http://127.0.0.1:3001/api/media/UUID/file -H "Range: bytes=0-1023" -o first-kib.bin
```

Processing executables, deadlines, cleanup guarantees, test evidence and limitations: [VIDEO.md](./VIDEO.md).

## Authentication and ownership

Set both `ECOGUARD_USER_POOL_ID` and `ECOGUARD_CLIENT_ID` to enable authentication; configuring only one fails startup. Without either, the loopback development adapter remains unauthenticated. All API routes are protected when enabled, including health and media bytes. The backend verifies RS256 signatures/JWKS, issuer, app client, access-token use and lifetime. Ownership comes exclusively from the verified subject, never request headers or bodies.

- `POST /api/auth/session`: verified bearer access token establishes an HttpOnly, SameSite=Strict cookie for native media requests. Cookie lifetime cannot exceed token expiry; HTTPS cookies use Secure.
- `DELETE /api/auth/session`: clears the cookie, including after token expiry. Mutations enforce the configured frontend Origin when an Origin header is supplied.
- Collection lists owned records only. General search/read allows owned or public records; lost-pet search remains public/date-restricted.
- Metadata exposes `canEdit`, hides internal owner/storage identifiers, and permits retry/tag/delete only for owned records. Whole mutation batches are authorized before writing.
- Checksums are unique per owner. Identical files owned by different users have independent storage keys. Legacy SQLite records remain unowned and are not automatically assigned to a new user.
- Unauthenticated requests return 401; forbidden origins/operations return 403 or conceal unavailable records as 404, as applicable. Frontend transport attaches bearer tokens and synchronizes cookies without placing tokens in media URLs.

## Audit and cloud boundary

See FRONTEND_VERIFICATION.md for current automated/browser checks and LOCAL_AUDIT.md for historical inference evidence. Cognito is real, but SQLite, filesystem storage and the loopback Node server are development adapters. CLOUD_TRANSITION.md is an earlier proposal, not deployed configuration. S3/serverless/cloud-database/chatbot/notification integration remains incomplete.

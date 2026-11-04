# Frontend integration contract

Base /api (same origin). Vite forwards this to 127.0.0.1:3001 in development.
Import { mediaApi, ApiError, type Media } from './api/media' in frontend code.
All successful metadata responses include relative originalUrl, and thumbnailUrl when available.
The default frontend page remains the inspected Vite starter; it is not an application UI yet.

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
Authentication UI must connect to Cognito later; do not create a fake login or imply this local API is protected.
No browser UI workflow has been verified by the agent. Typed client workflows are tested over real local HTTP.

## Remaining integration work

Cognito and ownership enforcement; S3 upload events; serverless processors and database on a secondary cloud;
Lex intents/fulfillment and clickable results; filtered notifications; reports and mandatory demo.
Existing A1 weights classify only empty/occupied parking spots and cannot supply wildlife tags.

## Detection processing contract

Local upload waits for thumbnail generation, inference and indexing. A stored upload can return 201 with
`processingStatus:failed`; 201 confirms storage, so callers must inspect processingStatus.
Duplicate upload returns 200 and the existing status without processing. POST process returns 200 with
either complete or failed metadata; missing IDs return 404 and other methods 405. Fix configuration then retry.
The typed client exposes process(id). No frontend pages were changed.

Complete metadata includes `species:{cat:2}` (or `{}` for no animals) and
`detectionModel:{identity,version,weightsSha256,confidence}`. Failure includes a sanitized processingError.
Reprocessing clears old inferred counts/model identity and keeps manualTags. Complete is persisted only after
inference succeeds. Pending can mean interrupted processing; explicit retry is safe. Processing and other
mutations are serialized in this local server. Worker timeout is 120 seconds.

Supported animal labels: bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe.
No fox, cane-toad, breed or colour inference. See [DETECTION.md](./DETECTION.md) for setup, limits and real test evidence.

## Temporary image query

POST /api/search/image with raw JPEG/PNG/WebP bytes and matching Content-Type (10 MiB maximum).
Returns {media:[]} using the same metadata representation as text search. Detected instance counts are
minimum thresholds, combined with AND across all detected animal classes. No animals means no matches.
Requires configured Pillow validation and YOLO; unavailable processing returns a structured error.
The query is decoded and inferred in memory, never stored/indexed and never thumbnailed.
Typed client: mediaApi.searchImage(file). This general local search has no ownership enforcement.

## Lost-pet image query

POST /api/search/lost-pet/image?tag=ginger&tag=collar&since=2026-10-01T00:00:00Z&until=2026-10-30T00:00:00Z
with raw image bytes and matching Content-Type. Same 10 MiB/decoding safeguards and {media:[]} response.
Detected counts use AND/minimum thresholds. Optional repeated tag parameters must all occur in manualTags
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
The existing typed upload method accepts video Files. All original retrieval is still unauthenticated locally.

Examples from backend (replace UUID with the returned media.id):

```powershell
curl.exe -X POST http://127.0.0.1:3001/api/search/image -H "Content-Type: image/jpeg" --data-binary "@data/inference-samples/cats.jpg"
curl.exe -X POST "http://127.0.0.1:3001/api/search/lost-pet/image?tag=collar&since=2026-10-01T00:00:00Z" -H "Content-Type: image/jpeg" --data-binary "@data/inference-samples/cats.jpg"
curl.exe -X POST http://127.0.0.1:3001/api/media -H "Content-Type: video/mp4" -H "X-Filename: cats.mp4" --data-binary "@cats.mp4"
curl.exe http://127.0.0.1:3001/api/media/UUID/file -H "Range: bytes=0-1023" -o first-kib.bin
```

Processing executables, deadlines, cleanup guarantees, test evidence and limitations: [VIDEO.md](./VIDEO.md).

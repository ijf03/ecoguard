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
| GET /api/media/:id/file | None | Original image bytes |
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

Image-based temporary query; video frames every 10 seconds;
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

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
Manual tags count as one occurrence. Inferred species counts will come from a real model, which is not connected.
Removing a detected tag currently removes that species entry; adding a tag manually records one occurrence.
Deletion/tag edits validate every referenced record before modifying a batch (maximum 100 unique inputs).
Tags normalize case and whitespace (maximum 32 tags, 80 characters each).
Use returned relative URLs; arbitrary external URLs are rejected.

Errors: {error:{code:"INVALID_QUERY",message:"..."}} with 400/404/405/413/415/422/500/503.
ApiError exposes status, code and message. Missing records and unavailable thumbnails return 404.
When cleanupPending is true, records are deleted and staged byte cleanup will finish on backend restart.

## Teammate implementation boundary

Use mediaApi.list/upload/search/lostPet/fromThumbnail/editTags/delete for feature pages.
Build independent UploadForm, MediaGallery/Preview, SearchForm and BulkActions components.
Catch ApiError, show loading/empty/error states, refresh results after mutations, and clear selection after deletion.
Use thumbnailUrl ?? originalUrl for image previews. Display processingStatus honestly: pending is not a detected animal result.
Authentication UI must connect to Cognito later; do not create a fake login or imply this local API is protected.
No browser UI workflow has been verified by the agent. Typed client workflows are tested over real local HTTP.

## Remaining integration work

Approved wildlife-capable YOLO/MegaDetector/Rekognition model; image-based temporary query; video frames every 10 seconds;
Cognito and ownership enforcement; S3 upload events; serverless processors and database on a secondary cloud;
Lex intents/fulfillment and clickable results; filtered notifications; reports and mandatory demo.
Existing A1 weights classify only empty/occupied parking spots and cannot supply wildlife tags.

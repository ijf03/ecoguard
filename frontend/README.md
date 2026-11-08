# Aussie EcoGuard frontend

React application connected to the existing same-origin media API. Vite proxies `/api` to the loopback backend at port 3001.

## Start

Use Node 22.13+ (Node 24 recommended), then `npm ci` and `npm run dev`. Start the backend separately using the root README. Configure its Python/Pillow, YOLO weights and FFmpeg before claiming real image/video processing works.

## Workflows

- Collection: thumbnails, original-image dialog, native video player, processing state and retry.
- Add a sighting: multiple validated image/MP4 uploads, public/private choice, per-file success/duplicate/request-failure/processing-failure messages. Uploads are sequential and navigation is disabled until they finish.
- Explore & search: dynamic AND/count filters, temporary example-image query, thumbnail-to-original lookup. Query images are sent to the temporary search endpoint, never the permanent upload endpoint.
- Find a lost pet: description or image, comma-separated descriptive tags and optional dates converted from local time to UTC. Both use the backend's public/date restrictions.
- Bulk editing: select up to 100 results, add/remove tags, or confirm permanent deletion. Unknown tags can be removed safely. A pending storage cleanup is explicitly reported.
- Responsive keyboard-accessible navigation, labelled fields, status/error announcements, empty states and native dialogs with Escape handling.

## Checks

`npm test` tests the form/API boundaries: normalized AND/count filters, duplicate names and invalid counts, descriptive-tag validation, UTC date windows, unsupported/oversized/empty files and video rejection for image-only queries.

`npm run build` checks TypeScript and bundles the app; `npm run lint` runs oxlint. Browser checks and their actual results belong in `docs/FRONTEND_VERIFICATION.md`.

## Remaining integration

This frontend currently uses the local API contract. Cognito registration/login/logout, protected routes/media, owner-aware cloud uploads, Lex chat and email-subscription controls remain required. Do not publish this application against an unauthenticated backend or describe the missing services as implemented. Real browser success paths for inferred image queries/video processing require configured processing dependencies. No fake chatbot, notification or inference responses are used.

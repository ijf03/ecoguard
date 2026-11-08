# Frontend verification - 8 November 2026

## Implemented

Connected the React application to the existing typed client: batch image/video upload and visibility, collection previews, original viewing and native video controls, processing status/retry, AND/count searches, temporary-image queries, thumbnail URL lookup, text/image lost-pet forms, bulk selection/tag editing and confirmed deletion. Added responsive layouts, labelled controls, status/error feedback and empty states. No chatbot, email or authentication simulation was added.

## Executed checks

- Four form-boundary tests passed with no failures or skips. They cover normalized filters, duplicate keys and invalid counts, tag validation, date windows/UTC conversion and file limits/type checks.
- TypeScript checking passed with a separately installed JavaScript TypeScript 5.9.3 compiler during development. This is supplemental evidence; it does not replace the project's pinned TypeScript 7/Vite build.
- The first oxlint run completed with no errors and four warnings. The flagged control-character regexes and synchronous initial-effect/cleanup pattern were subsequently rewritten. Final pinned lint/build verification remains outstanding due stalled native tool execution.
- An independent, temporary Rollup/TypeScript verification bundle rendered the current React source against the real local API. It is a browser testing aid outside the repository, not a changed project toolchain or a verified production build. The utility-class preflight import was excluded from that temporary bundle; all application CSS was included.
- `git diff --check` passed before the final documentation update.

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

- Complete the normal pinned TypeScript 7 / Vite production build and final lint after resolving native tool startup. Several native commands stalled; one native compiler exited 137. No successful current pinned build is claimed.
- Actual YOLO image-query success, real MP4/H.264 playback and processing, moving-wildlife accuracy, network-failure cases and all complete deployed browser workflows.
- Cognito registration/verification/login/logout, protected pages/APIs/media, ownership, asynchronous cloud-upload contract, Lex and notification subscription UI.
- Review accessible contrast/focus/keyboard behaviour across all states and supported browsers before calling the UI HD-ready.

The local server stays loopback-only. No cloud resources were provisioned and no code was pushed during these checks. Earlier 27-pass backend inference evidence remains historical and should not be presented as a new local run.

# Local MP4 processing

## Setup and run

Install FFmpeg with ffprobe (the full FFmpeg distribution), and use the existing Python/YOLO setup in
[DETECTION.md](./DETECTION.md). Both executables default to PATH. To override, set absolute paths in ignored
`backend/.env` and restart `npm run dev` from `backend`:

```dotenv
ECOGUARD_FFMPEG=C:/path/to/ffmpeg.exe
ECOGUARD_FFPROBE=C:/path/to/ffprobe.exe
ECOGUARD_MAX_VIDEO_BYTES=52428800
```

`ECOGUARD_MAX_VIDEO_BYTES` defaults to 50 MiB; it must be an integer from 1 byte to 200 MiB.
It is separate from the 10 MiB image limit. No software or weights are downloaded during requests.
Verified local executables: FFmpeg and ffprobe 8.1.1, already installed through WinGet.

```powershell
curl.exe -X POST http://127.0.0.1:3001/api/media -H "Content-Type: video/mp4" -H "X-Filename: cats.mp4" --data-binary "@cats.mp4"
curl.exe -X POST http://127.0.0.1:3001/api/media/UUID/process
curl.exe http://127.0.0.1:3001/api/media/UUID/file -H "Range: bytes=0-1023" -o first-kib.bin
```

The existing typed `mediaApi.upload(file, visibility)` accepts videos. Listing, detail, text/count and image
search, checksum deduplication, manual tags, processing retry and coordinated deletion use the same APIs.
Video thumbnails/posters are not generated in this iteration. Use a video element with originalUrl for playback.

## Validation, limits and processing

Supported input: MP4 (`video/mp4`) with an isom/iso2/mp41/mp42/avc1 major brand and exactly one H.264 video
stream. Other containers/codecs are unsupported. Source resolution must be at most 3840x2160 and duration
greater than zero and at most 120 seconds. Audio is preserved without analysis or transcoding; playback
of an unusual audio codec depends on the browser. Prefer AAC audio or silent clips for browser compatibility.

HTTP rejects excessive bytes and mismatching signatures before storage (413/415). A signature-valid upload
is stored before ffprobe/FFmpeg; corrupt streams, invalid duration/codec or unavailable processing leave
the original and checksum indexed with status failed, not lost. A 201 response means stored, so inspect
processingStatus. Duplicate uploads return existing metadata and do not retry automatically.
Retry through POST process after correcting dependencies; intrinsically unsupported input remains failed.

The replaceable FFmpegVideoProcessor writes one original into a unique OS temporary directory.
ffprobe checks metadata, then FFmpeg seeks separately to 0, 10, 20... seconds strictly before duration.
Examples: 10 seconds samples [0]; 20 seconds samples [0,10]; 20.1 seconds samples [0,10,20].
There are at most 12 samples. Frames are scaled into 1280x1280 with aspect preserved and piped in memory
as bounded JPEGs (4 MiB maximum). They are never indexed or written into permanent storage.
The existing YOLO detector runs on each sampled frame. Counts use the maximum observed count for each
species across frames. This is **not a unique-animal count** and can miss short appearances between samples.
Model provenance must agree across frames; a model change fails the attempt.

Per MediaService instance, processing/mutations run one at a time, including image-query inference.
FFmpeg uses one decoder/encoder thread, each external command has a 30-second timeout, individual YOLO
workers have 120 seconds, and the complete video job has a 180-second deadline shared with workers.
Timeout cancellation kills the subprocess and waits for close before temporary-directory cleanup.
Success, invalid metadata, extraction/inference failure and timeout all execute cleanup in finally.
Abrupt host/process termination can leave OS temporary files; automatic crash recovery of these directories
is not implemented. Normal coordinated deletion applies only to permanent originals/metadata.

Completed metadata adds `mediaType:video`, `duration` (seconds), `sampledAt`, `species`, `detectionModel`
and the existing original storage key. Legacy image documents without mediaType remain compatible.
Failures clear stale inference; manual tags survive retries. Complete is returned only after metadata save.
Duration/sample metadata is published with successful processing, not for failed probe/inference attempts.

## Retrieval and local limitations

GET originalUrl supports single closed, open-ended and suffix byte ranges, Accept-Ranges: bytes,
206 with Content-Range/Content-Length, and 416 with `Content-Range: bytes */SIZE` for invalid or multiple ranges.
HEAD returns full content headers without a body. Local storage currently reads the bounded original into
memory before slicing, rather than streaming a range from disk. MP4 fast-start layout is not rewritten.
HTTP behaviour is tested; interactive browser playback has not been verified.
These unauthenticated loopback endpoints remain development adapters, not cloud/auth completion.

## Reproducible verification

From `backend`, using the sample images and weights described in [DETECTION.md](./DETECTION.md):

```powershell
$env:TEST_PYTHON='C:/path/to/venv/Scripts/python.exe'
$env:TEST_MODEL_PATH=(Resolve-Path data/models/yolo11n.pt).Path
$env:TEST_IMAGE_DIR=(Resolve-Path data/inference-samples).Path
$env:TEST_FFMPEG=(Get-Command ffmpeg).Source
$env:TEST_FFPROBE=(Get-Command ffprobe).Source
npm test
npm run typecheck
npm run build
```

Without these variables real tests explicitly report skipped; deterministic tests still run and do not prove
ML/FFmpeg behaviour. With all variables set, 30 October 2026: real FFmpeg generated an 11-second H.264 clip
by repeating the public COCO cat image. Real YOLO processed samples [0,10], yielding cat:2 (not cat:4),
persisted successfully and matched count search. A corrupt MP4 retained its original, failed processing and
left no processing directory. This synthetic clip checks integration, not real-world wildlife-video accuracy.
The separate real query test checks cat matching, a bus no-animal query, corrupt-image rejection and public
versus private lost-pet filtering. Mock tests cover boundaries, max aggregation, no animals, inference/extraction
failures, subprocess timeout/cleanup, persistence/reopen, serialized retries, deduplication, range variants and deletion.

# Local animal detection

The replaceable TypeScript `Detector` adapter invokes a Python worker on the stored original.
Default local composition uses pretrained Ultralytics YOLO11n detection, CPU, confidence 0.25.
Pillow produces the thumbnail first. Requests wait for inference (120 second worker timeout).
This serial local implementation reloads weights per request; it is not a production job queue.

## Explicit setup

From `backend`, create/select a Python environment, then run these commands with its executable:

```powershell
& 'C:/path/to/venv/Scripts/python.exe' -m pip install -r workers/requirements.txt
New-Item -ItemType Directory -Force data/models
Invoke-WebRequest 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt' -OutFile data/models/yolo11n.pt
Get-FileHash data/models/yolo11n.pt -Algorithm SHA256
```

Verified weight SHA-256: `0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1`.
Use trusted weights only: `.pt` files contain executable serialized model data.
Set in ignored `backend/.env` (absolute paths; restart backend after changing):

```dotenv
ECOGUARD_PYTHON=C:/path/to/venv/Scripts/python.exe
ECOGUARD_MODEL_PATH=C:/absolute/path/to/backend/data/models/yolo11n.pt
ECOGUARD_CONFIDENCE=0.25
```

Confidence must be greater than 0 and at most 1. The model file must already exist.
The worker checks the file before importing/loading YOLO; requests never download missing weights.
The existing A1 Python environment is usable; its empty/occupied parking model is rejected.
Verified runtime: Python 3.12.10, Ultralytics 8.4.156, torch 2.14.0+cpu, Pillow 12.3.0.

## Supported labels and limits

COCO animal classes: **bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe**.
Only those boxes are counted after YOLO confidence filtering and nonmaximum suppression.
Other COCO classes (people, vehicles, etc.) are ignored. No animals is a valid complete result `{}`.
These broad class labels are stored under `species`; they are not fine-grained taxonomic identification.
No fox, cane-toad, kangaroo, breed or colour detection is claimed. Those terms can be manual tags only.
Counts are model estimates and can miss, merge or misclassify animals; this is not a wildlife survey model.

## Failure and retry

Inference failures preserve original media, checksum, thumbnail and manual tags. Status becomes `failed`
with a sanitized `processingError`. Fix setup and POST `/api/media/:id/process` (or `mediaApi.process(id)`).
No new upload is necessary. Duplicate upload returns the existing record without rerunning inference.
Explicit reprocessing clears old inferred counts/model metadata and preserves manual tags. A removed inferred
tag can return after reprocessing. `pending` records after interruption can use the same retry endpoint.
Only a successful inference plus metadata save returns `complete`. DB errors that prevent even failure
persistence produce HTTP 500; inspect metadata after recovery and retry. No automatic background retries.

## Verification

Default `npm test` uses deterministic mock detectors for orchestration, count thresholds, deduplication,
SQLite reopen, failure/retry, completion-write failure and manual tag retention. These are not ML accuracy tests.
Real inference is a separate opt-in test; provide locally downloaded samples:

```powershell
New-Item -ItemType Directory -Force data/inference-samples
Invoke-WebRequest 'http://images.cocodataset.org/val2017/000000039769.jpg' -OutFile data/inference-samples/cats.jpg
Invoke-WebRequest 'https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg' -OutFile data/inference-samples/dog.jpg
Invoke-WebRequest 'https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg' -OutFile data/inference-samples/bus.jpg
$env:TEST_PYTHON='C:/path/to/venv/Scripts/python.exe'
$env:TEST_MODEL_PATH=(Resolve-Path data/models/yolo11n.pt).Path
$env:TEST_IMAGE_DIR=(Resolve-Path data/inference-samples).Path
npm test
```

The COCO HTTPS sample endpoint failed certificate validation on this machine; its public HTTP endpoint
was used for this non-sensitive test image. Weights came from GitHub over HTTPS.
Executed 30 October 2026: cats image → `cat:2`; dog image → `dog:1`; bus negative control → `{}`.
Each used real Pillow thumbnails, YOLO inference, SQLite persistence and count search. All 19 tests passed,
zero skipped with the variables above. This small smoke check does not establish accuracy on Australian wildlife.
Weights and sample images live in ignored `backend/data`; tests never fetch them automatically.

## Temporary image queries

/api/search/image reuses YOLO after validation-only Pillow decode (including pixel/decompression limits).
It uses no temporary files, creates no thumbnail and writes no metadata or originals.
Detected query counts are AND/minimum thresholds, not similarity scores. An empty detection returns [].
Lost-pet image queries reuse this pipeline, filter public sightings by date and AND user-supplied manual descriptions. No breed or colour inference is added.

## Video reuse

The replaceable FFmpeg adapter invokes this same detector on bounded sampled JPEG frames, with cancellation
propagated to the Python subprocess. Counts are maxima across samples, never summed as unique animals.
The animal-class limitations above also apply to videos. See [VIDEO.md](./VIDEO.md) for limits and setup.

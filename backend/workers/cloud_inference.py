"""Version-pinned YOLO ONNX inference and bounded MP4 frame processing for Lambda."""
import ast
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import warnings
import boto3
from botocore.config import Config
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 20_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
s3 = boto3.client('s3', config=Config(connect_timeout=5, read_timeout=60, retries={'max_attempts': 2}))
DEFAULT_ANIMALS = ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']
ALLOWED = set(json.loads(os.environ.get('ECOGUARD_ANIMAL_CLASSES', json.dumps(DEFAULT_ANIMALS))))
CONFIDENCE = float(os.environ.get('ECOGUARD_CONFIDENCE', '0.25'))
if not 0 < CONFIDENCE <= 1:
    raise ValueError('Invalid confidence configuration')
_session = None
_labels = None
BIN_ROOT = Path(__file__).resolve().parent / 'bin'

class InvalidMedia(Exception):
    pass

def model():
    global _session, _labels
    if _session is not None:
        return _session, _labels
    digest = os.environ['ECOGUARD_MODEL_SHA256']
    if not re.fullmatch('[a-f0-9]{64}', digest):
        raise ValueError('Invalid model digest configuration')
    path = Path('/tmp/ecoguard-model-' + digest + '.onnx')
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        response = s3.get_object(Bucket=os.environ['ECOGUARD_MODEL_BUCKET'], Key=os.environ['ECOGUARD_MODEL_KEY'], VersionId=os.environ['ECOGUARD_MODEL_VERSION'])
        try:
            raw = response['Body'].read(64 * 1024 * 1024 + 1)
        finally:
            response['Body'].close()
        if len(raw) > 64 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != digest:
            raise RuntimeError('Configured model object failed integrity verification')
        staging = path.with_suffix('.part')
        staging.write_bytes(raw)
        staging.replace(path)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    _session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
    shape = _session.get_inputs()[0].shape
    if len(shape) != 4 or shape[:2] != [1, 3] or any(not isinstance(n, int) or not 0 < n <= 1280 for n in shape[2:]):
        raise RuntimeError('Configure a static NCHW YOLO detection export with dimensions at most 1280')
    metadata = _session.get_modelmeta().custom_metadata_map
    _labels = ast.literal_eval(metadata['names'])
    if isinstance(_labels, list):
        _labels = dict(enumerate(_labels))
    if not isinstance(_labels, dict) or len(_labels) > 1000:
        raise RuntimeError('Invalid model class metadata')
    _labels = {int(k): str(v).strip().lower() for k, v in _labels.items()}
    return _session, _labels

def image(raw, content_type=None):
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if content_type and {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}.get(probe.format) != content_type:
                raise InvalidMedia('MIME mismatch')
            probe.verify()
        with Image.open(io.BytesIO(raw)) as source:
            result = ImageOps.exif_transpose(source)
            result.load()
            return result.convert('RGB')
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise InvalidMedia('Invalid image') from error

def detect(picture):
    session, labels = model()
    target_height, target_width = session.get_inputs()[0].shape[2:]
    ratio = min(target_width / picture.width, target_height / picture.height)
    width, height = round(picture.width * ratio), round(picture.height * ratio)
    canvas = Image.new('RGB', (target_width, target_height), (114, 114, 114))
    canvas.paste(picture.resize((width, height), Image.Resampling.BILINEAR), (round((target_width - width) / 2 - 0.1), round((target_height - height) / 2 - 0.1)))
    tensor = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    result = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    layout = os.environ.get('ECOGUARD_MODEL_OUTPUT_LAYOUT', 'cxcywh-class-scores')
    if layout == 'xyxy-score-class':
        if result.ndim != 3 or result.shape[0] != 1 or result.shape[2] != 6: raise RuntimeError('Unsupported end-to-end YOLO output layout')
        counts = {}
        for row in result[0]:
            label = labels.get(int(row[5]))
            if row[4] >= CONFIDENCE and label in ALLOWED: counts[label] = counts.get(label, 0) + 1
        return counts
    if layout != 'cxcywh-class-scores' or result.ndim != 3 or result.shape[0] != 1 or result.shape[1] != len(labels) + 4:
        raise RuntimeError('Unsupported YOLO output layout')
    candidates = result[0].T
    class_ids = np.argmax(candidates[:, 4:], axis=1)
    scores = candidates[np.arange(len(candidates)), 4 + class_ids]
    selected = (scores >= CONFIDENCE) & np.array([labels[int(k)] in ALLOWED for k in class_ids])
    boxes, scores, class_ids = candidates[selected, :4].copy(), scores[selected], class_ids[selected]
    if not len(boxes):
        return {}
    boxes[:, :2] -= boxes[:, 2:] / 2
    boxes[:, 2:] += boxes[:, :2]
    order = np.argsort(scores)[::-1][:3000]
    kept = []
    while len(order) and len(kept) < 300:
        current = order[0]
        kept.append(current)
        rest = order[1:]
        if not len(rest): break
        top_left = np.maximum(boxes[current, :2], boxes[rest, :2])
        bottom_right = np.minimum(boxes[current, 2:], boxes[rest, 2:])
        area = np.maximum(bottom_right - top_left, 0).prod(axis=1)
        size_current = np.maximum(boxes[current, 2:] - boxes[current, :2], 0).prod()
        size_rest = np.maximum(boxes[rest, 2:] - boxes[rest, :2], 0).prod(axis=1)
        iou = area / np.maximum(size_current + size_rest - area, 1e-9)
        order = rest[(class_ids[rest] != class_ids[current]) | (iou <= 0.45)]
    counts = {}
    for index in kept:
        label = labels[int(class_ids[index])]
        counts[label] = counts.get(label, 0) + 1
    return counts

def source(event, limit):
    key, version = event.get('key', ''), event.get('version', '')
    if not (key.startswith('incoming/') or key.startswith('queries/') or key.startswith('verification/')) or len(key) > 1024 or not version:
        raise InvalidMedia('Invalid source reference')
    response = s3.get_object(Bucket=os.environ['ECOGUARD_MEDIA_BUCKET'], Key=key, VersionId=version)
    try:
        raw = response['Body'].read(limit + 1)
    finally:
        response['Body'].close()
    if len(raw) > limit or len(raw) != event.get('size') or hashlib.sha256(raw).hexdigest() != event.get('checksum') or response.get('ContentType') != event.get('contentType'):
        raise InvalidMedia('Source does not match reserved bytes')
    return raw

def video_metadata(path, raw):
    if len(raw) < 24 or raw[4:8] != b'ftyp' or raw[8:12] not in [b'isom', b'iso2', b'mp41', b'mp42', b'avc1']:
        raise InvalidMedia('Unsupported MP4 container')
    command = [str(BIN_ROOT / 'ffprobe'), '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', str(path)]
    response = subprocess.run(command, check=True, capture_output=True, timeout=30)
    if len(response.stdout) > 1024 * 1024: raise InvalidMedia('Oversized video metadata')
    metadata = json.loads(response.stdout)
    streams = [s for s in metadata.get('streams', []) if s.get('codec_type') == 'video']
    duration = float(metadata.get('format', {}).get('duration', 0))
    if len(streams) != 1 or not math.isfinite(duration) or not 0 < duration <= 120:
        raise InvalidMedia('Require one video stream and duration at most 120 seconds')
    stream = streams[0]
    width, height = stream.get('width'), stream.get('height')
    if stream.get('codec_name') != 'h264' or not isinstance(width, int) or not isinstance(height, int) or not 0 < width <= 3840 or not 0 < height <= 2160 or 'mp4' not in metadata['format']['format_name'].split(','):
        raise InvalidMedia('Require MP4/H.264 within supported dimensions')
    return {'duration': duration, 'width': width, 'height': height}

def handler(event, context):
    # Lambda runs one invocation per environment. Recover only our prior interrupted temp workspaces.
    for path in Path('/tmp').glob('ecoguard-video-*'):
        if path.is_dir(): shutil.rmtree(path)
    mode = event.get('mode', 'image')
    is_video = mode in ['video', 'validate-video']
    try:
        raw = source(event, (50 if is_video else 10) * 1024 * 1024)
        if is_video:
            with tempfile.TemporaryDirectory(prefix='ecoguard-video-') as directory:
                path = Path(directory) / 'source.mp4'; path.write_bytes(raw)
                metadata = video_metadata(path, raw)
                if mode == 'validate-video':
                    return {'valid': True, 'checksum': event['checksum'], 'size': len(raw), 'contentType': 'video/mp4', 'video': metadata}
                sampled = [10 * i for i in range(math.ceil(metadata['duration'] / 10))]
                counts = {}
                for timestamp in sampled:
                    if context.get_remaining_time_in_millis() < 10000: raise RuntimeError('Processing deadline reached')
                    command = [str(BIN_ROOT / 'ffmpeg'), '-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-ss', str(timestamp), '-i', str(path), '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease', '-threads', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']
                    frame = subprocess.run(command, check=True, capture_output=True, timeout=45).stdout
                    if not frame or len(frame) > 4 * 1024 * 1024: raise InvalidMedia('Invalid sampled video frame')
                    for name, count in detect(image(frame)).items(): counts[name] = max(counts.get(name, 0), count)
                extra = {'duration': metadata['duration'], 'sampledAt': sampled}
        else:
            if mode != 'image': raise InvalidMedia('Unsupported inference operation')
            counts = detect(image(raw, event.get('contentType')))
            extra = {}
        return {'species': counts, 'model': {'identity': os.environ.get('ECOGUARD_MODEL_IDENTITY', 'YOLO11n ONNX'),
                'version': os.environ['ECOGUARD_MODEL_EXPORTER_VERSION'] + '/onnxruntime-' + ort.__version__,
                'weightsSha256': os.environ['ECOGUARD_MODEL_SHA256'], 'confidence': CONFIDENCE}, **extra}
    except (InvalidMedia, subprocess.CalledProcessError, ValueError) as error:
        return {'valid': False, 'error': 'INVALID_MEDIA'}

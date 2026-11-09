"""Run once in an isolated AL2023 Fargate build task; produces trusted Lambda assets."""
import hashlib
import json
import os
import pathlib
import signal
import subprocess
import sys
import tarfile
import urllib.request
import boto3

# The essential container exits even if a child installer/compiler hangs.
def deadline(_signum, _frame):
    print('Build deadline exceeded; terminating the essential container.', flush=True)
    os._exit(124)
signal.signal(signal.SIGALRM, deadline)
signal.alarm(840)

def run(args, timeout=400, cwd=None):
    print('Build step:', args[0], flush=True)
    subprocess.run(args, check=True, timeout=timeout, cwd=cwd)

account = boto3.client('sts').get_caller_identity()['Account']
if account != '851725503164':
    raise RuntimeError('Wrong AWS build account')
media_bucket = os.environ['ECOGUARD_MODEL_BUCKET']
artifact_bucket = os.environ['ECOGUARD_ARTIFACT_BUCKET']
build_id = os.environ['ECOGUARD_BUILD_ID']
s3 = boto3.client('s3')
work = pathlib.Path('/tmp/ecoguard-build')
work.mkdir(exist_ok=True)
os.chdir(work)
run(['dnf', 'install', '-y', 'gcc', 'gcc-c++', 'make', 'nasm', 'tar', 'xz', 'mesa-libGL', 'glib2'], timeout=180)
run([sys.executable, '-m', 'pip', 'install', '--no-cache-dir', '--index-url', 'https://download.pytorch.org/whl/cpu', '--extra-index-url', 'https://pypi.org/simple', 'torch==2.14.0+cpu', 'torchvision==0.29.1+cpu'])
run([sys.executable, '-m', 'pip', 'install', '--no-cache-dir', 'ultralytics==8.4.207', 'onnx==1.23.2', 'boto3==1.43.126'], timeout=240)
from ultralytics import YOLO
import ultralytics
import torch
model = YOLO('yolo11n.pt')
exported = pathlib.Path(model.export(format='onnx', imgsz=640, opset=17, dynamic=False, simplify=False, nms=False, device='cpu'))
raw = exported.read_bytes()
model_sha = hashlib.sha256(raw).hexdigest()
model_key = 'models/yolo11n/' + model_sha + '.onnx'
model_put = s3.put_object(Bucket=media_bucket, Key=model_key, Body=raw, ContentType='application/octet-stream')
manifest = {'buildId': build_id, 'modelKey': model_key, 'modelVersion': model_put['VersionId'], 'modelSha256': model_sha,
            'identity': 'YOLO11n ONNX', 'exporterVersion': ultralytics.__version__, 'torchVersion': torch.__version__,
            'inputSize': 640, 'outputLayout': 'cxcywh-class-scores', 'classNames': model.names,
            'modelSource': 'https://github.com/ultralytics/assets', 'modelLicense': 'AGPL-3.0'}
s3.put_object(Bucket=artifact_bucket, Key='builds/' + build_id + '/model-manifest.json', Body=json.dumps(manifest).encode(), ContentType='application/json')
print('ONNX model uploaded with immutable S3 version and digest.', flush=True)

source = work / 'ffmpeg-8.1.3.tar.xz'
with urllib.request.urlopen('https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz', timeout=60) as response:
    source.write_bytes(response.read())
expected = '7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3'
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise RuntimeError('Official FFmpeg source digest mismatch')
with tarfile.open(source) as archive:
    archive.extractall(work, filter='data')
ffmpeg = work / 'ffmpeg-8.1.3'
run(['./configure', '--disable-everything', '--disable-autodetect', '--disable-doc', '--disable-debug', '--disable-network',
     '--disable-shared', '--enable-static', '--disable-zlib', '--disable-bzlib', '--disable-lzma', '--disable-iconv',
     '--enable-ffmpeg', '--enable-ffprobe', '--enable-protocol=file,pipe', '--enable-demuxer=mov', '--enable-parser=h264',
     '--enable-decoder=h264', '--enable-encoder=mjpeg', '--enable-muxer=image2,image2pipe',
     '--enable-filter=scale,format,buffer,buffersink,null', '--enable-swscale'], cwd=ffmpeg, timeout=120)
run(['make', '-j2'], cwd=ffmpeg, timeout=240)
for name in ['ffmpeg', 'ffprobe']:
    run([str(ffmpeg / name), '-version'], timeout=15)
archive_path = work / 'ffmpeg-minimal.tar.gz'
with tarfile.open(archive_path, 'w:gz') as archive:
    for name in ['ffmpeg', 'ffprobe', 'COPYING.LGPLv2.1']:
        archive.add(ffmpeg / name, arcname=name)
native_sha = hashlib.sha256(archive_path.read_bytes()).hexdigest()
native_key = 'native/ffmpeg-8.1.3-' + native_sha + '.tar.gz'
s3.upload_file(str(archive_path), artifact_bucket, native_key)
manifest.update({'ffmpegArchiveKey': native_key, 'ffmpegArchiveSha256': native_sha, 'ffmpegVersion': '8.1.3', 'ffmpegSourceSha256': expected,
                 'buildPlatform': 'Amazon Linux 2023 x86_64', 'complete': True})
s3.put_object(Bucket=artifact_bucket, Key='builds/' + build_id + '/model-manifest.json', Body=json.dumps(manifest).encode(), ContentType='application/json')
print('MODEL AND FFMPEG BUILD COMPLETE', flush=True)

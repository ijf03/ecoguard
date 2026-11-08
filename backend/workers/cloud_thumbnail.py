"""IAM-only image validation/thumbnail Lambda. No inferred species are fabricated."""
import hashlib
import io
import os
import re
import warnings
import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 20_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)
s3 = boto3.client('s3')

def handler(event, context):
    bucket = os.environ['ECOGUARD_MEDIA_BUCKET']
    key, version, media_id = event.get('key', ''), event.get('version', ''), event.get('mediaId', '')
    if not re.fullmatch(r'[a-f0-9-]{36}', media_id) or not re.fullmatch(r'incoming/[a-f0-9]{64}/' + re.escape(media_id), key) or not version:
        raise ValueError('Invalid processing reference')
    expected_size = event.get('size')
    content_type = event.get('contentType')
    if not isinstance(expected_size, int) or not 0 < expected_size <= 10 * 1024 * 1024:
        return {'valid': False, 'error': 'INVALID_MEDIA'}
    response = s3.get_object(Bucket=bucket, Key=key, VersionId=version)
    try:
        raw = response['Body'].read(10 * 1024 * 1024 + 1)
    finally:
        response['Body'].close()
    checksum = hashlib.sha256(raw).hexdigest()
    if len(raw) != expected_size or checksum != event.get('checksum') or response.get('ContentType') != content_type:
        return {'valid': False, 'error': 'INVALID_MEDIA'}
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}.get(probe.format) != content_type:
                return {'valid': False, 'error': 'INVALID_MEDIA'}
            probe.verify()
        with Image.open(io.BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source)
            image.load()
            original = image.size
            image.thumbnail((320, 320), Image.Resampling.LANCZOS)
            rgba = image.convert('RGBA')
            rgb = Image.new('RGB', rgba.size, 'white')
            rgb.paste(rgba, mask=rgba.getchannel('A'))
            output = io.BytesIO()
            rgb.save(output, format='JPEG', quality=75, optimize=True)
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        return {'valid': False, 'error': 'INVALID_MEDIA'}
    # A deterministic version prefix makes duplicate S3 events idempotent.
    thumbnail_key = 'thumbnails/' + media_id + '/' + hashlib.sha256(version.encode()).hexdigest() + '/preview.jpg'
    try:
        s3.put_object(Bucket=bucket, Key=thumbnail_key, Body=output.getvalue(), ContentType='image/jpeg',
                      CacheControl='private, max-age=60', IfNoneMatch='*')
    except ClientError as error:
        if error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') != 412:
            raise
    return {'valid': True, 'checksum': checksum, 'size': len(raw), 'contentType': content_type,
            'thumbnail': {'key': thumbnail_key, 'width': rgb.width, 'height': rgb.height,
                          'originalWidth': original[0], 'originalHeight': original[1]}}

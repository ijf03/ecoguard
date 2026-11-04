"""Read an image on stdin; return a compressed JPEG thumbnail as JSON.
Local adapter worker; production should invoke processing via object-upload events.
"""
import base64
import io
import json
import sys
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 20_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)

try:
    raw = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError("Image exceeds 10 MiB")
    with Image.open(io.BytesIO(raw)) as probe:
        probe.verify()
    with Image.open(io.BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source)
        image.load()
        if "--validate" in sys.argv:
            print(json.dumps({"valid": True}))
            sys.exit(0)
        original = image.size
        image.thumbnail((320, 320), Image.Resampling.LANCZOS)
        rgba = image.convert("RGBA")
        rgb = Image.new("RGB", rgba.size, "white")
        rgb.paste(rgba, mask=rgba.getchannel("A"))
        output = io.BytesIO()
        rgb.save(output, format="JPEG", quality=75, optimize=True)
        print(json.dumps({"width": rgb.width, "height": rgb.height,
                          "originalWidth": original[0], "originalHeight": original[1],
                          "bytes": base64.b64encode(output.getvalue()).decode("ascii")}))
except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError,
        Image.DecompressionBombWarning) as error:
    print(json.dumps({"error": "Invalid, corrupt or oversized image"}))
    sys.exit(2)

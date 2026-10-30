"""Local COCO animal detector. Never fetch weights during inference."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import warnings

ANIMALS = {"bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"}


def main():
    weights = Path(sys.argv[1]).resolve(strict=True)
    confidence = float(sys.argv[2])
    if not weights.is_file() or weights.suffix != ".pt" or not 0 < confidence <= 1:
        raise ValueError("Supply existing .pt detection weights and confidence in (0,1]")
    # Imports/model chatter must not corrupt the stdout JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        import ultralytics
        from ultralytics import YOLO
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS = 20_000_000
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        raw = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError("Image too large")
        model = YOLO(str(weights), task="detect")
        if model.task != "detect" or not ANIMALS.issubset(set(model.names.values())):
            raise ValueError("Expected COCO animal detection classes; parking weights are unsupported")
        with Image.open(io.BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            results = model.predict(image, conf=confidence, device="cpu", verbose=False)
        counts = {}
        for result in results:
            for class_id in result.boxes.cls.tolist():
                name = model.names[int(class_id)]
                if name in ANIMALS:
                    counts[name] = counts.get(name, 0) + 1
    print(json.dumps({"species": counts, "model": {
        "identity": weights.name, "version": "ultralytics/" + ultralytics.__version__,
        "weightsSha256": hashlib.sha256(weights.read_bytes()).hexdigest(), "confidence": confidence}}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        sys.exit(1)

"""
Utility module – pipeline steps:

1) Grayscale conversion
2) CLAHE histogram equalisation
3) Gaussian blur (noise reduction)
4) Adaptive threshold (binarisation)
5) Deskew (auto-rotation)
6) Output to PNG bytes
"""
import cv2
import numpy as np
from PIL import Image
from io import BytesIO

def preprocess_image(file_bytes: bytes) -> bytes:
    # ---- 1  grayscale ----
    img = cv2.imdecode(np.frombuffer(file_bytes, np.uint8),
                       cv2.IMREAD_GRAYSCALE)

    # ---- 2  CLAHE equalisation ----
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    img = clahe.apply(img)

    # ---- 3  Gaussian blur ----
    img = cv2.GaussianBlur(img, (5, 5), 0)

    # ---- 4  Adaptive threshold ----
    img = cv2.adaptiveThreshold(
        img, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        35, 15
    )

    # ---- 5  Deskew ----
    coords = np.column_stack(np.where(img > 0))
    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    h, w = img.shape
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    img = cv2.warpAffine(img, M, (w, h),
                         flags=cv2.INTER_CUBIC,
                         borderMode=cv2.BORDER_REPLICATE)

    # ---- 6  Encode as PNG ----
    pil = Image.fromarray(img)
    buf = BytesIO()
    pil.save(buf, format="PNG")
    return buf.getvalue()
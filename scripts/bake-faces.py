"""Bakes face layers for the character roster from source photos.

For each face, the photo is aligned on three landmarks (both eyes and the
centre of the mouth) onto the head unwrap of the Ready Player Me masculine
avatar atlas (512x512 head block), masked with a feathered oval, and written
to public/assets/faces/<id>.png together with a small portrait and the
sampled skin tone. The avatar texture itself is never written, because its
licence does not allow redistribution; the game composites at runtime.

Source photos are kept out of git in faces-src/. Requires Pillow and numpy:
    python3 scripts/bake-faces.py
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'faces-src')
OUT = os.path.join(ROOT, 'public', 'assets', 'faces')

# Landmarks on the avatar head unwrap (pixels in the 512x512 head block).
ATLAS_EYE_L = np.array([204.0, 161.0])
ATLAS_EYE_R = np.array([306.0, 161.0])
ATLAS_MOUTH = np.array([256.0, 247.0])

# Landmarks are (x, y) in the source photo: viewer's left eye, right eye, mouth centre.
FACES = [
    {'id': 'redpolo', 'src': 'bus.png', 'eyeL': (148, 139), 'eyeR': (215, 123), 'mouth': (210, 207), 'mask': (1.0, 1.0)},
    {'id': 'greytee', 'src': 'group.png', 'eyeL': (388, 192), 'eyeR': (457, 237), 'mouth': (383, 297), 'mask': (0.95, 1.0)},
    {'id': 'checkers', 'src': 'group.png', 'eyeL': (532, 557), 'eyeR': (597, 547), 'mouth': (573, 633), 'mask': (1.0, 0.92)},
    {'id': 'denim', 'src': 'group.png', 'eyeL': (785, 532), 'eyeR': (845, 515), 'mouth': (833, 592), 'mask': (0.95, 0.92)},
    {'id': 'linen', 'src': 'linen.png', 'eyeL': (437, 193), 'eyeR': (513, 220), 'mouth': (455, 294), 'mask': (1.0, 1.05)},
]


def face_transform(eye_l, eye_r, mouth):
    """Photo -> atlas 2x3 matrix: rotation and scale from the eye-mouth axis,
    with the horizontal scale from the eye spacing clamped so three-quarter
    views are widened a little but not smeared."""
    eye_l, eye_r, mouth = map(np.array, (eye_l, eye_r, mouth))
    mid = (eye_l + eye_r) / 2
    axis = mouth - mid
    down = axis / np.linalg.norm(axis)
    right = np.array([-down[1], down[0]])
    if np.dot(eye_r - eye_l, right) < 0:
        right = -right
    atlas_mid = (ATLAS_EYE_L + ATLAS_EYE_R) / 2
    sy = np.linalg.norm(ATLAS_MOUTH - atlas_mid) / np.linalg.norm(axis)
    eye_span = abs(np.dot(eye_r - eye_l, right))
    sx = np.linalg.norm(ATLAS_EYE_R - ATLAS_EYE_L) / eye_span
    sx = min(max(sx, sy), sy * 1.3)
    R = np.stack([right * sx, down * sy])
    t = atlas_mid - R @ mid
    return np.hstack([R, t[:, None]])


def bake(face):
    photo = Image.open(os.path.join(SRC, face['src'])).convert('RGB')
    M = face_transform(face['eyeL'], face['eyeR'], face['mouth'])
    inv = np.linalg.inv(np.vstack([M, [0, 0, 1]]))[:2]
    warped = photo.transform((512, 512), Image.AFFINE, tuple(inv.flatten()), resample=Image.BICUBIC)

    mx, my = face['mask']
    mask = Image.new('L', (512, 512), 0)
    cx, cy, rx, ry = 256, 204 - (1 - my) * 60, 100 * mx, 116 * my
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(16))

    arr = np.asarray(warped).astype(np.float32)
    samples = [arr[190:215, 212:236], arr[190:215, 276:300], arr[112:132, 236:276]]
    skin = np.median(np.concatenate([s.reshape(-1, 3) for s in samples]), axis=0)

    layer = warped.copy()
    layer.putalpha(mask)
    os.makedirs(OUT, exist_ok=True)
    layer.save(os.path.join(OUT, f"{face['id']}.png"), optimize=True)
    warped.crop((146, 76, 366, 316)).resize((160, 176), Image.LANCZOS).save(
        os.path.join(OUT, f"{face['id']}_portrait.jpg"), quality=88)
    return [int(round(c)) for c in skin]


def main():
    meta = {}
    for f in FACES:
        meta[f['id']] = {'skin': bake(f)}
        print(f['id'], meta[f['id']])
    with open(os.path.join(OUT, 'faces.json'), 'w') as fp:
        json.dump(meta, fp, indent=2)


if __name__ == '__main__':
    main()

"""Samples skin tones for the photo roster from source photos (faces-src/).

Does not write face images into the repo; the game tints the Ready Player Me
head in character.js and shows 3D avatars in the menu.

    python3 scripts/bake-faces.py
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'faces-src')
OUT = os.path.join(ROOT, 'public', 'assets', 'faces')

FACES = [
    {'id': 'redpolo', 'src': 'bus.png', 'eyeL': (148, 139), 'eyeR': (215, 123), 'mouth': (210, 207)},
    {'id': 'greytee', 'src': 'group.png', 'eyeL': (388, 192), 'eyeR': (457, 237), 'mouth': (383, 297)},
    {'id': 'checkers', 'src': 'group.png', 'eyeL': (532, 557), 'eyeR': (597, 547), 'mouth': (573, 633)},
    {'id': 'denim', 'src': 'group.png', 'eyeL': (785, 532), 'eyeR': (845, 515), 'mouth': (833, 592)},
    {'id': 'linen', 'src': 'linen.png', 'eyeL': (437, 193), 'eyeR': (513, 220), 'mouth': (455, 294)},
]


def sample_skin(face):
    photo = np.asarray(Image.open(os.path.join(SRC, face['src'])).convert('RGB'), dtype=np.float32)
    eye_l, eye_r, mouth = map(np.array, (face['eyeL'], face['eyeR'], face['mouth']))
    mid = (eye_l + eye_r) / 2
    patches = [
        photo[190:215, 212:236],
        photo[190:215, 276:300],
        photo[max(0, int(mid[1]) - 20):int(mid[1]), int(mid[0]) - 24:int(mid[0]) + 24],
    ]
    skin = np.median(np.concatenate([p.reshape(-1, 3) for p in patches if p.size]), axis=0)
    return [int(round(c)) for c in skin]


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {f['id']: {'skin': sample_skin(f)} for f in FACES}
    for fid, data in meta.items():
        print(fid, data)
    with open(os.path.join(OUT, 'faces.json'), 'w') as fp:
        json.dump(meta, fp, indent=2)


if __name__ == '__main__':
    main()

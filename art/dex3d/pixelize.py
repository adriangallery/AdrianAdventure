#!/usr/bin/env python3
"""A2.14 · Paso a pixel art de los renders en bruto de render.py (Python 3 + Pillow + numpy, fuera de Blender).

    python3 art/dex3d/pixelize.py --raw /var/tmp/adv-dex3d/raw --out assets/sprites/player3d [--contact /var/tmp/x.png]

Por fotograma: reducción ×SS por media (alfa premultiplicado) → alfa binario (≥ 0,5) → color al más cercano de la
paleta de los sprites de Dex de siempre (art/dex3d/palette.json; se saca de assets/sprites/player si no existe) →
contorno oscuro de 1 px por dentro de la silueta → recorte a CROP_W × 103 con el punto de los pies en la columna
CROP_W/2 y los dedos del pie de frente en la última fila (el origen (0,5, 1) de Player queda igual que hoy).
Escribe <out>/<anim>_<dir>_<i>.png y <out>/dex3d.json (animaciones, fotogramas, fps, bucle).
"""
import argparse
import glob
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CROP_W = 72
CROP_H = 103  # alto de Dex en reposo (px de arte): de la fila 0 a la de los dedos de frente
PAD_BOTTOM = 5  # filas bajo los pies para el pie adelantado al andar hacia cámara (el origen sigue en los pies)
OUTLINE = (12, 8, 10)
DARK_LUM = 0.25  # sRGB
DARK_MIN = 6  # de 16


def build_palette(n=40):
    pal_path = os.path.join(HERE, 'palette.json')
    if os.path.exists(pal_path):
        return np.array(json.load(open(pal_path))['colors'], dtype=np.float32)
    px = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'assets/sprites/player/*.png'))):
        if os.path.basename(f).startswith('Ape'):
            continue
        a = np.asarray(Image.open(f).convert('RGBA'))
        px.append(a[a[..., 3] > 127][:, :3])
    allpx = np.concatenate(px)
    img = Image.fromarray(allpx.reshape(1, -1, 3).astype(np.uint8), 'RGB')
    q = img.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    cols = np.array(q.getpalette()[: n * 3]).reshape(-1, 3)
    # colores que el median cut se come (pocos píxeles) pero son de Dex: lentes, montura, piel clara, suela
    extra = [(0, 230, 255), (90, 255, 255), (230, 10, 20), (255, 255, 255), (12, 8, 10), (246, 176, 132), (226, 140, 100)]
    cols = sorted({tuple(int(v) for v in c) for c in cols} | set(extra))
    json.dump({'source': 'assets/sprites/player (sin Ape-*), median cut', 'colors': cols}, open(pal_path, 'w'), indent=0)
    return np.array(cols, dtype=np.float32)


def to_lin(c):
    c = c / 255.0
    return np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)


def pixelize(raw_path, pal, ss, root_col_art, bottom_art):
    a = np.asarray(Image.open(raw_path).convert('RGBA')).astype(np.float32) / 255.0
    h, w = a.shape[0] // ss, a.shape[1] // ss
    a = a[: h * ss, : w * ss].reshape(h, ss, w, ss, 4)
    alpha = a[..., 3].mean(axis=(1, 3))
    rgb_lin = (to_lin(a[..., :3] * 255) * a[..., 3:4]).sum(axis=(1, 3)) / np.maximum(1e-6, a[..., 3].sum(axis=(1, 3)))[..., None]
    mask = alpha >= 0.5
    # trazos oscuros finos (boca, cejas, nariz, líneas de los cuadros): si un bloque tiene al menos DARK_MIN de sus
    # SS×SS píxeles oscuros y opacos, el píxel de arte toma el color medio de esos (la media los borraba)
    srgb = a[..., :3]
    lum = srgb[..., 0] * 0.30 + srgb[..., 1] * 0.59 + srgb[..., 2] * 0.11
    dark = (lum < DARK_LUM) & (a[..., 3] > 0.5)
    nd = dark.sum(axis=(1, 3))
    dark_lin = (to_lin(srgb * 255) * dark[..., None]).sum(axis=(1, 3)) / np.maximum(1, nd)[..., None]
    rgb_lin = np.where((nd >= DARK_MIN)[..., None], dark_lin, rgb_lin)
    # al más cercano de la paleta en lineal con pesos de luminancia
    pl = to_lin(pal)
    wts = np.array([0.30, 0.59, 0.11]) * 3
    d = (((rgb_lin[:, :, None, :] ** 0.5 - pl[None, None, :, :] ** 0.5) ** 2) * wts).sum(-1)
    idx = d.argmin(-1)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = pal[idx].astype(np.uint8)
    out[..., 3] = np.where(mask, 255, 0)
    # contorno: opaco con algún vecino (4) transparente
    m = mask
    pad = np.pad(m, 1)
    # 8 vecinos: el contorno cierra también en diagonal (sin píxeles claros en el borde)
    edge = m & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
                 & pad[:-2, :-2] & pad[:-2, 2:] & pad[2:, :-2] & pad[2:, 2:])
    out[edge, :3] = OUTLINE
    # recorte con el origen en los pies
    x0 = root_col_art - CROP_W // 2
    y0 = bottom_art + 1 - CROP_H
    y1 = bottom_art + 1 + PAD_BOTTOM
    lost = int(m[:y0].sum() + m[y1:].sum() + m[:, :x0].sum() + m[:, x0 + CROP_W:].sum()) if y0 >= 0 else -1
    return out[y0:y1, x0:x0 + CROP_W], lost


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--contact', default=None)
    args = ap.parse_args()
    meta = json.load(open(os.path.join(args.raw, 'meta.json')))
    c = meta['calib']
    ss = c['ss']
    bottom_art = c['bottom_raw'] // ss
    root_col = c['art_w'] // 2
    pal = build_palette()
    os.makedirs(args.out, exist_ok=True)
    anims = {}
    rows = []
    for name, a in meta['anims'].items():
        anims[name] = {'frames': a['frames'], 'fps': round(a['fps'], 3), 'loop': a['loop'], 'dirs': a['dirs']}
        for d in a['dirs']:
            row = []
            for i in range(a['frames']):
                img, lost = pixelize(os.path.join(args.raw, name, d, f'{i:04d}.png'), pal, ss, root_col, bottom_art)
                if lost:
                    print(f'AVISO {name}/{d}/{i}: {lost} px fuera del recorte')
                Image.fromarray(img, 'RGBA').save(os.path.join(args.out, f'{name}_{d}_{i}.png'), optimize=True)
                row.append(img)
            rows.append(row)
    manifest = {
        'source': 'art/dex3d (Blender, A2.14)',
        'frameWidth': CROP_W, 'frameHeight': CROP_H + PAD_BOTTOM, 'artHeight': CROP_H,
        'origin': [0.5, CROP_H / (CROP_H + PAD_BOTTOM)],
        'file': '{anim}_{dir}_{i}.png',
        'strideArtPx': 20, 'walkArtPxPerS': 74,
        'anims': anims,
    }
    json.dump(manifest, open(os.path.join(args.out, 'dex3d.json'), 'w'), indent=1)
    if args.contact:
        mx = max(len(r) for r in rows)
        FH = CROP_H + PAD_BOTTOM
        sheet = np.zeros((len(rows) * FH, mx * CROP_W, 4), dtype=np.uint8)
        sheet[..., :3] = (70, 160, 110)
        sheet[..., 3] = 255
        for r, row in enumerate(rows):
            for i, img in enumerate(row):
                sub = sheet[r * FH:(r + 1) * FH, i * CROP_W:(i + 1) * CROP_W]
                m = img[..., 3] > 0
                sub[m] = img[m]
        Image.fromarray(sheet, 'RGBA').resize((mx * CROP_W * 3, len(rows) * FH * 3), Image.NEAREST).save(args.contact)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""A2.17 fase 3: máscaras de los trozos del primer plano con walk-behind (`foregroundLayers[].mask` de scene.json).

Un trozo con `mask` se dibuja con los píxeles del primer plano (la MISMA textura que carga el juego, así que no hay
costura ni halo) solo donde la máscara es opaca, a la profundidad de su base; GameScene borra esos mismos píxeles del
resto del primer plano. La máscara es un WebP sin pérdida del tamaño de `bounds` (en píxeles del maestro de 3712×1152).

  python3 scripts/make-fg-layers.py            genera las máscaras y, en outside, el arbusto del fondo en el primer plano
  python3 scripts/make-fg-layers.py --check    rc 1 si falta una máscara declarada en scene.json o no mide lo que toca

- mountain / maleza: la maleza del pie de las rocas (x 82–100, y 70–100) que está en foreground.png junto con las rocas.
  Se separa de la roca por color (hojas naranjas frente a roca morada; los oscuros y el tramado, por mayoría de vecinos
  en 15×15) dentro de una zona a mano (x ≥ 88 con y ≥ 70, o x ≥ 82 con y ≥ 84); por debajo de y 84 y a la derecha de
  x 86 es todo maleza (la roca grande queda tapada).
- outside / bush_left y bush_right: los dos arbustos están pintados en el FONDO. Se copian TAL CUAL (mismos píxeles,
  alfa 0/255: sin halo) del fondo a foreground.png donde dice la máscara, y se rehacen foreground.webp (sin pérdida) y
  las variantes @1280/@2048 (Lanczos + WebP calidad 90 con el alfa sin pérdida, como scripts/make-bg-variants.mjs).
  La máscara sale de una zona a mano por arbusto (borde de abajo medido a ojo) ∩ color de arbusto (oliva, amarillo,
  negro neutro; no la casa marrón ni el suelo negro rojizo) con el borde de arriba en la primera hoja oliva de cada
  columna, y nunca donde ya hay seto en foreground.png.

Idempotente: si la máscara ya existe, los píxeles bajo ella no cuentan como «seto que ya estaba» al volver a correr.
Sin servicios de pago: Pillow + numpy + scipy.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SCENES = os.path.join(ROOT, 'assets', 'scenes')
VARIANT_WIDTHS = [1280, 2048]  # los de src/systems/SceneTextures.ts


def px_rect(b, w, h):
    """Como pctRectToPx de GameScene: caja en % → píxeles enteros"""
    x0 = max(0, round(b['x'] / 100 * w)); y0 = max(0, round(b['y'] / 100 * h))
    x1 = min(w, round((b['x'] + b['w']) / 100 * w)); y1 = min(h, round((b['y'] + b['h']) / 100 * h))
    return x0, y0, x1, y1


def layers(scene):
    d = json.load(open(os.path.join(SCENES, scene, 'scene.json'), encoding='utf-8'))
    return {l['id']: l for l in d.get('foregroundLayers', []) if l.get('mask')}


def poly(pts, w, h):
    im = Image.new('L', (w, h), 0)
    ImageDraw.Draw(im).polygon([(x * w / 100, y * h / 100) for x, y in pts], fill=1)
    return np.array(im) > 0


def majority(yes, no, k):
    kern = np.ones((k, k))
    return np.where(yes, True, np.where(no, False, nd.convolve(yes.astype(float), kern, mode='constant') > nd.convolve(no.astype(float), kern, mode='constant')))


def save_mask(scene, layer, m, w, h):
    x0, y0, x1, y1 = px_rect(layer['bounds'], w, h)
    a = (m[y0:y1, x0:x1] * 255).astype(np.uint8)
    out = np.zeros((y1 - y0, x1 - x0, 4), np.uint8); out[..., :3] = 255; out[..., 3] = a
    path = os.path.join(SCENES, scene, layer['mask'])
    Image.fromarray(out, 'RGBA').save(path, 'WEBP', lossless=True, quality=100, method=6)
    print(f'{scene}/{layer["mask"]}: {x1 - x0}×{y1 - y0}, {int(m.sum())} px, {os.path.getsize(path) // 1024} KB')


def load_mask(scene, layer, w, h):
    path = os.path.join(SCENES, scene, layer['mask'])
    full = np.zeros((h, w), bool)
    if not os.path.exists(path):
        return full
    x0, y0, x1, y1 = px_rect(layer['bounds'], w, h)
    a = np.array(Image.open(path).convert('RGBA'))[..., 3] > 127
    full[y0:y0 + a.shape[0], x0:x0 + a.shape[1]] = a[: y1 - y0, : x1 - x0]
    return full


def mountain():
    L = layers('mountain')
    a = np.array(Image.open(os.path.join(SCENES, 'mountain', 'foreground.png')).convert('RGBA')).astype(int)
    h, w = a.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]; X = xs * 100 / w; Y = ys * 100 / h
    R, G, B, A = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    alpha = A > 128
    orange = (R > B + 15) & (R + G + B > 60)
    purple = ((B > R + 8) | ((B > G + 20) & (R < B + 10))) & (R + G + B > 30)
    fol = majority(orange, purple, 15)
    region = ((X >= 88) & (Y >= 70)) | ((X >= 82) & (Y >= 84))
    force = (Y >= 84) & (X >= 86)
    m = alpha & region & (fol | force)
    m = nd.binary_opening(m, iterations=1)
    m = nd.binary_closing(m, iterations=2) & alpha
    m = nd.binary_fill_holes(m) & alpha
    save_mask('mountain', L['maleza'], m, w, h)


def outside():
    L = layers('outside')
    fg_path = os.path.join(SCENES, 'outside', 'foreground.png')
    bg = np.array(Image.open(os.path.join(SCENES, 'outside', 'background.png')).convert('RGB')).astype(int)
    fg = np.array(Image.open(fg_path).convert('RGBA'))
    h, w = bg.shape[:2]
    prev = np.zeros((h, w), bool)
    for l in L.values():
        prev |= load_mask('outside', l, w, h)
    hedge = (fg[..., 3] > 0) & ~prev  # el seto que ya estaba en foreground.png
    R, G, B = bg[..., 0], bg[..., 1], bg[..., 2]
    mx = bg.max(-1); mn = bg.min(-1)
    olive = (R >= G) & (G > B) & (B < 0.5 * G + 8) & (G > 0.55 * R) & (mx > 25)
    neutral = (mx - mn <= 4) & (mx < 30)
    house = ((R - G > 25) & (B > 0.55 * G)) | ((G <= 3) & (R > G + 3))
    lab = majority(olive | neutral, house, 9)
    regions = {
        # zona a mano: generosa por arriba (manda la primera hoja oliva), ajustada abajo (base medida a ojo)
        'bush_left': [(5.5, 71.5), (20.6, 71.5), (20.6, 84), (19.6, 88), (19.4, 92.2), (18, 92.6), (16, 93.4), (13, 93),
                      (11, 92.6), (10.2, 92), (10.2, 84), (5.5, 84)],
        'bush_right': [(19.6, 84), (21, 80.5), (23.6, 80.5), (25, 86), (25.9, 93.6), (25, 94.4), (24, 94.7), (23, 96.5),
                       (22, 97.3), (21, 97.3), (20, 96.5), (19.4, 92.2), (19.6, 88)],
    }
    union = np.zeros((h, w), bool)
    for lid, pts in regions.items():
        reg = poly(pts, w, h) & ~union  # un píxel, un solo trozo
        ol = nd.binary_dilation(reg & olive & ~hedge, iterations=2)
        cols = np.where(ol.any(0), ol.argmax(0), h)
        cols = nd.minimum_filter1d(cols, size=9)
        top = np.arange(h)[:, None] >= cols[None, :]
        m = reg & lab & ~hedge & top
        m = nd.binary_opening(m, iterations=1)
        m = nd.binary_closing(m, iterations=2)
        m = nd.binary_fill_holes(m) & reg & ~hedge
        lb, n = nd.label(m)
        sizes = nd.sum(m, lb, range(1, n + 1))
        m &= np.isin(lb, [i + 1 for i, s in enumerate(sizes) if s > 400])
        save_mask('outside', L[lid], m, w, h)
        union |= m
    # los píxeles del arbusto, tal cual, al primer plano (alfa 255)
    fg[union, :3] = bg[union].astype(np.uint8)
    fg[union, 3] = 255
    img = Image.fromarray(fg, 'RGBA')
    img.save(fg_path, optimize=True)
    img.save(os.path.join(SCENES, 'outside', 'foreground.webp'), 'WEBP', lossless=True, quality=100, method=6)
    for vw in VARIANT_WIDTHS:
        vh = round(vw * h / w)
        v = img.convert('RGBa').resize((vw, vh), Image.LANCZOS).convert('RGBA')
        p = os.path.join(SCENES, 'outside', f'foreground@{vw}.webp')
        v.save(p, 'WEBP', quality=90, alpha_quality=100, method=6)
        print(f'outside/foreground@{vw}.webp: {os.path.getsize(p) // 1024} KB')


def check():
    bad = 0
    for scene in sorted(os.listdir(SCENES)):
        if not os.path.exists(os.path.join(SCENES, scene, 'scene.json')):
            continue
        for l in layers(scene).values():
            path = os.path.join(SCENES, scene, l['mask'])
            x0, y0, x1, y1 = px_rect(l['bounds'], 3712, 1152)
            if not os.path.exists(path):
                print(f'falta {scene}/{l["mask"]}'); bad += 1; continue
            size = Image.open(path).size
            if size != (x1 - x0, y1 - y0):
                print(f'{scene}/{l["mask"]} mide {size} y su bounds pide {(x1 - x0, y1 - y0)}'); bad += 1
    print('máscaras: ok' if not bad else f'máscaras: {bad} mal')
    return bad


if __name__ == '__main__':
    if '--check' in sys.argv:
        sys.exit(1 if check() else 0)
    mountain()
    outside()

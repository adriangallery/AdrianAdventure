#!/usr/bin/env python3
# F1 (plan SCUMM, «Arte pendiente»): fondo nuevo de la azotea a partir del arte de Adrián (Gem «Scumm Engine»,
# art/rooftop/rooftop-gem-v1.jpeg, 1376x768, 16:9). Determinista: mismo JPEG => mismos bytes.
#
#   1. Franja y 135..625 del JPEG (490 px de alto, ancho entero): entra TODO lo interactivo (parabólica entera, veleta,
#      trampillas, puerta hasta el suelo y el suelo andable hasta el borde del tejado). Una franja 3,2:1 pura (430 px)
#      cortaba la parabólica o los pies de la puerta (ver docs/progreso/F1.md y --compare).
#   2-3. Limpieza de JPEG = cuantización SIN tramado a la paleta de la casa: el ruido y los halos del JPEG caen en el
#      color plano más cercano. 192 colores sacados (corte por la mediana) de los fondos de upstairs, lobby y el rooftop
#      anterior (de noche; pesa 6 veces para que los grises lavanda no se vayan al verde azulado de la casa), más el rojo
#      de la luz del sótano y el amarillo de las luces. Se probó una mediana 3x3 antes: se comía las luces de la ciudad
#      y las estrellas (2 px en el JPEG), así que no se usa.
#   4. Escala a 3712x1152 por vecino más cercano: x ×2,698, y ×2,351 (anisotropía 14,8 %, dentro del 15 % pedido).
#   5. vane_flipped: la B y la flecha de la veleta en espejo sobre el eje del mástil, recortadas a su caja; escribe
#      bounds en scene.json (conditionalOverlays[id=vane_flipped]). A9.12: la rosa de los vientos (N/S/E/W) NO gira
#      (sus letras saldrían en espejo) y el cielo se queda como estaba (la estrella no cambia de lado): solo se toman
#      del espejo los píxeles que son veleta, y lo que coincide con el fondo queda transparente (sin borde de caja).
#
# Uso:  python3 scripts/make-rooftop-bg.py                 escribe background.png/.webp, @2048, @1280 y vane_flipped.webp
#       python3 scripts/make-rooftop-bg.py --vane-only     solo vane_flipped.webp, a partir del background.png que hay
#       python3 scripts/make-rooftop-bg.py --compare OUT   además una hoja comparando los recortes posibles
# Las variantes @2048/@1280 se hacen como scripts/make-bg-variants.mjs (Lanczos, WebP con pérdida q90) pero con Pillow,
# para no depender de sharp; `node scripts/make-bg-variants.mjs --check` las da por buenas (solo mira tamaños).
import json
import os
import sys

from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art', 'rooftop', 'rooftop-gem-v1.jpeg')
SCENE_DIR = os.path.join(ROOT, 'assets', 'scenes', 'rooftop')
PALETTE_FROM = [('upstairs', 1), ('lobby', 1)]
OLD_ROOFTOP = os.path.join(ROOT, 'art', 'rooftop', 'rooftop-old-palette.png')  # copia reducida del fondo anterior
W, H = 3712, 1152
CROP = (0, 135, 1376, 625)
N_COLORS = 192
EXTRA = [(255, 64, 56), (200, 40, 40), (255, 210, 120)]  # luz roja (núcleo y halo) y luces de la ciudad
VARIANTS = (1280, 2048)
WEBP_Q = 90


def build_palette():
    tiles = []
    for scene, weight in PALETTE_FROM:
        im = Image.open(os.path.join(ROOT, 'assets', 'scenes', scene, 'background.png')).convert('RGB')
        tiles += [im.resize((928, 288), Image.NEAREST)] * weight
    old = Image.open(OLD_ROOFTOP).convert('RGB').resize((928, 288), Image.NEAREST)
    tiles += [old] * 6
    mosaic = Image.new('RGB', (928, 288 * len(tiles)))
    for i, t in enumerate(tiles):
        mosaic.paste(t, (0, 288 * i))
    q = mosaic.quantize(colors=N_COLORS - len(EXTRA), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    flat = q.getpalette()[: 3 * (N_COLORS - len(EXTRA))]
    for c in EXTRA:
        flat += list(c)
    pal = Image.new('P', (1, 1))
    pal.putpalette(flat + [0] * (768 - len(flat)))
    return pal


def make_background():
    src = Image.open(SRC).convert('RGB')
    band = src.crop(CROP)
    q = band.quantize(palette=build_palette(), dither=Image.Dither.NONE).convert('RGB')
    return q.resize((W, H), Image.NEAREST)


def write_variants(bg):
    bg.save(os.path.join(SCENE_DIR, 'background.png'), optimize=True)
    bg.save(os.path.join(SCENE_DIR, 'background.webp'), lossless=True, quality=100, method=4)
    for w in VARIANTS:
        h = max(1, round(w * H / W))
        bg.resize((w, h), Image.LANCZOS).save(os.path.join(SCENE_DIR, f'background@{w}.webp'), quality=WEBP_Q, method=6)


def mast_axis(bg, y0, y1, x0, x1):
    """Columna del mástil: la más oscura de media en una franja donde solo hay mástil y cielo."""
    px = bg.load()
    best, bx = None, x0
    for x in range(x0, x1):
        s = sum(sum(px[x, y]) for y in range(y0, y1, 4))
        if best is None or s < best:
            best, bx = s, x
    return bx


DILATE = 4  # px del maestro
ROSE_TOP = 289  # y del JPEG entre la flecha (acaba en ≈ 282) y la rosa de los vientos (empieza en ≈ 294): solo mástil


def is_vane(p):
    """Veleta = cobre (más rojo que azul) o contorno oscuro; el cielo es azul lavanda (y las estrellas, claras)."""
    r, g, b = p[:3]
    return r > b + 8 or (r + g + b) < 150


def vane_overlay(crop, flip, split):
    """A9.12: de `split` hacia arriba (B y flecha), el espejo, pero solo donde hay veleta en el original o en el espejo
    (donde el original era veleta y el espejo es cielo, sale el cielo del espejo: misma fila, mismo degradado). De
    `split` hacia abajo (rosa de los vientos y mástil), el original. Los píxeles iguales al fondo quedan transparentes."""
    w, h = crop.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    po, pf, pd = crop.load(), flip.load(), out.load()
    # máscara de veleta (original o espejo), engordada DILATE px: el halo de contorno del JPEG (azul oscuro, que
    # is_vane no ve) también se cambia, para que no quede un fantasma de la veleta vieja alrededor de la nueva
    mask = Image.new('L', (w, h), 0)
    pm = mask.load()
    for y in range(min(split, h)):
        for x in range(w):
            if is_vane(po[x, y]) or is_vane(pf[x, y]):
                pm[x, y] = 255
    mask = mask.filter(ImageFilter.MaxFilter(2 * DILATE + 1))
    pm = mask.load()
    for y in range(min(split, h)):
        for x in range(w):
            if pm[x, y] and pf[x, y] != po[x, y]:
                pd[x, y] = pf[x, y] + (255,)
    return out


def make_vane(bg):
    sx, sy = W / (CROP[2] - CROP[0]), H / (CROP[3] - CROP[1])
    # el mástil, en el JPEG, va de x≈990 a 996 entre y≈345 y 380 (debajo de la rosa de los vientos, encima del pretil)
    ax0 = mast_axis(bg, int((345 - CROP[1]) * sy), int((380 - CROP[1]) * sy), int(985 * sx), int(1001 * sx))
    # ancho del mástil: columnas oscuras contiguas
    px = bg.load()
    yy = int((360 - CROP[1]) * sy)
    lum = lambda x: sum(px[x, yy])
    ref = lum(ax0)
    left, right = ax0, ax0
    while lum(left - 1) <= ref + 60:
        left -= 1
    while lum(right + 1) <= ref + 60:
        right += 1
    axis2 = left + right  # eje × 2 (el mástil puede tener ancho par)
    # cabeza de la veleta: del JPEG x 900..1085, y 160..340 => caja simétrica sobre el eje
    top, bottom = int((158 - CROP[1]) * sy), int((342 - CROP[1]) * sy)
    half = int(max(axis2 / 2 - 900 * sx, 1085 * sx - axis2 / 2)) + 4
    x0 = (axis2 + 1) // 2 - half
    x1 = x0 + 2 * half + (axis2 % 2)
    box = (x0, top, x1, bottom)
    crop = bg.crop(box).convert('RGB')
    flip = crop.transpose(Image.FLIP_LEFT_RIGHT)
    vane_overlay(crop, flip, int((ROSE_TOP - CROP[1]) * sy) - top).save(
        os.path.join(SCENE_DIR, 'vane_flipped.webp'), lossless=True, quality=100, method=6)
    b = {'x': round(x0 / W * 100, 4), 'y': round(top / H * 100, 4), 'w': round((x1 - x0) / W * 100, 4),
         'h': round((bottom - top) / H * 100, 4)}
    path = os.path.join(SCENE_DIR, 'scene.json')
    txt = open(path, encoding='utf-8').read()
    data = json.loads(txt)
    for co in data.get('conditionalOverlays', []):
        if co.get('id') == 'vane_flipped':
            co['bounds'] = b
    with open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    return box, b, (left, right)


def compare(out):
    src = Image.open(SRC).convert('RGB')
    opts = [
        ('A · franja 135-625 escalada no uniforme (14,8 %) [elegida]', (0, 135, 1376, 625)),
        ('B · recorte 3,2:1 puro 195-625 (corta la parabólica)', (0, 195, 1376, 625)),
        ('C · recorte 3,2:1 puro 135-565 (corta los pies de la puerta y el suelo)', (0, 135, 1376, 565)),
        ('D · franja 135-625 a escala uniforme con bandas laterales (1568 de ancho)', None),
    ]
    tw, th = 1160, 362
    sheet = Image.new('RGB', (tw, (th + 24) * len(opts)), (20, 20, 20))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, (label, box) in enumerate(opts):
        if box:
            im = src.crop(box).resize((tw, th), Image.NEAREST)
        else:
            band = src.crop((0, 135, 1376, 625))
            im = Image.new('RGB', (1568, 490), (0, 0, 0))
            im.paste(band, (96, 0))
            im = im.resize((tw, th), Image.NEAREST)
        sheet.paste(im, (0, i * (th + 24) + 24))
        d.text((6, i * (th + 24) + 6), label, fill=(255, 255, 255))
    sheet.save(out)


if __name__ == '__main__':
    if '--compare' in sys.argv:
        compare(sys.argv[sys.argv.index('--compare') + 1])
    if '--vane-only' in sys.argv:
        bg = Image.open(os.path.join(SCENE_DIR, 'background.png')).convert('RGB')
    else:
        bg = make_background()
        write_variants(bg)
    box, b, mast = make_vane(bg)
    print('fondo', bg.size, 'colores', len(bg.getcolors(1 << 16) or []), 'veleta', box, b, 'mástil', mast)

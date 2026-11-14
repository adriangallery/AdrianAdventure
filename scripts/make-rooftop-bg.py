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

from PIL import Image

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


def write_variants(bg):
    bg.save(os.path.join(SCENE_DIR, 'background.png'), optimize=True)
    bg.save(os.path.join(SCENE_DIR, 'background.webp'), lossless=True, quality=100, method=4)
    for w in VARIANTS:
        h = max(1, round(w * H / W))
        bg.resize((w, h), Image.LANCZOS).save(os.path.join(SCENE_DIR, f'background@{w}.webp'), quality=WEBP_Q, method=6)


# ---------------------------------------------------------------------------------------------------------------
# A9.16: la veleta se trabaja en el espacio del JPEG (franja cuantizada de 1376x490), donde el mástil tiene 8 px
# (x 989..996) y su eje cae EXACTO entre dos columnas (992,5): el espejo es x -> 1985 - x, sin medio píxel suelto.
# El estado volteado se compone ahí entero y el overlay es la DIFERENCIA con el fondo, ya escalada: opacos solo los
# píxeles que cambian, con su color exacto, y el resto alfa 0. Fondo + overlay = estado volteado, bit a bit.
MAST = (989, 996)          # columnas del mástil en la franja
FLIP_SUM = 2 * 992 + 1     # x' = FLIP_SUM - x
HEAD = (900, 15, 1086, 155)  # caja de la cabeza (B y flecha) en la franja: x0, y0, x1, y1 (excl.)
ROSE = (936, 155, 1050, 201)  # caja de la rosa de los vientos en la franja (se redibuja, ver draw_rose)
HALO_RING, HALO_DELTA = 2, 6
OUTLINE, CU, CU_HI, CU_LO = (13, 4, 4), (127, 92, 71), (175, 154, 136), (99, 68, 49)


def is_sky(p):
    """Cielo = azul lavanda (b claramente por encima de r) de luminancia media. El contorno oscuro, el cobre, el
    halo azul oscuro del JPEG, el mástil gris claro y las estrellas NO son cielo."""
    r, g, b = p[:3]
    return b - r >= 50 and 250 <= r + g + b <= 480


def sky_fill(px, keep, x, y, x0, x1):
    """Cielo REAL del propio fondo para (x, y): el píxel de la misma fila que queda fuera de la máscara, buscando
    hacia el lado más cercano de la caja en saltos del ancho del hueco (así se copia la textura y el tramado de esa
    fila, sin rayas de una sola columna repetida)."""
    run_l = x
    while run_l - 1 >= x0 and not keep(run_l - 1, y):
        run_l -= 1
    run_r = x
    while run_r + 1 < x1 and not keep(run_r + 1, y):
        run_r += 1
    width = run_r - run_l + 1
    step = -width if (x - run_l) <= (run_r - x) else width
    sx = x + step
    while 0 <= sx < x1 + 400 and not keep(sx, y):
        sx += step
    return px[sx, y]


FONT = {
    'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
}


def draw_rose(band):
    """A9.16: la rosa de los vientos del arte de la Gem tiene los brazos de 1 px con huecos y la W y la N de 3 px:
    en el juego se ve «partida» (solo se leen trozos de la S y la E). Se borra (con cielo real de su fila) y se
    redibuja en la misma posición y perspectiva (dos brazos en aspa, W–E y S–N, N y W al fondo), con brazos
    enteros de 2 px de cobre y contorno, buje sobre el mástil y las cuatro letras derechas (5x7 a 2x, con
    contorno). Lo mismo en los dos estados: el overlay de la veleta no la toca."""
    px = band.load()
    x0, y0, x1, y1 = ROSE
    old = [(x, y) for y in range(y0, y1) for x in range(x0, x1)
           if not (MAST[0] <= x <= MAST[1]) and not is_sky(px[x, y])]
    gone = set(old)
    keep = lambda x, y: (x, y) not in gone and not (MAST[0] <= x <= MAST[1]) and is_sky(px[x, y])
    # y el halo del JPEG alrededor (como en flipped_band): lo que difiere del cielo de su fila
    ring = {(x + dx, y + dy) for (x, y) in old for dx in range(-HALO_RING, HALO_RING + 1)
            for dy in range(-HALO_RING, HALO_RING + 1)} - gone
    ring = {(x, y) for (x, y) in ring if x0 <= x < x1 and y0 <= y < y1 and not (MAST[0] <= x <= MAST[1])}
    keep = lambda x, y: (x, y) not in gone and (x, y) not in ring and not (MAST[0] <= x <= MAST[1]) and is_sky(px[x, y])
    for p in ring:
        c = sky_fill(px, keep, p[0], p[1], x0, x1)
        if max(abs(c[i] - px[p][i]) for i in range(3)) > HALO_DELTA:
            old.append(p)
    fill = {p: sky_fill(px, keep, p[0], p[1], x0, x1) for p in old}
    for p, c in fill.items():
        px[p] = c
    cx2, cy = FLIP_SUM, 177  # centro x2 (992,5) y fila del cruce

    def line(xa, ya, xb, yb, thick, color):
        n = max(abs(xb - xa), abs(yb - ya))
        for i in range(n + 1):
            x = round(xa + (xb - xa) * i / n)
            y = round(ya + (yb - ya) * i / n)
            for dy in range(thick):
                px[x, y + dy] = color

    arms = [((952, 168), (1033, 184)), ((952, 184), (1033, 168))]  # W→E y S→N
    for (xa, ya), (xb, yb) in arms:
        line(xa, ya - 1, xb, yb - 1, 4, OUTLINE)
    for (xa, ya), (xb, yb) in arms:
        line(xa, ya, xb, yb, 1, CU_HI)
        line(xa, ya + 1, xb, yb + 1, 1, CU)
    # buje sobre el mástil
    for y in range(cy - 4, cy + 5):
        for x in range(MAST[0] - 1, MAST[1] + 2):
            edge = y in (cy - 4, cy + 4) or x in (MAST[0] - 1, MAST[1] + 1)
            px[x, y] = OUTLINE if edge else (CU_HI if y < cy - 1 else CU if y < cy + 2 else CU_LO)

    def letter(ch, lx, ly):
        on = {(lx + 1 + 2 * c + dx, ly + 1 + 2 * r + dy) for r, row in enumerate(FONT[ch]) for c, v in enumerate(row)
              if v == '1' for dx in (0, 1) for dy in (0, 1)}
        for (x, y) in on:
            for ox in (-1, 0, 1):
                for oy in (-1, 0, 1):
                    if (x + ox, y + oy) not in on:
                        px[x + ox, y + oy] = OUTLINE
        for (x, y) in on:
            px[x, y] = CU_HI if (x, y - 1) not in on else (CU_LO if (x, y + 1) not in on else CU)

    letter('W', 940, 158)
    letter('N', 1034, 158)
    letter('S', 940, 182)
    letter('E', 1034, 182)
    return band


def make_band():
    """Franja cuantizada del JPEG con la rosa redibujada (A9.16): la base de background.png."""
    src = Image.open(SRC).convert('RGB')
    band = src.crop(CROP)
    q = band.quantize(palette=build_palette(), dither=Image.Dither.NONE).convert('RGB')
    return draw_rose(q)


def flipped_band(band):
    """Estado volteado (vane_pushed) en la franja: la B y la flecha en espejo sobre el eje del mástil (regla de
    A9.12: la rosa y el mástil no giran, el cielo y sus estrellas se quedan donde están).
      - O = lo que no es cielo en la caja de la cabeza (B, flecha, contorno y el halo oscuro del JPEG).
      - Donde estaba O, cielo REAL de la misma fila (sky_fill), no el del espejo (A9.12 lo tomaba del espejo y,
        con la máscara engordada 4 px, dejaba manchas de un azul algo distinto alrededor de la B y la flecha).
      - Donde cae el espejo de O, el píxel del espejo.
      - El tramo de mástil entre la flecha y la rosa, el original (con el brillo a su lado)."""
    px = band.load()
    x0, y0, x1, y1 = HEAD
    cand = {(x, y) for y in range(y0, y1) for x in range(x0, x1) if not is_sky(px[x, y])}
    # solo la pieza conexa de la veleta (8-vecinos desde el mástil bajo la flecha): las estrellas no se mueven
    seed = next((MAST[0], y) for y in range(y1 - 1, y0, -1) if (MAST[0], y) in cand)
    O, todo = {seed}, [seed]
    while todo:
        x, y = todo.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                n = (x + dx, y + dy)
                if n in cand and n not in O:
                    O.add(n)
                    todo.append(n)
    shaft_rows = [y for y in range(y0, y1) if sum((x, y) in O for x in range(x0, x1)) > 60]
    stem_from = max(shaft_rows) + 1  # primera fila bajo el asta de la flecha
    for y in range(stem_from, y1):
        for x in range(MAST[0] - 1, MAST[1] + 2):
            O.discard((x, y))
    M = {(FLIP_SUM - x, y) for (x, y) in O}
    # anillo de HALO_RING px alrededor de la veleta: el halo claro/oscuro del JPEG pasa por cielo en is_sky, pero
    # sin la veleta delante deja su fantasma (un contorno de la flecha vieja); se borra lo que difiere del cielo de
    # su fila en más de HALO_DELTA
    ring = set()
    for (x, y) in O:
        for dx in range(-HALO_RING, HALO_RING + 1):
            for dy in range(-HALO_RING, HALO_RING + 1):
                n = (x + dx, y + dy)
                if n not in O and y0 <= n[1] < y1 and not (MAST[0] - 1 <= n[0] <= MAST[1] + 1 and n[1] >= stem_from):
                    ring.add(n)
    out = band.copy()
    po = out.load()
    keep = lambda x, y: (x, y) not in O and (x, y) not in M and (x, y) not in ring and is_sky(px[x, y])
    E = set(O)
    for (x, y) in ring:
        c = sky_fill(px, keep, x, y, x0, x1)
        if max(abs(c[i] - px[x, y][i]) for i in range(3)) > HALO_DELTA:
            E.add((x, y))
    for (x, y) in E - M:
        po[x, y] = sky_fill(px, keep, x, y, x0, x1)
    for (x, y) in M:
        po[x, y] = px[FLIP_SUM - x, y]
    return out, (E | M)


def up(im):
    return im.resize((W, H), Image.NEAREST)


def make_vane(band, bg):
    """vane_flipped.webp = diferencia entre el estado volteado y el fondo (ya escalados), recortada a lo que tiene
    contenido + 2 px como scripts/crop-overlays.mjs (MARGIN_PX). Escribe bounds en scene.json."""
    fl, _ = flipped_band(band)
    flm = up(fl)
    a, b_ = bg.load(), flm.load()
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    po = ov.load()
    sx, sy = W / band.width, H / band.height
    bx0, by0 = int(HEAD[0] * sx) - 2, int(HEAD[1] * sy) - 2
    bx1, by1 = int(HEAD[2] * sx) + 3, int(HEAD[3] * sy) + 3
    for y in range(by0, by1):
        for x in range(bx0, bx1):
            if a[x, y] != b_[x, y]:
                po[x, y] = b_[x, y] + (255,)
    l, t, r, btm = ov.split()[3].getbbox()
    l, t, r, btm = l - 2, t - 2, r + 2, btm + 2
    ov.crop((l, t, r, btm)).save(os.path.join(SCENE_DIR, 'vane_flipped.webp'), lossless=True, quality=100, method=6)
    b = {'x': round(l / W * 100, 4), 'y': round(t / H * 100, 4), 'w': round((r - l) / W * 100, 4),
         'h': round((btm - t) / H * 100, 4)}
    path = os.path.join(SCENE_DIR, 'scene.json')
    txt = open(path, encoding='utf-8').read()
    data = json.loads(txt)
    for co in data.get('conditionalOverlays', []):
        if co.get('id') == 'vane_flipped':
            co['bounds'] = b
    with open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    return (l, t, r, btm), b, flm


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
    band = make_band()
    bg = up(band)
    if '--vane-only' not in sys.argv:
        write_variants(bg)
    box, b, flm = make_vane(band, bg)
    if '--flipped' in sys.argv:  # estado volteado completo, para revisarlo a mano
        flm.save(sys.argv[sys.argv.index('--flipped') + 1])
    print('fondo', bg.size, 'colores', len(bg.getcolors(1 << 16) or []), 'veleta', box, b)

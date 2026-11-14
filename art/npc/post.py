#!/usr/bin/env python3
"""Arte pendiente N1/N2: posproceso determinista de los originales de Gemini (art/npc/originales/) a sprites del juego.

Pasos (todos por código, ningún fotograma más se pide a Gemini):
  1. Fondo fuera: el color liso de las esquinas (magenta) y lo que se le parece → alfa 0.
  2. Recorte a la caja del personaje y reducción a la rejilla de píxeles de arte con la MODA de cada celda (el color
     que más se repite, no la media: sin colores intermedios ni bordes borrosos). Celda opaca si lo es más de la mitad.
  3. Cuantización a la paleta del sprite de referencia (el busto actual, Dex o el mono): cada píxel toma el color más
     cercano de esa paleta y luego la paleta se reduce a los N más usados.
  4. Contorno oscuro de 1 px por fuera (el negro de la referencia) y alfa solo 0 o 255 (sin halo ni semitransparencias).
  5. Fotogramas derivados del base: `_talk` (boca abierta), `_blink` (párpado sobre los ojos/gafas) o respirar (1 px).

Uso:  python3 art/npc/post.py penny      → assets/sprites/npcs/receptionist{,_talk,_blink}.png
      python3 art/npc/post.py chad       → art/npc/candidatos/ o assets/sprites/npcs/chad*.png (ver CONFIG)
Vistas ×8 y composiciones: /var/tmp/adv-gifs/arte-npc/
"""
import os, sys
from collections import Counter
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
VIS = '/var/tmp/adv-gifs/arte-npc'


def rgba(path):
    return np.array(Image.open(os.path.join(ROOT, path)).convert('RGBA'))


def key_out(img, tol=90):
    """Alfa 0 a todo lo parecido al color de fondo (mediana de las esquinas) y a lo muy magenta."""
    a = img.astype(int)
    h, w = a.shape[:2]
    corners = np.concatenate([a[:8, :8].reshape(-1, 4), a[:8, -8:].reshape(-1, 4), a[-8:, :8].reshape(-1, 4), a[-8:, -8:].reshape(-1, 4)])
    bg = np.median(corners[:, :3], 0)
    d = np.sqrt(((a[:, :, :3] - bg) ** 2).sum(2))
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    magenta = (r > 140) & (b > 90) & (g < 90) & (r - g > 90) & (b - g > 50)
    out = img.copy()
    out[:, :, 3] = np.where((d < tol) | magenta, 0, 255)
    return out


def bbox(a):
    ys, xs = np.nonzero(a[:, :, 3] > 0)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def largest_blob(img):
    """Solo el trozo opaco más grande (quita motas sueltas del fondo)."""
    m = img[:, :, 3] > 0
    lab = np.zeros(m.shape, int)
    cur = 0
    sizes = {}
    h, w = m.shape
    for y0 in range(h):
        for x0 in range(w):
            if m[y0, x0] and not lab[y0, x0]:
                cur += 1
                st = [(y0, x0)]; lab[y0, x0] = cur; n = 0
                while st:
                    y, x = st.pop(); n += 1
                    for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= yy < h and 0 <= xx < w and m[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = cur; st.append((yy, xx))
                sizes[cur] = n
    keep = max(sizes, key=sizes.get)
    out = img.copy()
    out[lab != keep] = 0
    return out


def mode_downscale(img, tw, th):
    """Celda a celda: el color más frecuente (cuantizado a 4 bits para contar) entre los opacos; opaca si > 50 %."""
    h, w = img.shape[:2]
    out = np.zeros((th, tw, 4), np.uint8)
    for j in range(th):
        y0, y1 = int(round(j * h / th)), max(int(round((j + 1) * h / th)), int(round(j * h / th)) + 1)
        for i in range(tw):
            x0, x1 = int(round(i * w / tw)), max(int(round((i + 1) * w / tw)), int(round(i * w / tw)) + 1)
            cell = img[y0:y1, x0:x1].reshape(-1, 4)
            op = cell[cell[:, 3] > 0]
            if len(op) * 2 <= len(cell):
                continue
            # moda sobre colores redondeados; el color de salida es la media de los de esa moda (estable)
            q = (op[:, :3] // 24)
            keys = [tuple(k) for k in q]
            best = Counter(keys).most_common(1)[0][0]
            sel = op[(q == best).all(1)]
            out[j, i, :3] = sel[:, :3].mean(0).round()
            out[j, i, 3] = 255
    return out


def palette_of(paths):
    cols = Counter()
    for p in paths:
        # (ruta, caja) = solo ese recorte (p. ej. el mono pintado en el fondo de la escena)
        a = rgba(p[0])[p[1][1]:p[1][3], p[1][0]:p[1][2]] if isinstance(p, tuple) else rgba(p)
        for c in a.reshape(-1, 4):
            if c[3] > 0:
                cols[tuple(int(v) for v in c[:3])] += 1
    return np.array(list(cols.keys()), int)


def quantize(img, pal, n_colors=None):
    a = img.astype(int)
    m = a[:, :, 3] > 0
    px = a[m][:, :3]
    d = ((px[:, None, :] - pal[None, :, :]) ** 2).sum(2)
    idx = d.argmin(1)
    if n_colors:
        used = Counter(idx.tolist())
        keep = np.array([k for k, _ in used.most_common(n_colors)])
        sub = pal[keep]
        d2 = ((px[:, None, :] - sub[None, :, :]) ** 2).sum(2)
        newcols = sub[d2.argmin(1)]
    else:
        newcols = pal[idx]
    out = img.copy()
    out[m, :3] = newcols
    out[:, :, 3] = np.where(m, 255, 0)
    return out


def outline(img, color):
    """Contorno de 1 px por fuera (4 vecinos) con `color`. El lienzo crece 1 px por lado."""
    h, w = img.shape[:2]
    out = np.zeros((h + 2, w + 2, 4), np.uint8)
    out[1:-1, 1:-1] = img
    m = out[:, :, 3] > 0
    n = np.zeros(m.shape, bool)
    n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
    ring = n & ~m
    out[ring, :3] = color
    out[ring, 3] = 255
    return out


def clean_orphans(img):
    a = img[:, :, 3] > 0
    n = np.zeros(a.shape, int)
    n[1:] += a[:-1]; n[:-1] += a[1:]; n[:, 1:] += a[:, :-1]; n[:, :-1] += a[:, 1:]
    img[a & (n == 0)] = 0
    return img


def is_red(c):
    r, g, b = int(c[0]), int(c[1]), int(c[2])
    return r > 150 and g < 110 and r - g > 80 and r - b > 60


def is_lens(c):
    r, g, b = int(c[0]), int(c[1]), int(c[2])
    return b > 120 and g > 90 and r < 120


def talk_from(base, head_rows, dark, face_cols):
    """Boca abierta: en la fila central de los labios (píxeles rojos de la cabeza) pone el interior oscuro y el labio
    de abajo baja 1 px. Si no encuentra labios, devuelve None."""
    t = base.copy()
    reds = [(y, x) for y in range(*head_rows) for x in range(*face_cols) if base[y, x, 3] and is_red(base[y, x])]
    if not reds:
        return None
    ys = sorted({y for y, _ in reds})
    ymid = ys[len(ys) // 2]
    xs = [x for y, x in reds if y == ymid]
    lo, hi = min(xs), max(xs)
    lip = base[ymid, lo].copy()
    for x in range(lo, hi + 1):
        t[ymid, x, :3] = dark
        if t[ymid + 1, x, 3]:
            t[ymid + 1, x, :3] = lip[:3]
    return t


def blink_from(base, head_rows, lid):
    """Parpadeo: la fila de arriba de cada cristal (o de los ojos) toma el color del párpado."""
    b = base.copy()
    cells = [(y, x) for y in range(*head_rows) for x in range(base.shape[1]) if base[y, x, 3] and is_lens(base[y, x])]
    if not cells:
        return None
    top = min(y for y, _ in cells)
    for y, x in cells:
        if y <= top + 1:
            b[y, x, :3] = lid
    return b


def x8(a, z=8):
    return Image.fromarray(a).resize((a.shape[1] * z, a.shape[0] * z), Image.NEAREST)


def side_by_side(frames, ref, path, z=8, bg=(120, 150, 120, 255)):
    cells = [ref] + frames
    W = sum(c.shape[1] + 4 for c in cells) * z
    H = max(c.shape[0] for c in cells) * z
    sheet = Image.new('RGBA', (W, H), bg)
    x = 0
    for c in cells:
        sheet.alpha_composite(x8(c, z), (x * z, H - c.shape[0] * z))
        x += c.shape[1] + 4
    sheet.save(path)


# ── configuración por personaje ────────────────────────────────────────────────────────────────────────────────
CONFIG = {
    'penny': dict(src='penny_a.png', h=103, pal=['assets/sprites/npcs/receptionist.png', 'assets/sprites/npcs/receptionist_talk.png'],
                  colors=None, head=(0, 22), face=(12, 26), cool_from=70, out='assets/sprites/npcs/receptionist', ref='assets/sprites/player/dex2d/idle_0.png'),
    'chad': dict(src='chad_a.png', h=44, w=48, pal=['assets/sprites/player/Ape-Idle-1.png',
                                                    ('assets/scenes/recovery_pool/background.png', (2290, 760, 2600, 1020))],
                 colors=None, head=(10, 30), face=(14, 34), mouth=(19, 17, 24), out='art/npc/candidatos/chad', ref='assets/sprites/player/dex2d/idle_0.png', breathe=True),
}


def run(name):
    C = CONFIG[name]
    src = np.array(Image.open(os.path.join(HERE, 'originales', C['src'])).convert('RGBA'))
    k = key_out(src)
    # motas: solo el trozo más grande, sobre una copia reducida para que vaya rápido, y se aplica la máscara
    small = k[::4, ::4].copy()
    keep = largest_blob(small)[:, :, 3] > 0
    big = np.kron(keep, np.ones((4, 4), bool))[:k.shape[0], :k.shape[1]]
    pad = np.zeros(k.shape[:2], bool); pad[:big.shape[0], :big.shape[1]] = big
    # dilatar 4 px para no comerse bordes finos
    for _ in range(4):
        d = pad.copy(); d[1:] |= pad[:-1]; d[:-1] |= pad[1:]; d[:, 1:] |= pad[:, :-1]; d[:, :-1] |= pad[:, 1:]; pad = d
    k[~pad] = 0
    x0, y0, x1, y1 = bbox(k)
    k = k[y0:y1, x0:x1]
    ih = C['h'] - 2
    iw = C['w'] - 2 if 'w' in C else max(1, int(round(k.shape[1] * ih / k.shape[0])))
    small = mode_downscale(k, iw, ih)
    pal = palette_of(C['pal'])
    q = clean_orphans(quantize(small, pal, C['colors']))
    darkest = pal[(pal.sum(1)).argmin()]
    for y in range(C.get('cool_from', q.shape[0]), q.shape[0]):
        # medias / pantalón: sin manchas cálidas sueltas (la reducción mete algún píxel de piel en la rodilla)
        for x in range(q.shape[1]):
            c = q[y, x].astype(int)
            if c[3] and c[0] - c[2] > 30:
                nb = [q[y, xx] for xx in (x - 1, x + 1, x - 2, x + 2) if 0 <= xx < q.shape[1] and q[y, xx, 3] and int(q[y, xx, 0]) - int(q[y, xx, 2]) <= 30]
                if nb:
                    q[y, x] = nb[0]
    base = outline(q, darkest)
    frames = {'': base}
    t = talk_from(base, C['head'], darkest, C.get('face', (0, base.shape[1])))
    if t is not None:
        frames['_talk'] = t
    if name == 'penny':
        b = blink_from(base, C['head'], darkest)
        if b is not None:
            frames['_blink'] = b
    if 'mouth' in C:
        # boca dibujada como raya oscura (Chad): abrir = oscurecer 2 filas por debajo de la raya (y 1 fila, medio abierta)
        my, mx0, mx1 = C['mouth']
        t1 = base.copy(); t2 = base.copy()
        for x in range(mx0, mx1 + 1):
            t1[my + 1, x, :3] = darkest
            t2[my + 1, x, :3] = darkest
            if mx0 < x < mx1:
                t1[my + 2, x, :3] = darkest
        frames['_talk'] = t1
        frames['_talk1'] = t2
    if C.get('breathe'):
        # respirar: el pecho (mitad de arriba) sube 1 px en los fotogramas 1 y 2; 3 = como 1
        br = base.copy(); hh = base.shape[0] // 2
        br[:hh - 1] = base[1:hh]; br[hh - 1] = base[hh]
        frames['_breathe'] = br
    out = os.path.join(ROOT, C['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for suf, a in frames.items():
        a[:, :, 3] = np.where(a[:, :, 3] > 0, 255, 0)
        Image.fromarray(a).save(out + suf + '.png', optimize=True)
        print(os.path.relpath(out + suf + '.png', ROOT), a.shape[1], 'x', a.shape[0],
              'colores', len({tuple(c) for c in a.reshape(-1, 4) if c[3]}))
    os.makedirs(VIS, exist_ok=True)
    side_by_side(list(frames.values()), rgba(C['ref']), os.path.join(VIS, f'{name}-junto-a-dex.png'))
    return frames


if __name__ == '__main__':
    for n in sys.argv[1:] or ['penny']:
        run(n)

#!/usr/bin/env python3
"""A2.16: PRUEBA de estilo «Dex de papel» (detrás de ?dex=papel).

Mismo sprite y mismas piezas del rig de A2.15 (art/dex2d/build.py + rig.json; el aspecto no cambia). Lo que cambia
es la MANERA de moverse, la de un muñeco recortado en papel:
  - piezas rígidas que pivotan (brazos sin doblar el codo al andar, zapato plano) y poses A SALTOS: pocos
    fotogramas, sin intermedios (el motor los sostiene, no interpola);
  - andar de 4 poses con rebote de la cadera (0/1/2 px según la intensidad) y el cuerpo que se adelanta 1 px;
  - hablar: la MANDÍBULA es una pieza aparte (filas de debajo de la boca, recortadas de la cabeza de frente y de
    perfil). En los fotogramas de hablar la cabeza va SIN mandíbula y el hueco se pinta con el oscuro de la boca;
    el motor (src/systems/PaperDex.ts) coloca encima `dexpapel_jaw_*` y la baja/descoloca según el volumen de la voz.

Salida: assets/sprites/player/dexpapel/*.png y src/data/dexPapelFrames.ts (fotogramas, ms y, para hablar, dónde va
la mandíbula en cada fotograma). Vecino más cercano y solo traslaciones/giros del rig de A2.15: se comprueba que no
sale ningún color fuera de la paleta de los PNG originales.

Uso:  python3 art/dex2d/papel.py            (ligero; con `nice` en el iMac)
      python3 art/dex2d/papel.py --sheets   además contact sheets / GIF en /var/tmp/adv-papel/
"""
import os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as B  # noqa: E402  (el rig de A2.15)

OUT = os.path.join(B.SRC, 'dexpapel')
TS = os.path.join(B.ROOT, 'src', 'data', 'dexPapelFrames.ts')
VIS = '/var/tmp/adv-papel'

# ── Ritmo (ver docs/progreso/A2.16.md) ────────────────────────────────────────────────────────────────────────────
WALK_POSES = 4          # perfil: 4 poses = 2 pasos
WALK_POSE_MS = 150      # → ciclo de 600 ms → 74 × 0,6 = 44,4 px por ciclo → paso de 22,2 px
STEP = B.WALK_ART_PX_PER_S * WALK_POSES * WALK_POSE_MS / 1000 / 2
# Intensidad del andar: rebote de cadera (px), giro rígido de los brazos (°), adelanto del cuerpo (px), alzada del pie
WALK_INT = {
    'suave': dict(bob=0, arm=18, lean=0, lift=3),
    'media': dict(bob=1, arm=30, lean=1, lift=4),
    'tope': dict(bob=2, arm=42, lean=1, lift=5),
}

# Mandíbula: filas de debajo de la línea de la boca (la boca, fila 18, se queda arriba) y columnas de la cara
JAW = {
    'front': dict(rows=(19, 23), cols=(11, 21), dark=(18, 15)),   # en la cabeza de Idle-1 (filas 0..22)
    'profile': dict(rows=(19, 23), cols=(9, 17), dark=(18, 13)),  # en la cabeza de Left.png
}


def split_jaw(head, src, spec):
    """(cabeza sin mandíbula con el hueco oscuro, mandíbula recortada, origen de la mandíbula en la cabeza)."""
    (y0, y1), (x0, x1) = spec['rows'], spec['cols']
    jaw = head[y0:y1, x0:x1].copy()
    top = head.copy()
    dark = src[spec['dark'][0], spec['dark'][1]]
    m = top[y0:y1, x0:x1, 3] > 0
    top[y0:y1, x0:x1][m] = dark
    return top, jaw, (x0, y0)


def profile_walk(P, k):
    """4 poses, pie de apoyo quieto respecto al suelo: en cada pose el apoyo está a ±STEP/4 de la cadera.

    pose 0: apoyo cercano delante (+), el lejano acaba de despegar detrás (en el aire)
    pose 1: apoyo cercano detrás (−), el lejano en el aire delante → aterriza en la pose 2
    pose 2/3: lo mismo con los pies cambiados.
    Entre la 0 y la 1 la cadera avanza 74 × 0,15 = 11,1 px y el pie de apoyo pasa de +5,55 a −5,55: no patina."""
    q = STEP / 4
    frames, feet_log = [], []
    for i in range(WALK_POSES):
        near_stance = i < 2
        sx = q if i % 2 == 0 else -q          # pie de apoyo
        wx = -sx                              # pie en el aire (al revés)
        stance = (sx, 0, 0)
        swing = (wx, k['lift'], 0)            # zapato plano: pieza rígida
        far, near = (swing, stance) if near_stance else (stance, swing)
        up = k['bob'] if i % 2 == 1 else 0     # rebote a saltos: arriba en la pose de paso
        hip_y = 64 - up
        sw = 1 if near_stance else -1
        a = k['arm'] * (sw if i % 2 == 0 else sw * 0.5)
        frames.append(P.frame(hip_y, [far, near], {'a': a, 'f': a}, {'a': -a, 'f': -a}, lean=k['lean'] if i % 2 == 0 else 0))
        feet_log.append(dict(stance='near' if near_stance else 'far', x=round(sx, 2)))
    return frames, feet_log


def talk_front(F, top):
    """5 poses de vendedor (sin intermedios). La cabeza va sin mandíbula; devuelve también dónde va la mandíbula."""
    o = F.ox
    D = dict(drawn=True)
    poses = [
        dict(),                                                                         # 0 reposo
        dict(armR=dict(D, a=-4, f=-38, lf=8)),                                          # 1 mano fuera (derecha)
        dict(armL=dict(D, a=4, f=38, lf=8), lean=-1),                                   # 2 mano fuera (izquierda)
        dict(armL={'a': 20, 'f': 95}, armR={'a': -20, 'f': -95}, shrug=1),              # 3 «¡tachán!» palmas arriba
        dict(armR=dict(D, hand=(o + 29, 24)), head=(1, 0)),                             # 4 brazo disparado arriba
    ]
    keep = F.head
    F.head = top
    out, anchors = [], []
    for p in poses:
        out.append(F.frame(**p))
        hx = o + p.get('lean', 0) + p.get('head', (0, 0))[0]
        hy = p.get('head', (0, 0))[1] - p.get('shrug', 0)
        anchors.append((hx, hy))
    F.head = keep
    return out, anchors


def talk_profile(P, top):
    """4 poses de perfil inclinado 1 px hacia quien escucha; brazo cercano rígido en 4 sitios."""
    hx = P.hipX
    hands = [None, (hx + 11, 47), (hx + 13, 37), (hx + 14, 56)]
    keep = P.head
    P.head = top
    out, anchors = [], []
    for i, h in enumerate(hands):
        near = {'a': 4, 'f': 0} if h is None else {'hand': h}
        far = {'a': -2, 'f': -6} if i != 2 else {'a': -30, 'f': -60}
        lean = 1
        out.append(B.profile_stand(P, near=near, far=far, lean=lean))
        oy = int(round(63 - 61))
        anchors.append((P.ox + lean, oy))
    P.head = keep
    return out, anchors


def build():
    P = B.Profile()
    F = B.Front()
    anims = {}
    meta_extra = {}
    for name, k in WALK_INT.items():
        fr, log = profile_walk(P, k)
        anims[f'walk_r_{name}'] = (fr, WALK_POSE_MS, True)
        meta_extra[f'walk_r_{name}'] = {'feet': log}
    ftop, fjaw, fo = split_jaw(F.head, F.src, JAW['front'])
    ptop, pjaw, po = split_jaw(P.head, P.src, JAW['profile'])
    fr, anc = talk_front(F, ftop)
    anims['talk_front'] = (fr, 0, True)
    meta_extra['talk_front'] = {'jaw': [(a[0] + fo[0], a[1] + fo[1]) for a in anc]}
    fr, anc = talk_profile(P, ptop)
    anims['talk_r'] = (fr, 0, True)
    meta_extra['talk_r'] = {'jaw': [(a[0] + po[0], a[1] + po[1]) for a in anc]}
    jaws = {'jaw_front': fjaw, 'jaw_r': pjaw, 'jaw_l': B.mirror(pjaw)}
    # espejo: _r → _l (la mandíbula se refleja: x' = ancho − (x + ancho de la mandíbula))
    for k in list(anims):
        if k.startswith('walk_r') or k == 'talk_r':
            fr, ms, lp = anims[k]
            k2 = k.replace('_r', '_l', 1)
            anims[k2] = ([B.mirror(a) for a in fr], ms, lp)
            if 'jaw' in meta_extra.get(k, {}):
                w = fr[0].shape[1]
                meta_extra[k2] = {'jaw': [(w - (x + pjaw.shape[1]), y) for (x, y) in meta_extra[k]['jaw']]}
    return anims, meta_extra, jaws


def write(anims, extra, jaws):
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.png'):
            os.remove(os.path.join(OUT, f))
    for k, (fr, _, _) in anims.items():
        for i, a in enumerate(fr):
            Image.fromarray(a).save(os.path.join(OUT, f'{k}_{i}.png'), optimize=True)
    for k, a in jaws.items():
        Image.fromarray(a).save(os.path.join(OUT, f'{k}.png'), optimize=True)
    L = ['// GENERADO por art/dex2d/papel.py (A2.16: prueba «Dex de papel», ?dex=papel). No editar a mano.',
         '// Claves de Phaser: `dexpapel_<anim>_<i>` y `dexpapel_jaw_<front|r|l>` (assets/sprites/player/dexpapel/).',
         '// `jaw`: esquina superior izquierda de la mandíbula en cada fotograma de hablar (píxeles de arte del lienzo).',
         'export interface DexPapelAnim { frames: number; ms: number; w: number; h: number; jaw?: ReadonlyArray<readonly [number, number]> }',
         f'export const DEXPAPEL_WALK_POSES = {WALK_POSES};',
         f'export const DEXPAPEL_WALK_POSE_MS = {WALK_POSE_MS};',
         f'export const DEXPAPEL_STEP_ART_PX = {STEP:.1f};',
         '/** Pie de apoyo respecto a la cadera en cada pose de andar (px de arte; + = hacia donde anda) */',
         f'export const DEXPAPEL_STANCE_X: readonly number[] = [{", ".join(str(f["x"]) for f in extra["walk_r_media"]["feet"])}];',
         'export const DEXPAPEL_JAW_SIZE: Record<string, readonly [number, number]> = {',
         ]
    for k, a in jaws.items():
        L.append(f"  {k.replace('jaw_', '')}: [{a.shape[1]}, {a.shape[0]}],")
    L.append('};')
    L.append('export const DEXPAPEL_ANIMS: Record<string, DexPapelAnim> = {')
    for k, (fr, ms, _) in anims.items():
        jaw = extra.get(k, {}).get('jaw')
        js = f", jaw: [{', '.join(f'[{x}, {y}]' for x, y in jaw)}]" if jaw else ''
        L.append(f"  {k}: {{ frames: {len(fr)}, ms: {ms}, w: {fr[0].shape[1]}, h: {fr[0].shape[0]}{js} }},")
    L.append('};')
    open(TS, 'w').write('\n'.join(L) + '\n')


def sheets(anims, extra, jaws):
    os.makedirs(VIS, exist_ok=True)
    bg = (120, 150, 120, 255)
    Z = 5
    for k, (fr, ms, _) in anims.items():
        jaw_list = extra.get(k, {}).get('jaw')
        jaw = jaws['jaw_front'] if k == 'talk_front' else jaws['jaw_r'] if k == 'talk_r' else jaws['jaw_l']
        w = max(a.shape[1] for a in fr)
        cells = []
        for i, a in enumerate(fr):
            drops = [0, 2] if jaw_list else [0]
            for d in drops:
                c = a.copy()
                if jaw_list:
                    B.paste(c, jaw, jaw_list[i][0], jaw_list[i][1] + d)
                cells.append(c)
        cs = Image.new('RGBA', ((w + 2) * len(cells) * Z, 104 * Z), bg)
        for i, c in enumerate(cells):
            cs.alpha_composite(Image.fromarray(c).resize((c.shape[1] * Z, c.shape[0] * Z), Image.NEAREST), (i * (w + 2) * Z, 0))
        cs.save(os.path.join(VIS, f'cs-{k}.png'))


if __name__ == '__main__':
    anims, extra, jaws = build()
    allf = dict(anims)
    allf['_jaws'] = (list(jaws.values()), 0, False)
    bad = B.palette_check(allf)
    write(anims, extra, jaws)
    n = sum(len(f) for f, _, _ in anims.values()) + len(jaws)
    print(f'{n} PNG (con {len(jaws)} mandíbulas) en {len(anims)} animaciones; colores fuera de la paleta original: {bad}')
    print(f'andar: {WALK_POSES} poses × {WALK_POSE_MS} ms → paso {STEP:.1f} px de arte, apoyo ±{STEP / 4:.2f} px')
    if bad:
        sys.exit(1)
    if '--sheets' in sys.argv:
        sheets(anims, extra, jaws)

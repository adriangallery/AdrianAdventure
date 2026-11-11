#!/usr/bin/env python3
"""A2.15: rig 2D del sprite ACTUAL de Dex, pre-renderizado a fotogramas.

Parte de los PNG de assets/sprites/player (Left.png, Idle-1.png, Back-Left.png y el zapato de Walk-Left-1.png) y del
despiece de art/dex2d/rig.json. Cada pieza se gira sobre su pivote con VECINO MÁS CERCANO (mapeo inverso píxel a
píxel: no se inventa ningún color) y se compone a la resolución nativa (×1). El cuerpo y la cabeza solo se trasladan
(píxeles enteros); solo giran brazos, piernas y zapatos. Al final comprueba que los colores de salida ⊆ colores de los
originales.

Uso:  python3 art/dex2d/build.py            # escribe assets/sprites/player/dex2d/*.png + src/data/dex2dFrames.ts
      python3 art/dex2d/build.py --sheets   # además hojas, contact sheets y GIF en /var/tmp/adv-dex2d/
"""
import json, math, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'sprites', 'player')
OUT = os.path.join(SRC, 'dex2d')
TS = os.path.join(ROOT, 'src', 'data', 'dex2dFrames.ts')
VIS = '/var/tmp/adv-dex2d'
RIG = json.load(open(os.path.join(os.path.dirname(__file__), 'rig.json')))

# ── Zancada (cuadra con WalkMotion: 74 px de arte por segundo) ──────────────────────────────────────────────────────
WALK_ART_PX_PER_S = 74
WALK_FRAMES = 8          # perfil: 8 fotogramas = 2 pasos
WALK_FRAME_MS = 100      # → ciclo 800 ms → 59,2 px por ciclo → paso de 29,6 px
STEP = WALK_ART_PX_PER_S * WALK_FRAMES * WALK_FRAME_MS / 1000 / 2
VWALK_FRAMES = 6         # arriba / abajo: 6 fotogramas por ciclo de 2 pasos, mismo ciclo de 800 ms
VWALK_FRAME_MS = 133


def load(name):
    return np.array(Image.open(os.path.join(SRC, name)).convert('RGBA'))


def blank(w, h):
    return np.zeros((h, w, 4), np.uint8)


def crop(img, x0, y0, x1, y1):
    return img[y0:y1, x0:x1].copy()


def paste(dst, src, x, y):
    """Pega `src` (opaco donde alfa > 0) con su esquina en (x, y) enteros."""
    h, w = src.shape[:2]
    for yy in range(h):
        ty = y + yy
        if ty < 0 or ty >= dst.shape[0]:
            continue
        for xx in range(w):
            tx = x + xx
            if 0 <= tx < dst.shape[1] and src[yy, xx, 3] > 0:
                dst[ty, tx] = src[yy, xx]


def blit_rot(dst, src, sp, dp, ang):
    """Pinta `src` girada `ang` grados (positivo = horario en pantalla) de modo que su punto `sp` caiga en `dp`.
    Mapeo inverso con vecino más cercano: cada píxel de destino toma exactamente un píxel de origen."""
    h, w = src.shape[:2]
    r = math.hypot(w, h) + 2
    a = math.radians(ang)
    c, s = math.cos(a), math.sin(a)
    for y in range(int(dp[1] - r), int(dp[1] + r) + 1):
        if y < 0 or y >= dst.shape[0]:
            continue
        for x in range(int(dp[0] - r), int(dp[0] + r) + 1):
            if x < 0 or x >= dst.shape[1]:
                continue
            vx, vy = x + 0.5 - dp[0], y + 0.5 - dp[1]
            sx = vx * c + vy * s + sp[0]
            sy = -vx * s + vy * c + sp[1]
            ix, iy = int(math.floor(sx)), int(math.floor(sy))
            if 0 <= ix < w and 0 <= iy < h and src[iy, ix, 3] > 0:
                dst[y, x] = src[iy, ix]


def clean_orphans(img):
    """Quita píxeles sueltos (opacos sin ningún vecino opaco en 4 direcciones) que puede dejar un giro."""
    a = img[:, :, 3] > 0
    n = np.zeros(a.shape, int)
    n[1:] += a[:-1]; n[:-1] += a[1:]; n[:, 1:] += a[:, :-1]; n[:, :-1] += a[:, 1:]
    img[a & (n == 0)] = 0
    return img


def is_blue(p):
    return p[3] > 0 and p[2] > p[0] and p[2] > p[1]


def ang_to(dx, dy):
    """Ángulo (horario) que lleva el vector (0, 1) — una pieza que cuelga — a apuntar a (dx, dy)."""
    return math.degrees(math.atan2(-dx, dy))


def ik(h, t, l1, l2, bend):
    """Dos huesos de `h` a `t`; `bend` = +1 rodilla/codo hacia +x, -1 hacia -x. Devuelve (ángulo1, codo, ángulo2)."""
    dx, dy = t[0] - h[0], t[1] - h[1]
    d = min(math.hypot(dx, dy), l1 + l2 - 0.05)
    d = max(d, abs(l1 - l2) + 0.05)
    phi = math.atan2(-dx, dy)
    al = math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    a1 = phi - bend * al
    k = (h[0] - l1 * math.sin(a1), h[1] + l1 * math.cos(a1))
    a2 = math.atan2(-(t[0] - k[0]), t[1] - k[1])
    return math.degrees(a1), k, math.degrees(a2)


# ════════════════════════════════════════ PERFIL (mira a la derecha) ══════════════════════════════════════════════
class Profile:
    def __init__(self):
        P = RIG['profile']
        self.W, self.H = P['canvas']
        self.ox = P['offsetX']
        L = load(P['src'])
        self.src = L
        # Torso (sin cabeza: cuello y cuerpo, filas 23..63) con el hueco del brazo rellenado con el cuadro de la camisa
        t = L[:64].copy()
        for y in range(37, 65 if 65 <= t.shape[0] else t.shape[0]):
            for x in range(0, 7):
                if x == 0:
                    t[y, x] = 0
                elif x == 1:
                    t[y, x] = L[30, 1]  # contorno
                elif y < 58:
                    t[y, x] = L[y, x + 4] if L[y, x + 4, 3] else L[y, x + 8]
                else:
                    t[y, x] = L[66, x]  # cadera: el vaquero de debajo
        self.head = t[:24].copy()
        self.head[23:] = 0
        body = t.copy()
        body[:21] = 0
        # cuello hacia arriba (para que la cabeza pueda bajar o subir 1 px sin hueco)
        for y in (21, 22):
            for x in range(5, 9):
                body[y, x] = L[23, x] if L[23, x, 3] else L[24, x]
        self.body = body
        # Brazo (manga + antebrazo + mano), sin los píxeles del vaquero
        arm = crop(L, 0, 29, 7, 65)
        for y in range(arm.shape[0]):
            for x in range(arm.shape[1]):
                if is_blue(arm[y, x]) or (arm[y, x, :3] > 190).all() or (y + 29 < 37 and x > 5):
                    arm[y, x] = 0
        self.upper = arm[:21].copy()       # filas 29..49
        self.fore = arm.copy(); self.fore[:19] = 0   # filas 48..64
        self.shoulder = (3.5, 31 - 29); self.elbow = (3.5, 49 - 29)
        self.l_up, self.l_fore = 18.0, 14.5
        # Pierna (una; la otra es la misma detrás): la mano que la tapaba se rellena con el vaquero de debajo
        leg = crop(L, 1, 59, 9, 95)
        for y in range(leg.shape[0]):
            for x in range(leg.shape[1]):
                p = leg[y, x]
                if 58 <= y + 59 < 66 and 1 <= x + 1 <= 6 and p[3] and not is_blue(p) and not (p[:3] < 50).all():
                    leg[y, x] = L[66, x + 1]
        self.thigh = leg[:20].copy()   # filas 59..78
        self.shin = leg[17:].copy()     # filas 76..94
        self.hipP = (3.5, 2); self.kneeT = (3.5, 19); self.kneeS = (3.5, 2); self.ankleS = (3.5, 18.5)
        self.l1, self.l2 = 17.0, 16.5
        W1 = load(P['shoe']['src'])
        self.shoe = crop(W1, 29, 95, 44, 102)
        self.shoeA = (2.5, 0.5)
        self.ground = self.H - self.shoe.shape[0] + 0.5   # y del tobillo con el pie en el suelo
        self.hipX = 4.5 + self.ox

    def leg(self, img, hip, ankle, shoe_ang=0.0):
        a1, k, a2 = ik(hip, ankle, self.l1, self.l2, +1)
        blit_rot(img, self.thigh, self.hipP, hip, a1)
        blit_rot(img, self.shin, self.kneeS, k, a2)
        blit_rot(img, self.shoe, self.shoeA, ankle, shoe_ang)

    def arm(self, img, sh, a_up, a_fore=None, hand=None):
        if hand is not None:
            a_up, el, a_fore = ik(sh, hand, self.l_up, self.l_fore, -1)
        else:
            r = math.radians(a_up)
            el = (sh[0] - self.l_up * math.sin(r), sh[1] + self.l_up * math.cos(r))
        blit_rot(img, self.upper, self.shoulder, sh, a_up)
        blit_rot(img, self.fore, self.elbow, el, a_fore)

    def frame(self, hip_y, feet, near_arm, far_arm, dx=0, head=(0, 0), mouth=False, lean=0):
        """feet: [(x_rel_cadera, elevación, ángulo_zapato)] lejano y cercano. Brazos: dict(a=, f=) o dict(hand=(x,y))."""
        img = blank(self.W, self.H)
        hx = self.hipX + dx
        hip = (hx, hip_y)
        oy = int(round(hip_y - 61))       # traslado del cuerpo respecto a Left.png (cadera en y=61)
        sh = (self.ox + 3.5 + dx + lean, 31 + oy)

        def A(spec, s):
            if 'hand' in spec:
                self.arm(img, s, 0, hand=spec['hand'])
            else:
                self.arm(img, s, spec['a'], spec['f'])
        A(far_arm, (sh[0] + 1, sh[1]))
        for (fx, lift, sang) in feet:
            self.leg(img, (hx, hip_y + 0.5), (hx + fx, self.ground - lift), sang)
        paste(img, self.body, self.ox + dx + lean, oy)
        h = self.head.copy()
        if mouth:
            for x in range(12, 15):
                h[19, x] = self.src[18, 13]
        paste(img, h, self.ox + dx + lean + head[0], oy + head[1])
        A(near_arm, sh)
        return clean_orphans(img)


def profile_walk(P):
    frames = []
    hips = []
    for i in range(WALK_FRAMES):
        feet = []
        stance_x = []
        for ph in ((i / WALK_FRAMES + 0.5) % 1, i / WALK_FRAMES):   # lejano, cercano
            if ph < 0.5:
                x = STEP / 2 - 2 * STEP * ph
                feet.append((x, 0, 0)); stance_x.append(abs(x))
            else:
                q = (ph - 0.5) / 0.5
                e = q * q * (3 - 2 * q)
                x = -STEP / 2 + STEP * e
                lift = 6 * math.sin(math.pi * q)
                sang = 28 * math.sin(math.pi * q) * (1 - q) - 18 * q * q * (1 - q) * 3
                feet.append((x, lift, sang))
        reach = min(math.sqrt(max(0, 33.2 ** 2 - x * x)) for x in stance_x)
        hv = min(32.0, reach)
        hips.append(round(P.ground - hv))
    for i in range(WALK_FRAMES):
        p = i / WALK_FRAMES
        feet = []
        for ph in ((p + 0.5) % 1, p):
            if ph < 0.5:
                feet.append((STEP / 2 - 2 * STEP * ph, 0, 0))
            else:
                q = (ph - 0.5) / 0.5
                e = q * q * (3 - 2 * q)
                feet.append((-STEP / 2 + STEP * e, 6 * math.sin(math.pi * q), 28 * math.sin(math.pi * q) * (1 - q) - 54 * q * q * (1 - q)))
        sw = math.cos(2 * math.pi * p)
        near = {'a': 24 * sw, 'f': 24 * sw - (10 + 22 * max(0, -sw))}
        far = {'a': -24 * sw, 'f': -24 * sw - (10 + 22 * max(0, sw))}
        # la cabeza acompaña con un fotograma de retraso (1 px como mucho)
        lag = hips[(i - 1) % WALK_FRAMES] - hips[i]
        frames.append(P.frame(hips[i], feet, near, far, head=(0, max(-1, min(1, lag)))))
    return frames


def profile_stand(P, **kw):
    hip_y = kw.pop('hip_y', 63)
    feet = kw.pop('feet', [(4, 0, 0), (-3, 0, 0)])
    near = kw.pop('near', {'a': 4, 'f': 0})
    far = kw.pop('far', {'a': -2, 'f': -6})
    return P.frame(hip_y, feet, near, far, **kw)


def profile_talk(P):
    out = []
    hands = [None, (P.hipX + 9, 52), (P.hipX + 11, 47), (P.hipX + 9, 52)]
    for i in range(4):
        near = {'a': 4, 'f': 0} if hands[i] is None else {'hand': hands[i]}
        out.append(profile_stand(P, near=near, mouth=i in (1, 3), head=(0, 1 if i == 2 else 0)))
    return out


def profile_pick(P, level):
    """Coger: anticipación, estirón (1 px más alto, de puntillas), sujeta, vuelve. level: high / mid / low."""
    hx = P.hipX
    if level == 'high':
        seq = [dict(hip_y=64, near={'a': -10, 'f': -30}, lean=0),
               dict(hip_y=62, near={'hand': (hx + 15, 6)}, lean=1, toes=True),
               dict(hip_y=62, near={'hand': (hx + 16, 3)}, lean=1, toes=True),
               dict(hip_y=63, near={'a': -25, 'f': -60}, lean=0)]
    elif level == 'low':
        seq = [dict(hip_y=64, near={'a': -10, 'f': -20}, lean=0),
               dict(hip_y=74, near={'hand': (hx + 18, 84)}, lean=4, crouch=True),
               dict(hip_y=76, near={'hand': (hx + 19, 88)}, lean=4, crouch=True),
               dict(hip_y=66, near={'hand': (hx + 8, 62)}, lean=1)]
    else:
        seq = [dict(hip_y=64, near={'a': 10, 'f': 0}, lean=-1),
               dict(hip_y=63, near={'hand': (hx + 17, 50)}, lean=2),
               dict(hip_y=63, near={'hand': (hx + 18, 48)}, lean=2),
               dict(hip_y=63, near={'hand': (hx + 10, 56)}, lean=1)]
    out = []
    for s in seq:
        feet = [(5, 0, 0), (-3, 0, 0)]
        if s.get('toes'):
            feet = [(5, 2, 18), (-3, 0, 0)]
        if s.get('crouch'):
            feet = [(8, 0, 0), (-6, 0, 0)]
        out.append(profile_stand(P, hip_y=s['hip_y'], near=s['near'], lean=s['lean'], feet=feet))
    return out


# ════════════════════════════════════════ FRENTE / ESPALDA ════════════════════════════════════════════════════════
class Front:
    def __init__(self, src='Idle-1.png', canvas=37, ox=6):
        self.src = load(src)
        S = self.src
        self.W, self.H, self.ox = canvas, 103, ox
        b = S.copy()
        # brazos fuera del torso, hueco relleno con el cuadro (periodo 4) y la cadera con el vaquero de debajo
        self.armL = crop(S, 0, 37, 7, 64); self.armR = crop(S, 19, 37, 25, 64)
        for arm, x0 in ((self.armL, 0), (self.armR, 19)):
            for y in range(arm.shape[0]):
                for x in range(arm.shape[1]):
                    if is_blue(arm[y, x]):
                        arm[y, x] = 0
                    if x0 == 0 and x == 6 and y + 37 < 58:
                        arm[y, x] = 0
                    if x0 == 19 and x == 0 and y + 37 < 58:
                        arm[y, x] = 0
        for y in range(37, 64):
            for x in list(range(0, 7)) + list(range(19, 25)):
                if x in (0, 24):
                    b[y, x] = 0
                elif x in (1, 23):
                    b[y, x] = S[32, 1] if y < 58 else 0
                elif y < 58:
                    c = S[y, x + 4] if x < 12 else S[y, x - 4]
                    if (c[:3] > 190).all():
                        c = S[y, x + 8] if x < 12 else S[y, x - 8]
                    b[y, x] = c
                elif y < 63:
                    b[y, x] = S[65, x] if S[65, x, 3] else 0
                else:
                    b[y, x] = 0
        self.legL = S.copy(); self.legL[:63] = 0; self.legL[:, 13:] = 0
        self.legR = S.copy(); self.legR[:63] = 0; self.legR[:, :13] = 0
        self.legR[:, 13] = S[:, 13]; self.legR[:63] = 0
        b[63:] = 0
        self.body = b
        self.head = b[:23].copy()
        self.torso = b.copy(); self.torso[:21] = 0
        self.uL = self.armL[:14].copy(); self.fL = self.armL.copy(); self.fL[:12] = 0
        self.uR = self.armR[:14].copy(); self.fR = self.armR.copy(); self.fR[:12] = 0
        self.shL, self.elL = (3.5, 1.5), (3.5, 13)
        self.shR, self.elR = (2.5, 1.5), (2.5, 13)
        self.lu, self.lf = 11.5, 13.0

    def arm(self, img, side, sh, a=0, f=0, hand=None):
        u, fo, sp, ep = (self.uL, self.fL, self.shL, self.elL) if side == 'L' else (self.uR, self.fR, self.shR, self.elR)
        if hand is not None:
            a, el, f = ik(sh, hand, self.lu, self.lf, +1 if side == 'L' else -1)
        else:
            r = math.radians(a)
            el = (sh[0] - self.lu * math.sin(r), sh[1] + self.lu * math.cos(r))
        # el brazo se pinta en su capa y lleva contorno oscuro (el del propio sprite) donde no está pegado al hombro,
        # para que el antebrazo se lea sobre el cuadro de la camisa
        lay = blank(self.W, self.H)
        blit_rot(lay, u, sp, sh, a)
        blit_rot(lay, fo, ep, el, f)
        m = lay[:, :, 3] > 0
        ring = np.zeros_like(m)
        ring[1:] |= m[:-1]; ring[:-1] |= m[1:]; ring[:, 1:] |= m[:, :-1]; ring[:, :-1] |= m[:, 1:]
        ring &= ~m
        ring[: int(sh[1]) + 4] = False
        if (a, f) != (0, 0) or hand is not None:
            img[ring] = self.src[32, 1]
        img[m] = lay[m]

    def frame(self, bob=0, liftL=0, liftR=0, armL=None, armR=None, head=(0, 0), mouth=False, lean=0, shrug=0, breath=0):
        img = blank(self.W, self.H)
        o = self.ox
        paste(img, self.legL, o, -liftL)
        paste(img, self.legR, o, -liftR)
        t = self.torso.copy()
        if breath:   # 1 px de pecho: quita una fila de camisa y baja lo de encima
            t[22:46] = t[21:45]; t[21] = 0
        paste(img, t, o + lean, bob)
        h = self.head.copy()
        if mouth:
            for x in range(15, 19):
                h[19, x] = self.src[18, 15]
        paste(img, h, o + lean + head[0], bob + head[1] + breath - shrug)
        sy = 38 + bob - shrug
        aL = armL or {}
        aR = armR or {}
        self.arm(img, 'L', (o + lean + 3.5, sy), **aL)
        self.arm(img, 'R', (o + lean + 21.5, sy), **aR)
        return clean_orphans(img)


def front_walk(F):
    out = []
    for i in range(VWALK_FRAMES):
        p = i / VWALK_FRAMES
        s = math.sin(2 * math.pi * p)
        liftL = round(2 * max(0, s)); liftR = round(2 * max(0, -s))
        bob = 1 if i % 3 == 0 else 0
        out.append(F.frame(bob=bob, liftL=liftL, liftR=liftR, armL={'a': -7 * s, 'f': -7 * s}, armR={'a': -7 * s, 'f': -7 * s}))
    return out


def back_walk():
    S = load(RIG['back']['src'])
    legL = S.copy(); legL[:66] = 0; legL[:, 13:] = 0
    legR = S.copy(); legR[:66] = 0; legR[:, :13] = 0
    up = S.copy(); up[66:] = 0
    # los brazos y las manos (filas 40..65 a los lados) suben/bajan 1 px en contrafase
    armL = up.copy(); armL[:, 6:] = 0; armL[:40] = 0
    armR = up.copy(); armR[:, :21] = 0; armR[:40] = 0
    body = up.copy(); body[40:, :6] = 0; body[40:, 21:] = 0
    out = []
    for i in range(VWALK_FRAMES):
        p = i / VWALK_FRAMES
        s = math.sin(2 * math.pi * p)
        img = blank(28, 103)
        bob = 1 if i % 3 == 0 else 0
        paste(img, legL, 0, -round(2 * max(0, s)))
        paste(img, legR, 0, -round(2 * max(0, -s)))
        paste(img, body, 0, bob)
        paste(img, armL, 0, bob + (1 if s > 0.3 else 0))
        paste(img, armR, 0, bob + (1 if s < -0.3 else 0))
        out.append(clean_orphans(img))
    return out


def front_idle(F):
    # respira: 1 px de pecho en 2 de 4 tiempos (sobre Idle-1; el resto de la pose igual)
    return [F.frame(), F.frame(), F.frame(breath=1), F.frame(breath=1)]


def front_tics(F):
    tics = {}
    # rascarse la cabeza (mano derecha de la pantalla sobre el pelo, 3 rascadas)
    sc = [F.frame(armR={'a': -40, 'f': -60})]
    for k in range(6):
        sc.append(F.frame(armR={'hand': (F.ox + 19 + (k % 2), 16 - 2 * (k % 2))}, head=(-1 if k % 2 else 0, 0)))
    sc.append(F.frame(armR={'a': -40, 'f': -60}))
    tics['scratch'] = sc
    # subirse las gafas (dedo al puente de las gafas, empuja 1 px)
    gl = [F.frame(armL={'a': 30, 'f': 60})]
    gl.append(F.frame(armL={'hand': (F.ox + 13, 16)}))
    gl.append(F.frame(armL={'hand': (F.ox + 13, 14)}, head=(0, -1)))
    gl.append(F.frame(armL={'hand': (F.ox + 13, 14)}))
    gl.append(F.frame(armL={'a': 30, 'f': 60}))
    tics['glasses'] = gl
    # balancearse sobre los talones (el cuerpo de un lado a otro, 1 px)
    tics['sway'] = [F.frame(lean=l) for l in (0, 1, 1, 0, -1, -1)]
    # bostezo con estirón: brazos arriba, boca abierta
    yw = [F.frame(bob=1), F.frame(armL={'hand': (F.ox + 3, 12)}, armR={'hand': (F.ox + 21, 12)}, mouth=True, shrug=1),
          F.frame(armL={'hand': (F.ox + 1, 4)}, armR={'hand': (F.ox + 23, 4)}, mouth=True, shrug=1, head=(0, -1)),
          F.frame(armL={'hand': (F.ox + 3, 12)}, armR={'hand': (F.ox + 21, 12)}, mouth=True), F.frame()]
    tics['yawn'] = yw
    return tics


def front_talk(F):
    # mano abierta hacia fuera (como el shrug, con un solo brazo) mientras cabecea y abre la boca
    return [F.frame(), F.frame(mouth=True, armR={'a': -12, 'f': -70}),
            F.frame(armR={'a': -16, 'f': -95}, head=(0, 1)), F.frame(mouth=True, armR={'a': -12, 'f': -70})]


def front_shrug(F):
    up = dict(armL={'a': 20, 'f': 95}, armR={'a': -20, 'f': -95})
    return [F.frame(bob=1), F.frame(shrug=1, head=(1, 0), **up), F.frame(shrug=1, head=(1, 0), **up),
            F.frame(shrug=1, head=(1, 0), **up), F.frame(bob=1, armL={'a': 4, 'f': 12}, armR={'a': -4, 'f': -12})]


# ════════════════════════════════════════ SALIDA ═════════════════════════════════════════════════════════════════
def mirror(a):
    return a[:, ::-1].copy()


def build():
    P = Profile()
    F = Front()
    anims = {}  # nombre -> (lista de arrays, ms por fotograma, loop)
    anims['walk_r'] = (profile_walk(P), WALK_FRAME_MS, True)
    anims['walk_down'] = (front_walk(F), VWALK_FRAME_MS, True)
    anims['walk_up'] = (back_walk(), VWALK_FRAME_MS, True)
    anims['idle'] = (front_idle(F), 450, True)
    for k, v in front_tics(F).items():
        anims['tic_' + k] = (v, 140 if k == 'scratch' else 220, False)
    anims['talk_front'] = (front_talk(F), 140, True)
    anims['talk_r'] = (profile_talk(P), 140, True)
    for lv in ('high', 'mid', 'low'):
        anims['pick_r_' + lv] = (profile_pick(P, lv), 90, False)
    anims['shrug'] = (front_shrug(F), 130, False)
    for k in list(anims):
        if k.endswith('_r') or '_r_' in k:
            fr, ms, lp = anims[k]
            anims[k.replace('_r', '_l', 1)] = ([mirror(a) for a in fr], ms, lp)
    return anims


def palette_check(anims):
    allowed = set()
    for f in os.listdir(SRC):
        if f.endswith('.png') and not f.startswith('Ape'):
            a = load(f)
            allowed |= {tuple(p) for p in a.reshape(-1, 4) if p[3] > 0}
    bad = 0
    for fr, _, _ in anims.values():
        for a in fr:
            bad += sum(1 for p in a.reshape(-1, 4) if p[3] > 0 and tuple(p) not in allowed)
    return bad


def write(anims):
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.png'):
            os.remove(os.path.join(OUT, f))
    meta = {}
    for k, (fr, ms, lp) in anims.items():
        for i, a in enumerate(fr):
            Image.fromarray(a).save(os.path.join(OUT, f'{k}_{i}.png'), optimize=True)
        meta[k] = {'frames': len(fr), 'ms': ms, 'loop': lp, 'w': fr[0].shape[1], 'h': fr[0].shape[0]}
    lines = ['// GENERADO por art/dex2d/build.py (A2.15: rig 2D de Dex pre-renderizado). No editar a mano.',
             '// Claves de Phaser: `dex2d_<anim>_<i>` (assets/sprites/player/dex2d/<anim>_<i>.png).',
             'export interface Dex2dAnim { frames: number; ms: number; loop: boolean; w: number; h: number }',
             f'export const DEX2D_WALK_STEP_ART_PX = {STEP:.1f};',
             'export const DEX2D_ANIMS: Record<string, Dex2dAnim> = {']
    for k, m in meta.items():
        lines.append(f"  {k}: {{ frames: {m['frames']}, ms: {m['ms']}, loop: {'true' if m['loop'] else 'false'}, w: {m['w']}, h: {m['h']} }},")
    lines.append('};')
    open(TS, 'w').write('\n'.join(lines) + '\n')
    return meta


def sheets(anims):
    os.makedirs(VIS, exist_ok=True)
    bg = (120, 150, 120, 255)
    Z = 6
    # antes / después en las mismas poses
    pairs = [('Idle-1.png', anims['idle'][0][0], 'idle frente'), ('Left.png', anims['talk_r'][0][0], 'perfil'),
             ('Back-Left.png', anims['walk_up'][0][1], 'espalda'), ('Walk-Left-1.png', anims['walk_r'][0][0], 'andar')]
    cells = []
    for name, new, _ in pairs:
        cells.append(load(name)); cells.append(new)
    wsum = sum(c.shape[1] + 6 for c in cells)
    sheet = Image.new('RGBA', (wsum * Z, 105 * Z), bg)
    x = 0
    for i, c in enumerate(cells):
        im = Image.fromarray(c).resize((c.shape[1] * Z, c.shape[0] * Z), Image.NEAREST)
        sheet.alpha_composite(im, (x * Z, (103 - c.shape[0]) * Z))
        x += c.shape[1] + (10 if i % 2 else 2)
    sheet.save(os.path.join(VIS, 'antes-despues.png'))
    small = sheet.resize((sheet.width // 2, sheet.height // 2), Image.NEAREST)
    small.save(os.path.join(VIS, 'antes-despues-x3.png'))
    for k, (fr, ms, lp) in anims.items():
        if k.endswith('_l') or '_l_' in k:
            continue
        w = max(a.shape[1] for a in fr)
        cs = Image.new('RGBA', ((w + 2) * len(fr) * Z, 104 * Z), bg)
        gif = []
        for i, a in enumerate(fr):
            im = Image.fromarray(a).resize((a.shape[1] * Z, a.shape[0] * Z), Image.NEAREST)
            cs.alpha_composite(im, (i * (w + 2) * Z, 0))
            g = Image.new('RGBA', (w * 5, 104 * 5), bg)
            g.alpha_composite(Image.fromarray(a).resize((a.shape[1] * 5, a.shape[0] * 5), Image.NEAREST), ((w - a.shape[1]) * 5 // 2, 0))
            gif.append(g.convert('RGB'))
        cs.save(os.path.join(VIS, f'cs-{k}.png'))
        gif[0].save(os.path.join(VIS, f'{k}.gif'), save_all=True, append_images=gif[1:], duration=ms, loop=0, disposal=2)


if __name__ == '__main__':
    anims = build()
    bad = palette_check(anims)
    meta = write(anims)
    print(f'{sum(m["frames"] for m in meta.values())} fotogramas en {len(meta)} animaciones; colores fuera de la paleta original: {bad}')
    print(f'zancada: paso {STEP:.1f} px de arte; ciclo {WALK_FRAMES * WALK_FRAME_MS} ms → {WALK_ART_PX_PER_S * WALK_FRAMES * WALK_FRAME_MS / 1000:.1f} px por ciclo a 74 px/s')
    if bad:
        sys.exit(1)
    if '--sheets' in sys.argv:
        sheets(anims)

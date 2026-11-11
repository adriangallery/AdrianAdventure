"""A2.14 · Acciones de Dex (idle, walk, talk, pick_low/mid/high, use, push, pull, give) sobre el rig de build_dex.

Todas las poses se calculan en el espacio del armature con Dex mirando a -Y y se aplican a los controles (IK de
manos y pies, foot roll, cadera) y a los huesos FK del tronco y la cabeza. Cada acción tiene una clave en CADA
fotograma (se renderizan fotograma a fotograma) y todas tocan los mismos canales, así cambiar de acción no deja
restos. La dirección (8 vistas) la pone `set_facing` girando el hueso root, que no está en ninguna acción.

Walk: ciclo de 8 fotogramas EN EL SITIO. El pie de apoyo retrocede a velocidad constante = 2·zancada / ciclo, que es
la velocidad a la que el juego mueve a Dex (WalkMotion: 74 px de arte/s, zancada de 20 px = Footsteps.STRIDE_ART_PX,
ciclo 540 ms): en pantalla el pie apoyado queda quieto sobre el suelo, sin patinar.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

import build_dex as B

ANIM_BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw',
              'shoulder.L', 'shoulder.R', 'hand.L', 'hand.R',
              'foot_ik.L', 'foot_ik.R', 'foot_roll.L', 'foot_roll.R', 'hand_ik.L', 'hand_ik.R',
              'knee_pole.L', 'knee_pole.R', 'elbow_pole.L', 'elbow_pole.R']

WALK_FRAMES = 8
WALK_CYCLE_MS = 540  # 2 zancadas de 20 px de arte a 74 px/s


def _pb(rig, n):
    return rig.pose.bones[n]


def _local_axis(rig, n, axis):
    return (rig.data.bones[n].matrix_local.to_3x3().inverted() @ Vector(axis)).normalized()


def _local_vec(rig, n, v):
    return rig.data.bones[n].matrix_local.to_3x3().inverted() @ Vector(v)


def rot(rig, n, axis, deg, q=None):
    """Quaternion local de un giro de `deg` grados alrededor de un eje del MUNDO (en reposo), encadenable."""
    r = Quaternion(_local_axis(rig, n, axis), math.radians(deg))
    return r @ q if q is not None else r


def clear(rig):
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


def rest(rig):
    clear(rig)
    bpy.context.view_layer.update()


def set_facing(rig, deg):
    pb = _pb(rig, 'root')
    pb.rotation_quaternion = rot(rig, 'root', (0, 0, 1), deg)
    bpy.context.view_layer.update()


def tpose(rig):
    clear(rig)
    for s, sx in (('L', 1), ('R', -1)):
        S = Vector(B.side(B.SHOULDER, sx))
        _pb(rig, f'hand_ik.{s}').location = _local_vec(rig, f'hand_ik.{s}', S + Vector((sx * 0.46, 0, 0)) - Vector(B.side(B.WRIST, sx)))
        _pb(rig, f'elbow_pole.{s}').location = _local_vec(rig, f'elbow_pole.{s}', Vector((0, 0, 0.25)))
    bpy.context.view_layer.update()


# ── Pose declarativa ──────────────────────────────────────────────────────────────────────────────────────────────
class Pose:
    """Pose en el espacio de Dex: desplazamientos (m) y giros (grados, ejes del mundo)."""

    def __init__(self):
        self.hips_off = Vector()
        self.hips_rot = []  # [(eje, grados)]
        self.spine_rot = []
        self.chest_rot = []
        self.neck_rot = []
        self.head_rot = []
        self.jaw = 0.0  # 0 cerrada · 1 abierta
        self.shoulder = {'L': 0.0, 'R': 0.0}  # subir hombro (grados)
        self.hand = {}  # lado → posición absoluta de la muñeca (armature)
        self.hand_rot = {'L': [], 'R': []}
        self.elbow_pole = {'L': Vector(), 'R': Vector()}
        self.foot = {'L': (Vector(), 0.0), 'R': (Vector(), 0.0)}  # (desplazamiento del talón, pitch grados: + = puntera arriba)
        self.roll = {'L': 0.0, 'R': 0.0}  # talón levantado sobre la bola (grados)
        self.stretch = 0.0  # squash & stretch del tronco: + estira (más alto y estrecho), - encoge


def chain(rig, n, rots):
    q = Quaternion()
    for axis, deg in rots:
        q = rot(rig, n, axis, deg, q)
    return q


def apply(rig, P):
    clear(rig)
    pb = _pb(rig, 'hips')
    pb.location = _local_vec(rig, 'hips', P.hips_off)
    pb.rotation_quaternion = chain(rig, 'hips', P.hips_rot)
    for n, rots in (('spine', P.spine_rot), ('chest', P.chest_rot), ('neck', P.neck_rot), ('head', P.head_rot)):
        _pb(rig, n).rotation_quaternion = chain(rig, n, rots)
    if P.stretch:
        # el eje Y del hueso va a lo largo de la columna: estira en Y y compensa el volumen en X/Z
        k = 1 + P.stretch
        _pb(rig, 'spine').scale = (1 / math.sqrt(k), k, 1 / math.sqrt(k))
    j = _pb(rig, 'jaw')
    j.scale = (1 + 0.3 * P.jaw, 1, 1 + 2.2 * P.jaw)
    j.location = _local_vec(rig, 'jaw', (0, 0, -0.006 * P.jaw))
    for s, sx in (('L', 1), ('R', -1)):
        _pb(rig, f'shoulder.{s}').rotation_quaternion = rot(rig, f'shoulder.{s}', (0, 1, 0), -sx * P.shoulder[s])
        W = P.hand.get(s)
        if W is None:
            W = Vector(B.side(B.WRIST, sx)) + P.hips_off
        _pb(rig, f'hand_ik.{s}').location = _local_vec(rig, f'hand_ik.{s}', Vector(W) - Vector(B.side(B.WRIST, sx)))
        _pb(rig, f'hand.{s}').rotation_quaternion = chain(rig, f'hand.{s}', P.hand_rot[s])
        _pb(rig, f'elbow_pole.{s}').location = _local_vec(rig, f'elbow_pole.{s}', P.elbow_pole[s] + P.hips_off)
        off, pitch = P.foot[s]
        f = _pb(rig, f'foot_ik.{s}')
        f.location = _local_vec(rig, f'foot_ik.{s}', off)
        f.rotation_quaternion = rot(rig, f'foot_ik.{s}', (1, 0, 0), pitch)
        _pb(rig, f'foot_roll.{s}').rotation_quaternion = rot(rig, f'foot_roll.{s}', (1, 0, 0), -P.roll[s])
        _pb(rig, f'knee_pole.{s}').location = _local_vec(rig, f'knee_pole.{s}', Vector((0, 0, 0)) + Vector((0, 0, P.hips_off.z)))


def key(rig, frame):
    for n in ANIM_BONES:
        pb = _pb(rig, n)
        pb.keyframe_insert('location', frame=frame)
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('scale', frame=frame)


def smooth(t):
    return B.smooth(t)


def shoulder_pos(P, s, lean_deg):
    """Hombro con la cadera desplazada y el tronco inclinado `lean_deg` (+ = hacia delante) sobre la columna."""
    sx = 1 if s == 'L' else -1
    pivot = Vector((0, 0, 1.08)) + P.hips_off
    S = Vector(B.side(B.SHOULDER, sx)) + P.hips_off
    return pivot + Matrix.Rotation(math.radians(lean_deg), 3, 'X') @ (S - pivot)


def hang(P, s, lean_deg):
    sx = 1 if s == 'L' else -1
    P.hand[s] = shoulder_pos(P, s, lean_deg) + (Vector(B.side(B.WRIST, sx)) - Vector(B.side(B.SHOULDER, sx)))


def arm_swing(P, s, deg, bend=0.0):
    """Muñeca colgando del hombro girada `deg` grados hacia delante (+) y algo doblada al ir delante."""
    sx = 1 if s == 'L' else -1
    S = Vector(B.side(B.SHOULDER, sx)) + P.hips_off
    v = Vector(B.side(B.WRIST, sx)) - Vector(B.side(B.SHOULDER, sx))
    v = Matrix.Rotation(math.radians(-deg), 3, 'X') @ v
    v *= 1 - bend
    P.hand[s] = S + v


# ── Animaciones (A2.14 «con gracia»: anticipación, rebote, overlap, squash & stretch) ──────────────────────────────
def walk_pose(p, stride):
    """Andar suelto y algo desgarbado, con rebote. p = fase [0, 1). Pie izquierdo apoya el talón en p = 0, el derecho
    en p = 0,5. Lo que NO se toca (WalkMotion/Footsteps): el pie de apoyo retrocede a velocidad constante (2·zancada por
    ciclo), apoyo del 60 % y los pies en el suelo; todo lo demás (cadera, tronco, cabeza, brazos) baila encima."""
    P = Pose()
    duty = 0.6
    A = stride * duty  # media excursión del pie: en el apoyo recorre 2A en duty·T → v = 2·stride/T
    lift = 0.115  # rodilla alta en el paso
    for s, ph in (('L', 0.0), ('R', 0.5)):
        q = (p - ph) % 1.0
        if q < duty:
            y = A - 2 * A * (q / duty)  # adelante = -Y
            z = 0.0
            pitch = 26 * (1 - smooth(q / 0.14))  # planta el talón con la puntera bien arriba
            roll = 40 * smooth((q - (duty - 0.22)) / 0.22)  # despegue sobre la bola
        else:
            t = (q - duty) / (1 - duty)
            y = -A + 2 * A * smooth(t)
            z = lift * math.sin(math.pi * min(1, t * 1.15))
            pitch = -38 * (1 - smooth(t / 0.45)) + 24 * smooth((t - 0.5) / 0.5)  # puntera colgando y luego arriba
            roll = 0.0
        P.foot[s] = (Vector((0, -y, z)), pitch)
        P.roll[s] = roll
    w = 2 * math.pi * p
    # rebote: la cadera cae justo después del contacto (absorbe) y sube en el paso; el resto llega tarde (overlap)
    bounce = math.cos(2 * w - 0.6)  # +1 en el contacto (abajo), −1 en el paso (arriba)
    P.hips_off = Vector((0.03 * math.sin(w), 0.0, -0.058 - 0.03 * bounce))
    P.hips_rot = [((0, 0, 1), 9 * math.cos(w)), ((0, 1, 0), 4.5 * math.sin(w))]
    P.stretch = -0.03 * bounce  # contacto: encoge; paso: estira
    # tronco adelantado desde la cadera y pecho echado atrás (desgarbado), con balanceo lateral y vaivén retrasado
    P.spine_rot = [((1, 0, 0), 7 + 2 * math.cos(2 * w - 1.2)), ((0, 1, 0), -4 * math.sin(w - 0.4))]
    P.chest_rot = [((1, 0, 0), -6 + 3 * math.cos(2 * w - 1.6)), ((0, 0, 1), -15 * math.cos(w - 0.2)), ((0, 1, 0), -2.5 * math.sin(w))]
    # cabeza: cabecea tarde respecto al rebote, ladea y casi no gira (mira adelante pese al tronco)
    P.head_rot = [((0, 0, 1), 8 * math.cos(w - 0.5)), ((1, 0, 0), -1 + 5 * math.cos(2 * w - 2.0)), ((0, 1, 0), 6 * math.sin(w - 1.0))]
    for s, sgn in (('L', -1), ('R', 1)):
        sx = 1 if s == 'L' else -1
        c = math.cos(w - 0.35)  # el brazo llega algo tarde
        a = sgn * 34 * c  # brazo contrario a la pierna
        fwd = max(0.0, a) / 34
        arm_swing(P, s, a, bend=0.10 + 0.22 * fwd)  # codo suelto: dobla más al ir delante
        P.hand[s] += Vector((sx * (0.03 + 0.02 * fwd), 0, 0.012 * (1 - bounce)))
        P.hand_rot[s] = [((1, 0, 0), -sgn * 28 * math.cos(w - 1.3))]  # muñeca que llega tarde y «flamea»
        P.elbow_pole[s] = Vector((sx * 0.06, 0.05, 0))
        P.shoulder[s] = 7 * fwd + 3 * math.cos(2 * w - 1.4)  # hombro arriba con el brazo delante + rebote tardío
    return P


def idle_pose(p):
    """Respira: ciclo lento; pecho y hombros suben, cabeza acompaña."""
    P = Pose()
    b = 0.5 - 0.5 * math.cos(2 * math.pi * p)
    P.hips_off = Vector((0, 0, -0.004))
    P.chest_rot = [((1, 0, 0), 2.5 * b)]
    P.head_rot = [((1, 0, 0), -2.0 * b), ((0, 0, 1), 1.5 * math.sin(2 * math.pi * p))]
    P.shoulder = {'L': 3 * b, 'R': 3 * b}
    for s in ('L', 'R'):
        arm_swing(P, s, 2 * b)
        P.hand[s] += Vector((0, 0, 0.008 * b))
    return P


def rest_wrist(P, s):
    sx = 1 if s == 'L' else -1
    return Vector(B.side(B.WRIST, sx)) + P.hips_off


def reach_to(P, s, tgt, k, pole=(0, 0, 0)):
    """Muñeca de `s` del reposo hacia `tgt` (armature) en la proporción k (k < 0 = anticipación, k > 1 = se pasa)."""
    r = rest_wrist(P, s)
    P.hand[s] = r + (Vector(tgt) - r) * k
    P.elbow_pole[s] = Vector(pole) * max(0.0, min(1.2, k))


TALK_JAW = [0.0, 1.0, 0.35, 0.9, 0.1, 0.75, 0.25, 0.95]
# Hablar gesticulando: la derecha ofrece la palma (0–3), la izquierda señala (4–6); cabeza que ladea a destiempo
TALK = {
    'r_sw': [30, 50, 58, 52, 40, 28, 22, 24], 'r_bend': [.35, .4, .42, .4, .35, .3, .25, .3],
    'r_palm': [40, 70, 75, 70, 50, 20, 10, 20], 'r_out': [.04, .08, .10, .08, .05, .03, .02, .03],
    'l_sw': [4, 2, 0, 10, 42, 64, 56, 26], 'l_bend': [.05, .05, .05, .1, .14, .08, .1, .08],
    'l_out': [0, 0, 0, .02, .06, .09, .08, .04],
    'tilt': [6, 9, 8, 3, -4, -9, -7, 0], 'nod': [-2, 3, -3, 1, -2, 4, -1, 2], 'turn': [4, 7, 5, 2, -3, -7, -4, 0],
    'chest': [3, 6, 5, 2, -2, -6, -4, 0], 'sh_r': [3, 6, 7, 4, 2, 1, 0, 1], 'sh_l': [0, 0, 0, 1, 4, 7, 5, 2],
}


def talk_pose(i, n):
    P = idle_pose(i / n)
    T = {k: v[i % 8] for k, v in TALK.items()}
    P.jaw = TALK_JAW[i % len(TALK_JAW)]
    P.head_rot = [((1, 0, 0), T['nod']), ((0, 0, 1), T['turn']), ((0, 1, 0), T['tilt'])]
    P.chest_rot = [((0, 0, 1), T['chest']), ((1, 0, 0), 1.5)]
    P.shoulder = {'L': T['sh_l'], 'R': T['sh_r']}
    arm_swing(P, 'R', T['r_sw'], bend=T['r_bend'])
    P.hand['R'] += Vector((-T['r_out'], 0, 0.04))
    P.hand_rot['R'] = [((0, 1, 0), T['r_palm'])]  # palma hacia arriba
    arm_swing(P, 'L', T['l_sw'], bend=T['l_bend'])
    P.hand['L'] += Vector((T['l_out'], 0, 0.02 * (T['l_sw'] > 30)))
    P.hand_rot['L'] = [((1, 0, 0), -25 * (T['l_sw'] / 64))]  # mano que señala
    P.elbow_pole['L'] = Vector((0.15, 0, 0)) * (T['l_sw'] / 64)
    return P


def reach_pose(e, target_rel, crouch=0.0, lean=0.0, tiptoe=0.0, hand='R', both=False):
    """Alcanzar: e = cuánto (puede ser < 0 = anticipación hacia atrás, > 1 = estirón pasándose del punto);
    target_rel = muñeca respecto al pie (armature)."""
    P = idle_pose(0)
    ep = max(0.0, e)
    ce = max(e, 0.35 * abs(e))  # en la anticipación también se agacha un poco
    dip = 0.035 * max(0.0, -e) / 0.25  # anticipación: baja la cadera
    P.hips_off = Vector((0, -0.03 * ep * (lean > 0), -crouch * ce + 0.045 * tiptoe * ep - dip))
    # giro +X = inclinarse hacia delante (hacia -Y); la cabeza compensa para seguir mirando al objeto
    P.spine_rot = [((1, 0, 0), lean * 0.5 * e)]
    P.chest_rot = [((1, 0, 0), lean * 0.5 * e)]
    P.head_rot = [((1, 0, 0), -lean * 0.25 * e + 6 * max(0.0, e - 1) / 0.15 - 4 * max(0.0, -e) / 0.25)]
    P.stretch = max(-0.035, min(0.04, 0.13 * (e - 0.85))) if e > 0 else -0.035 * min(1.0, -e / 0.2)
    for s in ('L', 'R'):
        hang(P, s, lean * e)
    for s in (('L', 'R') if both else (hand,)):
        sx = 1 if s == 'L' else -1
        rest_w = rest_wrist(P, s)
        tgt = Vector(target_rel) if s == hand else Vector((-target_rel[0], target_rel[1], target_rel[2]))
        P.hand[s] = rest_w + (tgt - rest_w) * e
        P.hand_rot[s] = [((1, 0, 0), -40 * e)]
        P.elbow_pole[s] = Vector((sx * 0.25 * ep, 0, -0.1 * ep))
        P.shoulder[s] = 10 * max(0.0, e - 0.6)  # el hombro se va con el estirón
    if tiptoe:
        for s in ('L', 'R'):
            P.roll[s] = 25 * tiptoe * ep
    if crouch > 0.15:
        # rodillas abiertas hacia delante y fuera
        P.foot['L'] = (Vector((0.02 * ep, 0, 0)), 0)
        P.foot['R'] = (Vector((-0.02 * ep, 0, 0)), 0)
    return P


# Envolvente de los gestos (5 fotogramas en GESTURE_MS): anticipación hacia atrás, estirón que se pasa, rebote y vuelta
GESTURE_ENV = [-0.25, 0.7, 1.15, 0.9, 0.3]


def gesture_env(i, n):
    if n == len(GESTURE_ENV):
        return GESTURE_ENV[i]
    return math.sin(math.pi * (i + 0.5) / n)


GESTURES = {
    # nombre: (función de e → Pose)
    'pick_low': lambda e: reach_pose(e, (-0.20, -0.36, 0.42), crouch=0.36, lean=45),
    'pick_mid': lambda e: reach_pose(e, (-0.30, -0.38, 1.00), lean=12),
    'pick_high': lambda e: reach_pose(e, (-0.30, -0.22, 1.72), tiptoe=0.6),
    'use': lambda e: reach_pose(e, (-0.22, -0.42, 1.10), lean=8),
    'push': lambda e: reach_pose(e, (-0.16, -0.48, 1.12), lean=20, both=True),
    'pull': lambda e: _pull(e),
    'give': lambda e: _give(e),
}


def _pull(e):
    P = reach_pose(1.0, (-0.16, -0.42, 1.05), lean=0, both=True)
    k = e  # anticipación: se echa hacia el objeto; luego tira pasándose hacia atrás
    P.hips_off = Vector((0, 0.05 * k, -0.03 * abs(k)))
    P.spine_rot = [((1, 0, 0), -12 * k)]
    P.chest_rot = [((1, 0, 0), -6 * k)]
    P.stretch = -0.03 * max(0.0, k - 0.8) / 0.35
    for s in ('L', 'R'):
        P.hand[s] = P.hand[s] + Vector((0, 0.10 * k, 0))
    return P


def _give(e):
    P = reach_pose(e, (-0.24, -0.42, 1.05), lean=5)
    P.hand_rot['R'] = [((0, 1, 0), 70 * max(0.0, e))]  # palma hacia arriba
    P.head_rot = [((1, 0, 0), 4 * e), ((0, 1, 0), 6 * max(0.0, e - 0.5))]
    return P


# ── «No puedo»: encogimiento de hombros ─────────────────────────────────────────────────────────────────────────────
SHRUG = {
    'k': [-0.15, 0.75, 1.12, 1.0, 0.95, 0.5, 0.1],
    'sh': [-4, 15, 24, 21, 19, 8, 1],
    'dip': [0.035, 0.0, -0.004, 0.0, 0.004, 0.01, 0.004],
    'tilt': [0, 8, 15, 14, 12, 5, 1],
    'look': [3, -4, -7, -6, -5, -2, 0],
    'stretch': [-0.035, 0.02, 0.035, 0.02, 0.01, 0.0, 0.0],
}


def shrug_pose(i):
    P = idle_pose(0)
    T = {k: v[i] for k, v in SHRUG.items()}
    k = T['k']
    P.hips_off = Vector((0, 0, -0.004 - T['dip']))
    P.stretch = T['stretch']
    P.shoulder = {'L': T['sh'], 'R': T['sh']}
    P.chest_rot = [((1, 0, 0), -4 * k)]
    P.neck_rot = [((1, 0, 0), 5 * max(0.0, k))]  # el cuello se hunde entre los hombros
    P.head_rot = [((0, 1, 0), T['tilt']), ((1, 0, 0), T['look']), ((0, 0, 1), 4 * max(0.0, k))]
    P.jaw = 0.25 * max(0.0, k)  # boca torcida de «ni idea»
    for s, sx in (('L', 1), ('R', -1)):
        reach_to(P, s, (sx * 0.34, -0.12, 0.98), k, pole=(sx * 0.12, 0.2, -0.12))
        P.hand_rot[s] = [((0, 1, 0), -sx * 75 * max(0.0, k))]  # palmas fuera, hacia arriba
    return P


# ── Manías de reposo (de frente; se disparan tras unos segundos quieto, PlayerAnim) ────────────────────────────────
def _scratch(i):
    k = [-0.12, 0.55, 1.08, 1.0, 1.0, 1.0, 1.0, 0.95, 0.45, 0.0][i]
    w = [0, 0, 0, 1, -1, 1, -1, 0.5, 0, 0][i]
    P = idle_pose(0)
    P.hips_off = Vector((0.01 * max(0.0, k), 0, -0.004 - 0.02 * max(0.0, -k) / 0.12))
    reach_to(P, 'R', (-0.15, 0.0, 1.70), k, pole=(-0.32, 0.05, 0.32))
    P.hand['R'] += Vector((0.018 * w, 0, 0.012 * abs(w)))
    P.hand_rot['R'] = [((0, 1, 0), 25 * w)]
    P.shoulder['R'] = 8 * max(0.0, k)
    P.head_rot = [((0, 1, 0), -10 * max(0.0, k) - 2 * w), ((1, 0, 0), -6 * max(0.0, k)), ((0, 0, 1), -5 * max(0.0, k))]
    P.chest_rot = [((0, 1, 0), 3 * max(0.0, k))]
    P.jaw = [0, 0, 0, 0.25, 0.1, 0.25, 0.1, 0, 0, 0][i]
    return P


def _glasses(i):
    k = [-0.1, 0.55, 1.0, 1.08, 1.0, 1.0, 0.98, 0.6, 0.15, 0.0][i]
    push = [0, 0, 0, 0, 1, 0.4, 0, 0, 0, 0][i]
    P = idle_pose(0)
    P.hips_off = Vector((0, 0, -0.004 - 0.02 * max(0.0, -k) / 0.1))
    reach_to(P, 'R', (-0.03, -0.19, 1.44), k, pole=(-0.18, -0.08, -0.05))
    P.hand['R'] += Vector((0, 0, 0.03 * push))
    P.hand_rot['R'] = [((1, 0, 0), -15 * max(0.0, k))]
    P.head_rot = [((1, 0, 0), [0, 0, -2, -3, -9, -5, 3, 2, 0, 0][i]), ((0, 0, 1), [0, 0, 0, 0, 0, 2, 5, 4, 1, 0][i])]
    P.chest_rot = [((1, 0, 0), -3 * max(0.0, k))]  # pecho fuera: muy digno
    P.stretch = 0.025 * push
    return P


def _yawn(i):
    k = [-0.15, -0.2, 0.4, 0.9, 1.1, 1.15, 1.1, 1.0, 0.6, 0.2, -0.05, 0.0][i]
    P = idle_pose(0)
    kp = max(0.0, k)
    P.hips_off = Vector((0, 0, -0.004 - 0.035 * max(0.0, -k) / 0.2))
    for s, sx in (('L', 1), ('R', -1)):
        reach_to(P, s, (sx * 0.46, 0.06, 1.58), k, pole=(sx * 0.2, 0.25, -0.1))  # en V: el sprite no tiene sitio sobre la cabeza
        P.shoulder[s] = 12 * kp - 6 * max(0.0, -k) / 0.2
        P.hand_rot[s] = [((0, 1, 0), sx * 30 * kp)]
    P.jaw = [0, 0, 0.3, 0.8, 1, 1, 1, 0.9, 0.5, 0.1, 0, 0][i]
    P.head_rot = [((1, 0, 0), -12 * kp + 6 * max(0.0, -k) / 0.2), ((0, 1, 0), 4 * kp)]
    P.chest_rot = [((1, 0, 0), -7 * kp + 5 * max(0.0, -k) / 0.2)]
    P.stretch = 0.045 * max(0.0, k - 0.5) / 0.65 - 0.03 * max(0.0, -k) / 0.2
    for s in ('L', 'R'):
        P.roll[s] = 12 * max(0.0, k - 0.75) / 0.4  # algo de puntillas al estirarse
    return P


def _tap(i):
    k = [-0.1, 0.6, 1.05, 1, 1, 1, 1, 1, 1, 1, 0.55, 0.1][i]
    tap = [0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0][i]
    P = idle_pose(0)
    kp = max(0.0, k)
    P.hips_off = Vector((0.018 * kp, 0, -0.004))  # el peso en la pierna izquierda
    P.hips_rot = [((0, 1, 0), -3 * kp)]
    reach_to(P, 'L', (-0.07, -0.17, 1.16), k, pole=(0.22, -0.25, -0.05))
    reach_to(P, 'R', (0.08, -0.15, 1.11), k, pole=(-0.22, -0.25, -0.05))
    P.shoulder = {'L': 5 * kp, 'R': 5 * kp}
    P.foot['R'] = (Vector((-0.02 * kp, -0.04 * kp, 0)), 24 * tap)  # golpecitos: puntera arriba y abajo
    P.head_rot = [((0, 1, 0), 7 * kp), ((0, 0, 1), [0, 0, 4, 8, 8, 8, 8, 6, 2, 0, 0, 0][i]), ((1, 0, 0), -3 * tap - 3 * kp)]
    P.chest_rot = [((1, 0, 0), -3 * kp)]
    return P


def _rock(i):
    k = [0.3, 0.85, 1, 1, 1, 1, 1, 1, 0.6, 0.15][i]
    r = [0, 1, 1, 0, -1, -1, 0, 1, 0, 0][i]  # +1 de puntillas, −1 sobre los talones
    P = idle_pose(0)
    P.hips_off = Vector((0, 0.035 * r, -0.012))
    for s, sx in (('L', 1), ('R', -1)):
        reach_to(P, s, (sx * 0.08, 0.15, 0.95), k, pole=(sx * 0.15, 0.25, 0))  # manos a la espalda
        P.roll[s] = 20 * max(0.0, r)
        P.foot[s] = (Vector(), 18 * max(0.0, -r))
    P.spine_rot = [((1, 0, 0), -4 * r)]
    P.head_rot = [((0, 0, 1), [0, 4, 8, 8, 0, -8, -8, -4, 0, 0][i]), ((1, 0, 0), 3 * r), ((0, 1, 0), 3 * r)]
    P.jaw = 0.15 * k  # silbando
    return P


MANIAS = {
    # nombre: (fotogramas, fps, pose)
    'idle_scratch': (10, 9, _scratch),
    'idle_glasses': (10, 9, _glasses),
    'idle_yawn': (12, 9, _yawn),
    'idle_tap': (12, 9, _tap),
    'idle_rock': (10, 9, _rock),
}


def build_actions(rig, stride_m):
    """Crea las acciones y devuelve {nombre: {action, start, frames, fps, dirs, loop}}."""
    out = {}
    rig.animation_data_create()
    frame = 1

    def make(name, n, fps, dirs, loop, posefn):
        nonlocal frame
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        start = frame
        for i in range(n):
            apply(rig, posefn(i))
            key(rig, start + i)
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        out[name] = {'action': act, 'start': start, 'frames': n, 'fps': fps, 'dirs': dirs, 'loop': loop}
        frame = start + n + 10

    eight = ['down', 'down_right', 'right', 'up_right', 'up', 'up_left', 'left', 'down_left']
    four = ['down', 'right', 'up', 'left']
    make('idle', 4, 3, eight, True, lambda i: idle_pose(i / 4))
    make('walk', WALK_FRAMES, 1000 * WALK_FRAMES / WALK_CYCLE_MS, eight, True, lambda i: walk_pose(i / WALK_FRAMES, stride_m))
    make('talk', 8, 10, ['down', 'right', 'left', 'down_right', 'down_left'], True, lambda i: talk_pose(i, 8))
    for g, fn in GESTURES.items():
        make(g, 5, 1000 * 5 / 320, four, False, lambda i, fn=fn: fn(gesture_env(i, 5)))
    make('shrug', 7, 10, ['down', 'right', 'left'], False, shrug_pose)
    for m, (n, fps, fn) in MANIAS.items():
        make(m, n, fps, ['down'], False, fn)
    rig.animation_data.action = None
    return out

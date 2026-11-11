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


def arm_swing(P, s, deg, bend=0.0):
    """Muñeca colgando del hombro girada `deg` grados hacia delante (+) y algo doblada al ir delante."""
    sx = 1 if s == 'L' else -1
    S = Vector(B.side(B.SHOULDER, sx)) + P.hips_off
    v = Vector(B.side(B.WRIST, sx)) - Vector(B.side(B.SHOULDER, sx))
    v = Matrix.Rotation(math.radians(-deg), 3, 'X') @ v
    v *= 1 - bend
    P.hand[s] = S + v


# ── Animaciones ───────────────────────────────────────────────────────────────────────────────────────────────────
def walk_pose(p, stride):
    """p = fase [0, 1). Pie izquierdo apoya el talón en p = 0, el derecho en p = 0,5."""
    P = Pose()
    duty = 0.6
    A = stride * duty  # media excursión del pie: en el apoyo recorre 2A en duty·T → v = 2·stride/T
    lift = 0.075
    for s, ph in (('L', 0.0), ('R', 0.5)):
        q = (p - ph) % 1.0
        if q < duty:
            y = A - 2 * A * (q / duty)  # adelante = -Y
            z = 0.0
            pitch = 14 * (1 - smooth(q / 0.12))  # talón: puntera arriba al pisar
            roll = 32 * smooth((q - (duty - 0.22)) / 0.22)  # despegue: talón arriba sobre la bola
        else:
            t = (q - duty) / (1 - duty)
            y = -A + 2 * A * smooth(t)
            z = lift * math.sin(math.pi * min(1, t * 1.1))
            pitch = -28 * (1 - smooth(t / 0.5)) + 10 * smooth((t - 0.6) / 0.4)
            roll = 0.0
        P.foot[s] = (Vector((0, -y, z)), pitch)
        P.roll[s] = roll
    w = 2 * math.pi * p
    P.hips_off = Vector((0.012 * math.sin(w), -0.0, -0.05 - 0.018 * math.cos(2 * w)))
    P.hips_rot = [((0, 0, 1), 6 * math.cos(w)), ((0, 1, 0), 2.5 * math.sin(w))]
    P.spine_rot = [((1, 0, 0), -4)]  # algo inclinado hacia delante
    P.chest_rot = [((0, 0, 1), -10 * math.cos(w)), ((0, 1, 0), -2 * math.sin(w))]
    P.head_rot = [((0, 0, 1), 4 * math.cos(w)), ((1, 0, 0), 3)]
    for s, sgn in (('L', -1), ('R', 1)):
        a = sgn * 22 * math.cos(w)  # brazo contrario a la pierna
        arm_swing(P, s, a, bend=0.06 * max(0.0, a) / 22)
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


TALK_JAW = [0.0, 1.0, 0.35, 0.9, 0.1, 0.75, 0.25, 0.95]


def talk_pose(i, n):
    P = idle_pose(i / n)
    P.jaw = TALK_JAW[i % len(TALK_JAW)]
    w = 2 * math.pi * i / n
    P.head_rot = [((1, 0, 0), -4 * math.sin(2 * w)), ((0, 0, 1), 5 * math.sin(w))]
    # mano derecha que acompaña lo que dice
    arm_swing(P, 'R', 35 + 15 * math.sin(w), bend=0.35)
    P.hand['R'] += Vector((0.04, 0, 0.05))
    P.hand_rot['R'] = [((0, 1, 0), 20)]
    return P


def reach_pose(e, target_rel, crouch=0.0, lean=0.0, tiptoe=0.0, hand='R', both=False):
    """Alcanzar: e ∈ [0,1] = cuánto; target_rel = muñeca respecto al pie (armature)."""
    P = idle_pose(0)
    P.hips_off = Vector((0, -0.03 * e * (lean > 0), -crouch * e + 0.04 * tiptoe * e))
    P.spine_rot = [((1, 0, 0), -lean * 0.5 * e)]
    P.chest_rot = [((1, 0, 0), -lean * 0.5 * e)]
    P.head_rot = [((1, 0, 0), -lean * 0.4 * e)]
    for s in (('L', 'R') if both else (hand,)):
        sx = 1 if s == 'L' else -1
        rest_w = Vector(B.side(B.WRIST, sx)) + P.hips_off
        tgt = Vector(target_rel) if s == hand else Vector((-target_rel[0], target_rel[1], target_rel[2]))
        P.hand[s] = rest_w.lerp(tgt, smooth(e))
        P.hand_rot[s] = [((1, 0, 0), -40 * e)]
        P.elbow_pole[s] = Vector((sx * 0.25 * e, 0, -0.1 * e))
    if tiptoe:
        for s in ('L', 'R'):
            P.roll[s] = 25 * tiptoe * e
    if crouch > 0.15:
        # rodillas abiertas hacia delante y fuera
        P.foot['L'] = (Vector((0.02 * e, 0, 0)), 0)
        P.foot['R'] = (Vector((-0.02 * e, 0, 0)), 0)
    return P


def gesture_env(i, n):
    """Envolvente de un gesto de n fotogramas: sale de reposo, llega arriba y vuelve (como PlayerAnim.gesturePose)."""
    return math.sin(math.pi * (i + 0.5) / n)


GESTURES = {
    # nombre: (función de e → Pose)
    'pick_low': lambda e: reach_pose(e, (-0.12, -0.36, 0.20), crouch=0.30, lean=38),
    'pick_mid': lambda e: reach_pose(e, (-0.12, -0.42, 0.98), lean=10),
    'pick_high': lambda e: reach_pose(e, (-0.12, -0.25, 1.62), tiptoe=1.0),
    'use': lambda e: reach_pose(e, (-0.10, -0.40, 1.10), lean=6),
    'push': lambda e: reach_pose(e, (-0.16, -0.48, 1.12), lean=18, both=True),
    'pull': lambda e: _pull(e),
    'give': lambda e: _give(e),
}


def _pull(e):
    P = reach_pose(1.0, (-0.16, -0.42, 1.05), lean=0, both=True)
    k = smooth(e)
    P.hips_off = Vector((0, 0.05 * k, -0.03 * k))
    P.spine_rot = [((1, 0, 0), 12 * k)]
    P.chest_rot = [((1, 0, 0), 6 * k)]
    for s in ('L', 'R'):
        P.hand[s] = P.hand[s] + Vector((0, 0.10 * k, 0))
    return P


def _give(e):
    P = reach_pose(e, (-0.10, -0.40, 1.05), lean=4)
    P.hand_rot['R'] = [((0, 1, 0), 70 * e)]  # palma hacia arriba
    P.head_rot = [((1, 0, 0), 4 * e)]
    return P


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
    rig.animation_data.action = None
    return out

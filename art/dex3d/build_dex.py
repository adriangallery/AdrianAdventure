"""A2.14 · Dex en 3D: malla low-poly por piezas + materiales + armature con IK, polos y foot roll + pesos explícitos.

Uso (headless, Blender 4.2 LTS):
    blender -b -P art/dex3d/build_dex.py -- [--out art/dex3d/dex.blend]
Normalmente no se llama solo: lo importa render.py (build() devuelve el objeto armature).

Convenciones: metros, Z arriba, Dex mira a -Y (a cámara). Lado .L = +X (izquierda del personaje = derecha de la
pantalla cuando está de frente). Alto total (con pelo) ~1,80 m = 103 px de arte (A2.11).

Pesos: cada pieza es un tubo/caja con anillos cada pocos cm; el peso de cada vértice se calcula a mano según su
posición a lo largo de la cadena de huesos con una mezcla suave (smoothstep) de ±BLEND m en cada articulación
(codo, rodilla, hombro, cadera, cuello). Sin pesos automáticos por calor.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

BLEND = 0.045  # media anchura de la mezcla de pesos en cada articulación (m)

# ── Medidas (m) ───────────────────────────────────────────────────────────────────────────────────────────────────
HIP_X = 0.095
ANKLE_Z = 0.11
KNEE = (0.0, -0.012, 0.50)  # rodilla un poco adelantada: el IK sabe hacia dónde doblar
HIP_Z = 0.87
SHOULDER = (0.175, 0.01, 1.315)
ELBOW = (0.205, 0.035, 1.075)  # codo un poco atrás
WRIST = (0.215, 0.0, 0.855)
HAND_TIP = (0.215, -0.005, 0.765)
NECK_BASE = 1.335
HEAD_BASE = 1.39
HEAD_TOP = 1.74
HEAD_C = Vector((0.0, -0.005, 1.535))
HEAD_K = 1.27  # cabeza grande de aventura gráfica: todo lo de la cabeza se escala ×HEAD_K sobre HEAD_C
MOUTH_C = HEAD_C + Vector((0, -0.118, -0.085)) * HEAD_K

COLORS = {
    'skin': (0.96, 0.66, 0.48),
    'skin_dark': (0.62, 0.30, 0.20),
    'hair': (0.035, 0.032, 0.03),
    'shirt_red': (0.80, 0.03, 0.06),
    'jeans': (0.20, 0.38, 0.68),
    'jeans_cuff': (0.45, 0.60, 0.82),
    'shoe_red': (0.82, 0.04, 0.07),
    'sole': (0.92, 0.92, 0.92),
    'white': (0.95, 0.95, 0.95),
    'lens_red': (0.85, 0.02, 0.05),
    'lens_cyan': (0.05, 0.85, 0.95),
    'mouth': (0.25, 0.04, 0.04),
    'belt': (0.88, 0.88, 0.90),
    'eye': (0.02, 0.02, 0.02),
}


def srgb_to_lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ── Materiales ────────────────────────────────────────────────────────────────────────────────────────────────────
def mat_flat(name, rgb, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb_to_lin(rgb), 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Specular IOR Level'].default_value = 0.1
    return m


def mat_plaid(name='shirt_plaid'):
    """Cuadros rojo/negro con la posición de reposo (atributo 'rest'): no «nada» al deformar."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Specular IOR Level'].default_value = 0.05
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'rest'
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(attr.outputs['Vector'], sep.inputs[0])
    period = 0.075

    def band(sock, width):
        # 1 dentro de la franja oscura: fract(v/period) < width
        div = nt.nodes.new('ShaderNodeMath'); div.operation = 'DIVIDE'; div.inputs[1].default_value = period
        nt.links.new(sock, div.inputs[0])
        fr = nt.nodes.new('ShaderNodeMath'); fr.operation = 'FRACT'
        nt.links.new(div.outputs[0], fr.inputs[0])
        lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = width
        nt.links.new(fr.outputs[0], lt.inputs[0])
        return lt.outputs[0]

    # horizontal: x+y (para que los costados también tengan cuadros)
    addxy = nt.nodes.new('ShaderNodeMath'); addxy.operation = 'ADD'
    nt.links.new(sep.outputs['X'], addxy.inputs[0]); nt.links.new(sep.outputs['Y'], addxy.inputs[1])
    vb = band(addxy.outputs[0], 0.42)
    hb = band(sep.outputs['Z'], 0.42)
    both = nt.nodes.new('ShaderNodeMath'); both.operation = 'MULTIPLY'
    nt.links.new(vb, both.inputs[0]); nt.links.new(hb, both.inputs[1])
    anyb = nt.nodes.new('ShaderNodeMath'); anyb.operation = 'MAXIMUM'
    nt.links.new(vb, anyb.inputs[0]); nt.links.new(hb, anyb.inputs[1])
    # rojo → rojo oscuro (una franja) → negro (cruce)
    r1 = nt.nodes.new('ShaderNodeMix'); r1.data_type = 'RGBA'
    r1.inputs['A'].default_value = (*srgb_to_lin(COLORS['shirt_red']), 1)
    r1.inputs['B'].default_value = (*srgb_to_lin((0.33, 0.01, 0.03)), 1)
    nt.links.new(anyb.outputs[0], r1.inputs['Factor'])
    r2 = nt.nodes.new('ShaderNodeMix'); r2.data_type = 'RGBA'
    nt.links.new(r1.outputs['Result'], r2.inputs['A'])
    r2.inputs['B'].default_value = (*srgb_to_lin((0.03, 0.01, 0.01)), 1)
    nt.links.new(both.outputs[0], r2.inputs['Factor'])
    nt.links.new(r2.outputs['Result'], bsdf.inputs['Base Color'])
    return m


# ── Geometría ─────────────────────────────────────────────────────────────────────────────────────────────────────
def new_obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    # posición de reposo para las texturas procedurales
    at = me.attributes.new('rest', 'FLOAT_VECTOR', 'POINT')
    for i, v in enumerate(me.vertices):
        at.data[i].vector = v.co
    return ob


def tube(points, segs=8, cap=True, squash=(1.0, 1.0)):
    """Tubo por una polilínea [(Vector centro, radio)]; anillos perpendiculares a la dirección local."""
    bm = bmesh.new()
    rings = []
    n = len(points)
    for i, (c, r) in enumerate(points):
        c = Vector(c)
        if i == 0:
            d = Vector(points[1][0]) - c
        elif i == n - 1:
            d = c - Vector(points[i - 1][0])
        else:
            d = Vector(points[i + 1][0]) - Vector(points[i - 1][0])
        d.normalize()
        ref = Vector((0, -1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
        u = d.cross(ref).normalized()
        w = d.cross(u).normalized()
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs + math.pi / segs
            p = c + u * (math.cos(a) * r * squash[0]) + w * (math.sin(a) * r * squash[1])
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(segs):
            a, b = rings[i][k], rings[i][(k + 1) % segs]
            c2, d2 = rings[i + 1][(k + 1) % segs], rings[i + 1][k]
            bm.faces.new((a, b, c2, d2))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)


def chain_points(joints, radii, step=0.03):
    """Puntos cada ~step m a lo largo de las articulaciones, con el radio interpolado."""
    pts = []
    for j in range(len(joints) - 1):
        a, b = Vector(joints[j]), Vector(joints[j + 1])
        n = max(2, int((b - a).length / step))
        for i in range(n):
            t = i / n
            pts.append((a.lerp(b, t), radii[j] + (radii[j + 1] - radii[j]) * t))
    pts.append((Vector(joints[-1]), radii[-1]))
    return pts


def box(c, size, bevel_segs=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(c)
    return bm


def sphere(c, r, scale=(1, 1, 1), segs=12, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])) + Vector(c)
    return bm


def loft(sections):
    """Cuerpo por secciones horizontales [(z, ancho, fondo, y_centro)] con 12 vértices por sección (elipse redondeada)."""
    bm = bmesh.new()
    rings = []
    segs = 12
    for z, w, d, yc in sections:
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            cx, cy = math.cos(a), math.sin(a)
            # superelipse (más cuadrada que una elipse)
            ex = math.copysign(abs(cx) ** 0.7, cx)
            ey = math.copysign(abs(cy) ** 0.7, cy)
            ring.append(bm.verts.new((ex * w / 2, yc + ey * d / 2, z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def mirror_x(p):
    return (-p[0], p[1], p[2])


def side(p, s):
    return p if s > 0 else mirror_x(p)


# ── Pesos ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def chain_weights(p, joints, bones, blend=BLEND):
    """Pesos de un punto sobre una cadena: proyección a lo largo de la cadena, mezcla smoothstep de ±blend en cada
    articulación interior. joints: N+1 puntos; bones: N nombres."""
    p = Vector(p)
    # distancia acumulada de la proyección
    lens = [(Vector(joints[i + 1]) - Vector(joints[i])).length for i in range(len(bones))]
    best = None
    acc = 0.0
    for i in range(len(bones)):
        a, b = Vector(joints[i]), Vector(joints[i + 1])
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
        dist = (a + ab * t - p).length
        s = acc + t * lens[i]
        if best is None or dist < best[0] - 1e-6:
            best = (dist, s)
        acc += lens[i]
    s = best[1]
    w = {}
    acc = 0.0
    bounds = []
    for i in range(len(bones)):
        bounds.append(acc)
        acc += lens[i]
    for i, bn in enumerate(bones):
        lo = bounds[i]
        hi = bounds[i] + lens[i]
        win = 1.0
        if i > 0:
            win *= smooth((s - (lo - blend)) / (2 * blend))
        if i < len(bones) - 1:
            win *= 1 - smooth((s - (hi - blend)) / (2 * blend))
        if win > 1e-4:
            w[bn] = win
    tot = sum(w.values()) or 1
    return {k: v / tot for k, v in w.items()}


def assign(ob, fn):
    vgs = {}
    for v in ob.data.vertices:
        for bn, wt in fn(v.co).items():
            if bn not in vgs:
                vgs[bn] = ob.vertex_groups.new(name=bn)
            vgs[bn].add([v.index], wt, 'REPLACE')


def assign_all(ob, bone):
    assign(ob, lambda co: {bone: 1.0})


# ── Armature ──────────────────────────────────────────────────────────────────────────────────────────────────────
def signed_angle(u, v, normal):
    a = u.angle(v)
    if u.cross(v).angle(normal) < 1:
        a = -a
    return a


def pole_angle(base, tip_bone, pole_loc):
    pole_normal = (tip_bone.tail - base.head).cross(pole_loc - base.head)
    proj = pole_normal.cross(base.tail - base.head)
    return signed_angle(base.x_axis, proj, base.tail - base.head)


def build_armature():
    arm = bpy.data.armatures.new('DexRig')
    rig = bpy.data.objects.new('DexRig', arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.show_in_front = True
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones

    def bone(name, head, tail, parent=None, deform=True, connect=False, roll=0.0):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        b.roll = roll
        b.use_deform = deform
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    bone('root', (0, 0, 0), (0, 0.25, 0), deform=False)
    bone('hips', (0, 0, 0.93), (0, 0, 1.03), 'root')
    bone('spine', (0, 0, 1.03), (0, 0, 1.18), 'hips', connect=True)
    bone('chest', (0, 0, 1.18), (0, 0, NECK_BASE), 'spine', connect=True)
    bone('neck', (0, 0, NECK_BASE), (0, -0.005, HEAD_BASE), 'chest', connect=True)
    bone('head', (0, -0.005, HEAD_BASE), (0, -0.005, HEAD_TOP), 'neck', connect=True)
    bone('jaw', MOUTH_C + Vector((0, 0.01, 0)), MOUTH_C + Vector((0, -0.05, 0)), 'head')
    for s, sx in (('L', 1), ('R', -1)):
        S = side(SHOULDER, sx)
        bone(f'shoulder.{s}', side((0.03, 0.0, 1.30), sx), S, 'chest')
        bone(f'upper_arm.{s}', S, side(ELBOW, sx), f'shoulder.{s}', connect=True)
        bone(f'forearm.{s}', side(ELBOW, sx), side(WRIST, sx), f'upper_arm.{s}', connect=True)
        bone(f'hand.{s}', side(WRIST, sx), side(HAND_TIP, sx), f'forearm.{s}', connect=True)
        H = (sx * HIP_X, 0, HIP_Z)
        K = (sx * HIP_X, KNEE[1], KNEE[2])
        A = (sx * HIP_X, 0.02, ANKLE_Z)
        BALL = (sx * HIP_X, -0.13, 0.03)
        TOE = (sx * HIP_X, -0.22, 0.03)
        HEEL = (sx * HIP_X, 0.08, 0.0)
        bone(f'thigh.{s}', H, K, 'hips')
        bone(f'shin.{s}', K, A, f'thigh.{s}', connect=True)
        bone(f'foot.{s}', A, BALL, f'shin.{s}', connect=True)
        bone(f'toe.{s}', BALL, TOE, f'foot.{s}', connect=True)
        # controles (no deforman)
        bone(f'foot_ik.{s}', HEEL, (sx * HIP_X, -0.22, 0.0), 'root', deform=False)
        bone(f'foot_roll.{s}', BALL, (sx * HIP_X, BALL[1] + 0.0, BALL[2] + 0.08), f'foot_ik.{s}', deform=False)
        bone(f'ankle_tgt.{s}', A, (sx * HIP_X, A[1] + 0.06, A[2]), f'foot_roll.{s}', deform=False)
        bone(f'knee_pole.{s}', (sx * HIP_X, -0.55, KNEE[2]), (sx * HIP_X, -0.62, KNEE[2]), 'root', deform=False)
        bone(f'hand_ik.{s}', side(WRIST, sx), side((WRIST[0], WRIST[1], WRIST[2] - 0.07), sx), 'root', deform=False)
        bone(f'elbow_pole.{s}', side((ELBOW[0], 0.45, ELBOW[2]), sx), side((ELBOW[0], 0.52, ELBOW[2]), sx), 'root', deform=False)
    poles = {}
    for s in ('L', 'R'):
        poles[f'shin.{s}'] = pole_angle(eb[f'thigh.{s}'], eb[f'shin.{s}'], eb[f'knee_pole.{s}'].head)
        poles[f'forearm.{s}'] = pole_angle(eb[f'upper_arm.{s}'], eb[f'forearm.{s}'], eb[f'elbow_pole.{s}'].head)
    bpy.ops.object.mode_set(mode='POSE')
    pbs = rig.pose.bones
    for pb in pbs:
        pb.rotation_mode = 'QUATERNION'
    for s in ('L', 'R'):
        ik = pbs[f'shin.{s}'].constraints.new('IK')
        ik.target = rig; ik.subtarget = f'ankle_tgt.{s}'
        ik.pole_target = rig; ik.pole_subtarget = f'knee_pole.{s}'
        ik.pole_angle = poles[f'shin.{s}']
        ik.chain_count = 2
        ik = pbs[f'forearm.{s}'].constraints.new('IK')
        ik.target = rig; ik.subtarget = f'hand_ik.{s}'
        ik.pole_target = rig; ik.pole_subtarget = f'elbow_pole.{s}'
        ik.pole_angle = poles[f'forearm.{s}']
        ik.chain_count = 2
        # pie: apunta siempre a la bola del foot_roll (roll de talón) ; dedos planos como el control
        dt = pbs[f'foot.{s}'].constraints.new('DAMPED_TRACK')
        dt.target = rig; dt.subtarget = f'foot_roll.{s}'
        cr = pbs[f'toe.{s}'].constraints.new('COPY_ROTATION')
        cr.target = rig; cr.subtarget = f'foot_ik.{s}'
        cr.mix_mode = 'REPLACE'
        # límites: la rodilla solo dobla hacia delante y el codo hacia atrás (los da el polo; aquí rigidez lateral)
        pbs[f'shin.{s}'].lock_ik_y = True
        pbs[f'shin.{s}'].lock_ik_z = True
        pbs[f'forearm.{s}'].lock_ik_y = True
    bpy.ops.object.mode_set(mode='OBJECT')
    # el toe rest dir es -Y igual que foot_ik: COPY_ROTATION mantiene la puntera plana; ajuste fino del bone
    return rig


# ── Malla de Dex ──────────────────────────────────────────────────────────────────────────────────────────────────
def build_mesh(rig):
    M = {k: mat_flat(k, v) for k, v in COLORS.items()}
    M['plaid'] = mat_plaid()
    M['lens_red'] = mat_flat('lens_red_e', COLORS['lens_red'], 0.3)
    M['lens_cyan'] = mat_flat('lens_cyan_e', COLORS['lens_cyan'], 0.3)
    objs = []

    def add(ob, wfn):
        if wfn in ('head', 'jaw'):
            for v in ob.data.vertices:
                v.co = HEAD_C + (v.co - HEAD_C) * HEAD_K
        if isinstance(wfn, str):
            assign_all(ob, wfn)
        else:
            assign(ob, wfn)
        objs.append(ob)

    torso_bones_j = [(0, 0, 0.90), (0, 0, 1.03), (0, 0, 1.18), (0, 0, NECK_BASE)]

    def torso_w(co):
        w = chain_weights((0, 0, co.z), torso_bones_j, ['hips', 'spine', 'chest'], blend=0.05)
        # esquinas de los hombros: mezcla con la clavícula
        ax = abs(co.x)
        if co.z > 1.22 and ax > 0.09:
            k = smooth((ax - 0.09) / 0.08) * smooth((co.z - 1.22) / 0.08) * 0.6
            s = 'L' if co.x > 0 else 'R'
            w = {b: v * (1 - k) for b, v in w.items()}
            w[f'shoulder.{s}'] = w.get(f'shoulder.{s}', 0) + k
        return w

    # camisa (torso) — algo suelta, por fuera del pantalón
    shirt = loft([
        (0.935, 0.315, 0.205, 0.0), (0.99, 0.32, 0.205, 0.0), (1.06, 0.315, 0.20, 0.0), (1.13, 0.32, 0.20, 0.0),
        (1.20, 0.335, 0.205, 0.005), (1.26, 0.355, 0.205, 0.005), (1.30, 0.36, 0.195, 0.005), (1.335, 0.30, 0.17, 0.005),
        (1.36, 0.14, 0.12, 0.005),
    ])
    add(new_obj('shirt', shirt, M['plaid']), torso_w)
    # cintura blanca (la goma que asoma) y pantalón (pelvis)
    add(new_obj('belt', loft([(0.905, 0.30, 0.19, 0.0), (0.935, 0.305, 0.195, 0.0)]), M['belt']), 'hips')
    pelvis = loft([(0.80, 0.27, 0.17, 0.0), (0.84, 0.29, 0.18, 0.0), (0.88, 0.295, 0.185, 0.0), (0.91, 0.295, 0.185, 0.0)])

    def pelvis_w(co):
        s = 'L' if co.x > 0 else 'R'
        k = smooth((0.86 - co.z) / 0.07) * smooth((abs(co.x) - 0.02) / 0.06)
        return {'hips': 1 - k, f'thigh.{s}': k} if k > 1e-3 else {'hips': 1.0}
    add(new_obj('pelvis', pelvis, M['jeans']), pelvis_w)

    for s, sx in (('L', 1), ('R', -1)):
        H = (sx * HIP_X, 0, HIP_Z + 0.02)
        K = (sx * HIP_X, KNEE[1], KNEE[2])
        A = (sx * HIP_X, 0.02, ANKLE_Z + 0.06)
        leg_j = [H, K, A]
        legs = chain_points(leg_j, [0.08, 0.068, 0.062], step=0.03)
        leg = tube(legs, segs=8)

        def leg_w(co, sx=sx, s=s):
            w = chain_weights(co, [(sx * HIP_X, 0, HIP_Z), K, (sx * HIP_X, 0.02, ANKLE_Z)], [f'thigh.{s}', f'shin.{s}'])
            # arriba del muslo: algo de cadera
            k = smooth((co.z - (HIP_Z - 0.06)) / 0.08) * 0.5
            if k > 1e-3:
                w = {b: v * (1 - k) for b, v in w.items()}
                w['hips'] = k
            return w
        add(new_obj(f'leg.{s}', leg, M['jeans']), leg_w)
        # bajo vuelto del vaquero
        cuff = tube([((sx * HIP_X, 0.02, ANKLE_Z + 0.015), 0.074), ((sx * HIP_X, 0.02, ANKLE_Z + 0.07), 0.074)], segs=8)
        add(new_obj(f'cuff.{s}', cuff, M['jeans_cuff']), f'shin.{s}')
        # zapatilla: suela blanca + cuerpo rojo (talón→bola: foot, bola→punta: toe)
        x = sx * HIP_X

        def shoe_w(co, s=s):
            k = smooth((-(co.y) - 0.10) / 0.06)  # delante de la bola → toe
            return {f'foot.{s}': 1 - k, f'toe.{s}': k} if k > 1e-3 else {f'foot.{s}': 1.0}
        sole = box((x, -0.065, 0.02), (0.115, 0.31, 0.04))
        add(new_obj(f'sole.{s}', sole, M['sole']), shoe_w)
        upper = loft([(0.04, 0.105, 0.29, -0.065), (0.08, 0.10, 0.27, -0.055), (0.115, 0.09, 0.16, 0.0), (0.15, 0.085, 0.11, 0.025)])
        for v in upper.verts:
            v.co.x += x
        add(new_obj(f'shoe.{s}', upper, M['shoe_red']), shoe_w)

        # brazo: manga corta de cuadros + brazo de piel
        S, E, W, T = side(SHOULDER, sx), side(ELBOW, sx), side(WRIST, sx), side(HAND_TIP, sx)
        arm_j = [S, E, W]

        def arm_w(co, s=s, S=S, E=E, W=W):
            w = chain_weights(co, [S, E, W], [f'upper_arm.{s}', f'forearm.{s}'])
            # hombro: mezcla con la clavícula y el pecho en los primeros cm
            d = (Vector(co) - Vector(S)).length
            k = 1 - smooth(d / 0.07)
            if k > 1e-3:
                w = {b: v * (1 - k) for b, v in w.items()}
                w[f'shoulder.{s}'] = w.get(f'shoulder.{s}', 0) + k * 0.7
                w['chest'] = w.get('chest', 0) + k * 0.3
            return w
        arm_pts = chain_points([lerp(S, E, 0.25), E, W], [0.042, 0.038, 0.032], step=0.025)
        add(new_obj(f'arm.{s}', tube(arm_pts, segs=8), M['skin']), arm_w)
        sleeve_pts = chain_points([lerp(S, (0, 0, S[2]), 0.1) + Vector((0, 0, -0.01)), lerp(S, E, 0.42)], [0.068, 0.062], step=0.025)
        add(new_obj(f'sleeve.{s}', tube(sleeve_pts, segs=8), M['plaid']), arm_w)
        # mano: manopla + pulgar (todo al hueso hand)
        hand = sphere(lerp(W, T, 0.45), 0.042, scale=(0.75, 0.95, 1.25), segs=8, rings=6)
        thumb = sphere(Vector(W) + Vector((0, -0.035, -0.035)), 0.016, scale=(1, 1, 1.6), segs=6, rings=4)
        hb = hand
        tm = bpy.data.meshes.new('tmp')
        thumb.to_mesh(tm); thumb.free()
        hb.from_mesh(tm)
        bpy.data.meshes.remove(tm)
        add(new_obj(f'hand.{s}', hb, M['skin']), f'hand.{s}')

    # cuello
    neck = tube(chain_points([(0, 0.0, NECK_BASE - 0.03), (0, -0.005, HEAD_BASE + 0.03)], [0.048, 0.046], step=0.02), segs=8)
    add(new_obj('neck', neck, M['skin']),
        lambda co: chain_weights(co, [(0, 0, 1.2), (0, 0, NECK_BASE), (0, -0.005, HEAD_BASE), (0, 0, HEAD_TOP)], ['chest', 'neck', 'head'], blend=0.025))
    # cabeza (grande, de aventura gráfica): cráneo + mandíbula
    head = sphere(HEAD_C, 0.125, scale=(1.0, 1.05, 1.12), segs=14, rings=10)
    # afinar la barbilla
    for v in head.verts:
        if v.co.z < HEAD_C.z - 0.02:
            t = (HEAD_C.z - 0.02 - v.co.z) / 0.13
            v.co.x *= 1 - 0.22 * t
            v.co.y = HEAD_C.y + (v.co.y - HEAD_C.y) * (1 - 0.15 * t) - 0.012 * t
    add(new_obj('head', head, M['skin']), 'head')
    nose = sphere(HEAD_C + Vector((0, -0.13, -0.025)), 0.022, scale=(0.9, 1.1, 1.3), segs=8, rings=5)
    add(new_obj('nose', nose, M['skin']), 'head')
    for sx in (1, -1):
        ear = sphere(HEAD_C + Vector((sx * 0.118, 0.0, -0.005)), 0.025, scale=(0.5, 0.9, 1.3), segs=8, rings=5)
        add(new_obj(f'ear{sx}', ear, M['skin']), 'head')
    # boca (la abre el hueso jaw)
    mouth = box(HEAD_C + Vector((0, -0.118, -0.085)), (0.05, 0.02, 0.014))
    add(new_obj('mouth', mouth, M['mouth']), 'jaw')
    # gafas 3D: montura blanca + lente cian (lado R = izquierda de la pantalla) y roja (lado L)
    gz = HEAD_C.z + 0.015
    gy = HEAD_C.y - 0.128
    frame = box((0, gy, gz), (0.25, 0.018, 0.062))
    add(new_obj('glasses_frame', frame, M['white']), 'head')
    for sx, mat in ((1, M['lens_red']), (-1, M['lens_cyan'])):
        lens = box((sx * 0.055, gy - 0.011, gz), (0.075, 0.006, 0.042))
        add(new_obj(f'lens{sx}', lens, mat), 'head')
        temple = box((sx * 0.122, gy + 0.07, gz + 0.012), (0.012, 0.15, 0.014))
        add(new_obj(f'temple{sx}', temple, M['white']), 'head')
    # pelo: casquete + pinchos despeinados (deterministas)
    cap = sphere(HEAD_C + Vector((0, 0.012, 0.035)), 0.133, scale=(1.0, 1.06, 1.12), segs=14, rings=10)
    rm = [v for v in cap.verts if (v.co.y - HEAD_C.y < -0.05 and v.co.z < HEAD_C.z + 0.085) or (v.co.y - HEAD_C.y < 0.05 and v.co.z < HEAD_C.z + 0.045) or v.co.z < HEAD_C.z - 0.04]
    bmesh.ops.delete(cap, geom=rm, context='VERTS')
    import random
    rnd = random.Random(1414)
    for i in range(70):
        # dirección en el hemisferio de arriba y de atrás
        th = rnd.uniform(0, 2 * math.pi)
        ph = rnd.uniform(0.0, 1.6)
        d = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)))
        if d.z < 0.35 and not (d.y > 0.35 and d.z > -0.25):
            continue  # pinchos arriba y detrás: nada sobre la cara ni las orejas
        base = HEAD_C + Vector((0, 0.015, 0.04)) + Vector((d.x * 0.125, d.y * 0.13, d.z * 0.15))
        ln = rnd.uniform(0.06, 0.12)
        tip = base + (d + Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.2, 0.35), rnd.uniform(-0.1, 0.4)))).normalized() * ln
        res = bmesh.ops.create_cone(cap, cap_ends=True, segments=5, radius1=0.032, radius2=0.0, depth=ln)
        rot = (tip - base).to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.transform(cap, matrix=Matrix.Translation((base + tip) / 2) @ rot, verts=res['verts'])
    bmesh.ops.recalc_face_normals(cap, faces=cap.faces)
    add(new_obj('hair', cap, M['hair']), 'head')

    for ob in objs:
        ob.parent = rig
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig
    return objs


def build():
    clear_scene()
    rig = build_armature()
    build_mesh(rig)
    return rig


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    build()
    if '--out' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--out') + 1], compress=True)

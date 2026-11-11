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
SHOULDER = (0.195, 0.01, 1.315)
ELBOW = (0.207, 0.035, 1.075)  # codo un poco atrás; brazos que caen pegados al tronco
WRIST = (0.212, 0.0, 0.855)
HAND_TIP = (0.212, -0.005, 0.765)
NECK_BASE = 1.335
HEAD_BASE = 1.39
HEAD_TOP = 1.74
HEAD_C = Vector((0.0, -0.005, 1.535))
HEAD_K = 1.20  # cabeza grande de aventura gráfica: todo lo de la cabeza se escala ×HEAD_K sobre HEAD_C
HEAD_LIFT = 0.04  # la malla de la cabeza sube un poco sobre el hueso: cuello visible
MOUTH_C = HEAD_C + Vector((0, -0.132, -0.078)) * HEAD_K + Vector((0, 0, HEAD_LIFT))

COLORS = {
    'skin': (0.96, 0.66, 0.48),
    'skin_dark': (0.62, 0.30, 0.20),
    'hair': (0.05, 0.045, 0.045),
    'shirt_red': (0.90, 0.03, 0.07),
    'jeans': (0.15, 0.31, 0.60),
    'jeans_cuff': (0.45, 0.60, 0.82),
    'shoe_red': (0.82, 0.04, 0.07),
    'sole': (0.92, 0.92, 0.92),
    'white': (0.95, 0.95, 0.95),
    'lens_red': (0.85, 0.02, 0.05),
    'lens_cyan': (0.05, 0.85, 0.95),
    'mouth': (0.10, 0.01, 0.01),
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


def mat_hair():
    """Pelo en dos tonos: casi negro y gris oscuro en las caras que miran arriba (brillo de los mechones)."""
    m = mat_flat('hair2', COLORS['hair'], 0.5)
    nt = m.node_tree
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = (*srgb_to_lin(COLORS['hair']), 1)
    ramp.color_ramp.elements[1].position = 0.55
    ramp.color_ramp.elements[1].color = (*srgb_to_lin((0.26, 0.25, 0.27)), 1)
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    return m


def mat_toon(name, base, dark=None, light=None, dark_x=0.55, dark_z=-0.45, light_x=-0.5, rough=0.85):
    """Color plano por la normal en el mundo (luz de arriba a la izquierda, como los sprites 2D): caras que miran a la
    derecha (x > dark_x) o abajo (z < dark_z) → tono oscuro; a la izquierda (x < light_x) → tono claro. Así cada
    material da 3 tonos estables que la paleta no aplana."""
    m = mat_flat(name, base, rough)
    nt = m.node_tree
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    col = nt.nodes.new('ShaderNodeRGB')
    col.outputs[0].default_value = (*srgb_to_lin(base), 1)
    out = col.outputs[0]
    if light:
        lt = nt.nodes.new('ShaderNodeMath'); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = light_x
        nt.links.new(sep.outputs['X'], lt.inputs[0])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        nt.links.new(lt.outputs[0], mx.inputs['Factor'])
        nt.links.new(out, mx.inputs['A'])
        mx.inputs['B'].default_value = (*srgb_to_lin(light), 1)
        out = mx.outputs['Result']
    if dark:
        gx = nt.nodes.new('ShaderNodeMath'); gx.operation = 'GREATER_THAN'; gx.inputs[1].default_value = dark_x
        nt.links.new(sep.outputs['X'], gx.inputs[0])
        lz = nt.nodes.new('ShaderNodeMath'); lz.operation = 'LESS_THAN'; lz.inputs[1].default_value = dark_z
        nt.links.new(sep.outputs['Z'], lz.inputs[0])
        mxm = nt.nodes.new('ShaderNodeMath'); mxm.operation = 'MAXIMUM'
        nt.links.new(gx.outputs[0], mxm.inputs[0]); nt.links.new(lz.outputs[0], mxm.inputs[1])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        nt.links.new(mxm.outputs[0], mx.inputs['Factor'])
        nt.links.new(out, mx.inputs['A'])
        mx.inputs['B'].default_value = (*srgb_to_lin(dark), 1)
        out = mx.outputs['Result']
    nt.links.new(out, nt.nodes['Principled BSDF'].inputs['Base Color'])
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
    period = 0.068  # celda de ~3,6 px de arte: cuadros que se leen, no ruido

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
    r1.inputs['B'].default_value = (*srgb_to_lin((0.30, 0.0, 0.02)), 1)
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
    M['hair'] = mat_hair()
    M['cuffred'] = mat_flat('cuffred', (0.55, 0.02, 0.05))
    M['lens_red'] = mat_flat('lens_red_e', COLORS['lens_red'], 0.3)
    M['lens_cyan'] = mat_flat('lens_cyan_e', COLORS['lens_cyan'], 0.3)
    # piel, vaqueros y zapatilla en 3 tonos fijos por la normal (sombra de mejilla, mandíbula, nariz y cuello)
    M['skin'] = mat_toon('skin_t', COLORS['skin'], dark=(0.80, 0.46, 0.33), light=(0.99, 0.75, 0.58), dark_x=0.3, dark_z=-0.35)
    M['nose'] = mat_toon('nose_t', (0.86, 0.52, 0.38), dark=(0.62, 0.30, 0.20), dark_x=0.15, dark_z=-0.3)
    M['skin_neck'] = mat_flat('skin_neck', (0.78, 0.45, 0.32))
    M['jeans'] = mat_toon('jeans_t', COLORS['jeans'], dark=(0.05, 0.16, 0.38), light=(0.27, 0.45, 0.74), dark_x=0.3, dark_z=-0.5, light_x=-0.35)
    M['shoe_red'] = mat_toon('shoe_t', COLORS['shoe_red'], dark=(0.42, 0.01, 0.03), light=(0.95, 0.20, 0.18), dark_x=0.5, dark_z=-0.5)
    objs = []

    def add(ob, wfn):
        if wfn in ('head', 'jaw'):
            for v in ob.data.vertices:
                v.co = HEAD_C + (v.co - HEAD_C) * HEAD_K + Vector((0, 0, HEAD_LIFT))
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
        (0.875, 0.33, 0.21, 0.0), (0.93, 0.335, 0.21, 0.0), (1.00, 0.335, 0.205, 0.0), (1.08, 0.34, 0.205, 0.0),
        (1.16, 0.35, 0.21, 0.005), (1.24, 0.365, 0.21, 0.005), (1.28, 0.355, 0.20, 0.005), (1.315, 0.31, 0.18, 0.005),
        (1.345, 0.23, 0.15, 0.005), (1.362, 0.15, 0.12, 0.005),
    ])
    add(new_obj('shirt', shirt, M['plaid']), torso_w)
    # cintura blanca (la goma que asoma) y pantalón (pelvis)
    add(new_obj('belt', loft([(0.845, 0.305, 0.19, 0.0), (0.878, 0.31, 0.195, 0.0)]), M['belt']), 'hips')
    pelvis = loft([(0.78, 0.28, 0.17, 0.0), (0.81, 0.295, 0.18, 0.0), (0.845, 0.30, 0.185, 0.0), (0.86, 0.30, 0.185, 0.0)])

    def pelvis_w(co):
        s = 'L' if co.x > 0 else 'R'
        k = smooth((0.86 - co.z) / 0.07) * smooth((abs(co.x) - 0.02) / 0.06)
        return {'hips': 1 - k, f'thigh.{s}': k} if k > 1e-3 else {'hips': 1.0}
    add(new_obj('pelvis', pelvis, M['jeans']), pelvis_w)

    for s, sx in (('L', 1), ('R', -1)):
        H = (sx * HIP_X, 0, HIP_Z + 0.02)
        K = (sx * HIP_X, KNEE[1], KNEE[2])
        A = (sx * HIP_X, 0.02, ANKLE_Z + 0.06)
        # la malla de la pierna va algo hacia dentro (los huesos no se mueven): piernas juntas como en el 2D
        Km = (sx * (HIP_X - 0.016), KNEE[1], KNEE[2])
        Am = (sx * (HIP_X - 0.012), 0.02, ANKLE_Z + 0.06)
        leg_j = [H, Km, Am]
        legs = chain_points(leg_j, [0.094, 0.08, 0.074], step=0.03)
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
        cuff = tube([((sx * (HIP_X - 0.008), 0.02, ANKLE_Z + 0.015), 0.084), ((sx * (HIP_X - 0.01), 0.02, ANKLE_Z + 0.075), 0.084)], segs=8)
        add(new_obj(f'cuff.{s}', cuff, M['jeans_cuff']), f'shin.{s}')
        # zapatilla: suela blanca + cuerpo rojo (talón→bola: foot, bola→punta: toe)
        x = sx * HIP_X

        def shoe_w(co, s=s):
            k = smooth((-(co.y) - 0.10) / 0.06)  # delante de la bola → toe
            return {f'foot.{s}': 1 - k, f'toe.{s}': k} if k > 1e-3 else {f'foot.{s}': 1.0}
        sole = box((x, -0.065, 0.014), (0.13, 0.32, 0.028))  # suela fina
        add(new_obj(f'sole.{s}', sole, M['sole']), shoe_w)
        upper = loft([(0.026, 0.122, 0.305, -0.065), (0.085, 0.115, 0.28, -0.055), (0.12, 0.10, 0.17, 0.0), (0.155, 0.09, 0.11, 0.025)])
        for v in upper.verts:
            v.co.x += x
        add(new_obj(f'shoe.{s}', upper, M['shoe_red']), shoe_w)
        toecap = loft([(0.028, 0.05, 0.03, -0.205), (0.05, 0.04, 0.025, -0.203)])  # toque blanco pequeño en la puntera
        for v in toecap.verts:
            v.co.x += x
        add(new_obj(f'toecap.{s}', toecap, M['sole']), shoe_w)
        laces = box((x, -0.05, 0.108), (0.03, 0.08, 0.02))
        add(new_obj(f'laces.{s}', laces, M['white']), shoe_w)

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
        arm_pts = chain_points([lerp(S, E, 0.25), E, W], [0.058, 0.056, 0.048], step=0.025)
        add(new_obj(f'arm.{s}', tube(arm_pts, segs=8), M['skin']), arm_w)
        sleeve_pts = chain_points([lerp(S, (0, 0, S[2]), 0.1) + Vector((0, 0, -0.01)), lerp(S, E, 0.42)], [0.08, 0.075], step=0.025)
        add(new_obj(f'sleeve.{s}', tube(sleeve_pts, segs=8), M['plaid']), arm_w)
        cuff_pts = chain_points([lerp(S, E, 0.38), lerp(S, E, 0.46)], [0.082, 0.078], step=0.02)
        add(new_obj(f'sleeve_cuff.{s}', tube(cuff_pts, segs=8), M['cuffred']), arm_w)
        # mano: manopla + pulgar (todo al hueso hand)
        hand = sphere(lerp(W, T, 0.45), 0.052, scale=(0.75, 0.95, 1.25), segs=8, rings=6)
        thumb = sphere(Vector(W) + Vector((0, -0.035, -0.035)), 0.016, scale=(1, 1, 1.6), segs=6, rings=4)
        hb = hand
        tm = bpy.data.meshes.new('tmp')
        thumb.to_mesh(tm); thumb.free()
        hb.from_mesh(tm)
        bpy.data.meshes.remove(tm)
        add(new_obj(f'hand.{s}', hb, M['skin']), f'hand.{s}')

    # cuello de la camisa: dos solapas rojo oscuro en V con un pico de piel en medio
    for sx in (1, -1):
        flap = box((0, 0, 0), (0.075, 0.022, 0.05))
        bmesh.ops.transform(flap, matrix=Matrix.Translation((sx * 0.045, -0.072, 1.338)) @ Matrix.Rotation(math.radians(sx * 28), 4, 'Y') @ Matrix.Rotation(math.radians(sx * 20), 4, 'Z'), verts=flap.verts)
        add(new_obj(f'collar{sx}', flap, M['cuffred']), 'chest')
    vneck = box((0, -0.068, 1.33), (0.04, 0.02, 0.05))
    add(new_obj('vneck', vneck, M['skin_neck']), 'chest')
    # cuello
    neck = tube(chain_points([(0, 0.0, NECK_BASE - 0.03), (0, -0.005, HEAD_BASE + 0.03)], [0.062, 0.058], step=0.02), segs=8)
    add(new_obj('neck', neck, M['skin_neck']),
        lambda co: chain_weights(co, [(0, 0, 1.2), (0, 0, NECK_BASE), (0, -0.005, HEAD_BASE), (0, 0, HEAD_TOP)], ['chest', 'neck', 'head'], blend=0.025))
    # cabeza (grande, de aventura gráfica): cráneo + mandíbula
    head = sphere(HEAD_C, 0.125, scale=(0.82, 1.0, 1.30), segs=14, rings=12)
    # afinar la barbilla
    for v in head.verts:
        if v.co.z < HEAD_C.z - 0.02:
            t = (HEAD_C.z - 0.02 - v.co.z) / 0.13
            v.co.x *= 1 - 0.30 * t
            v.co.y = HEAD_C.y + (v.co.y - HEAD_C.y) * (1 - 0.10 * t) - 0.045 * t  # mandíbula y barbilla adelantadas
    add(new_obj('head', head, M['skin']), 'head')
    # nariz con volumen (su cara de abajo y la derecha salen en sombra con mat_toon)
    nose = sphere(HEAD_C + Vector((0, -0.15, -0.032)), 0.028, scale=(0.8, 2.0, 1.2), segs=8, rings=6)
    add(new_obj('nose', nose, M['nose']), 'head')
    for sx in (1, -1):
        ear = sphere(HEAD_C + Vector((sx * 0.10, 0.01, -0.01)), 0.03, scale=(0.5, 0.9, 1.4), segs=8, rings=5)
        add(new_obj(f'ear{sx}', ear, M['skin']), 'head')
    # boca (la abre el hueso jaw)
    mouth = box(HEAD_C + Vector((0, -0.132, -0.078)), (0.075, 0.04, 0.026))
    add(new_obj('mouth', mouth, M['mouth']), 'jaw')
    # cejas: trazo oscuro sobre la montura
    for sx in (1, -1):
        brow = box(HEAD_C + Vector((sx * 0.058, -0.118, 0.104)), (0.065, 0.03, 0.018))
        add(new_obj(f'brow{sx}', brow, M['hair']), 'head')
    # gafas 3D: montura blanca + lente cian (lado R = izquierda de la pantalla) y roja (lado L)
    gz = HEAD_C.z + 0.045  # gafas altas: queda cara debajo para nariz, boca y barbilla
    gy = HEAD_C.y - 0.128
    frame = box((0, gy, gz), (0.25, 0.03, 0.088))
    add(new_obj('glasses_frame', frame, M['white']), 'head')
    for sx, mat in ((1, M['lens_red']), (-1, M['lens_cyan'])):
        lens = box((sx * 0.058, gy - 0.018, gz), (0.08, 0.03, 0.05))
        add(new_obj(f'lens{sx}', lens, mat), 'head')
        temple = box((sx * 0.112, gy + 0.085, gz + 0.02), (0.016, 0.13, 0.02))
        add(new_obj(f'temple{sx}', temple, M['white']), 'head')
        # lateral de la lente por fuera de la patilla (de perfil se ve el color dentro de la montura blanca)
        rim = box((sx * 0.124, gy + 0.004, gz), (0.008, 0.06, 0.088))
        add(new_obj(f'rim_side{sx}', rim, M['white']), 'head')
        side_l = box((sx * 0.13, gy + 0.004, gz - 0.002), (0.008, 0.038, 0.048))
        add(new_obj(f'lens_side{sx}', side_l, mat), 'head')
    # pelo: casquete + pinchos despeinados (deterministas)
    cap = sphere(HEAD_C + Vector((0, 0.012, 0.03)), 0.133, scale=(1.0, 1.06, 1.05), segs=14, rings=10)
    rm = [v for v in cap.verts if (v.co.y - HEAD_C.y < -0.05 and v.co.z < HEAD_C.z + 0.085) or (v.co.y - HEAD_C.y < 0.05 and v.co.z < HEAD_C.z + 0.045) or v.co.z < HEAD_C.z - 0.04]
    bmesh.ops.delete(cap, geom=rm, context='VERTS')
    import random
    rnd = random.Random(1414)
    for i in range(120):
        # dirección en el hemisferio de arriba y de atrás
        th = rnd.uniform(0, 2 * math.pi)
        ph = rnd.uniform(0.0, 1.6)
        d = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)))
        if d.z < 0.35 and not (d.y > 0.35 and d.z > -0.25):
            continue  # pinchos arriba y detrás: nada sobre la cara ni las orejas
        base = HEAD_C + Vector((0, 0.015, 0.04)) + Vector((d.x * 0.125, d.y * 0.13, d.z * 0.135))
        ln = rnd.uniform(0.04, 0.085) * (1.35 if i % 4 == 0 else 1.0)  # algunos mechones sueltos más largos
        out = Vector((d.x * 0.5, 0, 0.45))  # hacia arriba y hacia fuera, como el 2D
        tip = base + (d + out + Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.2, 0.35), rnd.uniform(-0.1, 0.4)))).normalized() * ln
        res = bmesh.ops.create_cone(cap, cap_ends=True, segments=5, radius1=0.021, radius2=0.0, depth=ln)
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

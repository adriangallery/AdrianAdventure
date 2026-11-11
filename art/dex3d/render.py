"""A2.14 · Render de Dex: cámara ortográfica como la de los fondos (casi frontal, algo picada), luz parecida a la de
las escenas y salida en bruto (RGBA a ×SS de la resolución de arte) que luego pasa pixelize.py.

Uso (headless):
    blender -b -P art/dex3d/render.py -- --out /var/tmp/adv-dex3d/raw [--only walk_right,idle] [--views] [--save-blend art/dex3d/dex.blend]

--views: solo pose de reposo, pose T y una vuelta de 8 vistas (comprobación del modelo).
Sin --views: calibra la escala (103 px de arte de alto en reposo, de frente), monta las acciones (animate.py) con la
zancada en metros que corresponde a 20 px de arte y renderiza cada animación en cada dirección: <out>/<anim>/<dir>/NNNN.png
+ <out>/meta.json (fotogramas, fps, fila del suelo y columna del origen en la imagen en bruto).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_dex  # noqa: E402
import animate  # noqa: E402

SS = 4  # supermuestreo: el bruto es ×4 la resolución de arte
ART_W, ART_H = 80, 116  # lienzo de arte (pixelize recorta a 72 × 108: 103 de Dex + 5 bajo los pies de frente)
TILT_DEG = 12.0  # cámara algo picada, como los fondos
ART_HEIGHT = 103  # alto de Dex en reposo (px de arte) = el sprite de siempre
ROOT_ROW = 108  # fila (en px de arte) del punto de los pies en el lienzo
DIRS = {'down': 0.0, 'down_right': 45.0, 'right': 90.0, 'up_right': 135.0, 'up': 180.0, 'up_left': -135.0, 'left': -90.0, 'down_left': -45.0}


def setup_scene(ortho_scale):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 2
    sc.render.film_transparent = True
    sc.render.resolution_x = ART_W * SS
    sc.render.resolution_y = ART_H * SS
    sc.render.resolution_percentage = 100
    sc.render.filter_size = 0.75
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = ortho_scale
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    t = math.radians(TILT_DEG)
    cam.rotation_euler = (math.pi / 2 - t, 0, 0)
    place_camera(cam, ortho_scale)
    # luz: llave cálida desde arriba-izquierda-delante (como la lámpara/sol de los fondos) + relleno frío + ambiente
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    key.data.energy = 3.0
    key.data.color = (1.0, 0.93, 0.82)
    key.data.angle = math.radians(8)
    key.rotation_euler = (math.radians(50), 0, math.radians(-25))
    sc.collection.objects.link(key)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 1.0
    fill.data.color = (0.75, 0.82, 1.0)
    fill.rotation_euler = (math.radians(75), 0, math.radians(40))
    sc.collection.objects.link(fill)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.42, 0.45, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.3
    sc.world = world
    return cam


def place_camera(cam, ortho_scale):
    """Coloca la cámara para que el punto de los pies (0,0,0) caiga en la columna ART_W/2 y la fila ROOT_ROW."""
    t = math.radians(TILT_DEG)
    fwd = Vector((0, math.cos(t), -math.sin(t)))
    up = Vector((0, math.sin(t), math.cos(t)))
    px = ortho_scale / (ART_W * SS)  # m por píxel en bruto (ortho_scale = ancho, el lado mayor es el alto)
    sc = bpy.context.scene
    # ortho_scale se aplica al lado mayor (alto): recalcular m/px con el alto
    px = ortho_scale / (ART_H * SS)
    # el centro de la imagen está a (ROOT_ROW - ART_H/2) px de arte por encima de los pies
    off = (ROOT_ROW - ART_H / 2) * SS * px
    center = Vector((0, 0, 0)) + up * off
    cam.location = center - fwd * 20
    cam.data.ortho_scale = ortho_scale
    cam.data.clip_end = 100


def m_per_art_px(ortho_scale):
    return ortho_scale / ART_H


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def opaque_rows(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = list(img.pixels)
    rows = [y for y in range(h) if any(px[(y * w + x) * 4 + 3] > 0.5 for x in range(w))]
    bpy.data.images.remove(img)
    return (h - 1 - max(rows), h - 1 - min(rows)) if rows else (0, 0)  # (arriba, abajo) desde arriba


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[argv.index('--out') + 1] if '--out' in argv else '/var/tmp/adv-dex3d/raw'
    only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    os.makedirs(out, exist_ok=True)
    rig = build_dex.build()
    ortho = 2.02
    cam = setup_scene(ortho)
    animate.rest(rig)
    # calibración: alto en reposo de frente = ART_HEIGHT px de arte (dos pasadas)
    for _ in range(2):
        p = os.path.join(out, '_calib.png')
        render_to(p)
        top, bottom = opaque_rows(p)
        h_art = (bottom - top + 1) / SS
        ortho *= h_art / ART_HEIGHT
        place_camera(cam, ortho)
    render_to(os.path.join(out, '_calib.png'))
    top, bottom = opaque_rows(os.path.join(out, '_calib.png'))
    calib = {'ortho_scale': ortho, 'm_per_art_px': m_per_art_px(ortho), 'height_raw': bottom - top + 1,
             'bottom_raw': bottom, 'root_row_art': ROOT_ROW, 'ss': SS, 'art_w': ART_W, 'art_h': ART_H}
    print('CALIB', calib)
    if '--views' in argv:
        for name, deg in DIRS.items():
            animate.set_facing(rig, deg)
            render_to(os.path.join(out, 'views', name, '0000.png'))
        animate.set_facing(rig, 0)
        animate.tpose(rig)
        render_to(os.path.join(out, 'tpose', 'down', '0000.png'))
        meta = {'calib': calib, 'anims': {'views': {'frames': 1, 'fps': 1, 'loop': False, 'dirs': list(DIRS)},
                                          'tpose': {'frames': 1, 'fps': 1, 'loop': False, 'dirs': ['down']}}}
        json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
        return
    stride_m = 20 * calib['m_per_art_px']  # 20 px de arte por paso (Footsteps.STRIDE_ART_PX, WalkMotion 74 px/s)
    anims = animate.build_actions(rig, stride_m)
    meta = {'calib': calib, 'stride_m': stride_m, 'anims': {}}
    for name, a in anims.items():
        if only and name not in only:
            continue
        meta['anims'][name] = {'frames': a['frames'], 'fps': a['fps'], 'dirs': a['dirs'], 'loop': a['loop']}
        for d in a['dirs']:
            animate.set_facing(rig, DIRS[d])
            rig.animation_data.action = a['action']
            for i in range(a['frames']):
                bpy.context.scene.frame_set(a['start'] + i)
                render_to(os.path.join(out, name, d, f'{i:04d}.png'))
            print('RENDERED', name, d, flush=True)
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    if '--save-blend' in argv:
        animate.set_facing(rig, 0)
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--save-blend') + 1], compress=True)


main()

"""A2.14 · Hojas de la nota: antes-despues.png, vistas-modelo.png y un GIF por animación.

    python3 art/dex3d/sheets.py <carpeta pixelizada de --views>
"""
import json, os, sys
from PIL import Image, ImageDraw
W='/home/adrian/build/.wt-adventure/a2-14-dex3d'
P3=f'{W}/assets/sprites/player3d'; P2=f'{W}/assets/sprites/player'; D=f'{W}/docs/progreso/A2.14'
views=sys.argv[1]
BG=(90,140,105,255)
def ld(p): return Image.open(p).convert('RGBA')
def row(imgs, cw=80, base=None):
    h=max(i.height for i in imgs); s=Image.new('RGBA',(cw*len(imgs),h),BG)
    for k,i in enumerate(imgs): s.alpha_composite(i,(k*cw+(cw-i.width)//2,h-i.height))
    return s
# antes / después
top=row([ld(f'{P2}/{n}.png') for n in ['Idle-1','Left','Back-Left','Walk-Right-1','Idle-2']])
bot=row([ld(f'{P3}/{n}.png') for n in ['idle_down_0','idle_left_0','idle_up_left_0','walk_right_2','talk_down_3']])
k=4; Wd=top.width*k
sheet=Image.new('RGBA',(Wd,(top.height+bot.height)*k+60),BG)
sheet.alpha_composite(top.resize((top.width*k,top.height*k),Image.NEAREST),(0,16))
sheet.alpha_composite(bot.resize((bot.width*k,bot.height*k),Image.NEAREST),(0,top.height*k+50))
d=ImageDraw.Draw(sheet); d.text((8,2),'ANTES (sprites 2D)',fill=(255,255,255)); d.text((8,top.height*k+34),'DESPUES (Dex 3D, Blender) - mismo alto (103 px) y pies en la misma linea',fill=(255,255,255))
d.line([(0,top.height*k+16),(Wd,top.height*k+16)],fill=(255,255,0)); d.line([(0,sheet.height-1),(Wd,sheet.height-1)],fill=(255,255,0))
sheet.convert('RGB').save(f'{D}/antes-despues.png')
# vistas del modelo
vs=[ld(f'{views}/views_{n}_0.png') for n in ['down','down_right','right','up_right','up','up_left','left','down_left']]
ref=[ld(f'{P2}/Idle-1.png'),ld(f'{P2}/Left.png')]
r=row(vs+ref,cw=80); k=3
r.resize((r.width*k,r.height*k),Image.NEAREST).convert('RGB').save(f'{D}/vistas-modelo.png')
# GIF por animación
man=json.load(open(f'{P3}/dex3d.json'))
for name,a in man['anims'].items():
    frames=[]
    for i in range(a['frames']):
        fr=row([ld(f'{P3}/{name}_{d}_{i}.png') for d in a['dirs']],cw=76)
        frames.append(fr.resize((fr.width*3,fr.height*3),Image.NEAREST).convert('RGB'))
    frames[0].save(f'{D}/{name}.gif',save_all=True,append_images=frames[1:],duration=int(1000/a['fps']),loop=0)
print('ok')

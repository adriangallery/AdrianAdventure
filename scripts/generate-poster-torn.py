#!/usr/bin/env python3
"""A1.3 — Póster roto del lobby (lo que ve quien no es holder).

Sustituye al placeholder `poster_generic.png` (un rectángulo lila liso de 32x48) por pixel art
dibujado aquí, sin dependencias ni créditos (D2): solo la librería estándar de Python.

Es un trozo de póster arrancado: queda la esquina superior izquierda con «BE» y media gafa de
AdrianPunk (el póster entero, «BE REAL. BE ADRIAN.», es el de los holders), cinta adhesiva en las
esquinas, una esquina suelta abajo y la marca más clara que dejó el póster en la pared.

Uso: python3 scripts/generate-poster-torn.py  → assets/scenes/lobby/poster_generic.png
El juego lo escala con `pixelArt: true` al tamaño de `lobby.web3Visuals.vip_poster.size`.
"""
import os
import struct
import zlib

W, H = 30, 45  # ≈ 5,2 px del fondo por píxel de arte, como el trazo del cartel COATS

PALETTE = {
    '.': (0, 0, 0, 0),
    'g': (104, 128, 138, 255),   # pared sin decolorar donde estuvo el póster
    'r': (74, 92, 102, 255),     # borde de cola / sombra de la marca
    'o': (30, 28, 34, 255),      # contorno
    'w': (234, 228, 210, 255),   # papel
    's': (196, 186, 160, 255),   # papel en sombra (rasgado, doblez)
    'b': (160, 148, 120, 255),   # dorso del papel (esquina doblada)
    'k': (26, 26, 30, 255),      # letras
    'c': (70, 222, 232, 255),    # cristal cian de la gafa
    'p': (232, 76, 88, 255),     # cristal rojo de la gafa
    't': (222, 210, 150, 215),   # cinta adhesiva
    'T': (186, 172, 116, 215),   # cinta en sombra
}

grid = [['.' for _ in range(W)] for _ in range(H)]


def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        grid[y][x] = c


# 1) Marca del póster en la pared (rectángulo más claro con borde de cola)
for y in range(1, H - 1):
    for x in range(1, W - 1):
        edge = x in (1, W - 2) or y in (1, H - 2)
        put(x, y, 'r' if edge else 'g')

# 2) Papel que queda: todo lo que está por encima de la línea de rasgado (de abajo-izquierda a
#    arriba-derecha, con dientes). tear[x] = primera fila SIN papel en la columna x.
tear = [33, 34, 32, 31, 32, 30, 28, 29, 27, 26, 27, 25, 23, 24, 22, 21, 22, 20, 18, 19, 17, 15,
        16, 14, 12, 13, 11, 9, 10, 8]
paper = [[False] * W for _ in range(H)]
for x in range(1, W - 1):
    for y in range(1, tear[x]):
        paper[y][x] = True

# 3) Esquina suelta abajo a la derecha, sujeta por su cinta
for y in range(36, H - 1):
    for x in range(20, W - 1):
        if (x - 20) + (H - 2 - y) >= 7:
            paper[y][x] = True

for y in range(H):
    for x in range(W):
        if paper[y][x]:
            put(x, y, 'w')

# 4) Contorno: papel que toca algo que no es papel
for y in range(H):
    for x in range(W):
        if not paper[y][x]:
            continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H) or not paper[ny][nx]:
                put(x, y, 'o')
                break

# 5) Sombra de papel junto al rasgado (fibras del borde roto)
for x in range(2, W - 2):
    y = tear[x] - 2
    if y > 1 and grid[y][x] == 'w':
        put(x, y, 's')
        if x % 3 == 0 and grid[y - 1][x] == 'w':
            put(x, y - 1, 's')

# 6) Letras «BE» (fuente 3x5 escalada x2) y media gafa de AdrianPunk, cortadas por el rasgado
FONT = {
    'B': ['##.', '#.#', '##.', '#.#', '##.'],
    'E': ['###', '#..', '##.', '#..', '###'],
    'R': ['##.', '#.#', '##.', '#.#', '#.#'],
}


def text(s, ox, oy, scale=2):
    cx = ox
    for ch in s:
        for j, row in enumerate(FONT[ch]):
            for i, cell in enumerate(row):
                if cell != '#':
                    continue
                for sy in range(scale):
                    for sx in range(scale):
                        x, y = cx + i * scale + sx, oy + j * scale + sy
                        if 0 <= y < H and paper[y][x] and grid[y][x] in ('w', 's'):
                            put(x, y, 'k')
        cx += 3 * scale + 1


text('BE', 4, 5)
text('RE', 4, 17)
# gafa: montura negra con un cristal cian y otro rojo (el rojo queda medio arrancado)
for x in range(17, 27):
    for y in range(5, 9):
        if 0 <= y < H and paper[y][x]:
            frame = y in (5, 8) or x in (17, 21, 22, 26)
            lens = 'c' if x < 22 else 'p'
            put(x, y, 'k' if frame else lens)

# 7) Cinta adhesiva: arriba a la izquierda (sujeta el papel), arriba a la derecha (sola, el papel
#    se fue) y abajo a la derecha (sujeta la esquina suelta)
TAPES = [
    [(0, 3), (1, 2), (2, 1), (3, 0), (1, 3), (2, 2), (3, 1), (4, 0), (2, 3), (3, 2), (4, 1)],
    [(W - 1, 3), (W - 2, 2), (W - 3, 1), (W - 4, 0), (W - 2, 3), (W - 3, 2), (W - 4, 1), (W - 5, 0)],
    [(W - 1, H - 4), (W - 2, H - 3), (W - 3, H - 2), (W - 4, H - 1), (W - 2, H - 4), (W - 3, H - 3),
     (W - 4, H - 2), (W - 5, H - 1)],
]
for tape in TAPES:
    for i, (x, y) in enumerate(tape):
        put(x, y, 'T' if i % 4 == 3 else 't')

# 8) Dobladillo de la esquina suelta (se ve el dorso)
for (x, y) in ((21, 43), (22, 43), (21, 42)):
    if paper[y][x]:
        put(x, y, 'b')


def png(path):
    raw = b''.join(b'\x00' + b''.join(bytes(PALETTE[c]) for c in row) for row in grid)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'assets', 'scenes', 'lobby', 'poster_generic.png')
    png(out)
    print(f'{out} ({W}x{H})')

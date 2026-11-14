#!/usr/bin/env python3
"""Arte pendiente N1/N2: una llamada de generación de imagen a Gemini con referencias del juego.

La clave se lee de ~/.secrets/gemini.key (fuera del repo) y no se imprime nunca. ANTES de llamar se apunta la línea en
el registro de gasto (gemini-gasto.tsv del orquestador) y se suma la columna: si con esta llamada se pasa del tope, no
se llama. El PNG que devuelve se guarda tal cual en art/npc/originales/<salida>.png (el posproceso es art/npc/post.py).

Uso:  python3 -I art/npc/gemini_gen.py <salida> <prompt.txt> <ref1.png> [<ref2.png> ...] [--tope 1.50]
"""
import base64, datetime, json, os, sys, urllib.request

MODEL = 'gemini-2.5-flash-image'
COST = 0.039          # $ por imagen generada (tarifa pública de gemini-2.5-flash-image; las referencias suman céntimos)
TSV = '/home/adrian/srv/orquestador/planes/ADVENTURE_SCUMM/gemini-gasto.tsv'
HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.path.expanduser('~/.secrets/gemini.key')


def spent():
    tot = 0.0
    for line in open(TSV).read().splitlines()[1:]:
        p = line.split('\t')
        if len(p) >= 4:
            try:
                tot += float(p[3])
            except ValueError:
                pass
    return tot


def main():
    args = [a for a in sys.argv[1:]]
    tope = 1.50
    if '--tope' in args:
        i = args.index('--tope'); tope = float(args[i + 1]); del args[i:i + 2]
    out, prompt_file, refs = args[0], args[1], args[2:]
    prompt = open(prompt_file).read().strip()
    base = spent()
    if base + COST > tope + 1e-9:
        sys.exit(f'NO: {base:.3f} $ gastados + {COST} $ pasaría del tope {tope:.2f} $')
    with open(TSV, 'a') as f:
        f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')}\t{MODEL}\t{out} (arte-npc)\t{COST}\n")
    parts = [{'text': prompt}]
    for r in refs:
        parts.append({'inline_data': {'mime_type': 'image/png', 'data': base64.b64encode(open(r, 'rb').read()).decode()}})
    body = {'contents': [{'parts': parts}], 'generationConfig': {'responseModalities': ['IMAGE', 'TEXT']}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
                                                                          'x-goog-api-key': open(KEY).read().strip()})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        sys.exit(f'HTTP {e.code}: {e.read()[:300]!r}')
    n = 0
    for c in d.get('candidates', []):
        for p in c.get('content', {}).get('parts', []):
            if 'inlineData' in p or 'inline_data' in p:
                blob = p.get('inlineData') or p.get('inline_data')
                path = os.path.join(HERE, 'originales', f'{out}.png' if n == 0 else f'{out}-{n}.png')
                open(path, 'wb').write(base64.b64decode(blob['data']))
                print('guardado', os.path.relpath(path, os.path.join(HERE, '..', '..')))
                n += 1
            elif 'text' in p:
                print('texto:', p['text'][:200])
    print(f'gasto acumulado: {spent():.3f} $ (tope {tope:.2f} $); uso: {d.get("usageMetadata")}')
    if not n:
        sys.exit('sin imagen')


if __name__ == '__main__':
    main()

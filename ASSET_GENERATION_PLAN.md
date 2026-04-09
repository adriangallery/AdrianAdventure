# ZEROadventure II — Plan de Generación de Assets con AI

## Herramientas configuradas

### PixelLab MCP (INSTALADO ✅)
- **Package**: `pixellab-mcp` (instalado globalmente)
- **API Key**: `8411a69d-5e8c-4146-b2a9-c1cf10b674f4`
- **Config**: `.claude/settings.local.json` — ya configurado
- **Cuenta**: Free trial — 4/40 generaciones usadas, 36 restantes
- **Límites free**: sprites/items hasta 200×200px, NO animaciones, NO mapas
- **Tools disponibles**: `generate_image_pixflux`, `generate_image_bitforge` (style transfer), `rotate`, `inpaint`, `estimate_skeleton`, `get_balance`

### SpriteCook MCP (PENDIENTE SETUP ⚠️)
- **Package**: `spritecook-mcp` (instalado globalmente)
- **Auth**: Requiere login interactivo — ejecutar `! npx spritecook-mcp` en terminal de Claude Code
- **Cuenta**: Free — 40 créditos/mes, 8 créditos por sprite = 5 sprites
- **Límites**: sin límite de tamaño aparente, soporta backgrounds

---

## Presupuesto total de créditos

| Herramienta | Créditos free | Coste/gen | Generaciones disponibles |
|---|---|---|---|
| **PixelLab** | 36 restantes (de 40) + 5 daily slow | 1 gen = 1 crédito | ~36 fast + ~150 slow/mes |
| **SpriteCook** | 40/mes | 8 cr/sprite | 5 sprites |

**Total estimado**: ~41 sprites (PixelLab) + 5 backgrounds (SpriteCook) = **~46 assets**

---

## Assets necesarios (ordenados por prioridad)

### PRIORIDAD 1: Backgrounds de escenas placeholder (5) — SpriteCook
Estos son los más visibles y se benefician del tamaño grande que SpriteCook soporta.

| # | Escena | Descripción para el prompt | Style reference |
|---|--------|---------------------------|-----------------|
| 1 | **upstairs** | Trading floor interior, dark purple tones, 3 monitors on desk, mining rig with GPUs on left, premium armchair right, ceiling hatch top-left, noir pixel art style, warm lamp lighting | `outside/background.png` |
| 2 | **clinic_interior** | Sterile hospital reception, white/green walls, uncomfortable chairs, motivational posters, reception desk, water cooler, dim fluorescent lighting, creepy pixel art | `lobby/background.png` |
| 3 | **server_room** | Narrow dark room, blinking server racks with green LEDs, tangled cables, red emergency switch behind glass, dripping cooling pipes, noir atmosphere | `basement/background.png` |
| 4 | **rooftop** | Night sky panorama, large satellite dish, antenna array, city lights in distance, stars visible, moonlight, pixel art noir style | `mountain/background.png` |
| 5 | **treatment_room** | Small dark room, single chair facing a glowing monitor, walls covered in charts and graphs, dim eerie lighting, minimalist and unsettling | `basement/background.png` |

**Tamaño**: 1536×1024px (o generar a menor res y upscale con nearest-neighbor)
**Estilo**: Debe coincidir con los backgrounds existentes (outside, frontdoor, lobby, basement, mountain) — pixel art cálido/oscuro, estilo Thimbleweed Park

### PRIORIDAD 2: Item icons para inventario (11) — PixelLab
Estos se muestran en el panel de inventario como tiles 48-64px. Generarlos a 64×64 con `no_background: true`.

| # | Item ID | Descripción para el prompt |
|---|---------|---------------------------|
| 1 | `code_note` | Small crumpled paper note with numbers "7314" written on it, pixel art item |
| 2 | `ledger` | Hardware crypto wallet device (Ledger), small black USB-like device with screen, pixel art |
| 3 | `keycard` | ID keycard with "ADMIN" text, magnetic strip, lanyard hole, pixel art |
| 4 | `floppy_disk` | 3.5 inch floppy disk, blue/black color, label says "BACKUP", pixel art |
| 5 | `printout` | Thermal paper printout with text and a small map, rolled edges, pixel art |
| 6 | `water_bottle` | Clear water bottle filled with crystal water, pixel art item |
| 7 | `golden_token` | Golden coin/token with "ZERO" engraved, shiny, pixel art |
| 8 | `terminal_key` | Small electronic key/fob with LED light, pixel art |
| 9 | `antenna` | Telescoping metal antenna, extended, pixel art |
| 10 | `sign_in_sheet` | Clipboard with paper and handwritten names, pixel art |
| 11 | `monkey_sticker` | Sticker showing a three-headed monkey, colorful, funny, pixel art (Monkey Island reference) |

**Tamaño**: 64×64px, `no_background: true`, `outline: "single color black outline"`, `detail: "medium detail"`

### PRIORIDAD 3: NPC sprites (2) — PixelLab
Usar el personaje existente como style reference con `generate_image_bitforge`.

| # | NPC | Descripción |
|---|-----|-------------|
| 1 | **Receptionist** | Female office worker, orange hair, professional outfit, standing pose, pixel art character ~100px tall |
| 2 | **Dr. Satoshi** | Male doctor, white coat, glasses, mysterious expression, standing pose, pixel art character ~100px tall |

**Tamaño**: 48×103px (match player sprite proportions), `no_background: true`

### PRIORIDAD 4: Backgrounds adicionales si sobran créditos — PixelLab
Si PixelLab genera backgrounds aceptables a 200×200 (free tier max) con upscale:
- Variantes de los 5 backgrounds de Prioridad 1 para iterar hasta obtener calidad

---

## Workflow de generación

### Paso 1: SpriteCook — 5 Backgrounds (usa los 40 créditos)
```
Para cada background:
1. Usar un background existente como style reference
2. Prompt detallado describiendo la escena
3. Generar a la mayor resolución posible
4. Si < 1536×1024, upscale con nearest-neighbor (Sharp/Node.js script)
5. Guardar en assets/scenes/{scene}/background.png
```

### Paso 2: PixelLab MCP — 11 Items (~11 generaciones)
```
Para cada item:
pixellab generate_image_pixflux
  description: "..."
  width: 64, height: 64
  no_background: true
  outline: "single color black outline"
  detail: "medium detail"
  save_to_file: "assets/sprites/items/{id}.png"
```

### Paso 3: PixelLab MCP — 2 NPCs (~2-4 generaciones con iteración)
```
pixellab generate_image_bitforge
  description: "..."
  style_image_path: "assets/sprites/player/Idle-1.png"
  width: 48, height: 103
  no_background: true
  save_to_file: "assets/sprites/npcs/{id}.png"
```

### Paso 4: Integrar assets en el juego
```
1. Backgrounds: ya se cargan automáticamente de assets/scenes/{scene}/background.png
2. Items: actualizar InventoryItem.icon para referenciar sprite path (requiere código)
3. NPCs: actualizar NPC.ts para cargar sprites en vez de rectángulos
4. Re-deploy: vercel --prod
```

---

## Setup antes de empezar la sesión

### Ya hecho ✅
- [x] `pixellab-mcp` instalado globalmente
- [x] API key configurada en `.claude/settings.local.json`
- [x] Cuenta verificada (36 fast gens restantes)

### Pendiente para próxima sesión ⚠️
- [ ] **SpriteCook auth**: ejecutar `! npx spritecook-mcp` en terminal → login via browser → obtener API key → añadir a settings.local.json
- [ ] **Verificar PixelLab MCP funciona**: en nueva sesión de Claude Code, verificar que los tools `generate_image_pixflux` etc. aparecen
- [ ] **Preparar style references**: los backgrounds existentes en `assets/scenes/outside/background.png` etc. serán los style references para mantener consistencia visual

---

## Notas importantes

- **PixelLab free**: max 200×200px. Para backgrounds necesitamos 1536×1024. Opciones:
  - Generar a 200×200 y upscale ×8 con nearest-neighbor (se verá como pixel art chunky — puede funcionar)
  - Usar SpriteCook que no tiene límite de tamaño aparente
  - Generar tiles/sections y componer manualmente

- **SpriteCook**: 8 créditos por generación = exactamente 5 backgrounds con 40 créditos. No hay margen para iteración. Si un background sale mal, gastamos 1/5 del presupuesto.

- **Consistencia visual**: Usar SIEMPRE un background existente como style reference. El estilo es: pixel art cálido/oscuro, paleta Thimbleweed Park (azules profundos, naranjas cálidos, iluminación dramática).

- **Player sprite**: NO necesita regeneración. Los 16 frames existentes (25×103px) funcionan bien y ya se escalan per-scene hasta 6x.

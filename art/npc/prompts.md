# Prompts de Gemini (arte pendiente N1/N2)

Modelo: `gemini-2.5-flash-image` (0,039 $ por imagen). Script: `art/npc/gemini_gen.py`; posproceso: `art/npc/post.py`.
Referencias (no van al repo, se rehacen con PIL): Dex `dex2d/idle_0.png` ×8 con nearest, el busto `receptionist.png` ×8 (Penny) o `Ape-Idle-1.png` ×8 y el recorte del mono pintado (Chad), y un recorte del fondo de su escena.

## penny_a (N1)

Referencias: ref_dex_x8.png, ref_penny_bust_x8.png, ref_lobby.png (lobby x 200–1600, y 100–1152, a la mitad).

```
Pixel art game sprite, full body, of the SAME woman shown in the second reference image (Penny, a receptionist): same face, same black hair with the yellow hair band hanging on her left side, same cyan-blue sunglasses, same red lips, same white blouse. Now draw her ENTIRE body standing upright, facing the viewer (very slightly turned to her right like the bust), arms relaxed at her sides: white blouse tucked into a dark charcoal pencil skirt, thin dark legs, black low heels. Slim, adult proportions: about 4 times taller than wide, the head about 1/5 of the height, exactly like the man in the first reference image (Dex), which is the target style and scale: chunky low-resolution pixel art (about 25 pixels wide and 103 pixels tall if you count the big pixels), 1-pixel black outline around the whole figure, flat cel shading with 2-3 tones per material, no anti-aliasing, no gradients, no glow. The third image is the game background (a dim blue lobby) for the colour mood only; do NOT draw any background. Put the single character centred on a perfectly flat solid magenta background (#FF00FF), nothing else in the image: no shadow, no floor, no text, no frame.
```

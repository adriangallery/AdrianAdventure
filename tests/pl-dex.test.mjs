// A2.21: prueba del andar «Dex PixelLab» (?dex=pl)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { parsePlMode, plWalkKey, plFiles, PL_SIDE_FRAME_MS, PL_VERT_FRAME_MS, PL_SIDE_STEP_ART_PX } from "../src/systems/PlDex.ts";

test("solo ?dex=pl activa la prueba", () => {
  assert.equal(parsePlMode("?dex=pl"), true);
  assert.equal(parsePlMode("?qa=1&dex=PL"), true);
  assert.equal(parsePlMode(""), false);
  assert.equal(parsePlMode("?dex=papel"), false);
});

test("fotograma según el reloj y la dirección, en bucle de 8", () => {
  assert.equal(plWalkKey("right", 0), "dexpl_walk_right_0");
  assert.equal(plWalkKey("right", PL_SIDE_FRAME_MS * 3 + 1), "dexpl_walk_right_3");
  assert.equal(plWalkKey("down", PL_VERT_FRAME_MS * 9), "dexpl_walk_down_1");
  assert.equal(plWalkKey("left", -50), "dexpl_walk_left_0");
});

test("los 32 PNG existen", () => {
  const files = plFiles();
  assert.equal(files.length, 32);
  for (const f of files) assert.ok(existsSync(new URL("../" + f.url, import.meta.url)), f.url);
});

test("de perfil no patina: avance por fotograma ≈ lo que retrocede el pie apoyado", () => {
  // Velocidad real de Dex medida por demo-a2-21-pldex (px de arte por segundo de reloj de andar): outside 78, lobby 81
  const [lo, hi] = PL_SIDE_STEP_ART_PX;
  for (const pxPerS of [78, 81]) {
    const perFrame = (pxPerS * PL_SIDE_FRAME_MS) / 1000;
    assert.ok(perFrame >= lo - 0.5 && perFrame <= hi + 0.5, `${pxPerS} px/s × ${PL_SIDE_FRAME_MS} ms = ${perFrame} px por fotograma (pie: ${lo}–${hi})`);
  }
});

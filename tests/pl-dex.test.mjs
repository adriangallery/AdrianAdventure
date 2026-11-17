// A2.21: prueba del andar «Dex PixelLab» (?dex=pl)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { parsePlMode, plWalkKey, plFiles, PL_SIDE_FRAME_MS, PL_VERT_FRAME_MS } from "../src/systems/PlDex.ts";

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

// F3.2b: el perfil de maquetación por defecto no cambia nada (el juego normal sigue igual) y el apilado reparte bien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLASSIC_LAYOUT, STACKED_PORTRAIT_LAYOUT, getLayoutProfile, setLayoutProfile, isStackedPortrait, stackedPanelHeight, mobileMinFontPx,
} from '../src/platform/LayoutProfile.ts';

test('por defecto: perfil clásico, sin vertical apilado ni letra mínima en ningún tamaño', () => {
  assert.equal(getLayoutProfile(), CLASSIC_LAYOUT);
  for (const [w, h] of [[390, 844], [844, 390], [1280, 720], [1920, 1080], [375, 667]]) {
    assert.equal(isStackedPortrait(w, h), false);
    assert.equal(stackedPanelHeight(w, h), null);
    assert.equal(mobileMinFontPx(w, h), null);
  }
});

test('apilado: escena arriba con la mitad del alto en vertical; en horizontal, lo clásico', () => {
  setLayoutProfile(STACKED_PORTRAIT_LAYOUT);
  try {
    assert.equal(isStackedPortrait(390, 844), true);
    assert.equal(stackedPanelHeight(390, 844), 844 - 422);
    assert.ok((844 - stackedPanelHeight(390, 844)) / 844 >= 0.38);
    assert.equal(stackedPanelHeight(844, 390), null);
    assert.equal(stackedPanelHeight(1280, 720), null);
    assert.equal(mobileMinFontPx(390, 844), 14);
    assert.equal(mobileMinFontPx(844, 390), 14);
    assert.equal(mobileMinFontPx(1920, 1080), null);
  } finally {
    setLayoutProfile(null);
  }
  assert.equal(getLayoutProfile(), CLASSIC_LAYOUT);
});

test('LayoutProfile.ts no nombra ninguna plataforma (entra en el bundle normal)', () => {
  const src = readFileSync(new URL('../src/platform/LayoutProfile.ts', import.meta.url), 'utf-8');
  assert.doesNotMatch(src, /funtico/i);
});

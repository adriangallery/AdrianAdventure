/**
 * F0.1 (plan FUNTICO_ADVENTURE): entrada del build Funtico (funtico/index.html, `vite build --mode funtico`).
 * F1.2: menú Funtico (FunticoMenuScene), Triage (TriageScene) y resultado (TriageResultScene), todos con
 * `Scale.RESIZE` y recolocación en caliente al girar o redimensionar. No importa nada de web3: IS_FUNTICO apaga
 * WEB3_ENABLED como en Steam.
 */
import Phaser from 'phaser';
import { IS_FUNTICO, WEB3_ENABLED } from '@/config/platform';
import { createBridge } from './FunticoBridge';
import { FunticoMenuScene } from './FunticoMenuScene';
import { TriageScene, funticoHook } from './TriageScene';
import { TriageResultScene } from './TriageResultScene';
import { FONT, REG } from './ui';

function start(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#06060c',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: '100%',
      height: '100%',
    },
    render: { pixelArt: true, antialias: false, roundPixels: true },
    scene: [FunticoMenuScene, TriageScene, TriageResultScene],
  });
  game.registry.set('platform', { funtico: IS_FUNTICO, web3: WEB3_ENABLED });
  const bridge = createBridge();
  game.registry.set(REG.bridge, bridge);
  void bridge.init();
  // Para el smoke y las pruebas de F1: sabe que es el build Funtico y que web3 está apagado. F1.2 añade `menu`,
  // `triage` y `result` (los registra cada escena mientras está activa).
  Object.assign(funticoHook(), { game, web3: WEB3_ENABLED, bridgeMode: bridge.mode });
}

// La fuente se carga antes de pintar el texto (si no llega en 3 s, arranca con la de reserva)
const fontReady = document.fonts?.load(`16px ${FONT}`) ?? Promise.resolve();
Promise.race([fontReady, new Promise((r) => setTimeout(r, 3000))]).catch(() => undefined).then(start);

/**
 * F0.1 (plan FUNTICO_ADVENTURE): entrada del build Funtico (funtico/index.html, `vite build --mode funtico`).
 * Escena mínima provisional que ocupa la ventana y se recoloca al girar o redimensionar (vertical y horizontal);
 * el menú real y Triage llegan en F1.2. No importa nada de web3: IS_FUNTICO apaga WEB3_ENABLED como en Steam.
 */
import Phaser from 'phaser';
import { IS_FUNTICO, WEB3_ENABLED } from '@/config/platform';

const FONT = '"Press Start 2P", monospace';
const TITLE = 'ZEROadventure · Funtico';

class FunticoPlaceholderScene extends Phaser.Scene {
  private title!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;

  constructor() {
    super('FunticoPlaceholderScene');
  }

  create(): void {
    this.title = this.add.text(0, 0, TITLE, { fontFamily: FONT, color: '#f8e848', align: 'center' }).setOrigin(0.5);
    this.sub = this.add.text(0, 0, 'Coming soon', { fontFamily: FONT, color: '#8078b0', align: 'center' }).setOrigin(0.5);
    this.layout(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  /** Recoloca y escala el texto con el tamaño de la ventana (vertical u horizontal). */
  private layout(size: Phaser.Structs.Size): void {
    const { width, height } = size;
    this.cameras.main.setSize(width, height);
    const portrait = height > width;
    // El título cabe en una línea en horizontal y en dos en vertical; tamaño entero para que el píxel quede nítido
    const titleText = portrait ? TITLE.replace(' · ', '\n') : TITLE;
    const chars = portrait ? 13 : TITLE.length;
    const titlePx = Math.max(12, Math.min(48, Math.floor((width * 0.86) / chars)));
    this.title.setText(titleText).setFontSize(titlePx).setLineSpacing(Math.round(titlePx * 0.6));
    this.title.setPosition(Math.round(width / 2), Math.round(height / 2 - titlePx));
    const subPx = Math.max(10, Math.round(titlePx * 0.45));
    this.sub.setFontSize(subPx).setPosition(Math.round(width / 2), Math.round(this.title.y + this.title.height / 2 + subPx * 2));
  }
}

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
    scene: [FunticoPlaceholderScene],
  });
  game.registry.set('platform', { funtico: IS_FUNTICO, web3: WEB3_ENABLED });
  // Para el smoke y las pruebas de F1: sabe que es el build Funtico y que web3 está apagado
  (window as unknown as { __funtico?: { game: Phaser.Game; web3: boolean } }).__funtico = { game, web3: WEB3_ENABLED };
}

// La fuente se carga antes de pintar el texto (si no llega en 3 s, arranca con la de reserva)
const fontReady = document.fonts?.load(`16px ${FONT}`) ?? Promise.resolve();
Promise.race([fontReady, new Promise((r) => setTimeout(r, 3000))]).catch(() => undefined).then(start);

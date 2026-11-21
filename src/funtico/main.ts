/**
 * F0.1 (plan FUNTICO_ADVENTURE): entrada del build Funtico (funtico/index.html, `vite build --mode funtico`).
 * F1.2: menú Funtico (F1.5: lobby, lobby/LobbyScene.ts), Triage (TriageScene) y resultado (TriageResultScene), todos con
 * `Scale.RESIZE` y recolocación en caliente al girar o redimensionar. F3.2a: mapa de Campaign (CampaignMapScene); cada
 * expediente se juega en su página (campaign.html?chapter=N, src/funtico/campaignMain.ts). No importa nada de web3: IS_FUNTICO apaga
 * WEB3_ENABLED como en Steam.
 */
import Phaser from 'phaser';
import { IS_FUNTICO, WEB3_ENABLED } from '@/config/platform';
import { createBridge } from './FunticoBridge';
import { LobbyScene } from './lobby/LobbyScene';
import { HallOfFameScene } from './lobby/HallOfFameScene';
import { MyResultsScene } from './lobby/MyResultsScene';
import { HowToPlayScene } from './lobby/HowToPlayScene';
import { SettingsScene } from './lobby/SettingsScene';
import { getSfxVolume, onSettingsChange } from './settings';
import { TriageScene, funticoHook } from './TriageScene';
import { TriageResultScene } from './TriageResultScene';
import { TriageStartScene } from './TriageStartScene';
import { CampaignMapScene } from './campaign/CampaignMapScene';
import { FONT, REG } from './ui';

/** F1.5: pantallas del lobby (Hall of Fame, Mis resultados, How to play, Ajustes). */
const LOBBY_SCREENS = [HallOfFameScene, MyResultsScene, HowToPlayScene, SettingsScene];

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
    // F3.2a: `?view=campaign` (vuelta desde un expediente) abre directamente el mapa de campaña
    scene: new URLSearchParams(location.search).get('view') === 'campaign'
      ? [CampaignMapScene, LobbyScene, TriageStartScene, TriageScene, TriageResultScene, ...LOBBY_SCREENS]
      : [LobbyScene, TriageStartScene, TriageScene, TriageResultScene, CampaignMapScene, ...LOBBY_SCREENS],
  });
  // F1.5: volumen de sonido de los ajustes (la música iMUSE de Triage se engancha a getMusicVolume al juntar con F1.4)
  game.sound.volume = getSfxVolume();
  onSettingsChange((st) => { game.sound.volume = st.sfx; });
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

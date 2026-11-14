import Phaser from 'phaser';
import { playStatsEnabled, setPlayStatsEnabled } from '@/systems/PlayStats';
import { TEXT_SPEEDS, TEXT_SPEED_LABEL, MUSIC_LEVEL_LABEL, getTextSpeed, setTextSpeed, getMusicLevel, setMusicLevel, musicVolumeFor, getVoiceLevel, setVoiceLevel, nextLevel } from '@/systems/Settings';
import type { GameState } from '@/types/game.types';
import { SaveLoadSystem } from '@/systems/SaveLoadSystem';
import { savedSpawn } from '@/systems/SaveMigration';
import { ScummUI } from './ScummUI';
import { getWalletState, getSessionAuth, authorizeSession } from '@/web3/wallet';
import { exportSignedWalletSave, importWalletSave, saveForWalletRemote, loadRemoteSlots, type WalletSave } from '@/web3/wallet-save';
import {
  AUTOSAVE_SLOT, BACKUP_SLOT, PREVIOUS_AUTOSAVE_SLOT_ID, MANUAL_SLOTS, pickSlotView, saveErrorMessage, sessionUsable, slotLabel, slotTapAction,
  type PanelMode, type SlotView,
} from '@/systems/SaveSlots';
import type { GameScene } from '@/scenes/GameScene';
import { TWP } from '@/config/theme';
import { setTouchInteractive, touchContains } from './touchTarget';
import { iconTexture, setIconLabel, type IconName } from './icons';

/**
 * Floppy disk save button — top-left corner.
 * Unified save system: wallet connected = wallet-keyed saves, otherwise anonymous.
 */
export class SaveButton {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.container = scene.add.container(8, 8).setDepth(600);

    // A5.2: se ve de 30×24, pero el dedo tiene 44×44 (setTouchInteractive)
    const bg = this.bg = setTouchInteractive(scene.add.rectangle(0, 0, 30, 24, TWP.WALLET_BG, 0.85)
      .setStrokeStyle(1, TWP.WALLET_BORDER, 0.6)
      .setOrigin(0, 0), 30, 24);

    // A7.3: disquete dibujado (el emoji 💾 salía como cuadradito sin fuente de emoji)
    const label = scene.add.image(15, 12, iconTexture(scene, 'floppy', 2)).setOrigin(0.5, 0.5);

    this.container.add([bg, label]);
    bg.on('pointerdown', () => this.showMenu());
  }

  /** A0.5: si el punto de pantalla cae en el botón (lo usa el hit-test de la API de QA). */
  contains(x: number, y: number): boolean {
    return this.container.active && this.container.visible && this.bg.active && touchContains(this.bg, x, y);
  }

  /**
   * A1.12: panel de guardar/cargar revisado. Pestañas SAVE / LOAD inequívocas; tocar un slot nunca carga en un clic
   * (cargar siempre pide confirmación con escena y fecha, y antes guarda la partida actual en «Before load»);
   * sobrescribir pide confirmación; «saved» solo tras releer lo escrito (local y, con wallet, la nube).
   */
  private async showMenu(initialMode: PanelMode = 'save'): Promise<void> {
    if (document.getElementById('save-load-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'save-load-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(6,6,12,0.9);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Press Start 2P', monospace;
    `;
    const modal = document.createElement('div');
    modal.id = 'save-load-panel';
    modal.style.cssText = `
      background: #1a1a2e; border: 2px solid #5b3a8c; box-sizing: border-box;
      border-radius: 8px; padding: 12px; text-align: center;
      width: min(94vw, 380px); max-height: 94vh; overflow-y: auto; -webkit-overflow-scrolling: touch;
    `;
    overlay.appendChild(modal);

    const { address } = getWalletState();
    const isWallet = !!address;
    const saveSystem = new SaveLoadSystem();
    if (isWallet) saveSystem.setWalletAddress(address!);
    const gs = this.scene.scene.get('GameScene') as GameScene | undefined;
    gs?.syncPlayerPosition?.();
    const sceneData = this.scene.registry.get('sceneData') as { title?: string } | undefined;
    const sceneName = sceneData?.title ?? 'Unknown';
    const currentGame = () => this.scene.registry.get('gameState') as GameState | undefined;

    let mode: PanelMode = initialMode;
    let busy = false;
    let remoteSlots: Record<number, WalletSave> | null = null;
    let remoteFailed = false;
    let status: { kind: StatusKind; text: string; action?: { label: string; id: string; run: () => void; icon?: IconName } } | null = null;

    const cleanup = () => overlay.remove();
    const viewOf = (slotId: number): SlotView | null => pickSlotView(slotId, saveSystem.loadFromSlot(slotId), remoteSlots?.[slotId]);

    const fetchRemote = async () => {
      if (!isWallet) return;
      remoteSlots = await loadRemoteSlots(address!).catch(() => null);
      remoteFailed = remoteSlots === null;
    };

    const setStatus = (kind: StatusKind, text: string, action?: { label: string; id: string; run: () => void; icon?: IconName }) => {
      status = { kind, text, action };
      render();
    };

    /** Firma de sesión y, si sale bien, reintenta lo pendiente. */
    const signThen = async (after: () => Promise<void>) => {
      setStatus('busy', 'Check your wallet to sign…');
      const ok = await authorizeSession().catch(() => false);
      if (!ok) { setStatus('error', 'Signature cancelled. Cloud save not done (this device is saved).'); return; }
      await after();
    };

    const cloudSave = async (slotId: number, toSave: GameState): Promise<void> => {
      if (!sessionUsable(getSessionAuth(), Date.now())) {
        const err = getSessionAuth() ? 'session-expired' : 'no-session';
        setStatus('warn', `Slot ${slotId} saved on this device only. ${saveErrorMessage(err)}`,
          { label: 'Sign & save to cloud', icon: 'pen', id: 'sign', run: () => void signThen(() => cloudSave(slotId, toSave)) });
        return;
      }
      setStatus('busy', `Saving Slot ${slotId} to the cloud…`);
      const res = await saveForWalletRemote(address!, toSave, sceneName, slotId);
      if (res.ok) {
        await fetchRemote();
        setStatus('ok', `Slot ${slotId} saved (device + cloud)`);
      } else if (res.error === 'no-session' || res.error === 'session-expired') {
        setStatus('warn', `Slot ${slotId} saved on this device only. ${saveErrorMessage(res.error)}`,
          { label: 'Sign & save to cloud', icon: 'pen', id: 'sign', run: () => void signThen(() => cloudSave(slotId, toSave)) });
      } else {
        setStatus('error', `Slot ${slotId} saved on this device only. ${saveErrorMessage(res.error, res.status)}`,
          { label: 'Retry cloud save', icon: 'retry', id: 'retry', run: () => void cloudSave(slotId, toSave) });
      }
    };

    const doSave = async (slotId: number) => {
      const game = currentGame();
      if (!game || busy) return;
      busy = true;
      try {
        // Copia con la fecha de guardado: la partida en memoria no se toca aunque falle
        const toSave: GameState = { ...structuredClone(game), savedAt: Date.now() };
        const local = saveSystem.saveToSlot(slotId, toSave, sceneName);
        if (!local.ok) { setStatus('error', `Slot ${slotId} NOT saved. ${saveErrorMessage(local.error)}`); return; }
        if (isWallet) await cloudSave(slotId, toSave);
        else setStatus('ok', `Slot ${slotId} saved`);
      } finally {
        busy = false;
        render();
      }
    };

    /** Carga una partida: antes guarda la actual en «Before load»; si eso falla, no carga. */
    const performLoad = (state: GameState, what: string) => {
      const cur = currentGame();
      if (cur) {
        const backup = saveSystem.backupBeforeLoad({ ...structuredClone(cur), savedAt: Date.now() }, sceneName);
        if (!backup.ok) {
          setStatus('error', `Could not back up your current game (${saveErrorMessage(backup.error)}). ${what} not loaded.`);
          return;
        }
      }
      const next = structuredClone(state);
      if (!next.firedTriggers) next.firedTriggers = [];
      if (!next.dialogueProgress) next.dialogueProgress = {};
      if (!next.achievements) next.achievements = [];
      this.scene.registry.set('gameState', next);
      this.scene.registry.set('currentSceneId', next.currentScene);
      // A7.2 (J-7): Dex aparece donde se guardó (partidas viejas o posición corrupta: spawn por defecto de la escena)
      // y el panel de verbos, desplegado
      const spawn = savedSpawn(next);
      if (spawn) this.scene.registry.set('spawnOverride', spawn); else this.scene.registry.remove('spawnOverride');
      ScummUI.resetCollapsed();
      cleanup();
      this.scene.scene.stop('UIScene');
      this.scene.scene.stop('GameScene');
      this.scene.scene.start('PreloadScene');
    };

    const makeBtn = (text: string, enabled: boolean, onClick: () => void, extra = '', icon?: IconName) => {
      const btn = document.createElement('button');
      if (icon) setIconLabel(btn, icon, text, 12);
      else btn.textContent = text;
      btn.disabled = !enabled;
      btn.style.cssText = `
        display: block; width: 100%; min-height: 44px; padding: 8px 12px; margin-bottom: 6px; box-sizing: border-box;
        background: ${enabled ? '#2a2a4e' : '#1a1a2e'}; border: 1px solid ${enabled ? '#5b3a8c' : '#333'};
        border-radius: 6px; color: ${enabled ? '#e8d5f5' : '#555'}; line-height: 1.5;
        font-family: 'Press Start 2P', monospace; font-size: 9px;
        cursor: ${enabled ? 'pointer' : 'not-allowed'}; text-align: left; ${extra}
      `;
      if (enabled) btn.onclick = onClick;
      return btn;
    };

    const confirmBox = (anchor: HTMLElement, opts: { title: string; detail: string; warn?: string; yes: string; onYes: () => void }) => {
      modal.querySelector('.save-confirm')?.remove();
      const box = document.createElement('div');
      box.className = 'save-confirm';
      box.style.cssText = 'background: #2a1a1a; border: 1px solid #e94560; border-radius: 6px; padding: 10px; margin: 0 0 8px; text-align: center;';
      const t = document.createElement('div');
      t.textContent = opts.title;
      t.style.cssText = 'color: #e94560; font-size: 10px; margin-bottom: 6px; line-height: 1.5;';
      const d = document.createElement('div');
      d.textContent = opts.detail;
      d.style.cssText = 'color: #ccc; font-size: 8px; margin-bottom: 6px; line-height: 1.6;';
      box.append(t, d);
      if (opts.warn) {
        const w = document.createElement('div');
        w.textContent = opts.warn;
        w.style.cssText = 'color: #f8e848; font-size: 7px; margin-bottom: 8px; line-height: 1.7;';
        box.appendChild(w);
      }
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 8px;';
      const btnCss = 'flex: 1; min-height: 44px; font-family: inherit; font-size: 9px; border-radius: 4px; cursor: pointer;';
      const yes = document.createElement('button');
      yes.textContent = opts.yes;
      yes.dataset.confirm = 'yes';
      yes.style.cssText = btnCss + 'background: #e94560; color: #fff; border: none;';
      yes.onclick = () => { box.remove(); opts.onYes(); };
      const no = document.createElement('button');
      no.textContent = 'Cancel';
      no.dataset.confirm = 'no';
      no.style.cssText = btnCss + 'background: transparent; color: #ccc; border: 1px solid #666;';
      no.onclick = () => box.remove();
      row.append(yes, no);
      box.appendChild(row);
      anchor.after(box);
      box.scrollIntoView({ block: 'nearest' });
    };

    const describe = (v: SlotView | null) => v ? `${v.sceneName} — ${formatWhen(v.timestamp)}${v.source === 'cloud' ? ' (cloud)' : ''}` : 'Empty';

    const render = () => {
      modal.innerHTML = '';
      const title = document.createElement('div');
      setIconLabel(title, 'floppy', isWallet ? `${address!.slice(0, 6)}...${address!.slice(-4)}` : 'Save / Load', 14);
      title.style.cssText = 'color: #f8e848; font-size: 10px; margin-bottom: 10px; line-height: 1.5;';
      modal.appendChild(title);

      // Pestañas: el modo en pantalla es inequívoco
      const tabs = document.createElement('div');
      tabs.setAttribute('role', 'tablist');
      tabs.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';
      for (const m of ['save', 'load'] as const) {
        const tab = document.createElement('button');
        const active = m === mode;
        setIconLabel(tab, m === 'save' ? 'floppy' : 'folder', m === 'save' ? 'SAVE' : 'LOAD', 12);
        tab.dataset.tab = m;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(active));
        tab.style.cssText = `flex: 1; min-height: 44px; font-family: inherit; font-size: 10px; border-radius: 6px; cursor: pointer;
          background: ${active ? (m === 'save' ? '#f8e848' : '#3396ff') : 'transparent'}; color: ${active ? '#1a1a2e' : '#aaa'};
          border: 2px solid ${m === 'save' ? '#f8e848' : '#3396ff'};`;
        tab.onclick = () => { if (mode !== m) { mode = m; status = null; render(); } };
        tabs.appendChild(tab);
      }
      modal.appendChild(tabs);

      const hint = document.createElement('div');
      hint.dataset.modeHint = mode;
      hint.textContent = mode === 'save' ? 'Tap a slot to SAVE your game there.' : 'Tap a slot to LOAD it. You will be asked first.';
      hint.style.cssText = `color: ${mode === 'save' ? '#f8e848' : '#3396ff'}; font-size: 7px; margin-bottom: 8px; line-height: 1.7;`;
      modal.appendChild(hint);

      if (status) {
        const st = document.createElement('div');
        st.id = 'save-status';
        st.dataset.kind = status.kind;
        st.setAttribute('role', status.kind === 'error' ? 'alert' : 'status');
        if (status.kind === 'ok') setIconLabel(st, 'check', status.text, 10);
        else st.textContent = status.text;
        const color = { ok: '#5be37a', error: '#ff6b81', warn: '#f8e848', busy: '#ccc' }[status.kind];
        st.style.cssText = `color: ${color}; border: 1px solid ${color}; border-radius: 6px; font-size: 8px; line-height: 1.7; padding: 8px; margin-bottom: 8px;`;
        modal.appendChild(st);
        if (status.action) {
          const act = status.action;
          const b = makeBtn(act.label, !busy, act.run, 'text-align: center;', act.icon);
          b.dataset.action = act.id;
          modal.appendChild(b);
        }
      }

      if (isWallet && remoteFailed) {
        const n = document.createElement('div');
        n.textContent = 'Cloud list unavailable: showing saves on this device.';
        n.style.cssText = 'color: #ff9f43; font-size: 7px; margin-bottom: 8px; line-height: 1.7;';
        modal.appendChild(n);
      }
      if (isWallet && !sessionUsable(getSessionAuth(), Date.now()) && status?.action?.id !== 'sign') {
        const b = makeBtn('Sign to enable cloud saves', true, () => void signThen(async () => { setStatus('ok', 'Cloud saves enabled.'); }), 'text-align: center; color: #3396ff;', 'pen');
        b.dataset.action = 'sign';
        modal.appendChild(b);
      }

      const game = currentGame();
      // A1.13: «Previous autosave» (copia del autoguardado de otra partida) solo se lista si existe
      const slotIds = mode === 'save' ? [...MANUAL_SLOTS]
        : [...MANUAL_SLOTS, AUTOSAVE_SLOT, BACKUP_SLOT, ...(viewOf(PREVIOUS_AUTOSAVE_SLOT_ID) ? [PREVIOUS_AUTOSAVE_SLOT_ID] : [])];
      for (const slotId of slotIds) {
        const view = viewOf(slotId);
        const action = slotTapAction(mode, slotId, view, !!game);
        const icon: IconName = mode === 'save' ? 'floppy' : 'folder';
        const btn = makeBtn(`${slotLabel(slotId)}: ${describe(view)}`, action !== 'none' && !busy, () => {
          if (busy) return;
          if (action === 'save-now') void doSave(slotId);
          else if (action === 'confirm-overwrite') {
            confirmBox(btn, {
              title: `Overwrite ${slotLabel(slotId)}?`, detail: `Now: ${describe(view)}`, yes: 'Overwrite',
              onYes: () => void doSave(slotId),
            });
          } else if (action === 'confirm-load' && view) {
            confirmBox(btn, {
              title: `Load ${slotLabel(slotId)}?`, detail: describe(view),
              warn: game ? 'Unsaved progress will be lost. Your current game is kept in "Before load".' : undefined,
              yes: 'Load', onYes: () => performLoad(view.state, slotLabel(slotId)),
            });
          }
        }, '', icon);
        btn.dataset.slot = String(slotId);
        btn.dataset.empty = String(!view);
        modal.appendChild(btn);
      }

      this.appendExtras(modal, makeBtn, isWallet, address, game, sceneName, (st, what) => performLoad(st, what));

      const closeBtn = makeBtn('Close', true, cleanup, 'text-align: center; background: transparent; color: #aaa; border-color: #444; margin-top: 6px;');
      closeBtn.dataset.action = 'close';
      modal.appendChild(closeBtn);
    };

    overlay.onclick = (e) => { if (e.target === overlay && !busy) cleanup(); };
    document.body.appendChild(overlay);
    if (isWallet) { status = { kind: 'busy', text: 'Loading cloud saves…' }; render(); await fetchRemote(); status = null; }
    render();
  }

  /** Ajustes (V6) y, con wallet, exportar/importar partida firmada. */
  private appendExtras(
    modal: HTMLDivElement, makeBtn: (t: string, en: boolean, fn: () => void, extra?: string, icon?: IconName) => HTMLButtonElement,
    isWallet: boolean, address: string | null, gameState: GameState | undefined, sceneName: string,
    load: (state: GameState, what: string) => void,
  ): void {
    const sepSettings = document.createElement('hr');
    sepSettings.style.cssText = 'border: none; border-top: 1px solid #333; margin: 10px 0;';
    modal.appendChild(sepSettings);
    const music = this.scene.game.registry.get('musicManager') as { toggleMute(): boolean; isMuted(): boolean; setMusicVolume(v: number): void; unlockFromGesture(): void } | null;
    const speedLabel = () => `Text speed: ${TEXT_SPEED_LABEL[getTextSpeed()]}`;
    const speedBtn: HTMLButtonElement = makeBtn(speedLabel(), true, () => {
      const next = TEXT_SPEEDS[(TEXT_SPEEDS.indexOf(getTextSpeed()) + 1) % TEXT_SPEEDS.length];
      setTextSpeed(next);
      setIconLabel(speedBtn, 'gear', speedLabel(), 12);
    }, '', 'gear');
    speedBtn.dataset.setting = 'text-speed';
    modal.appendChild(speedBtn);
    if (music) {
      const muteLabel = () => `Music: ${music.isMuted() ? 'Off' : 'On'}`;
      const muteIcon = (): IconName => (music.isMuted() ? 'mute' : 'note');
      // A1.5: al activar el sonido, este clic es el gesto que desbloquea el AudioContext (como «Enable Sound»
      // del menú) y MusicManager descarga entonces la música de la escena; en silencio no se había pedido.
      const muteBtn: HTMLButtonElement = makeBtn(muteLabel(), true, () => {
        if (music.isMuted()) music.unlockFromGesture();
        music.toggleMute();
        setIconLabel(muteBtn, muteIcon(), muteLabel(), 12);
      }, '', muteIcon());
      muteBtn.dataset.setting = 'music';
      modal.appendChild(muteBtn);
      // A4.8: por defecto High (antes Low); la música y las voces tienen cada una su ajuste
      const volLabel = () => `Music volume: ${MUSIC_LEVEL_LABEL[getMusicLevel()]}`;
      const volBtn: HTMLButtonElement = makeBtn(volLabel(), true, () => {
        const next = nextLevel(getMusicLevel());
        setMusicLevel(next);
        music.setMusicVolume(musicVolumeFor(next));
        setIconLabel(volBtn, 'speaker', volLabel(), 12);
      }, '', 'speaker');
      volBtn.dataset.setting = 'volume';
      modal.appendChild(volBtn);
      const voiceLabel = () => `Voices: ${MUSIC_LEVEL_LABEL[getVoiceLevel()]}`;
      const voiceBtn: HTMLButtonElement = makeBtn(voiceLabel(), true, () => {
        setVoiceLevel(nextLevel(getVoiceLevel()));
        (this.scene.game.registry.get('voiceSystem') as { applyVoiceLevel?: () => void } | undefined)?.applyVoiceLevel?.();
        setIconLabel(voiceBtn, 'speaker', voiceLabel(), 12);
      }, '', 'speaker');
      voiceBtn.dataset.setting = 'voices';
      modal.appendChild(voiceBtn);
    }

    // A9.17: aviso de estadísticas anónimas con interruptor (apagado = no se manda nada)
    const statsLabel = () => `Anonymous play stats: ${playStatsEnabled() ? 'On' : 'Off'}`;
    const statsBtn: HTMLButtonElement = makeBtn(statsLabel(), true, () => {
      setPlayStatsEnabled(!playStatsEnabled());
      setIconLabel(statsBtn, 'gear', statsLabel(), 12);
    }, '', 'gear');
    statsBtn.dataset.setting = 'play-stats';
    modal.appendChild(statsBtn);
    const statsNote = document.createElement('div');
    statsNote.textContent = 'Anonymous play stats help improve the game';
    statsNote.style.cssText = 'font-size: 8px; line-height: 1.5; color: #8878a8; margin: 2px 4px 6px;';
    modal.appendChild(statsNote);

    if (!isWallet || !address) return;
    const sep2 = document.createElement('hr');
    sep2.style.cssText = 'border: none; border-top: 1px solid #3396ff44; margin: 10px 0;';
    modal.appendChild(sep2);

    modal.appendChild(makeBtn('Export Signed Save', !!gameState, async () => {
      if (!gameState) return;
      const json = await exportSignedWalletSave(gameState, sceneName);
      if (!json) return;
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zeroadventure_${address.slice(0, 8)}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, '', 'export'));

    // Importar es una acción explícita (elegir archivo); igual que cargar, guarda antes la partida en «Before load»
    modal.appendChild(makeBtn('Import Signed Save', true, () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const save = importWalletSave(reader.result as string);
          if (save && save.address.toLowerCase() === address.toLowerCase()) load(save.state, 'Imported save');
          else alert('Save file does not match connected wallet.');
        };
        reader.readAsText(file);
      };
      input.click();
    }, '', 'import'));
  }

  destroy(): void {
    this.container.destroy();
    document.getElementById('save-load-overlay')?.remove();
  }
}

type StatusKind = 'ok' | 'error' | 'warn' | 'busy';

/** Fecha y hora cortas del slot (dos partidas del mismo día se distinguen). */
function formatWhen(ts: number): string {
  if (!ts) return '?';
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

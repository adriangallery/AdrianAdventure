import Phaser from 'phaser';
import { FONT } from '@/config/theme';
import { NpcLife, blinkSquash, type LifeInput, type LastTalk, type NpcSide } from '@/systems/NpcLife';

/** A4.2 (QA): vida de una NPC en `state().npcLife` */
export interface NpcLifeQa {
  id: string;
  /** Sprite espejado (mira a la izquierda) */
  mirrored: boolean;
  facing: NpcSide;
  defaultFacing: NpcSide;
  /** Conversación con el jugador en marcha (se gira hacia él) */
  engaged: boolean;
  /** Tiene su texto en pantalla (o actorAnim talk) */
  talking: boolean;
  mouthOpen: boolean;
  /** Elevación de la respiración en píxeles de arte (0 o 1) */
  breathPx: number;
  blinking: boolean;
  blinkCount: number;
  /** Veces que se ha girado hacia el jugador en la escena */
  turns: number;
  /** Aperturas de boca y ms hablando en la escena */
  mouthMoves: number;
  talkMs: number;
  /** Última conversación (null si aún no ha hablado) */
  lastTalk: LastTalk | null;
  /** Sin conversación, boca cerrada y con su orientación por defecto */
  rest: boolean;
  /** Una cinemática le fijó la cara (actorFace) */
  faceLocked: boolean;
}

/**
 * NPC game object — uses a sprite if available, otherwise a colored rectangle.
 * Supports talk animation: alternates between idle and talk sprite.
 */
export class NPC extends Phaser.GameObjects.Container {
  public npcId: string;
  public npcName: string;
  public dialogueTreeId: string | null;
  /**
   * A2.8: densidad de la hoja respecto a la del jugador (`artScale` de npcs[], 1 por defecto) y posición (%) de la
   * escena, para recolocarla y reescalarla al cambiar el tamaño (GameScene.npcPixelScale)
   */
  public artScale = 1;
  public pctPosition: { x: number; y: number } | null = null;
  private npcBody: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private talkSpriteKey: string | null = null;
  private idleSpriteKey: string | null = null;
  private blinkSpriteKey: string | null = null;
  /**
   * A4.2: respiración, parpadeo, boca y giro (src/systems/NpcLife.ts). Lo mueve GameScene.update (`updateLife`) cada
   * frame: sin tweens ni temporizadores propios, así que no hay nada que cancelar al cerrar la escena.
   */
  private life: NpcLife | null = null;
  /** actorAnim talk de una cinemática: habla hasta actorAnim idle */
  private forcedTalk = false;
  /** actorAnim con una textura fija: la boca y el parpadeo con textura no la tocan */
  private posed = false;
  /** actorFace de una cinemática: manda hasta que acabe */
  private faceLocked = false;
  private lastPose = { breathPx: 0, blink: false, mouthOpen: false };
  private talkingNow = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    npcId: string,
    name: string,
    dialogueTreeId?: string,
    color = 0xff6600,
  ) {
    super(scene, x, y);

    this.npcId = npcId;
    this.npcName = name;
    this.dialogueTreeId = dialogueTreeId ?? null;

    const spriteKey = npcId;
    if (scene.textures.exists(spriteKey)) {
      const sprite = scene.add.image(0, 0, spriteKey).setOrigin(0.5, 1);
      this.npcBody = sprite;
      this.idleSpriteKey = spriteKey;
      this.setSize(sprite.width, sprite.height);
      // Check for talk sprite (e.g., npc_receptionist_talk)
      const talkKey = spriteKey + '_talk';
      if (scene.textures.exists(talkKey)) {
        this.talkSpriteKey = talkKey;
      }
      // A4.2: ojos cerrados, si algún día hay arte (si no, el parpadeo es un aplastado de 1 píxel de arte)
      if (scene.textures.exists(spriteKey + '_blink')) this.blinkSpriteKey = spriteKey + '_blink';
    } else {
      this.npcBody = scene.add.rectangle(0, 0, 28, 42, color).setStrokeStyle(1, 0xffffff, 0.6);
      this.setSize(28, 42);
    }

    // Name label above
    const labelY = this.npcBody instanceof Phaser.GameObjects.Image
      ? -(this.npcBody.height + 8)
      : -30;
    this.label = scene.add
      .text(0, labelY, name, {
        fontFamily: FONT.FAMILY,
        fontSize: '8px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.add([this.npcBody, this.label]);
    this.setDepth(9);
    scene.add.existing(this);
  }

  /**
   * A4.2: arranca la vida de la NPC (respiración, parpadeo, boca y giro). `seed` fija los parpadeos y la cadencia de la
   * boca (con ?qa=1, siempre la misma); `facing` = su orientación por defecto (`npcs[].facing`, `right` si no).
   */
  startLife(seed: number, facing: NpcSide): void {
    this.life = new NpcLife(this.npcId, seed, facing);
    this.setMirrored(facing === 'left');
  }

  /** A4.2: el jugador va a hablarle o a darle/usar algo con ella: se gira hacia él */
  engage(): void {
    this.life?.engage();
  }

  /**
   * A4.2: un frame de vida. Lo que decide NpcLife se aplica al cuerpo (hijo del Container): elevación en píxeles de arte,
   * aplastado de 1 píxel de arte o textura `_blink` al parpadear, `_talk` con la boca abierta y espejo para girarse.
   * El Container (posición y escala entera de A2.8) no se toca.
   */
  updateLife(dtMs: number, input: Omit<LifeInput, 'faceLocked' | 'npcX'> & { cinematic: boolean }): void {
    if (!this.life) return;
    // La cara fijada y el «habla» forzado de una cinemática duran lo que ella (saltada o no, al acabar se sueltan)
    if (!input.cinematic) {
      this.faceLocked = false;
      this.forcedTalk = false;
    }
    const talking = input.talking || this.forcedTalk;
    this.talkingNow = talking;
    const pose = this.life.update(dtMs, {
      ...input,
      talking,
      line: input.talking ? input.line : this.forcedTalk ? '(cinemática)' : input.line,
      npcX: this.x,
      faceLocked: this.faceLocked,
    });
    if (pose.facing) this.setMirrored(pose.facing === 'left');
    if (!(this.npcBody instanceof Phaser.GameObjects.Image)) {
      this.npcBody.y = -pose.breathPx;
      this.lastPose = { breathPx: pose.breathPx, blink: false, mouthOpen: false };
      return;
    }
    const body = this.npcBody;
    body.y = -pose.breathPx;
    if (!this.posed) {
      const key = pose.blink && this.blinkSpriteKey && !pose.mouthOpen
        ? this.blinkSpriteKey
        : pose.mouthOpen && this.talkSpriteKey ? this.talkSpriteKey : this.idleSpriteKey;
      if (key && body.texture.key !== key) body.setTexture(key);
    }
    const squash = pose.blink && !(this.blinkSpriteKey && !this.posed) ? blinkSquash(body.height) : 1;
    if (body.scaleY !== squash) body.setScale(1, squash);
    this.lastPose = { breathPx: pose.breathPx, blink: pose.blink, mouthOpen: pose.mouthOpen && !!this.talkSpriteKey && !this.posed };
  }

  /** A4.2 (QA): estado de la vida de la NPC */
  getLifeState(): NpcLifeQa {
    const l = this.life;
    return {
      id: this.npcId,
      mirrored: this.isMirrored(),
      facing: l?.currentFacing() ?? (this.isMirrored() ? 'left' : 'right'),
      defaultFacing: l?.defaultFacing ?? 'right',
      engaged: l?.isEngaged() ?? false,
      talking: this.talkingNow,
      mouthOpen: this.lastPose.mouthOpen,
      breathPx: this.lastPose.breathPx,
      blinking: this.lastPose.blink,
      blinkCount: l?.blinkCount() ?? 0,
      turns: l?.turns ?? 0,
      mouthMoves: l?.mouth.moves ?? 0,
      talkMs: Math.round(l?.talkMs ?? 0),
      lastTalk: l?.lastTalk ? { ...l.lastTalk, ms: Math.round(l.lastTalk.ms) } : null,
      rest: (l?.atRest() ?? true) && !this.talkingNow,
      faceLocked: this.faceLocked,
    };
  }

  /**
   * A2.10 (actorAnim talk): habla (boca al ritmo de la voz si dice algo; si no, sin voz) hasta `stopTalking`.
   * A4.2: ya no hay temporizador fijo de 200 ms: la boca la mueve `updateLife`.
   */
  startTalking(): void {
    this.forcedTalk = true;
    this.posed = false;
  }

  /** A2.10 (actorFace): fija la cara hasta que acabe la cinemática (A4.2: la vida no la pisa) */
  faceFromCinematic(side: NpcSide): void {
    this.faceLocked = true;
    this.life?.noteFacing(side);
    this.setMirrored(side === 'left');
  }

  /**
   * A2.10 (actorFace): espeja el sprite. Las NPC no tienen fotogramas por orientación: `right` es el sprite tal cual
   * y `left` el sprite espejado; `front`/`back` lo dejan como esté.
   */
  setMirrored(mirrored: boolean): void {
    if (this.npcBody instanceof Phaser.GameObjects.Image) this.npcBody.setFlipX(mirrored);
  }

  isMirrored(): boolean {
    return this.npcBody instanceof Phaser.GameObjects.Image && this.npcBody.flipX;
  }

  /** A2.10 (actorAnim): textura quieta (clave existente) o null para volver a la de siempre. */
  setPose(key: string | null): boolean {
    if (!(this.npcBody instanceof Phaser.GameObjects.Image)) return false;
    if (key === null) {
      this.posed = false;
      if (this.idleSpriteKey) this.npcBody.setTexture(this.idleSpriteKey);
      return true;
    }
    if (!this.scene.textures.exists(key)) return false;
    this.stopTalking();
    this.posed = true;
    this.npcBody.setTexture(key);
    return true;
  }

  /** A2.10 (actorAnim idle): deja de hablar a la fuerza; la boca vuelve a seguir solo a su texto */
  stopTalking(): void {
    this.forcedTalk = false;
    if (!this.posed && this.idleSpriteKey && this.npcBody instanceof Phaser.GameObjects.Image) {
      this.npcBody.setTexture(this.idleSpriteKey);
    }
  }
}

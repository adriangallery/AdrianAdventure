import Phaser from 'phaser';
import { FONT } from '@/config/theme';

/**
 * NPC game object — uses a sprite if available, otherwise a colored rectangle.
 * Supports talk animation: alternates between idle and talk sprite.
 */
export class NPC extends Phaser.GameObjects.Container {
  public npcId: string;
  public npcName: string;
  public dialogueTreeId: string | null;
  private npcBody: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private talkSpriteKey: string | null = null;
  private idleSpriteKey: string | null = null;
  private talkTimer: Phaser.Time.TimerEvent | null = null;

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
      .setOrigin(0.5);

    this.add([this.npcBody, this.label]);
    this.setDepth(9);
    scene.add.existing(this);
  }

  /** Simple idle bob animation */
  startIdle(): void {
    this.scene.tweens.add({
      targets: this.npcBody,
      y: { from: 0, to: -2 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Start talk animation — alternate between idle and talk sprites */
  startTalking(): void {
    if (!this.talkSpriteKey || !(this.npcBody instanceof Phaser.GameObjects.Image)) return;
    this.stopTalking();
    let open = false;
    this.talkTimer = this.scene.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        if (!(this.npcBody instanceof Phaser.GameObjects.Image)) return;
        open = !open;
        this.npcBody.setTexture(open ? this.talkSpriteKey! : this.idleSpriteKey!);
      },
    });
  }

  /** Stop talk animation — return to idle sprite */
  stopTalking(): void {
    if (this.talkTimer) {
      this.talkTimer.destroy();
      this.talkTimer = null;
    }
    if (this.idleSpriteKey && this.npcBody instanceof Phaser.GameObjects.Image) {
      this.npcBody.setTexture(this.idleSpriteKey);
    }
  }
}

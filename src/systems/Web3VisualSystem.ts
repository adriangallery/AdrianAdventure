import Phaser from 'phaser';
import type { CoordSystem } from '@/systems/CoordSystem';
import type { Web3Visual } from '@/types/scene.types';
import { getWalletState, onWalletChange } from '@/web3/wallet';
import { checkGatingRule, type GatingRule } from '@/web3/gating';
import type { Address } from 'viem';

/**
 * Renders conditional visual overlays based on wallet/NFT state.
 * Placed on top of the background, supports live updates on wallet connect/disconnect.
 */
export class Web3VisualSystem {
  private scene: Phaser.Scene;
  private coordSystem: CoordSystem;
  private visuals: Web3Visual[];
  private sprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private glowTimers: Map<string, Phaser.Tweens.Tween> = new Map();
  private unsubscribe: (() => void) | null = null;

  constructor(scene: Phaser.Scene, coordSystem: CoordSystem, visuals: Web3Visual[]) {
    this.scene = scene;
    this.coordSystem = coordSystem;
    this.visuals = visuals;

    // Place default sprites
    for (const v of visuals) {
      this.placeSprite(v, v.defaultSprite);
    }

    // Check gating and swap if wallet connected
    this.checkAndUpdate();

    // Subscribe to wallet changes for live updates
    this.unsubscribe = onWalletChange(() => this.checkAndUpdate());
  }

  /** Re-check gating rules and update sprites */
  private async checkAndUpdate(): Promise<void> {
    const { connected, address } = getWalletState();

    for (const v of this.visuals) {
      let matchedVariant: { sprite: string; effect?: string } | null = null;

      if (connected && address) {
        for (const variant of v.variants) {
          const rule = variant.gate as GatingRule;
          const passed = await checkGatingRule(address as Address, rule);
          if (passed) {
            matchedVariant = variant;
            break;
          }
        }
      }

      const spriteKey = matchedVariant ? matchedVariant.sprite : v.defaultSprite;
      const existing = this.sprites.get(v.id);

      // Only swap if texture key changed
      if (existing && existing.texture.key !== spriteKey && this.scene.textures.exists(spriteKey)) {
        existing.setTexture(spriteKey);
        this.resizeSprite(v, existing);
      }

      // Apply/remove effect
      this.clearEffect(v.id);
      if (matchedVariant?.effect && matchedVariant.effect !== 'none') {
        this.applyEffect(v.id, matchedVariant.effect);
      }
    }
  }

  private placeSprite(v: Web3Visual, spriteKey: string): void {
    if (!this.scene.textures.exists(spriteKey)) {
      console.warn(`Web3VisualSystem: sprite "${spriteKey}" not found, skipping visual "${v.id}"`);
      return;
    }

    const pos = this.coordSystem.pctToScreen(v.position.x, v.position.y);
    const sprite = this.scene.add.image(pos.x, pos.y, spriteKey)
      .setOrigin(0.5, 0.5)
      .setDepth(v.depth ?? 5);

    this.resizeSprite(v, sprite);
    this.sprites.set(v.id, sprite);
  }

  private resizeSprite(v: Web3Visual, sprite: Phaser.GameObjects.Image): void {
    if (v.size) {
      const tl = this.coordSystem.pctToScreen(0, 0);
      const br = this.coordSystem.pctToScreen(v.size.w, v.size.h);
      const targetW = br.x - tl.x;
      const targetH = br.y - tl.y;
      sprite.setDisplaySize(targetW, targetH);
    } else {
      // Use natural size scaled to background
      sprite.setScale(this.coordSystem.bgW / this.coordSystem.imgW);
    }
  }

  private applyEffect(id: string, effect: string): void {
    const sprite = this.sprites.get(id);
    if (!sprite) return;

    if (effect === 'glow') {
      const tween = this.scene.tweens.add({
        targets: sprite,
        alpha: { from: 1, to: 0.7 },
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.glowTimers.set(id, tween);
    } else if (effect === 'shimmer') {
      const tween = this.scene.tweens.add({
        targets: sprite,
        alpha: { from: 0.85, to: 1 },
        scaleX: { from: sprite.scaleX, to: sprite.scaleX * 1.02 },
        scaleY: { from: sprite.scaleY, to: sprite.scaleY * 1.02 },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.glowTimers.set(id, tween);
    }
  }

  private clearEffect(id: string): void {
    const tween = this.glowTimers.get(id);
    if (tween) {
      tween.stop();
      tween.destroy();
      this.glowTimers.delete(id);
    }
    const sprite = this.sprites.get(id);
    if (sprite) sprite.setAlpha(1);
  }

  /** Called on resize to reposition sprites */
  onResize(coordSystem: CoordSystem): void {
    this.coordSystem = coordSystem;
    for (const v of this.visuals) {
      const sprite = this.sprites.get(v.id);
      if (!sprite) continue;
      const pos = coordSystem.pctToScreen(v.position.x, v.position.y);
      sprite.setPosition(pos.x, pos.y);
      this.resizeSprite(v, sprite);
    }
  }

  destroy(): void {
    this.unsubscribe?.();
    for (const tween of this.glowTimers.values()) {
      tween.stop();
      tween.destroy();
    }
    this.glowTimers.clear();
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
  }
}

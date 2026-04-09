import Phaser from 'phaser';
import type { InventorySystem } from '@/systems/InventorySystem';
import type { InventoryItem } from '@/types/game.types';
import { TWP, FONT, LAYOUT } from '@/config/theme';

const ITEM_SIZE = 48;
const ITEM_GAP = 8;
const PADDING = 12;
const ANIM_DURATION = 200;

/**
 * Mobile-first slide-up inventory drawer.
 * Thimbleweed Park palette: dark panel, lavender text, yellow highlights.
 * Collapsed: small button bottom-right with item count badge.
 * Expanded: slide-up panel (28% height) with horizontal scrollable grid.
 */
export class InventoryDrawer {
  private scene: Phaser.Scene;
  private inventory: InventorySystem;

  // Collapsed state
  private button: Phaser.GameObjects.Container;
  private badge: Phaser.GameObjects.Text;

  // Expanded state
  private drawer: Phaser.GameObjects.Container;
  private drawerBg: Phaser.GameObjects.Rectangle;
  private drawerBorder: Phaser.GameObjects.Rectangle;
  private itemsContainer: Phaser.GameObjects.Container;
  private closeHint: Phaser.GameObjects.Text;
  private tabGameItems: Phaser.GameObjects.Text;
  private tabNFTs: Phaser.GameObjects.Text;

  private expanded = false;
  private selectedItemId: string | null = null;
  private activeTab: 'items' | 'nfts' = 'items';
  private onItemSelected: ((item: InventoryItem | null) => void) | null = null;

  constructor(scene: Phaser.Scene, inventory: InventorySystem) {
    this.scene = scene;
    this.inventory = inventory;

    const { width, height } = scene.scale;

    // --- Collapsed button (TWP dark style) ---
    this.button = scene.add.container(width - 60, height - 50).setDepth(350);

    const btnBg = scene.add.circle(0, 0, 22, TWP.PANEL_BG, 0.85)
      .setStrokeStyle(2, TWP.INV_SLOT_BORDER, 0.7);
    const btnIcon = scene.add.text(0, -2, '\u{1F392}', { fontSize: '20px' }).setOrigin(0.5);
    this.badge = scene.add
      .text(14, -14, '0', {
        fontFamily: FONT.FAMILY,
        fontSize: '7px',
        color: TWP.INV_BADGE_TEXT,
        backgroundColor: TWP.INV_BADGE_BG,
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);

    this.button.add([btnBg, btnIcon, this.badge]);
    btnBg.setInteractive({ useHandCursor: true });
    btnBg.on('pointerdown', () => this.toggle());

    // --- Expanded drawer ---
    const drawerH = Math.floor(height * LAYOUT.INV_DRAWER_RATIO);
    const drawerY = height;

    this.drawer = scene.add.container(0, drawerY).setDepth(350).setVisible(false);

    this.drawerBg = scene.add.rectangle(width / 2, drawerH / 2, width, drawerH, TWP.PANEL_BG, 0.92);
    this.drawerBorder = scene.add.rectangle(width / 2, 0, width, 1, TWP.PANEL_BORDER, TWP.PANEL_BORDER_ALPHA);

    // Tabs
    const tabSize = Math.max(11, Math.min(14, Math.floor(width * 0.014)));
    this.tabGameItems = scene.add
      .text(PADDING, 10, 'Items', {
        fontFamily: FONT.FAMILY,
        fontSize: `${tabSize}px`,
        color: TWP.VERB_ACTIVE,
      })
      .setInteractive({ useHandCursor: true });

    this.tabNFTs = scene.add
      .text(PADDING + tabSize * 7, 10, 'NFTs', {
        fontFamily: FONT.FAMILY,
        fontSize: `${tabSize}px`,
        color: TWP.VERB_NORMAL,
      })
      .setInteractive({ useHandCursor: true });

    this.tabGameItems.on('pointerdown', () => this.setTab('items'));
    this.tabNFTs.on('pointerdown', () => this.setTab('nfts'));

    // Close hint
    this.closeHint = scene.add
      .text(width - PADDING, 10, '\u{2715}', {
        fontFamily: FONT.FAMILY,
        fontSize: `${tabSize}px`,
        color: TWP.VERB_NORMAL,
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.closeHint.on('pointerover', () => this.closeHint.setColor(TWP.VERB_ACTIVE));
    this.closeHint.on('pointerout', () => this.closeHint.setColor(TWP.VERB_NORMAL));
    this.closeHint.on('pointerdown', () => this.collapse());

    // Items container
    this.itemsContainer = scene.add.container(PADDING, 36);

    this.drawer.add([this.drawerBg, this.drawerBorder, this.tabGameItems, this.tabNFTs, this.closeHint, this.itemsContainer]);

    this.inventory.onChanged(() => this.refresh());
    this.refresh();

    scene.scale.on('resize', this.handleResize, this);
  }

  onSelect(cb: (item: InventoryItem | null) => void): void {
    this.onItemSelected = cb;
  }

  getSelectedItem(): InventoryItem | null {
    if (!this.selectedItemId) return null;
    return this.inventory.getItems().find((i) => i.id === this.selectedItemId) ?? null;
  }

  private toggle(): void {
    if (this.expanded) this.collapse();
    else this.expand();
  }

  private expand(): void {
    if (this.expanded) return;
    this.expanded = true;

    const { height } = this.scene.scale;
    const drawerH = Math.floor(height * LAYOUT.INV_DRAWER_RATIO);

    this.drawer.setVisible(true);
    this.drawer.setPosition(0, height);

    this.scene.tweens.add({
      targets: this.drawer,
      y: height - drawerH,
      duration: ANIM_DURATION,
      ease: 'Quad.easeOut',
    });

    this.scene.tweens.add({ targets: this.button, alpha: 0, duration: 100 });
    this.refresh();
  }

  private collapse(): void {
    if (!this.expanded) return;
    this.expanded = false;

    const { height } = this.scene.scale;

    this.scene.tweens.add({
      targets: this.drawer,
      y: height,
      duration: ANIM_DURATION,
      ease: 'Quad.easeIn',
      onComplete: () => this.drawer.setVisible(false),
    });

    this.scene.tweens.add({ targets: this.button, alpha: 1, duration: 100 });
  }

  private setTab(tab: 'items' | 'nfts'): void {
    this.activeTab = tab;
    this.tabGameItems.setColor(tab === 'items' ? TWP.VERB_ACTIVE : TWP.VERB_NORMAL);
    this.tabNFTs.setColor(tab === 'nfts' ? TWP.VERB_ACTIVE : TWP.VERB_NORMAL);
    this.renderItems();
  }

  refresh(): void {
    const count = this.inventory.count();
    this.badge.setText(String(count));
    this.badge.setVisible(count > 0);

    if (this.expanded) {
      this.renderItems();
    }
  }

  private renderItems(): void {
    this.itemsContainer.removeAll(true);

    const items = this.activeTab === 'items' ? this.inventory.getGameItems() : this.inventory.getNFTItems();

    if (items.length === 0) {
      const emptySize = Math.max(9, Math.min(12, Math.floor(this.scene.scale.width * 0.011)));
      const empty = this.scene.add.text(0, 10, this.activeTab === 'items' ? 'No items yet' : 'Connect wallet to see NFTs', {
        fontFamily: FONT.FAMILY,
        fontSize: `${emptySize}px`,
        color: TWP.VERB_NORMAL,
      });
      this.itemsContainer.add(empty);
      return;
    }

    items.forEach((item, i) => {
      const x = i * (ITEM_SIZE + ITEM_GAP);
      const isSelected = this.selectedItemId === item.id;

      // Item slot — dark with subtle border
      const slot = this.scene.add
        .rectangle(x + ITEM_SIZE / 2, ITEM_SIZE / 2, ITEM_SIZE, ITEM_SIZE, TWP.INV_SLOT_BG, 0.8)
        .setStrokeStyle(2, isSelected ? TWP.INV_SLOT_SELECT : TWP.INV_SLOT_BORDER, isSelected ? 1 : 0.5)
        .setInteractive({ useHandCursor: true });

      // Item icon: sprite if available, then emoji, then first letter
      const spriteKey = `item_${item.id}`;
      let display: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
      if (this.scene.textures.exists(spriteKey)) {
        const img = this.scene.add.image(x + ITEM_SIZE / 2, ITEM_SIZE / 2, spriteKey).setOrigin(0.5);
        const maxDim = ITEM_SIZE - 8;
        const scale = Math.min(maxDim / img.width, maxDim / img.height);
        img.setScale(scale);
        display = img;
      } else if (item.icon) {
        display = this.scene.add.text(x + ITEM_SIZE / 2, ITEM_SIZE / 2 - 4, item.icon, { fontSize: '24px' }).setOrigin(0.5);
      } else {
        display = this.scene.add
            .text(x + ITEM_SIZE / 2, ITEM_SIZE / 2 - 4, item.name.charAt(0).toUpperCase(), {
              fontFamily: FONT.FAMILY,
              fontSize: '16px',
              color: TWP.INV_ITEM_TEXT,
            })
            .setOrigin(0.5);
      }

      // Item name below
      const label = this.scene.add
        .text(x + ITEM_SIZE / 2, ITEM_SIZE + 4, item.name, {
          fontFamily: FONT.FAMILY,
          fontSize: '9px',
          color: TWP.INV_ITEM_TEXT,
          align: 'center',
        })
        .setOrigin(0.5, 0);

      // Selected glow
      if (isSelected) {
        slot.setFillStyle(0x18182a, 0.9);
      }

      slot.on('pointerdown', () => {
        if (this.selectedItemId === item.id) {
          this.selectedItemId = null;
        } else {
          this.selectedItemId = item.id;
        }
        this.onItemSelected?.(this.getSelectedItem());
        this.renderItems();
      });

      this.itemsContainer.add([slot, display, label]);
    });
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    const { width, height } = gameSize;
    this.button.setPosition(width - 60, height - 50);

    const drawerH = Math.floor(height * LAYOUT.INV_DRAWER_RATIO);
    if (this.expanded) {
      this.drawer.setPosition(0, height - drawerH);
    }
    this.drawerBg.setPosition(width / 2, drawerH / 2).setSize(width, drawerH);
    this.drawerBorder.setPosition(width / 2, 0).setSize(width, 2);
    this.closeHint.setPosition(width - PADDING, 10);
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this);
    this.button.destroy();
    this.drawer.destroy();
  }
}

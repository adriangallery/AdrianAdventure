import Phaser from 'phaser';
import { Verb, PANEL_VERBS, VERB_LABELS } from '@/types/game.types';
import type { InventorySystem } from '@/systems/InventorySystem';
import type { InventoryItem } from '@/types/game.types';
import { TWP, FONT, LAYOUT } from '@/config/theme';

export const SCUMM_PANEL_MIN_HEIGHT: number = LAYOUT.PANEL_MIN_HEIGHT;
const COLLAPSED_HEIGHT = 36;

/**
 * Thimbleweed Park-style SCUMM bottom panel.
 * - No borders, no separators — seamless black panel
 * - Left ~50%: 3×3 verb grid with LARGE text
 * - Between: scroll arrows column (↑↓)
 * - Right ~45%: 2-row inventory grid of dark square tiles
 * - Top: action/sentence line
 */
export class ScummUI {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private actionLine!: Phaser.GameObjects.Text;
  private verbTexts: Map<Verb, Phaser.GameObjects.Text> = new Map();
  private invContainer!: Phaser.GameObjects.Container;
  private invScrollOffset = 0;
  private panelHeight = SCUMM_PANEL_MIN_HEIGHT;
  private fullPanelHeight = SCUMM_PANEL_MIN_HEIGHT;

  private selectedVerb: Verb = Verb.WALK;
  private hoveredObject: string | null = null;
  private selectedItem: InventoryItem | null = null;
  private inventory: InventorySystem | null = null;
  private onVerbSelect: ((verb: Verb) => void) | null = null;
  private onInventorySelect: ((item: InventoryItem) => void) | null = null;
  private onItemCombo: ((item1: InventoryItem, item2: InventoryItem) => void) | null = null;

  /** Mobile collapsible state */
  private collapsed = false;
  private isMobile = false;
  private handleBar: Phaser.GameObjects.Container | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(500).setScrollFactor(0);
    this.detectMobile();
    this.build();
    scene.scale.on('resize', () => { this.detectMobile(); this.rebuild(); });
  }

  private detectMobile(): void {
    const { width, height } = this.scene.scale;
    this.isMobile = height > width || Math.min(width, height) < 600;
  }

  private build(): void {
    this.container.removeAll(true);
    this.verbTexts.clear();
    this.handleBar = null;

    const { width, height } = this.scene.scale;

    // Panel height — compact on mobile, standard on desktop
    const isLandscape = width > height;
    const panelRatio = this.isMobile
      ? (isLandscape ? 0.28 : 0.18)
      : 0.25;
    const minH = this.isMobile && isLandscape ? 120 : LAYOUT.PANEL_MIN_HEIGHT;
    this.fullPanelHeight = Math.max(minH, Math.floor(height * panelRatio));

    // Effective height depends on collapsed state
    this.panelHeight = (this.isMobile && this.collapsed) ? COLLAPSED_HEIGHT : this.fullPanelHeight;

    const panelY = height - this.panelHeight;
    this.container.setPosition(0, panelY);
    this.scene.registry.set('scummPanelHeight', this.panelHeight);

    // ─── Panel background (pure black, seamless — NO border) ───
    this.container.add(
      this.scene.add.rectangle(width / 2, this.panelHeight / 2, width, this.panelHeight, TWP.PANEL_BG, TWP.PANEL_BG_ALPHA)
    );

    // ─── Font sizing — TWP verbs are BIG, use larger ref on portrait phones ───
    const refDim = this.isMobile && !isLandscape ? Math.max(width, height * 0.5) : width;
    const verbFontSize = Math.max(14, Math.min(26, Math.floor(refDim * 0.022)));
    const actionFontSize = Math.max(12, Math.min(20, Math.floor(refDim * 0.018)));

    // ─── Action / sentence line — top of panel ───
    const actionY = (this.isMobile && this.collapsed) ? (COLLAPSED_HEIGHT / 2 - actionFontSize / 2) : 6;
    this.actionLine = this.scene.add.text(width / 2, actionY, '', {
      fontFamily: FONT.FAMILY,
      fontSize: `${actionFontSize}px`,
      color: TWP.ACTION_LINE,
    }).setOrigin(0.5, 0);
    this.container.add(this.actionLine);
    this.updateActionLine();

    // Mobile: collapsed toggle handle
    if (this.isMobile) {
      this.buildHandle(width);
    }

    // Content area (verbs + inventory) — hidden when collapsed
    if (!this.collapsed || !this.isMobile) {
      this.buildContent(width, verbFontSize, actionFontSize);
    }
  }

  private buildHandle(width: number): void {
    const hb = this.scene.add.container(0, 0);

    const chevronText = this.collapsed ? '\u25B2' : '\u25BC';
    const chevron = this.scene.add.text(width - 30, COLLAPSED_HEIGHT / 2, chevronText, {
      fontFamily: FONT.FAMILY, fontSize: '12px', color: TWP.VERB_NORMAL,
    }).setOrigin(0.5);
    hb.add(chevron);

    const hitArea = this.scene.add.rectangle(width / 2, COLLAPSED_HEIGHT / 2, width, COLLAPSED_HEIGHT, 0x000000, 0.001)
      .setInteractive({ useHandCursor: true });
    hb.add(hitArea);

    hitArea.on('pointerup', () => this.toggle());

    this.container.add(hb);
    this.handleBar = hb;
  }

  private buildContent(width: number, verbFontSize: number, actionFontSize: number): void {
    // ─── Verb grid (3×3) — proportional columns based on text width ───
    const verbStartY = 6 + actionFontSize + 10; // below action line
    const verbPadLeft = Math.max(6, width * 0.015);
    const mobileVerbSize = width < 500 ? Math.max(10, Math.min(14, Math.floor(width * 0.028))) : verbFontSize;
    const verbRowH = Math.max(22, mobileVerbSize + 8);
    const verbGap = Math.max(8, Math.floor(width * 0.012)); // consistent gap between columns

    // Measure max width per column to position evenly
    const cols = LAYOUT.VERB_COLS;
    const colMaxW: number[] = new Array(cols).fill(0);
    const tempTexts: Phaser.GameObjects.Text[] = [];
    PANEL_VERBS.forEach((verb, i) => {
      const t = this.scene.add.text(0, 0, VERB_LABELS[verb], {
        fontFamily: FONT.FAMILY, fontSize: `${mobileVerbSize}px`,
      }).setPadding(2, 3);
      tempTexts.push(t);
      const col = i % cols;
      colMaxW[col] = Math.max(colMaxW[col], t.width);
    });
    tempTexts.forEach(t => t.destroy());

    // Calculate column X positions from measured widths
    const colX: number[] = [];
    let cx = verbPadLeft;
    for (let c = 0; c < cols; c++) {
      colX.push(cx);
      cx += colMaxW[c] + verbGap;
    }

    PANEL_VERBS.forEach((verb, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = colX[col];
      const y = verbStartY + row * verbRowH;
      const isActive = verb === this.selectedVerb;

      const text = this.scene.add.text(x, y, VERB_LABELS[verb], {
        fontFamily: FONT.FAMILY,
        fontSize: `${mobileVerbSize}px`,
        color: isActive ? TWP.VERB_ACTIVE : TWP.VERB_NORMAL,
      })
        .setInteractive({ useHandCursor: true })
        .setPadding(2, 3);

      text.on('pointerover', () => {
        if (verb !== this.selectedVerb) text.setColor(TWP.VERB_HOVER);
      });
      text.on('pointerout', () => {
        if (verb !== this.selectedVerb) text.setColor(TWP.VERB_NORMAL);
      });
      text.on('pointerdown', () => {
        this.selectVerb(verb);
      });

      this.verbTexts.set(verb, text);
      this.container.add(text);
    });

    // Total verb area width (for positioning arrows/inventory after)
    const verbAreaW = colX[cols - 1] + colMaxW[cols - 1];

    // ─── Scroll arrows column (between verbs and inventory) ───
    const arrowX = verbAreaW + verbGap;
    const arrowSize = Math.max(12, Math.min(20, Math.floor(width * 0.016)));
    const arrowTopY = verbStartY + 4;
    const arrowBotY = verbStartY + verbRowH * 3 - arrowSize - 4;

    // Up arrow
    const upArrow = this.scene.add.text(arrowX, arrowTopY, '\u25B2', {
      fontFamily: FONT.FAMILY, fontSize: `${arrowSize}px`, color: TWP.INV_ARROW,
    }).setInteractive({ useHandCursor: true });
    upArrow.on('pointerover', () => upArrow.setColor(TWP.INV_ARROW_HOVER));
    upArrow.on('pointerout', () => upArrow.setColor(TWP.INV_ARROW));
    upArrow.on('pointerdown', () => {
      if (this.invScrollOffset > 0) { this.invScrollOffset--; this.renderInventory(); }
    });
    this.container.add(upArrow);

    // Down arrow
    const downArrow = this.scene.add.text(arrowX, arrowBotY, '\u25BC', {
      fontFamily: FONT.FAMILY, fontSize: `${arrowSize}px`, color: TWP.INV_ARROW,
    }).setInteractive({ useHandCursor: true });
    downArrow.on('pointerover', () => downArrow.setColor(TWP.INV_ARROW_HOVER));
    downArrow.on('pointerout', () => downArrow.setColor(TWP.INV_ARROW));
    downArrow.on('pointerdown', () => {
      this.invScrollOffset++;
      this.renderInventory();
    });
    this.container.add(downArrow);

    // ─── Inventory grid (right side — 2 rows of dark square tiles) ───
    const invStartX = arrowX + arrowSize + 12;
    this.invContainer = this.scene.add.container(invStartX, verbStartY);
    this.container.add(this.invContainer);
    this.renderInventory();

  }

  private rebuild(): void {
    this.build();
  }

  // ─── Collapse / Expand ───

  toggle(): void {
    if (this.collapsed) this.expand(); else this.collapse();
  }

  collapse(): void {
    if (!this.isMobile || this.collapsed) return;
    this.collapsed = true;
    this.animatePanel();
  }

  expand(): void {
    if (!this.isMobile || !this.collapsed) return;
    this.collapsed = false;
    this.animatePanel();
  }

  private animatePanel(): void {
    const targetH = this.collapsed ? COLLAPSED_HEIGHT : this.fullPanelHeight;
    const targetY = this.scene.scale.height - targetH;

    this.panelHeight = targetH;
    this.scene.registry.set('scummPanelHeight', targetH);
    this.scene.events.emit('panel:toggled');

    this.build();

    this.container.setY(this.scene.scale.height);
    this.scene.tweens.add({
      targets: this.container,
      y: targetY,
      duration: 200,
      ease: 'Power2',
    });
  }

  selectVerb(verb: Verb): void {
    // Toggle: clicking the already-active verb deselects it (resets to WALK)
    if (verb === this.selectedVerb && verb !== Verb.WALK) {
      this.selectedVerb = Verb.WALK;
    } else {
      this.selectedVerb = verb;
    }
    // Clear item selection when switching verbs
    if (this.selectedItem && this.selectedVerb !== Verb.USE) {
      this.selectedItem = null;
    }
    for (const [v, text] of this.verbTexts) {
      const active = v === this.selectedVerb;
      text.setColor(active ? TWP.VERB_ACTIVE : TWP.VERB_NORMAL);
    }
    this.updateActionLine();
    this.onVerbSelect?.(this.selectedVerb);
  }

  getSelectedVerb(): Verb { return this.selectedVerb; }
  getSelectedItem(): InventoryItem | null { return this.selectedItem; }
  clearSelectedItem(): void { this.selectedItem = null; this.updateActionLine(); }
  onVerb(cb: (verb: Verb) => void): void { this.onVerbSelect = cb; }

  setHoveredObject(name: string | null): void {
    this.hoveredObject = name;
    this.updateActionLine();
  }

  private updateActionLine(): void {
    const verb = VERB_LABELS[this.selectedVerb];
    if (this.selectedItem) {
      // Item cursor mode: "Use [item] with [target]"
      const itemName = this.selectedItem.name;
      this.actionLine.setText(
        this.hoveredObject ? `Use ${itemName} with ${this.hoveredObject}` : `Use ${itemName} with...`
      );
    } else if (this.selectedVerb === Verb.WALK) {
      // WALK mode: show target name only when hovering, empty otherwise
      this.actionLine.setText(this.hoveredObject ? `Walk to ${this.hoveredObject}` : '');
    } else {
      this.actionLine.setText(this.hoveredObject ? `${verb} ${this.hoveredObject}` : verb);
    }
  }

  setInventory(inv: InventorySystem): void {
    this.inventory = inv;
    inv.onChanged(() => this.renderInventory());
    this.renderInventory();
  }

  onItemSelect(cb: (item: InventoryItem) => void): void {
    this.onInventorySelect = cb;
  }

  onCombo(cb: (item1: InventoryItem, item2: InventoryItem) => void): void {
    this.onItemCombo = cb;
  }

  /** Inventory item clicked — behavior depends on current verb. */
  private selectInventoryItem(item: InventoryItem): void {
    // LOOK: describe the item
    if (this.selectedVerb === Verb.LOOK) {
      const desc = ScummUI.ITEM_DESCS[item.id] ?? `It's ${item.name}. Nothing special about it.`;
      this.scene.events.emit('say', desc);
      return;
    }

    // Item combo: if we already have an item selected and click a DIFFERENT item
    if (this.selectedItem && this.selectedItem.id !== item.id) {
      const item1 = this.selectedItem;
      this.selectedItem = null;
      this.updateActionLine();
      if (this.onItemCombo) {
        this.onItemCombo(item1, item);
      } else {
        this.scene.events.emit('say', `I can't use ${item1.name} with ${item.name}.`);
      }
      return;
    }

    // USE or WALK: toggle "Use X with..." cursor mode
    if (this.selectedVerb === Verb.USE || this.selectedVerb === Verb.WALK) {
      if (this.selectedItem?.id === item.id) {
        this.selectedItem = null;
      } else {
        this.selectedItem = item;
        if (this.selectedVerb !== Verb.USE) {
          this.selectedVerb = Verb.USE;
          for (const [v, text] of this.verbTexts) {
            text.setColor(v === Verb.USE ? TWP.VERB_ACTIVE : TWP.VERB_NORMAL);
          }
        }
      }
      this.updateActionLine();
      this.onInventorySelect?.(this.selectedItem!);
      return;
    }

    // Other verbs (OPEN, CLOSE, PUSH, PULL, TALK, GIVE, PICK): show per-item response
    const verbKey = this.selectedVerb;
    const response = ScummUI.ITEM_VERB_RESPONSES[item.id]?.[verbKey]
      ?? ScummUI.DEFAULT_ITEM_VERB_RESPONSES[verbKey]
      ?? `I can't ${VERB_LABELS[verbKey].toLowerCase()} ${item.name}.`;
    this.scene.events.emit('say', response);
  }

  private static readonly ITEM_DESCS: Record<string, string> = {
    code_note: "A crumpled note with '7314' scrawled in shaky handwriting. Someone was in a hurry. Or panicking. Or both.",
    ledger: "Adrian's hardware wallet. The screen shows a balance that would make a whale blush. Or maybe it's just dust on the display.",
    keycard: "An admin keycard with Adrian's photo. He looks younger. And less concerned about gas fees.",
    floppy_disk: "A 3.5\" floppy labeled 'BACKUP'. 1.44 MB of pure nostalgia. That's like... half an NFT image.",
    printout: "A thermal printout with transaction hashes and a small map. The ink is already fading. Like most altcoin roadmaps.",
    water_bottle: "Crystal clear spring water. In the crypto world, this is the only thing that's actually transparent.",
    golden_token: "A golden ZERO token. Heavy. Shiny. Makes me feel important. This must be what institutional adoption feels like.",
    terminal_key: "An electronic key fob for the trading terminal. The LED blinks green. It knows things. Important things.",
    antenna: "A loose antenna salvaged from the rooftop array. Still picks up two bars. And occasionally, Rick Astley.",
    sign_in_sheet: "Patient records from the clinic. Names, diagnoses... 'Chronic Airdrop Dependency', 'Acute Rug Pull Trauma'. These people need help.",
    monkey_sticker: "A sticker of a three-headed monkey. A classic. I heard you can't see it behind you, though.",
    patient_file: "A classified patient file. The encryption seal is intact. 'PATIENT ZERO' is stamped in red.",
    dr_satoshi_badge: "A clinic badge for 'Dr. Satoshi'. Chief of Decentralized Medicine. The photo is conveniently blurry.",
    clinic_photo: "A faded photo of the clinic's grand opening. Hopeful faces and a banner: 'Healing the Blockchain'.",
    adrian_note: "A handwritten note from Adrian himself. The ink is fresh. He was here recently.",
    rubber_duck: "A yellow rubber duck. Squeaky. Utterly useless. I love it. Every adventure needs one.",
    receipt: "A crumpled receipt: '1 BTC @ $3.50'. Someone didn't HODL. This is the saddest artifact I've ever seen.",
    broken_mouse: "A computer mouse with a severed cable. Clicked its last click. Rest in pixels, little friend.",
    server_log: "Printed server logs. Error codes, timestamps, and someone's 3 AM debugging desperation.",
    burned_chip: "A scorched chip from the AdrianAuctions server. Whatever happened, it happened fast and hot.",
  };

  private static readonly DEFAULT_ITEM_VERB_RESPONSES: Partial<Record<Verb, string>> = {
    [Verb.OPEN]: "I don't think I can open this.",
    [Verb.CLOSE]: "Not the kind of thing you close.",
    [Verb.PUSH]: "I push it around in my pocket. Thrilling.",
    [Verb.PULL]: "I tug on it. Nothing happens. As expected.",
    [Verb.TALK]: "I hold it to my ear. Silence. It's not a seashell.",
    [Verb.GIVE]: "Nobody here to give it to.",
    [Verb.PICK]: "Already in my inventory. Mission accomplished.",
  };

  private static readonly ITEM_VERB_RESPONSES: Record<string, Partial<Record<Verb, string>>> = {
    code_note: {
      [Verb.OPEN]: "I unfold it completely. Still just 7314. No hidden message on the back either.",
      [Verb.TALK]: "*clears throat* 'Seven-three-one-four!' ...nothing happened. Was worth a try.",
      [Verb.PUSH]: "I flatten the creases. The handwriting doesn't get any less panicked.",
      [Verb.PULL]: "I try to tear it. No — this might be important. What am I doing?",
      [Verb.CLOSE]: "I fold it back up. The 7 peeks out accusingly.",
      [Verb.GIVE]: "I'm not giving away the only code I have. That's Security 101.",
    },
    mystery_envelope: {
      [Verb.OPEN]: "I tear open the seal... Inside: a single sheet with coordinates and a cryptic note: 'Find Patient Zero before they find you.'",
      [Verb.TALK]: "'CONFIDENTIAL — PATIENT ZERO'. Yeah, I can read. The envelope doesn't respond.",
      [Verb.PUSH]: "I press on the envelope. Something stiff is inside. A card? A photo?",
      [Verb.PULL]: "I pull at the corners. The wax seal holds firm. Whoever sealed this meant business.",
      [Verb.CLOSE]: "It's an envelope. It was already closed. That's its whole thing.",
      [Verb.GIVE]: "Give away confidential evidence? I didn't get this far by being careless.",
    },
    ledger: {
      [Verb.OPEN]: "The Ledger screen flickers. Balance: [REDACTED]. Transaction history: longer than a CVS receipt.",
      [Verb.TALK]: "I whisper my seed phrase to it. Just kidding. I'm not THAT careless.",
      [Verb.PUSH]: "I press the button. It shows a firmware update notification. Not now.",
      [Verb.PULL]: "I yank the USB cable. It protests with an angry LED.",
      [Verb.CLOSE]: "I power it down. The screen fades with a sad little Ledger logo.",
      [Verb.GIVE]: "My hardware wallet? To whom? This isn't a 'not your keys' situation.",
    },
    keycard: {
      [Verb.OPEN]: "It's a flat card. There's nothing to open. Unless you count the doors it unlocks.",
      [Verb.TALK]: "I hold it up. 'Open sesame!' The keycard is unimpressed.",
      [Verb.PUSH]: "I bend it slightly. The magnetic strip catches the light. Still works, probably.",
      [Verb.PULL]: "The lanyard stretches. ADMIN ACCESS - ADRIAN. The photo really doesn't do him justice.",
      [Verb.CLOSE]: "I put it back in my pocket. Card stored securely. Unlike most private keys.",
      [Verb.GIVE]: "This admin keycard is my VIP pass. Not sharing.",
    },
    water_bottle: {
      [Verb.OPEN]: "I unscrew the cap. Crystal clear water. The only transparent thing in crypto.",
      [Verb.TALK]: "I speak into the bottle. My voice echoes. 'HODL... hodl... hodl...'",
      [Verb.PUSH]: "Water sloshes. Simple physics. No smart contract needed.",
      [Verb.PULL]: "I pull off the label. 'Spring Water - Not Financial Advice'. Heh.",
      [Verb.CLOSE]: "I screw the cap back on. Hydration secured.",
      [Verb.GIVE]: "Plants need it more than people do around here.",
    },
    golden_token: {
      [Verb.OPEN]: "It's a solid token. No hidden compartments. Unlike most crypto projects.",
      [Verb.TALK]: "'To the moon?' I ask. The token stays firmly in my hand. Gravity: 1, ZERO: 0.",
      [Verb.PUSH]: "Heavy. Solid. Real. Everything most tokens aren't.",
      [Verb.PULL]: "I polish it with my sleeve. It gleams. I feel wealthier already.",
      [Verb.CLOSE]: "You can't close a token. You can only HODL.",
      [Verb.GIVE]: "This golden ZERO token is mine. MINE. ...sorry, got a bit possessive there.",
    },
    terminal_key: {
      [Verb.OPEN]: "The key fob has a tiny seam. I pry it open — a microchip inside. Interesting.",
      [Verb.TALK]: "The LED blinks twice. Was that... morse code? ...No. It was just blinking.",
      [Verb.PUSH]: "I press the button. The LED turns red briefly. Did I just lock something?",
      [Verb.PULL]: "The keyring loop is sturdy. Whoever owned this was serious about terminal access.",
      [Verb.CLOSE]: "I snap the fob shut. The LED blinks green again. Crisis averted.",
      [Verb.GIVE]: "This terminal key could unlock important data. Keeping it.",
    },
    antenna: {
      [Verb.OPEN]: "It's a metal rod. Not much to open here. Unless I'm missing something fundamental.",
      [Verb.TALK]: "I speak into it like a microphone. *feedback screech* Nope.",
      [Verb.PUSH]: "I extend it fully. Two bars of signal. And faintly... Rick Astley?",
      [Verb.PULL]: "I collapse the antenna. It clicks satisfyingly into its shortest form.",
      [Verb.CLOSE]: "I retract it. *click click click* Oddly therapeutic.",
      [Verb.GIVE]: "Who would want a loose antenna? Besides another conspiracy theorist.",
    },
    floppy_disk: {
      [Verb.OPEN]: "I slide the metal cover. The magnetic disk inside looks fragile. 1.44 MB of destiny.",
      [Verb.TALK]: "'What secrets do you hold?' The floppy spins silently. It knows.",
      [Verb.PUSH]: "I push the metal slider back and forth. *click click* Pure nostalgia.",
      [Verb.PULL]: "I almost pull the magnetic disk out. BAD IDEA. That would destroy the data.",
      [Verb.CLOSE]: "I slide the metal cover back. Data protected. Old school style.",
      [Verb.GIVE]: "This backup floppy is evidence. Not giving it away.",
    },
    printout: {
      [Verb.OPEN]: "I unfold the thermal paper. Transaction hashes, timestamps, and... a small map section.",
      [Verb.TALK]: "I read the hashes aloud. '0x7f3a...' This is not light reading material.",
      [Verb.PUSH]: "The thermal paper curls back up. It wants to be a scroll. Who am I to argue?",
      [Verb.PULL]: "I stretch it out. The ink is already fading. Like most altcoin roadmaps.",
      [Verb.CLOSE]: "I roll it up carefully. Evidence preservation 101.",
      [Verb.GIVE]: "This printout maps directly to Adrian's activities. Keeping it close.",
    },
    monkey_sticker: {
      [Verb.OPEN]: "It's a sticker. Flat by definition. But the three-headed monkey winks at me.",
      [Verb.TALK]: "'How appropriate, you fight like a cow.' The monkey doesn't get the reference.",
      [Verb.PUSH]: "I press it against my arm. It sticks! Then falls off. Quality adhesive.",
      [Verb.PULL]: "I peel the backing. Shiny. Where should I stick it? Decisions, decisions...",
      [Verb.CLOSE]: "You can't close a sticker. You can only appreciate its beauty.",
      [Verb.GIVE]: "A genuine three-headed monkey sticker? This is priceless. Well, worthless. But priceless to me.",
    },
    server_log: {
      [Verb.OPEN]: "I scan the log entries. Timestamps, error codes, and someone's desperate 3 AM debugging session.",
      [Verb.TALK]: "'Access denied at 03:47, 03:48, 03:49...' Someone was persistent. Or desperate.",
      [Verb.PUSH]: "I scroll through the data. Page after page of server screams.",
      [Verb.PULL]: "I pull up the last entries. 'CRITICAL: FloorEngine heartbeat lost'. Ominous.",
      [Verb.CLOSE]: "I close the log. Some things are better left unread at night.",
      [Verb.GIVE]: "Server logs are like diaries. You don't share them.",
    },
    burned_chip: {
      [Verb.OPEN]: "The chip's casing is cracked. Inside: scorched silicon and broken dreams.",
      [Verb.TALK]: "'What happened to you?' The burnt chip remains silent. It's seen things.",
      [Verb.PUSH]: "I press it. A tiny piece crumbles off. This server died hard.",
      [Verb.PULL]: "I try to straighten the bent pins. Some damage is irreversible. Like rug pulls.",
      [Verb.CLOSE]: "I wrap it carefully. Evidence of AdrianAuctions' final moments.",
      [Verb.GIVE]: "A burnt chip from a dead server. Not exactly a crowd-pleaser.",
    },
    sign_in_sheet: {
      [Verb.OPEN]: "Names and diagnoses: 'Chronic Airdrop Dependency', 'Acute Rug Pull Trauma'. These people need help.",
      [Verb.TALK]: "I read the names aloud. Some of these wallet addresses... I recognize them from the chain.",
      [Verb.PUSH]: "I flatten the crinkled paper. Coffee stains obscure some entries. Classic clinic aesthetic.",
      [Verb.PULL]: "I pull out the second page. More patients. The clinic was busy.",
      [Verb.CLOSE]: "I fold the sheet. Patient privacy matters. Even in DeFi.",
      [Verb.GIVE]: "Medical records? I'll hold onto these for now.",
    },
    patient_file: {
      [Verb.OPEN]: "The file is encrypted. The cover reads: 'PATIENT ZERO — CLASSIFIED'. I need a way to decrypt it.",
      [Verb.TALK]: "'Tell me your secrets.' The classified file maintains its silence. Professional.",
      [Verb.PUSH]: "I press the folder. Thick. Multiple pages inside. Whatever Patient Zero is, it's well-documented.",
      [Verb.PULL]: "I try to pry it open. The encryption seal holds. Old school security.",
      [Verb.CLOSE]: "I put it away. When the time comes, this file will reveal everything.",
      [Verb.GIVE]: "A classified patient file? I need to read this myself first.",
    },
    dr_satoshi_badge: {
      [Verb.OPEN]: "I flip the badge over. 'If found, please return to the blockchain.' Cute.",
      [Verb.TALK]: "'Dr. Satoshi, I presume?' The badge says nothing. The name says everything.",
      [Verb.PUSH]: "I press the clip. It springs open. Sturdy. Like the pseudonym itself.",
      [Verb.PULL]: "The lanyard stretches. 'Chief of Decentralized Medicine'. Is that even a real title?",
      [Verb.CLOSE]: "I clip it shut. Dr. Satoshi's identity remains a mystery. As tradition demands.",
      [Verb.GIVE]: "A badge belonging to the mysterious Dr. Satoshi? This stays with me.",
    },
    clinic_photo: {
      [Verb.OPEN]: "I turn the photo over. Written on the back: 'Grand Opening — Day 1. We will help them all.'",
      [Verb.TALK]: "I study the faces. Hopeful smiles. They really believed they could cure crypto addiction.",
      [Verb.PUSH]: "I press the glossy surface. Old photograph. Before the clinic got... complicated.",
      [Verb.PULL]: "I hold it up to the light. Wait — is that Adrian in the background? Hard to tell.",
      [Verb.CLOSE]: "I put the photo away. History captured in a single frame.",
      [Verb.GIVE]: "A piece of the clinic's history. Better in my pocket than on the wall.",
    },
    adrian_note: {
      [Verb.OPEN]: "I unfold the note carefully. Adrian's handwriting: 'If you're reading this, you already know the truth.'",
      [Verb.TALK]: "I read aloud: 'Patient Zero was never who you thought.' Chills. Literal chills.",
      [Verb.PUSH]: "I press the wrinkled paper flat. The ink smudges slightly. Be more careful.",
      [Verb.PULL]: "I hold it up. The light reveals faint writing on the back. More clues?",
      [Verb.CLOSE]: "I fold it. Adrian's final message. The weight of it is metaphorical but heavy.",
      [Verb.GIVE]: "Adrian's personal note? This is between me and the mystery now.",
    },
    rubber_duck: {
      [Verb.OPEN]: "Solid rubber. No hidden compartment. No secret USB drive. Just duck.",
      [Verb.TALK]: "*squeak* That's its entire vocabulary. And honestly? More articulate than most whitepapers.",
      [Verb.PUSH]: "*squeak squeak* Stop it. *squeak* I said stop. *squeeeak*",
      [Verb.PULL]: "I stretch the duck. It bounces back. Resilient. Unlike my portfolio.",
      [Verb.CLOSE]: "It's a duck. It's always closed. And always judging.",
      [Verb.GIVE]: "Nobody wants my rubber duck. Their loss.",
    },
    receipt: {
      [Verb.OPEN]: "I unfold it. '1 BTC @ $3.50 — Thank you for your purchase!' Someone. Should. Have. Held.",
      [Verb.TALK]: "'Three dollars and fifty cents.' I need a moment. *deep breath*",
      [Verb.PUSH]: "I crumple it in rage. Then carefully unflatten it. This is a historical artifact.",
      [Verb.PULL]: "I stretch it out. The thermal ink is fading. Like the memory of cheap Bitcoin.",
      [Verb.CLOSE]: "I fold it gently. A monument to missed opportunities everywhere.",
      [Verb.GIVE]: "This receipt would make anyone cry. I'll spare them the pain.",
    },
    broken_mouse: {
      [Verb.OPEN]: "I pop the shell open. Inside: a dusty scroll wheel and the ghost of a million right-clicks.",
      [Verb.TALK]: "'Click?' Nothing. 'Double-click?' Silence. It has clicked its last click.",
      [Verb.PUSH]: "The left button still depresses. *faint click* A ghost click. Spooky.",
      [Verb.PULL]: "The severed cable dangles. What violence happened here? Who severs a mouse cable?",
      [Verb.CLOSE]: "I snap the shell back together. Rest in pixels, little mouse.",
      [Verb.GIVE]: "A broken mouse with a severed cable? That's not a gift. That's a threat.",
    },
  };

  private renderInventory(): void {
    if (!this.invContainer) return;
    this.invContainer.removeAll(true);
    if (!this.inventory) return;

    const items = this.inventory.getItems();
    const { width } = this.scene.scale;

    // TWP-style: exactly 2 rows of square icon tiles, no text labels
    const slotSize = Math.max(44, Math.min(64, Math.floor(width * 0.05)));
    const gap = 4;
    const availableW = width * 0.40;
    const cols = Math.max(2, Math.floor(availableW / (slotSize + gap)));
    const rows = 2; // TWP always uses 2 rows
    const maxVisible = cols * rows;
    const visible = items.slice(this.invScrollOffset * cols, this.invScrollOffset * cols + maxVisible);

    // Only render slots that have items (no empty placeholders — TWP style)
    visible.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (slotSize + gap);
      const y = row * (slotSize + gap);

      // Dark tile background
      const slot = this.scene.add.rectangle(
        x + slotSize / 2, y + slotSize / 2,
        slotSize, slotSize,
        TWP.INV_SLOT_BG, 0.9
      ).setStrokeStyle(1, TWP.INV_SLOT_BORDER, 0.4)
        .setInteractive({ useHandCursor: true });

      // Item icon: sprite if available, then emoji, then first-letter
      const spriteKey = `item_${item.id}`;
      let icon: Phaser.GameObjects.Image | Phaser.GameObjects.Text;
      if (this.scene.textures.exists(spriteKey)) {
        const img = this.scene.add.image(x + slotSize / 2, y + slotSize / 2, spriteKey).setOrigin(0.5);
        const maxDim = slotSize - 6;
        img.setScale(Math.min(maxDim / img.width, maxDim / img.height));
        icon = img;
      } else {
        const iconText = item.icon || item.name.charAt(0).toUpperCase();
        icon = this.scene.add.text(x + slotSize / 2, y + slotSize / 2, iconText, {
          fontFamily: FONT.FAMILY,
          fontSize: `${Math.floor(slotSize * 0.4)}px`,
          color: TWP.INV_ITEM_TEXT,
        }).setOrigin(0.5);
      }

      // Hover: show name in action line, highlight border
      slot.on('pointerover', () => {
        slot.setStrokeStyle(1, TWP.INV_SLOT_SELECT, 0.9);
        if (icon instanceof Phaser.GameObjects.Text) icon.setColor(TWP.INV_ITEM_HOVER);
        this.setHoveredObject(item.name);
      });
      slot.on('pointerout', () => {
        slot.setStrokeStyle(1, TWP.INV_SLOT_BORDER, 0.4);
        if (icon instanceof Phaser.GameObjects.Text) icon.setColor(TWP.INV_ITEM_TEXT);
        this.setHoveredObject(null);
      });
      slot.on('pointerdown', () => this.selectInventoryItem(item));

      this.invContainer.add([slot, icon]);
    });
  }

  getPanelHeight(): number { return this.panelHeight; }
  isExpanded(): boolean { return !this.collapsed; }

  destroy(): void {
    this.container.destroy();
  }
}

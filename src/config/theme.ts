/**
 * Thimbleweed Park visual theme.
 * Single source of truth for all UI colors, fonts, and layout constants.
 */

// ─── Color Palette ─────────────────────────────────────────
export const TWP = {
  // Panel — pure black, seamless with scene (no border, no separator)
  PANEL_BG:         0x000000,
  PANEL_BG_ALPHA:   1.0,
  PANEL_BORDER:     0x000000,
  PANEL_BORDER_ALPHA: 0,
  SEPARATOR:        0x000000,

  // Verbs
  VERB_NORMAL:      '#8878a8',
  VERB_HOVER:       '#c0b0d8',
  VERB_ACTIVE:      '#f8e848',

  // Action / sentence line
  ACTION_LINE:      '#f8f0e0',

  // Inventory
  INV_ITEM_TEXT:    '#8878a8',
  INV_ITEM_HOVER:   '#f8e848',
  INV_SLOT_BG:     0x10101a,
  INV_SLOT_BORDER:  0x2a2a40,
  INV_SLOT_SELECT:  0xf8e848,
  INV_ARROW:        '#504878',
  INV_ARROW_HOVER:  '#f8e848',
  INV_BADGE_BG:     '#f8e848',
  INV_BADGE_TEXT:    '#08080f',

  // Dialogue
  DIALOGUE_SPEAKER: '#f8e848',
  DIALOGUE_TEXT:    '#f0e8d8',
  DIALOGUE_STROKE:  '#000000',

  // Choice panel (dialogue options)
  CHOICE_ENABLED:   '#48d8e8',
  CHOICE_HOVER:     '#80f0ff',
  CHOICE_USED:      '#304858',
  CHOICE_DISABLED:  '#383848',
  CHOICE_BG:        0x08080f,
  CHOICE_BORDER:    0x1a2a38,

  // VerbWheel (mobile)
  WHEEL_BACKDROP:   0x08080f,
  WHEEL_BTN_BG:     0x12121e,
  WHEEL_BTN_BORDER: 0x504878,
  WHEEL_BTN_HOVER:  0x1a1a30,
  WHEEL_BTN_HOVER_BORDER: 0xf8e848,
  WHEEL_LABEL:      '#8878a8',
  WHEEL_LABEL_HOVER:'#f8e848',
  WHEEL_HOTSPOT:    '#f8e848',

  // Action hint tooltip
  HINT_TEXT:        '#c0b0d8',
  HINT_BG:         'rgba(8,8,15,0.75)',
  HINT_STROKE:     '#1a1a2e',

  // Wallet button
  WALLET_BG:        0x08080f,
  WALLET_BORDER:    0x2a2a40,
  WALLET_BORDER_ON: 0xf8e848,
  WALLET_TEXT:      '#8878a8',

  // Menu scene
  MENU_BG:         '#06060c',
  MENU_TITLE:      '#f8e848',
  MENU_SUBTITLE:   '#504878',
  MENU_BTN:        '#8878a8',
  MENU_BTN_HOVER:  '#f8e848',

  // Scene title
  SCENE_TITLE:     '#f8e848',

  // Loading screen (HTML)
  LOADING_BG:      '#06060c',
  LOADING_TEXT:    '#504878',
  LOADING_TITLE:   '#f8e848',

  // Debug (keep distinct)
  DEBUG_WALK:       0x00ff00,
  DEBUG_HOTSPOT:    0xffff00,
  DEBUG_TRIGGER:    0xff00ff,
  DEBUG_SPAWN:      0xff0000,
} as const;

// ─── Typography ────────────────────────────────────────────
export const FONT = {
  /** Primary pixel font — loaded via Google Fonts in index.html */
  FAMILY: '"Press Start 2P", cursive',
  /** Fallback for larger text that needs readability */
  FAMILY_READABLE: '"Press Start 2P", "Courier New", monospace',
} as const;

// ─── Layout Constants ──────────────────────────────────────
export const LAYOUT = {
  /** Minimum panel height in pixels */
  PANEL_MIN_HEIGHT: 140,
  /** Panel height as fraction of viewport (landscape) */
  PANEL_RATIO_LANDSCAPE: 0.22,
  /** Panel height as fraction of viewport (portrait) */
  PANEL_RATIO_PORTRAIT: 0.20,
  /** Verb grid: always 3 columns x 3 rows */
  VERB_COLS: 3,
  VERB_ROWS: 3,
  /** Inventory drawer height as fraction of viewport */
  INV_DRAWER_RATIO: 0.28,
} as const;

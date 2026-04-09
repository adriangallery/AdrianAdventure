import Phaser from 'phaser';
import { BootScene } from '@/scenes/BootScene';
import { MenuScene } from '@/scenes/MenuScene';
import { PreloadScene } from '@/scenes/PreloadScene';
import { GameScene } from '@/scenes/GameScene';
import { UIScene } from '@/scenes/UIScene';

export const MASK_COLORS = {
  WALKABLE: '#0000FF',
  HOTSPOT: '#FFFF00',
  TRIGGER: '#FF00FF',
} as const;

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: '100%',
    height: '100%',
  },
  scene: [BootScene, MenuScene, PreloadScene, GameScene, UIScene],
  render: {
    pixelArt: true,
    antialias: false,
  },
  input: {
    activePointers: 2,
  },
};

export const PLAYER_DEFAULTS = {
  SPEED: 280,
  SIZE: 37,
  COLOR: 0x00ff00,
} as const;

export const DEFAULT_SCENE_ID = 'outside';

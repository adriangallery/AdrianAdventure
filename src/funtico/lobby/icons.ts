/**
 * F1.5: iconos en píxel dibujados por código (texturas generadas con Graphics; sin emojis ni fuentes de iconos).
 * Cada icono es un mapa de 8×8 («#» = píxel encendido) que se pinta a escala entera.
 */
import Phaser from 'phaser';
import { C } from '../ui';

export type IconId = 'crown' | 'list' | 'gear' | 'back' | 'help' | 'left' | 'right' | 'close';

const MAPS: Record<IconId, string[]> = {
  crown: ['........', '#..##..#', '#..##..#', '##.##.##', '########', '########', '........', '########'],
  list: ['........', '#.######', '........', '#.######', '........', '#.######', '........', '........'],
  gear: ['.....#..', '########', '.....#..', '..#.....', '########', '..#.....', '......#.', '########'],
  back: ['....#...', '...#....', '..#.....', '.#######', '.#######', '..#.....', '...#....', '....#...'],
  left: ['....##..', '...##...', '..##....', '.##.....', '.##.....', '..##....', '...##...', '....##..'],
  right: ['..##....', '...##...', '....##..', '.....##.', '.....##.', '....##..', '...##...', '..##....'],
  help: ['..####..', '.##..##.', '.....##.', '....##..', '...##...', '...##...', '........', '...##...'],
  close: ['##....##', '.##..##.', '..####..', '...##...', '..####..', '.##..##.', '##....##', '........'],
};

export const ICON_SCALE = 3;

/** Clave de textura del icono (la crea la primera vez). */
export function iconTexture(scene: Phaser.Scene, id: IconId, color: number = C.yellowN): string {
  const key = `f15-icon-${id}-${color.toString(16)}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(color, 1);
  MAPS[id].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect(x * ICON_SCALE, y * ICON_SCALE, ICON_SCALE, ICON_SCALE);
  });
  g.generateTexture(key, 8 * ICON_SCALE, 8 * ICON_SCALE);
  g.destroy();
  return key;
}

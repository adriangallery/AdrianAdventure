/**
 * Generate placeholder background PNGs for new scenes.
 *
 * Usage:
 *   npm install canvas   (one-time, from project root)
 *   node scripts/generate-placeholders.js
 *
 * Creates 1536x1024 pixel-art style placeholder backgrounds with a
 * color fill, label text, and simple decorative elements for each scene.
 *
 * If the `canvas` package is not installed it falls back to generating
 * minimal valid PNGs using raw binary (solid color, no text).
 */

const fs = require('fs');
const path = require('path');

const SCENES_DIR = path.join(__dirname, '..', 'assets', 'scenes');
const WIDTH = 1536;
const HEIGHT = 1024;

const scenes = [
  {
    id: 'clinic_interior',
    label: 'Clinic Reception',
    bgColor: '#e8e8e8',
    accentColor: '#4a9e6e',
    description: 'Sterile white reception - motivational posters, chairs, filing cabinet',
  },
  {
    id: 'server_room',
    label: 'Server Room',
    bgColor: '#1a1a2e',
    accentColor: '#00ff41',
    description: 'Dark room with green LEDs, server racks, terminal',
  },
  {
    id: 'rooftop',
    label: 'Rooftop',
    bgColor: '#0d1b2a',
    accentColor: '#778da9',
    description: 'Night sky, satellite dish, antenna array, city lights below',
  },
  {
    id: 'treatment_room',
    label: 'Treatment Room',
    bgColor: '#2b2b2b',
    accentColor: '#ff4444',
    description: 'Dim room - single chair, monitor, wall charts',
  },
];

// --------------- canvas-based generator ---------------

function generateWithCanvas() {
  const { createCanvas } = require('canvas');

  for (const scene of scenes) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background fill
    ctx.fillStyle = scene.bgColor;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Subtle grid (pixel art vibe)
    ctx.strokeStyle = scene.accentColor + '22';
    ctx.lineWidth = 1;
    for (let x = 0; x < WIDTH; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
    }
    for (let y = 0; y < HEIGHT; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
    }

    // Scene label
    ctx.fillStyle = scene.accentColor;
    ctx.font = 'bold 72px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(scene.label.toUpperCase(), WIDTH / 2, HEIGHT / 2 - 30);

    // Description
    ctx.font = '28px monospace';
    ctx.fillStyle = scene.accentColor + 'aa';
    ctx.fillText(scene.description, WIDTH / 2, HEIGHT / 2 + 30);

    // "PLACEHOLDER" watermark
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = scene.accentColor + '44';
    ctx.fillText('[ PLACEHOLDER ]', WIDTH / 2, HEIGHT / 2 + 90);

    // Floor line (walkable area hint)
    ctx.strokeStyle = '#0000FF44';
    ctx.lineWidth = 2;
    const floorY = HEIGHT * 0.75;
    ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(WIDTH, floorY); ctx.stroke();
    ctx.fillStyle = '#0000FF11';
    ctx.fillRect(0, floorY, WIDTH, HEIGHT - floorY);

    // Write PNG
    const outPath = path.join(SCENES_DIR, scene.id, 'background.png');
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buffer);
    console.log(`  [OK] ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
  }
}

// --------------- fallback: minimal PNG (no dependencies) ---------------

function generateMinimalPNG() {
  // Generates a valid but simple solid-color PNG using raw binary.
  // No text, just the bg color. Good enough as a placeholder.
  console.log('  (canvas package not found — generating minimal solid-color PNGs)');
  console.log('  Install canvas for nicer placeholders: npm install canvas\n');

  for (const scene of scenes) {
    const outPath = path.join(SCENES_DIR, scene.id, 'background.png');

    // Parse hex color
    const hex = scene.bgColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Build a minimal valid PNG with PLTE + tRNS for indexed color
    // Using a 1x1 image scaled by the viewer (PNG doesn't scale, but it's a placeholder)
    // Actually let's create a proper-sized image using IDAT with filtered scanlines

    // For simplicity, create a small valid PNG and note the real size in metadata
    // The game loader will stretch it to fit the 1536x1024 world anyway
    const png = createSolidPNG(WIDTH, HEIGHT, r, g, b);
    fs.writeFileSync(outPath, png);
    console.log(`  [OK] ${outPath} (${(png.length / 1024).toFixed(1)} KB) — solid ${scene.bgColor}`);
  }
}

function createSolidPNG(width, height, r, g, b) {
  const zlib = require('zlib');

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk — 8-bit indexed color (type 3), one palette entry
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 3;  // color type: indexed
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // PLTE chunk — single color
  const plte = Buffer.from([r, g, b]);
  const plteChunk = makeChunk('PLTE', plte);

  // IDAT chunk — each scanline: filter byte (0) + width bytes of index 0
  const scanline = Buffer.alloc(width + 1, 0); // filter=0, all pixels=index 0
  const rawData = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    scanline.copy(rawData, y * (width + 1));
  }
  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, plteChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  // Standard CRC-32 for PNG
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// --------------- main ---------------

console.log('Generating placeholder backgrounds for new scenes...\n');

try {
  require.resolve('canvas');
  generateWithCanvas();
} catch (e) {
  generateMinimalPNG();
}

console.log('\nDone! Replace these with real pixel art backgrounds later.');
console.log('Each background should be 1536x1024 PNG pixel art.');

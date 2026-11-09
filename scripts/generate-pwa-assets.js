const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC_DIR = path.join(__dirname, '../public');

// --- Helper: pure Node PNG generator with RGBA buffer ---
function createPng(width, height, colorFn) {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = colorFn(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      raw[pixelOffset] = r;
      raw[pixelOffset + 1] = g;
      raw[pixelOffset + 2] = b;
      raw[pixelOffset + 3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// 1. Generate icon.svg
const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b" />
      <stop offset="50%" stop-color="#312e81" />
      <stop offset="100%" stop-color="#4f46e5" />
    </linearGradient>
    <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#f59e0b" />
    </linearGradient>
    <linearGradient id="docGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#e0e7ff" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.5" />
    </filter>
  </defs>

  <!-- Background rounded rect -->
  <rect x="24" y="24" width="464" height="464" rx="104" fill="url(#bgGrad)" filter="url(#shadow)" />
  <!-- Inner subtle border -->
  <rect x="24" y="24" width="464" height="464" rx="104" fill="none" stroke="#818cf8" stroke-width="4" stroke-opacity="0.4" />

  <!-- Document / CV Emblem -->
  <g transform="translate(136, 120)">
    <rect x="0" y="0" width="180" height="250" rx="16" fill="url(#docGrad)" filter="url(#shadow)" />
    <!-- Header banner in doc -->
    <rect x="16" y="20" width="90" height="14" rx="4" fill="#4f46e5" />
    <rect x="16" y="44" width="148" height="6" rx="3" fill="#94a3b8" />
    <rect x="16" y="60" width="130" height="6" rx="3" fill="#cbd5e1" />
    <rect x="16" y="76" width="140" height="6" rx="3" fill="#cbd5e1" />
    
    <rect x="16" y="100" width="70" height="10" rx="3" fill="#10b981" />
    <rect x="16" y="120" width="148" height="6" rx="3" fill="#94a3b8" />
    <rect x="16" y="136" width="120" height="6" rx="3" fill="#cbd5e1" />
    
    <rect x="16" y="160" width="80" height="10" rx="3" fill="#6366f1" />
    <rect x="16" y="180" width="148" height="6" rx="3" fill="#cbd5e1" />
    <rect x="16" y="196" width="135" height="6" rx="3" fill="#cbd5e1" />
  </g>

  <!-- Golden Lightning Bolt (Speed, Real-Time Fintech & Offline Power) -->
  <polygon points="320,100 240,260 295,260 250,400 370,230 310,230" fill="url(#boltGrad)" filter="url(#shadow)" stroke="#d97706" stroke-width="3" />
</svg>
`;

fs.writeFileSync(path.join(PUBLIC_DIR, 'icon.svg'), iconSvg);
console.log('✓ Created public/icon.svg');

// Color shader for brand icons
function brandShader(x, y, w, h, isMaskable = false) {
  const cx = w / 2;
  const cy = h / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Background gradient: from deep indigo (#1e1b4b) to royal violet (#4f46e5)
  const gradT = (x + y) / (w + h);
  const bgR = Math.round(30 + gradT * (79 - 30));
  const bgG = Math.round(27 + gradT * (70 - 27));
  const bgB = Math.round(75 + gradT * (229 - 75));

  // If not maskable, we round the outer corners with a squircle/rounded rect
  if (!isMaskable) {
    const radius = w * 0.22;
    const qx = Math.max(Math.abs(dx) - (w / 2 - radius), 0);
    const qy = Math.max(Math.abs(dy) - (h / 2 - radius), 0);
    const cornerDist = Math.sqrt(qx * qx + qy * qy);
    if (cornerDist > radius) {
      return [0, 0, 0, 0]; // Transparent outer
    }
  }

  // Safe scale factor: maskable icons keep symbols inside central 65% safe zone
  const scale = isMaskable ? 0.65 : 0.85;
  const ndx = dx / (w * scale);
  const ndy = dy / (h * scale);

  // Draw Document Shape (-0.35 to 0.15 X, -0.4 to 0.4 Y)
  const docLeft = -0.32;
  const docRight = 0.12;
  const docTop = -0.36;
  const docBottom = 0.36;

  let isDoc = ndx >= docLeft && ndx <= docRight && ndy >= docTop && ndy <= docBottom;
  if (isDoc) {
    // Document background: crisp white to light silver
    const docT = (ndy - docTop) / (docBottom - docTop);
    const dr = Math.round(255 - docT * 15);
    const dg = Math.round(255 - docT * 12);
    const db = Math.round(255);

    // Subtle blue document lines
    if (ndx >= docLeft + 0.05 && ndx <= docRight - 0.05) {
      // Line 1: Header banner
      if (ndy >= -0.28 && ndy <= -0.24 && ndx <= -0.05) {
        return [79, 70, 229, 255]; // Indigo bar
      }
      // Line 2 & 3: Content
      if (ndy >= -0.19 && ndy <= -0.17) return [148, 163, 184, 255];
      if (ndy >= -0.14 && ndy <= -0.12) return [203, 213, 225, 255];
      if (ndy >= -0.09 && ndy <= -0.07) return [203, 213, 225, 255];
      // Line 4: Green accent bar
      if (ndy >= -0.01 && ndy <= 0.03 && ndx <= -0.1) return [16, 185, 129, 255];
      if (ndy >= 0.07 && ndy <= 0.09) return [148, 163, 184, 255];
      if (ndy >= 0.13 && ndy <= 0.15) return [203, 213, 225, 255];
      // Line 5: Section 3
      if (ndy >= 0.22 && ndy <= 0.25 && ndx <= -0.08) return [99, 102, 241, 255];
      if (ndy >= 0.29 && ndy <= 0.31) return [203, 213, 225, 255];
    }
    return [dr, dg, db, 255];
  }

  // Draw Lightning Bolt:
  // Vertices approx: (0.15, -0.40) -> (-0.05, -0.02) -> (0.08, -0.02) -> (-0.02, 0.38) -> (0.28, -0.06) -> (0.14, -0.06) -> cycle
  function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const v0x = cx - ax, v0y = cy - ay;
    const v1x = bx - ax, v1y = by - ay;
    const v2x = px - ax, v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return (u >= 0) && (v >= 0) && (u + v < 1);
  }

  const inBolt1 = pointInTriangle(ndx, ndy, 0.16, -0.40, -0.06, -0.02, 0.10, -0.02);
  const inBolt2 = pointInTriangle(ndx, ndy, -0.06, -0.02, 0.10, -0.02, -0.04, 0.38);
  const inBolt3 = pointInTriangle(ndx, ndy, 0.10, -0.02, 0.28, -0.08, 0.14, -0.08);
  const inBolt4 = pointInTriangle(ndx, ndy, 0.10, -0.02, 0.28, -0.08, -0.04, 0.38);

  if (inBolt1 || inBolt2 || inBolt3 || inBolt4) {
    // Golden amber lightning gradient
    const boltT = (ndy + 0.4) / 0.8;
    const br = Math.round(251 - boltT * 10);
    const bg = Math.round(191 - boltT * 40);
    const bb = Math.round(36 + boltT * 2);
    return [br, bg, bb, 255];
  }

  return [bgR, bgG, bgB, 255];
}

// Generate PNG icons
const pwa192 = createPng(192, 192, (x, y, w, h) => brandShader(x, y, w, h, false));
fs.writeFileSync(path.join(PUBLIC_DIR, 'pwa-192x192.png'), pwa192);
console.log('✓ Created public/pwa-192x192.png (', pwa192.length, 'bytes)');

const pwa512 = createPng(512, 512, (x, y, w, h) => brandShader(x, y, w, h, false));
fs.writeFileSync(path.join(PUBLIC_DIR, 'pwa-512x512.png'), pwa512);
console.log('✓ Created public/pwa-512x512.png (', pwa512.length, 'bytes)');

const pwaMaskable512 = createPng(512, 512, (x, y, w, h) => brandShader(x, y, w, h, true));
fs.writeFileSync(path.join(PUBLIC_DIR, 'pwa-maskable-512x512.png'), pwaMaskable512);
console.log('✓ Created public/pwa-maskable-512x512.png (', pwaMaskable512.length, 'bytes)');

const appleTouch = createPng(180, 180, (x, y, w, h) => brandShader(x, y, w, h, false));
fs.writeFileSync(path.join(PUBLIC_DIR, 'apple-touch-icon.png'), appleTouch);
console.log('✓ Created public/apple-touch-icon.png (', appleTouch.length, 'bytes)');

console.log('PWA icon assets generation complete!');

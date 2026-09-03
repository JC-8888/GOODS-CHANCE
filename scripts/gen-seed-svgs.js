// Generates the pastel emoji illustrations used by seed items (regenerable).
// Usage: node scripts/gen-seed-svgs.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'images', 'seed');

const defs = [
  ['bookshelf', '📚', '#e4efe8'],
  ['lamp', '🛋️', '#eef2dc'],
  ['vase', '🏺', '#f3e8e2'],
  ['bike', '🚲', '#e3f0f5'],
  ['backpack', '🎒', '#ece3f2'],
  ['jacket', '🧥', '#e2e9f5'],
  ['microwave', '📦', '#f0e9db'],
  ['books', '📖', '#fbeede']
];

const svg = (emoji, bg) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
  <rect width="640" height="480" fill="${bg}"/>
  <circle cx="540" cy="70" r="110" fill="#ffffff" opacity="0.45"/>
  <circle cx="90" cy="420" r="60" fill="#ffffff" opacity="0.3"/>
  <text x="320" y="316" font-size="190" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
</svg>
`;

const defaultSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
  <rect width="640" height="480" fill="#e4efe8"/>
  <circle cx="320" cy="240" r="110" fill="none" stroke="#1e9a6f" stroke-width="46"/>
  <circle cx="320" cy="240" r="34" fill="#1e9a6f"/>
</svg>
`;

fs.mkdirSync(OUT, { recursive: true });
for (const [name, emoji, bg] of defs) {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg(emoji, bg));
  console.log('✓', `${name}.svg`);
}
fs.writeFileSync(path.join(OUT, 'default.svg'), defaultSvg);
console.log('✓ default.svg');

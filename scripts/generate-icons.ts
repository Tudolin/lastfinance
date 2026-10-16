/** Gera os ícones PNG do PWA a partir do SVG da marca (seta de tendência sobre verde-petróleo). */
import sharp from 'sharp';

const svg = (size: number, pad: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${pad === 0 ? 22 : 0}" fill="#0B6E55"/>
  <g transform="translate(${50 - 30 * (1 - pad)},${50 - 30 * (1 - pad)}) scale(${(1 - pad) * 2.5})">
    <path d="M4 17l5-5 4 4 7-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg(192, 0)))
  .png()
  .toFile('public/icons/icon-192.png');
await sharp(Buffer.from(svg(512, 0)))
  .png()
  .toFile('public/icons/icon-512.png');
// maskable: o conteúdo precisa caber no círculo seguro (80%), então mais margem e sem cantos arredondados
await sharp(Buffer.from(svg(512, 0.2)))
  .png()
  .toFile('public/icons/icon-maskable-512.png');
await sharp(Buffer.from(svg(180, 0)))
  .png()
  .toFile('public/icons/apple-touch-icon.png');
await sharp(Buffer.from(svg(32, 0)))
  .png()
  .toFile('public/favicon.png');
console.log('Ícones gerados.');

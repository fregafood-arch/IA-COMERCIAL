import { mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const stage = resolve('dist/widget-package');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp('widget', stage, { recursive: true });
await mkdir(stage + '/images', { recursive: true });
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, sum]);
}
// A simple original monogram; no company artwork or existing project assets.
function icon(width, height) {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  const size = Math.min(width, height), left = (width - size) / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = (x - left) / size, ny = y / height;
    const mark = nx > .36 && nx < .64 && ny > .22 && ny < .78 || nx > .24 && nx < .76 && (ny > .18 && ny < .28 || ny > .72 && ny < .82);
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    rows.set(mark ? [242, 250, 248, 255] : [11, 73, 79, 255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [name, width, height] of [ ['logo.png',130,100], ['logo_main.png',400,272], ['logo_min.png',84,84],
  ['logo_medium.png',240,84], ['logo_small.png',108,108], ['logo_dp.png',174,109] ]) {
  await writeFile(stage + '/images/' + name, icon(width, height));
}
const archive = resolve('dist/kommo-widget.zip');
await rm(archive, { force: true });
const result = spawnSync('zip', ['-qr', archive, '.'], { cwd: stage, stdio: 'inherit' });
if (result.status !== 0) throw new Error('Could not package widget; install the zip command.');
console.log('Created dist/kommo-widget.zip (no credentials).');

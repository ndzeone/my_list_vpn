'use strict';
/**
 * Генерирует assets/icon.png и assets/icon.ico без внешних зависимостей —
 * только встроенный zlib. Рисуем простой значок в цветах приложения:
 * чёрный фон со скруглёнными углами и оранжевое кольцо-«тоннель».
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const BLACK = [10, 10, 11];
const ORANGE = [255, 122, 26];

function buildPixels() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outerR = SIZE * 0.34;
  const innerR = SIZE * 0.22;
  const dotR = SIZE * 0.09;
  const cornerR = SIZE * 0.18;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;

      // Скругление углов фона (альфа-маска).
      let alpha = 255;
      const nearestCornerDist = cornerDistance(x, y, cornerR);
      if (nearestCornerDist > cornerR) alpha = 0;

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let color = BLACK;
      if (dist <= dotR) {
        color = ORANGE;
      } else if (dist >= innerR && dist <= outerR) {
        color = ORANGE;
      }

      px[idx] = color[0];
      px[idx + 1] = color[1];
      px[idx + 2] = color[2];
      px[idx + 3] = alpha;
    }
  }
  return px;
}

function cornerDistance(x, y, r) {
  // Возвращает 0 внутри «безопасной» области (не у угла), иначе расстояние
  // от центра ближайшей скругляющей окружности радиуса r.
  const corners = [
    [r, r],
    [SIZE - r, r],
    [r, SIZE - r],
    [SIZE - r, SIZE - r],
  ];
  let inCornerBox = false;
  let d = 0;
  for (const [ccx, ccy] of corners) {
    const inX = (ccx === r && x < r) || (ccx === SIZE - r && x > SIZE - r);
    const inY = (ccy === r && y < r) || (ccy === SIZE - r && y > SIZE - r);
    if (inX && inY) {
      inCornerBox = true;
      d = Math.sqrt((x - ccx) ** 2 + (y - ccy) ** 2);
    }
  }
  return inCornerBox ? d : 0;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });
  const idat = chunk('IDAT', idatData);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function encodeIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 0 = 256
  entry[1] = 0; // height 0 = 256
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32BE(0, 8); // placeholder, set below (LE actually)
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12); // offset

  return Buffer.concat([header, entry, pngBuffer]);
}

function main() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const pixels = buildPixels();
  const png = encodePng(pixels, SIZE);
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);

  const ico = encodeIco(png);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), ico);

  console.log('Иконки сгенерированы: assets/icon.png, assets/icon.ico');
}

main();

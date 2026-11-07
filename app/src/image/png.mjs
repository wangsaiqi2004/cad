// @ts-check
/**
 * 最小 PNG 生成与图片可解码性检查（零依赖，仅用 node:zlib）。
 * 用途：① 测试替身返回的可解码小图；② 生图结果写入前的格式校验；
 *       ③ 程序生成布局参考图（优先用 CAD 视图，这里提供兜底）。
 * @module image/png
 */

import { deflateSync } from 'node:zlib';
import { crc32 } from '../core/crc32.mjs';

/** @param {string} type @param {Buffer} data @returns {Buffer} */
function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * 生成一张纯色 / 简单网格的 RGB PNG。
 * @param {number} width
 * @param {number} height
 * @param {(x:number,y:number)=>[number,number,number]} [pixel]
 * @returns {Buffer}
 */
export function createPng(width, height, pixel) {
  const w = Math.max(1, Math.min(4096, Math.floor(width)));
  const h = Math.max(1, Math.min(4096, Math.floor(height)));
  const colorAt = pixel || ((x, y) => (((x >> 4) + (y >> 4)) % 2 === 0 ? [235, 238, 242] : [205, 214, 226]));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolor RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  /** @type {Buffer[]} */
  const rows = [];
  for (let y = 0; y < h; y += 1) {
    const row = Buffer.alloc(1 + w * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = colorAt(x, y);
      const offset = 1 + x * 3;
      row[offset] = r & 0xFF;
      row[offset + 1] = g & 0xFF;
      row[offset + 2] = b & 0xFF;
    }
    rows.push(row);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 检查一段 Buffer 是否是可解码的 PNG 或 JPEG（只做格式与最小结构校验，不做像素解码）。
 * @param {Buffer} buffer
 * @returns {{ok:boolean,format:'png'|'jpeg'|null,reason?:string}}
 */
export function isDecodableImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) return { ok: false, format: null, reason: '数据过短或不是 Buffer' };
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (buffer.subarray(0, 8).equals(png)) {
    if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return { ok: false, format: 'png', reason: '缺少 IHDR' };
    // IEND chunk = length(4) + type(4) + crc(4)，共 12 字节；type 位于倒数第 8..4 字节。
    const end = buffer.subarray(buffer.length - 8, buffer.length - 4).toString('ascii');
    if (end !== 'IEND') return { ok: false, format: 'png', reason: '缺少 IEND' };
    return { ok: true, format: 'png' };
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[buffer.length - 2] === 0xFF && buffer[buffer.length - 1] === 0xD9) {
    return { ok: true, format: 'jpeg' };
  }
  return { ok: false, format: null, reason: '不是 PNG / JPEG' };
}

/** @param {Buffer} buffer @returns {string} data URL */
export function toDataUrl(buffer) {
  const info = isDecodableImage(buffer);
  const mime = info.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

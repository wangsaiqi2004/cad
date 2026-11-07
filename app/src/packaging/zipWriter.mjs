// @ts-check
/**
 * 最小 ZIP（store 模式，无压缩）写出器，零依赖。
 * 用标准 local file header + central directory + EOCD，Windows 资源管理器 / 常见解压工具可打开。
 * @module packaging/zipWriter
 */

import { crc32 } from '../core/crc32.mjs';

const LOCAL_HEADER = 0x04034B50;
const CENTRAL_HEADER = 0x02014B50;
const EOCD = 0x06054B50;
// 固定 DOS 时间（1980-01-01 00:00）便于产物可复现；UTF-8 文件名标志位 0x0800。
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const FLAGS = 0x0800;

/**
 * @param {Array<{name:string,data:Buffer}>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  /** @type {Buffer[]} */
  const localParts = [];
  /** @type {Buffer[]} */
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(FLAGS, 6);    // flags: UTF-8 names
    local.writeUInt16LE(0, 8);        // method: store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);       // extra length
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4);     // version made by
    central.writeUInt16LE(20, 6);     // version needed
    central.writeUInt16LE(FLAGS, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);     // extra
    central.writeUInt16LE(0, 32);     // comment
    central.writeUInt16LE(0, 34);     // disk start
    central.writeUInt16LE(0, 36);     // internal attrs
    central.writeUInt32LE(0, 38);     // external attrs
    central.writeUInt32LE(offset, 42);// local header offset
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localData, centralData, end]);
}

/** 简单校验 ZIP 结构（EOCD 签名与条目数），用于验收。 @param {Buffer} buffer */
export function verifyZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return { ok: false, reason: '数据过短' };
  const signature = buffer.readUInt32LE(0);
  if (signature !== LOCAL_HEADER) return { ok: false, reason: '缺少 local file header' };
  // EOCD 固定在末尾 22 字节。
  const eocdOffset = buffer.length - 22;
  if (buffer.readUInt32LE(eocdOffset) !== EOCD) return { ok: false, reason: '缺少 EOCD' };
  const count = buffer.readUInt16LE(eocdOffset + 10);
  return { ok: true, entries: count, bytes: buffer.length };
}

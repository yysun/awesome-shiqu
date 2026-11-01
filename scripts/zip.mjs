// Read bounded ZIP entries in memory for imports; never extract archive paths to disk.
import {inflateRawSync} from 'node:zlib';
import {assert, LIMITS, safeArchivePath} from './content.mjs';

const table = Uint32Array.from({length: 256}, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
const decoder = new TextDecoder('utf-8', {fatal: true});
function filename(bytes) {
  try { return safeArchivePath(decoder.decode(bytes)); }
  catch (error) { throw new Error(`ZIP 文件名无效：${error.message}`); }
}
function bounds(bytes, offset, count) {
  assert(Number.isSafeInteger(offset) && offset >= 0 && count >= 0 && offset + count <= bytes.length, 'ZIP 数据不完整。');
}

// Read only STORE/DEFLATE archives in memory. Never extract archive paths to disk.
export function readZip(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= LIMITS.archiveBytes,
    'ZIP 为空、损坏或超过 256 MiB。');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset; break;
    }
  }
  assert(end !== -1, '未找到有效 ZIP 目录；请从拾趣重新导出。');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  assert(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === count,
    '不支持分卷 ZIP。');
  assert(count > 0 && count <= LIMITS.entries && size !== 0xffffffff && start !== 0xffffffff,
    'ZIP 文件数量超限，或使用了不支持的 ZIP64。');
  assert(start + size === end, 'ZIP 目录长度不一致。');
  let cursor = start, total = 0;
  const records = [], names = new Set(), ranges = [];
  for (let i = 0; i < count; i++) {
    bounds(bytes, cursor, 46);
    assert(bytes.readUInt32LE(cursor) === 0x02014b50, 'ZIP 中央目录损坏。');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20), expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38), local = bytes.readUInt32LE(cursor + 42);
    assert(bytes.readUInt16LE(cursor + 34) === 0 && expanded !== 0xffffffff && compressed !== 0xffffffff && local !== 0xffffffff,
      '不支持分卷或 ZIP64 条目。');
    assert((flags & ~(0x800 | 8 | 2 | 4)) === 0, '不支持加密或特殊编码的 ZIP。');
    assert(method === 0 || method === 8, 'ZIP 只能使用普通存储或 Deflate 压缩。');
    const mode = external >>> 16 & 0xf000;
    assert(mode === 0 || mode === 0x8000 || mode === 0x4000, 'ZIP 不能包含符号链接或特殊文件。');
    bounds(bytes, cursor + 46, nameLength + extraLength + commentLength);
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = filename(rawName);
    const normalized = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    assert(!names.has(normalized), `ZIP 中存在重复或大小写冲突的文件：${name}`);
    names.add(normalized);
    assert(expanded <= (name === '分镜.md' || name === '故事.json' ? LIMITS.markdownBytes : LIMITS.imageBytes), `ZIP 文件过大：${name}`);
    total += expanded;
    assert(total <= LIMITS.archiveBytes, 'ZIP 解压后的总大小超过 256 MiB。');
    bounds(bytes, local, 30);
    assert(local < start && bytes.readUInt32LE(local) === 0x04034b50, 'ZIP 本地文件头损坏。');
    assert(bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method, 'ZIP 文件头与目录不一致。');
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    bounds(bytes, local + 30, localNameLength + localExtraLength);
    assert(rawName.equals(bytes.subarray(local + 30, local + 30 + localNameLength)), 'ZIP 文件名在目录与文件头之间不一致。');
    if (!(flags & 8)) assert(bytes.readUInt32LE(local + 14) === crc && bytes.readUInt32LE(local + 18) === compressed && bytes.readUInt32LE(local + 22) === expanded,
      'ZIP 文件大小或校验信息不一致。');
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    assert(dataEnd <= start, 'ZIP 文件数据超出存储区。');
    for (const [a, b] of ranges) assert(dataEnd <= a || local >= b, 'ZIP 文件数据相互重叠。');
    ranges.push([local, dataEnd]);
    assert(!name.endsWith('/') || expanded === 0, 'ZIP 文件夹不能包含数据。');
    records.push({name, method, crc, compressed, expanded, dataStart, dataEnd});
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert(cursor === end, 'ZIP 目录条目数量不一致。');
  const files = new Map();
  for (const record of records) {
    let data = bytes.subarray(record.dataStart, record.dataEnd);
    if (record.method === 0) assert(record.compressed === record.expanded, '未压缩 ZIP 条目的大小不一致。');
    else {
      try { data = inflateRawSync(data, {maxOutputLength: record.expanded + 1}); }
      catch { throw new Error(`ZIP 压缩数据损坏或超过声明大小：${record.name}`); }
    }
    assert(data.length === record.expanded && crc32(data) === record.crc, `ZIP 校验失败：${record.name}`);
    if (!record.name.endsWith('/')) files.set(record.name, data);
  }
  return files;
}

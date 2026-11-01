// Portable ZIP reader for Node and modern browsers. Files remain in memory;
// archive paths are never written to disk or used as network addresses.
export const ZIP_LIMITS = Object.freeze({
  archiveBytes: 25 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  imageBytes: 12 * 1024 * 1024,
  markdownBytes: 1024 * 1024,
  entries: 200,
  pages: 80,
});

function assert(condition, message) { if (!condition) throw new Error(message); }

export function safeArchivePath(value) {
  assert(typeof value === 'string' && value && value.length <= 500 && !/[\u0000-\u001f\u007f\\]/.test(value), 'ZIP 中含有无效文件名。');
  assert(!value.startsWith('/') && !/^[a-z]:/i.test(value), 'ZIP 中不能使用绝对路径。');
  const clean = value.endsWith('/') ? value.slice(0, -1) : value;
  assert(clean && clean.split('/').every(part => part && part !== '.' && part !== '..'), 'ZIP 中不能包含空路径、. 或 .. 路径段。');
  return value;
}

const crcTable = Uint32Array.from({length: 256}, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = new TextDecoder('utf-8', {fatal: true});
function filename(bytes) {
  try { return safeArchivePath(utf8.decode(bytes)); }
  catch (error) { throw new Error(`ZIP 文件名无效：${error.message}`); }
}

function bounds(bytes, offset, count) {
  assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(count) && count >= 0 && offset + count <= bytes.length, 'ZIP 数据不完整。');
}

function equalBytes(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }

async function inflate(bytes, size, name) {
  let decompressor;
  try { decompressor = new DecompressionStream('deflate-raw'); }
  catch { throw new Error('当前浏览器不支持 ZIP 解压，请使用较新版本的 Chrome、Edge、Firefox 或 Safari。'); }
  const reader = new Blob([bytes]).stream().pipeThrough(decompressor).getReader();
  const output = new Uint8Array(size);
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      assert(length + value.length <= size, `ZIP 压缩数据超过声明大小：${name}`);
      output.set(value, length);
      length += value.length;
    }
    assert(length === size, `ZIP 解压长度不一致：${name}`);
    return output;
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error(`ZIP 压缩数据损坏或超过声明大小：${name}`);
  } finally { reader.releaseLock(); }
}

export async function readZip(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  assert(bytes instanceof Uint8Array && bytes.length >= 22 && bytes.length <= ZIP_LIMITS.archiveBytes, 'ZIP 为空、损坏或超过 25 MiB。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  assert(end !== -1, '未找到有效 ZIP 目录；请从拾趣重新导出。');
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  assert(u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === count, '不支持分卷 ZIP。');
  assert(count > 0 && count <= ZIP_LIMITS.entries && size !== 0xffffffff && start !== 0xffffffff, 'ZIP 文件数量超限，或使用了不支持的 ZIP64。');
  assert(start + size === end, 'ZIP 目录长度不一致。');
  let cursor = start, total = 0;
  const records = [], names = new Set(), ranges = [];
  for (let i = 0; i < count; i++) {
    bounds(bytes, cursor, 46);
    assert(cursor + 46 <= end && u32(cursor) === 0x02014b50, 'ZIP 中央目录损坏。');
    const flags = u16(cursor + 8), method = u16(cursor + 10);
    const crc = u32(cursor + 16), compressed = u32(cursor + 20), expanded = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const external = u32(cursor + 38), local = u32(cursor + 42);
    assert(u16(cursor + 34) === 0 && expanded !== 0xffffffff && compressed !== 0xffffffff && local !== 0xffffffff, '不支持分卷或 ZIP64 条目。');
    assert((flags & ~(0x800 | 8 | 2 | 4)) === 0, '不支持加密或特殊编码的 ZIP。');
    assert(method === 0 || method === 8, 'ZIP 只能使用普通存储或 Deflate 压缩。');
    const mode = external >>> 16 & 0xf000;
    assert(mode === 0 || mode === 0x8000 || mode === 0x4000, 'ZIP 不能包含符号链接或特殊文件。');
    bounds(bytes, cursor + 46, nameLength + extraLength + commentLength);
    assert(cursor + 46 + nameLength + extraLength + commentLength <= end, 'ZIP 目录条目超出中央目录。');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = filename(rawName);
    const normalized = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    assert(!names.has(normalized), `ZIP 中存在重复或大小写冲突的文件：${name}`);
    names.add(normalized);
    assert(expanded <= (name === '分镜.md' || /\.(?:md|txt|json)$/i.test(name) ? ZIP_LIMITS.markdownBytes : ZIP_LIMITS.imageBytes), `ZIP 文件过大：${name}`);
    total += expanded;
    assert(total <= ZIP_LIMITS.expandedBytes, 'ZIP 解压后的总大小超过 256 MiB。');
    bounds(bytes, local, 30);
    assert(local < start && u32(local) === 0x04034b50, 'ZIP 本地文件头损坏。');
    assert(u16(local + 6) === flags && u16(local + 8) === method, 'ZIP 文件头与目录不一致。');
    const localNameLength = u16(local + 26), localExtraLength = u16(local + 28);
    bounds(bytes, local + 30, localNameLength + localExtraLength);
    assert(equalBytes(rawName, bytes.subarray(local + 30, local + 30 + localNameLength)), 'ZIP 文件名在目录与文件头之间不一致。');
    if (!(flags & 8)) assert(u32(local + 14) === crc && u32(local + 18) === compressed && u32(local + 22) === expanded, 'ZIP 文件大小或校验信息不一致。');
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    assert(dataEnd <= start, 'ZIP 文件数据超出存储区。');
    let recordEnd = dataEnd;
    if (flags & 8) {
      bounds(bytes, dataEnd, 12);
      const descriptor = dataEnd + (u32(dataEnd) === 0x08074b50 ? 4 : 0);
      bounds(bytes, descriptor, 12);
      assert(u32(descriptor) === crc && u32(descriptor + 4) === compressed && u32(descriptor + 8) === expanded, 'ZIP 数据描述符与目录不一致。');
      recordEnd = descriptor + 12;
      assert(recordEnd <= start, 'ZIP 数据描述符超出存储区。');
    }
    for (const [a, b] of ranges) assert(recordEnd <= a || local >= b, 'ZIP 文件数据相互重叠。');
    ranges.push([local, recordEnd]);
    assert(!name.endsWith('/') || expanded === 0, 'ZIP 文件夹不能包含数据。');
    records.push({name, method, crc, compressed, expanded, dataStart, dataEnd});
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert(cursor === end, 'ZIP 目录条目数量不一致。');
  const files = new Map();
  for (const record of records) {
    let data = bytes.subarray(record.dataStart, record.dataEnd);
    if (record.method === 0) assert(record.compressed === record.expanded, '未压缩 ZIP 条目的大小不一致。');
    else data = await inflate(data, record.expanded, record.name);
    assert(data.length === record.expanded && crc32(data) === record.crc, `ZIP 校验失败：${record.name}`);
    if (!record.name.endsWith('/')) files.set(record.name, data);
  }
  return files;
}

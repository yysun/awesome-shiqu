// 仅将当前来源中已验证的公开字段和引用图片原字节写入内容哈希目录。
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MAX_PUBLIC_MANIFEST_BYTES} from '../site/assets/story-publication.mjs';
import {assert, validateManifest, validateImageName} from './content.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const publicJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function imageDimensions(input) {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let width, height;
  if (b.toString('ascii', 12, 16) === 'IHDR') { width = b.readUInt32BE(16); height = b.readUInt32BE(20); }
  else if (b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = b.readUInt16BE(i);
      if (length < 2 || i + length > b.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        height = b.readUInt16BE(i + 3); width = b.readUInt16BE(i + 5); break;
      }
      i += length;
    }
  } else if (b.toString('ascii', 8, 12) === 'WEBP') {
    for (let i = 12; i + 8 <= b.length;) {
      const kind = b.toString('ascii', i, i + 4), length = b.readUInt32LE(i + 4), start = i + 8;
      if (start + length > b.length) break;
      if (kind === 'VP8X' && length >= 10) { width = 1 + b.readUIntLE(start + 4, 3); height = 1 + b.readUIntLE(start + 7, 3); break; }
      if (kind === 'VP8 ' && length >= 10 && b.toString('hex', start + 3, start + 6) === '9d012a') { width = b.readUInt16LE(start + 6) & 0x3fff; height = b.readUInt16LE(start + 8) & 0x3fff; break; }
      if (kind === 'VP8L' && length >= 5 && b[start] === 0x2f) { const bits = b.readUInt32LE(start + 1); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; break; }
      i = start + length + (length % 2);
    }
  }
  assert(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 40000000, '图片尺寸无效或过大。');
  return {width, height};
}

export function preparePublication(story) {
  const manifest = validateManifest(story.manifest);
  const images = new Map(story.images.map(image => [image.name, image]));
  const pages = manifest.pages.map(page => {
    const image = images.get(page.image); assert(image, '缺少公开画面。');
    validateImageName(Buffer.from(image.bytes), image.name);
    return {...page, sha256: hash(image.bytes), ...imageDimensions(image.bytes)};
  });
  const provenance = story.relativePath ? {sourcePath: story.relativePath, sha256: story.sha256, archiveBytes: story.archiveBytes} : undefined;
  const content = {...manifest, pages, ...(provenance ? {provenance} : {})};
  const version = hash(publicJSON(content));
  const published = {...content, version};
  const directory = `public/${manifest.id}/${version}`;
  const {pages: _pages, sourceText: _text, provenance: _provenance, ...metadata} = published;
  return {manifest: published, images: [...images.values()], directory, entry: {
    ...metadata, pageCount: pages.length, cover: `${directory}/${pages[0].image}`, url: `${directory}/story.json`,
    ...(provenance || {}),
  }};
}

export async function writePublication(staging, publication) {
  const {directory, manifest, images} = publication;
  const folder = path.join(staging, directory);
  await mkdir(path.join(folder, 'images'), {recursive: true});
  let bytes = 0;
  for (const image of images) { await writeFile(path.join(folder, image.name), image.bytes); bytes += image.bytes.length; }
  const json = publicJSON(manifest) + '\n'; assert(Buffer.byteLength(json) <= MAX_PUBLIC_MANIFEST_BYTES, '公开清单超过允许大小。'); await writeFile(path.join(folder, 'story.json'), json);
  return bytes + Buffer.byteLength(json);
}

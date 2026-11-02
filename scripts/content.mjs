// Validate allowlisted public manifests and confine all published files to the story directory.
import {createHash} from 'node:crypto';
import {publicationFields,pagePublicFields,validateAI} from '../site/assets/story-publication.mjs';
import {lstat, readFile, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {validateGenerationModels} from '../site/assets/story-archive.mjs';

export const LIMITS = Object.freeze({
  archiveBytes: 256 * 1024 * 1024,
  imageBytes: 12 * 1024 * 1024,
  markdownBytes: 1024 * 1024,
  entries: 200,
  pages: 80,
  siteBytes: 950 * 1024 * 1024,
});

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateSlug(value) {
  assert(typeof value === 'string' && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    '作品 slug 只能包含小写英文字母、数字和单个连字符，长度不超过 80。');
  return value;
}

export function validateDate(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '发布日期必须为 YYYY-MM-DD。');
  const date = new Date(`${value}T00:00:00.000Z`);
  assert(Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value, '发布日期不是有效日期。');
  return value;
}

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function validateSourceUrl(value) {
  if (!value) return '';
  assert(typeof value === 'string' && value.length <= 2000, '出处链接过长。');
  let url;
  try { url = new URL(value); } catch { throw new Error('出处链接必须是完整的 http 或 https 链接。'); }
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
    '出处链接只允许 http 或 https，不能包含登录凭据。');
  return url.href;
}

export function safeArchivePath(value) {
  assert(typeof value === 'string' && value && value.length <= 500 && !/[\u0000-\u001f\u007f\\]/.test(value),
    'ZIP 中含有无效文件名。');
  assert(!value.startsWith('/') && !/^[a-z]:/i.test(value), 'ZIP 中不能使用绝对路径。');
  const clean = value.endsWith('/') ? value.slice(0, -1) : value;
  assert(clean && clean.split('/').every(part => part && part !== '.' && part !== '..'),
    'ZIP 中不能包含空路径、. 或 .. 路径段。');
  return value;
}

function text(value, name, maximum, optional = false) {
  assert(typeof value === 'string' && value.length <= maximum && !value.includes('\0') && (optional || value.trim()),
    `${name}为空或超过长度限制。`);
  return value.trim();
}

function onlyKeys(value, permitted, name) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${name}必须是对象。`);
  for (const key of Object.keys(value)) assert(permitted.includes(key), `${name}含有不应公开的未知字段：${key}`);
}

export function validateManifest(input, expectedId = input?.id) {
  onlyKeys(input, ['schemaVersion', 'id', 'title', 'hook', 'book', 'theme', 'artStyle', 'author',
    'publishedAt', 'source', 'adaptationNote', 'reflection', 'generationModels', 'storyboardModels', 'aiGenerated', 'pages', 'publication','contributor','sourceText','exportIdentity','aiDisclosure'], '作品清单');
  assert(input.schemaVersion === 1, '作品清单 schemaVersion 必须为 1。');
  const id = validateSlug(input.id);
  assert(id === expectedId, '作品清单 id 必须与文件夹名称相同。');
  onlyKeys(input.source, ['title', 'url'], '出处');
  const sourceTitle = text(input.source.title, '出处标题', 1000);
  assert(input.source.url === undefined || typeof input.source.url === 'string', '出处链接必须是字符串。');
  const sourceUrl = validateSourceUrl(input.source.url ?? '');
  validateAI(input.aiGenerated);
  assert(Array.isArray(input.pages) && input.pages.length >= 1 && input.pages.length <= LIMITS.pages,
    `每篇作品需要 1–${LIMITS.pages} 幅画面。`);
  const paths = new Set();
  const pages = input.pages.map((page, index) => {
    onlyKeys(page, ['image', 'caption','sha256','originalSha256','imagePayloadSha256','watermark'], `第 ${index + 1} 幅`);
    assert(typeof page.image === 'string' && /^images\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/.test(page.image),
      `第 ${index + 1} 幅图片必须位于本作品 images/ 下，使用 PNG、JPEG 或 WebP。`);
    const key = page.image.toLowerCase();
    assert(!paths.has(key), '作品清单含有重复图片路径。');
    paths.add(key);
    return {...pagePublicFields(page),image: page.image, caption: text(page.caption, `第 ${index + 1} 幅旁白`, 3000)};
  });
  return {
    ...publicationFields(input),
    schemaVersion: 1, id,
    title: text(input.title, '标题', 200),
    hook: text(input.hook ?? '', '简介', 2000, true),
    book: text(input.book, '书名', 1000),
    theme: text(input.theme ?? '', '主题', 1000, true),
    artStyle: text(input.artStyle ?? '', '画风', 200, true),
    author: text(input.author, '署名', 120,true),
    publishedAt: validateDate(input.publishedAt),
    source: {title: sourceTitle, ...(sourceUrl ? {url: sourceUrl} : {})},
    adaptationNote: text(input.adaptationNote ?? '', '改编说明', 6000, true),
    reflection: text(input.reflection ?? '', '结语', 3000, true),
    ...(input.generationModels === undefined ? {} : {generationModels: validateGenerationModels(input.generationModels)}),
    ...(input.storyboardModels === undefined ? {} : {storyboardModels: validateGenerationModels(input.storyboardModels)}),
    aiGenerated: input.aiGenerated, pages,
  };
}

export function imageFormat(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMITS.imageBytes,
    '图片为空或超过 12 MiB。');
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    assert(bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR', 'PNG 图片头损坏。');
    assert(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, 'PNG 图片尺寸无效。');
    return 'png';
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    assert(bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217, 'JPEG 图片不完整。');
    return 'jpg';
  }
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    assert(bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16)),
      'WebP 图片头损坏。');
    return 'webp';
  }
  throw new Error('文件不是可识别的 PNG、JPEG 或 WebP 图片。');
}

export function validateImageName(bytes, filename) {
  const type = imageFormat(bytes);
  const ext = path.extname(filename).slice(1).toLowerCase();
  assert(ext === type || type === 'jpg' && ext === 'jpeg', `图片扩展名与实际格式不符：${filename}`);
  return type;
}

export async function regularFile(filename, root, maximum = Infinity) {
  const relative = path.relative(root, filename);
  assert(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative),
    '文件必须位于作品目录内。');
  let current = root;
  const rootStat = await lstat(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), '作品根目录必须是真实文件夹。');
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    assert(!stat.isSymbolicLink(), `不允许发布符号链接：${relative}`);
    if (current !== filename) assert(stat.isDirectory(), `图片路径中的目录无效：${relative}`);
    else assert(stat.isFile() && stat.size <= maximum, `文件类型或大小不符合要求：${relative}`);
  }
  const canonicalRoot = await realpath(root), canonicalFile = await realpath(filename);
  assert(canonicalFile.startsWith(`${canonicalRoot}${path.sep}`), '文件不能指向作品目录之外。');
  return readFile(filename);
}

export async function readLibrary(root, {retainImages = true} = {}) {
  const storiesRoot = path.join(root, 'stories');
  let entries;
  try {
    const stat = await lstat(storiesRoot);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'stories 必须是真实文件夹。');
    entries = await readdir(storiesRoot, {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const stories = [];
  let totalBytes = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'README.md') continue;
    assert(entry.isDirectory() && !entry.isSymbolicLink(), `stories/ 只允许作品文件夹：${entry.name}`);
    validateSlug(entry.name);
    const directory = path.join(storiesRoot, entry.name);
    let input;
    try {
      input = JSON.parse((await regularFile(path.join(directory, 'story.json'), directory, LIMITS.markdownBytes)).toString('utf8'));
    } catch (error) { throw new Error(`${entry.name}/story.json 无法读取：${error.message}`); }
    const manifest = validateManifest(input, entry.name);
    const images = [];
    for (const page of manifest.pages) {
      let bytes;
      try {
        totalBytes += (await lstat(path.join(directory, page.image))).size;
        assert(totalBytes <= LIMITS.siteBytes, '作品图片总量超过 950 MiB，请先压缩或移除大图。');
        bytes = await regularFile(path.join(directory, page.image), directory, LIMITS.imageBytes);
        validateImageName(bytes, page.image);
        assert(!page.sha256||createHash('sha256').update(bytes).digest('hex')===page.sha256,'图片 SHA-256 与声明不符。');
      } catch (error) { throw new Error(`${entry.name}/${page.image}：${error.message}`); }
      if (retainImages) images.push({name: page.image, bytes});
    }
    stories.push({manifest, images});
  }
  return stories.sort((a, b) => b.manifest.publishedAt.localeCompare(a.manifest.publishedAt) || a.manifest.id.localeCompare(b.manifest.id));
}

export function makeCatalog(stories) {
  return {
    schemaVersion: 1,
    stories: stories.map(({manifest}) => {
      const {pages, sourceText: _sourceText, ...metadata} = manifest;
      return {...metadata, pageCount: pages.length, cover: `stories/${manifest.id}/${pages[0].image}`,
        url: `stories/${manifest.id}/story.json`};
    }),
  };
}

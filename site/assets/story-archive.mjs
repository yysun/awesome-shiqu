// Parse public story fields from Shiqu exports without publishing prompts or generation history.
import {readZip, ZIP_LIMITS, safeArchivePath} from './zip.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }
function text(value, label, limit, optional = false) {
  assert(typeof value === 'string' && value.length <= limit && !value.includes('\0') && (optional || value.trim()), `${label}为空或超过长度限制。`);
  return value.trim();
}

export function validateStoryId(value) {
  assert(typeof value === 'string' && value.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(value), '作品 ID 只能包含小写英文字母、数字、连字符，以及作者与作品间的双连字符。');
  return value;
}

function date(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '发布日期必须为 YYYY-MM-DD。');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert(Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, '发布日期不是有效日期。');
  return value;
}

function sourceURL(value) {
  if (!value) return '';
  assert(typeof value === 'string' && value.length <= 2000, '出处链接过长。');
  let url;
  try { url = new URL(value); } catch { throw new Error('出处链接必须是完整的 http 或 https 链接。'); }
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, '出处链接只允许 http 或 https，不能包含登录凭据。');
  return url.href;
}

export function validateGenerationModels(value = []) {
  assert(Array.isArray(value) && value.length <= 1000, '生成模型必须是数组，最多 1000 条。');
  return [...new Set(value.map(model => text(model, '模型名', 200)))];
}

export function parseStoryJSON(input) {
  let data;
  try { data = JSON.parse(input.replace(/^\uFEFF/, '')); }
  catch { throw new Error('故事.json 不是有效的 JSON。'); }
  assert(data && typeof data === 'object' && !Array.isArray(data), '故事.json 必须是对象。');
  assert(Array.isArray(data.pages) && data.pages.length >= 1 && data.pages.length <= ZIP_LIMITS.pages,
    '故事.json 需要 1–80 幅画面。');
  const sourceTitle = text(data.sourceReference, '出处标题', 1000);
  const url = sourceURL(data.sourceUrl === undefined ? '' : text(data.sourceUrl, '出处链接', 2000, true));
  const summary = data.summary === undefined ? data.hook : data.summary;
  let models = [], storyboardModels = [];
  if (data.generationModels !== undefined) {
    assert(Array.isArray(data.generationModels) && data.generationModels.length <= 1000, '故事.json 的生成模型必须是数组，最多 1000 条。');
    models = validateGenerationModels(data.generationModels.map(record => {
      assert(record && typeof record === 'object' && !Array.isArray(record), '故事.json 的生成模型记录必须是对象。');
      return record.model;
    }));
    // Batched exports use "plan" for the outline and "plan:<offset>" for actual storyboards.
    const batches = data.generationModels.filter(record => typeof record.step === 'string' && /^plan:\d+$/.test(record.step));
    const storyboard = batches.length ? batches : data.generationModels.filter(record => record.step === 'plan');
    storyboardModels = validateGenerationModels(storyboard.map(record => record.model));
  }
  return {
    title: text(data.title, '标题', 200), hook: text(summary === undefined ? '' : summary, '简介', 2000, true),
    book: text(data.bookId === undefined ? sourceTitle.match(/《([^》]+)》/)?.[1] || sourceTitle : data.bookId, '书名', 1000),
    theme: text(data.theme === undefined ? '' : data.theme, '主题', 1000, true),
    artStyle: text(data.artStyleLabel === undefined ? '' : data.artStyleLabel, '画风', 200, true),
    source: {title: sourceTitle, ...(url ? {url} : {})},
    reflection: text(data.reflection === undefined ? '' : data.reflection, '结语', 3000, true),
    adaptationNote: text(data.adaptationNote === undefined ? '' : data.adaptationNote, '改编说明', 6000, true),
    ...(models.length ? {generationModels: models} : {}),
    ...(storyboardModels.length ? {storyboardModels} : {}),
    pages: data.pages.map((page, index) => {
      assert(page && typeof page === 'object' && !Array.isArray(page), `第 ${index + 1} 幅必须是对象。`);
      return {image: safeArchivePath(page.image), caption: text(page.caption, `第 ${index + 1} 幅旁白`, 3000)};
    }),
  };
}

export function parseStoryFiles(files) {
  const name = files.has('故事.json') ? '故事.json' : '分镜.md';
  const bytes = files.get(name);
  assert(bytes, 'ZIP 根目录缺少故事.json 或分镜.md；请使用拾趣的“分镜与图片 ZIP”导出。');
  assert(bytes.length <= ZIP_LIMITS.markdownBytes, `${name} 超过 1 MiB。`);
  let input;
  try { input = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw new Error(`${name} 必须使用 UTF-8 编码。`); }
  return name === '故事.json' ? parseStoryJSON(input) : parseStoryboard(input);
}

// Matches the Shiqu “分镜与图片 ZIP” export. Private production/image
// prompt sections are deliberately absent from the returned public fields.
export function parseStoryboard(input) {
  assert(typeof input === 'string' && input.length && !input.includes('\0'), '分镜.md 为空或不是文本。');
  const markdown = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const parts = markdown.split(/^##\s+(.+?)\s*$/m);
  const header = parts[0].trim(), heading = header.match(/^#\s+([^\n]+)\n?/);
  assert(heading, '分镜.md 缺少一级故事标题。');
  const remaining = header.slice(heading[0].length).trim(), metadata = new Map();
  for (const match of remaining.matchAll(/^(主题|出处|出处链接|画风)[：:]\s*(.+)$/gm)) {
    assert(!metadata.has(match[1]), `分镜.md 重复声明${match[1]}。`);
    metadata.set(match[1], match[2].trim());
  }
  const firstMetadata = remaining.search(/^(主题|出处|出处链接|画风)[：:]/m);
  const hook = (firstMetadata < 0 ? remaining : remaining.slice(0, firstMetadata)).trim();
  const pages = [], extras = new Map();
  for (let index = 1; index < parts.length; index += 2) {
    const label = parts[index].trim(), body = (parts[index + 1] || '').trim();
    const frame = label.match(/^第\s*(\d+)\s*幅$/);
    // Unescaped legacy prompts can contain heading-like text. Start only at a
    // complete first frame, and clear candidate endings before each next frame.
    if (!pages.length && !(frame?.[1] === '1' && /^图片[：:]\s*.+$/m.test(body) && /^###\s+旁白\s*$/m.test(body))) continue;
    if (frame) {
      assert(Number(frame[1]) === pages.length + 1, '分镜页码必须从 1 开始连续排列，不能重复或缺页。');
      const sections = body.split(/^###\s+(.+?)\s*$/m);
      const images = [...sections[0].matchAll(/^图片[：:]\s*(.+)$/gm)];
      assert(images.length === 1, `第 ${frame[1]} 幅必须包含唯一的图片路径。`);
      const image = safeArchivePath(images[0][1].trim());
      let caption;
      for (let section = 1; section < sections.length; section += 2) {
        if (sections[section].trim() !== '旁白') continue;
        assert(caption === undefined, `第 ${frame[1]} 幅重复声明旁白。`);
        caption = sections[section + 1]?.trim();
      }
      assert(caption, `第 ${frame[1]} 幅缺少旁白。`);
      extras.clear();
      pages.push({image, caption});
      assert(pages.length <= ZIP_LIMITS.pages, '作品超过 80 幅画面。');
    } else if (label === '余味' || label === '改编说明') {
      assert(!extras.has(label), `分镜.md 的${label}标题存在歧义；请检查提示词中的同名 Markdown 标题后重新导出。`);
      extras.set(label, body);
    }
  }
  assert(pages.length, '分镜.md 中没有找到画面。');
  const sourceTitle = metadata.get('出处');
  assert(sourceTitle, '分镜.md 缺少出处。');
  return {
    title: heading[1].trim(), hook, theme: metadata.get('主题') || '', artStyle: metadata.get('画风') || '',
    book: sourceTitle.match(/《([^》]+)》/)?.[1] || sourceTitle,
    source: {title: sourceTitle, ...(metadata.get('出处链接') ? {url: metadata.get('出处链接')} : {})},
    reflection: extras.get('余味') || '', adaptationNote: extras.get('改编说明') || '', pages,
  };
}

function imageFormat(bytes, name) {
  assert(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= ZIP_LIMITS.imageBytes, '图片为空或超过 12 MiB。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  let format;
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    assert(view.getUint32(8) === 13 && ascii(12, 16) === 'IHDR', 'PNG 图片头损坏。');
    const width = view.getUint32(16), height = view.getUint32(20);
    assert(width > 0 && height > 0, 'PNG 图片尺寸无效。');
    assert(width <= 16384 && height <= 16384 && width * height <= 40000000,
      'PNG 图片尺寸过大：每边最多 16384 像素，总像素最多 4000 万。');
    format = 'png';
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    assert(bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217, 'JPEG 图片不完整。');
    format = 'jpg';
  } else if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    assert(view.getUint32(4, true) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 16)), 'WebP 图片头损坏。');
    format = 'webp';
  }
  assert(format, '文件不是可识别的 PNG、JPEG 或 WebP 图片。');
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  assert(extension === format || format === 'jpg' && extension === 'jpeg', `图片扩展名与实际格式不符：${name}`);
  return {format, mime: format === 'jpg' ? 'image/jpeg' : `image/${format}`};
}

export async function parseStoryArchive(bytes, options = {}) {
  // Validate caller-owned identity before allocating or decompressing content.
  const id = validateStoryId(options.id), author = text(options.author, '署名', 120), publishedAt = date(options.publishedAt);
  const files = await readZip(bytes), parsed = parseStoryFiles(files), images = [], used = new Set();
  const pages = parsed.pages.map((page, index) => {
    const key = page.image.normalize('NFC').toLowerCase();
    assert(!used.has(key), '分镜中重复引用了同一张图片。'); used.add(key);
    const data = files.get(page.image);
    assert(data, `ZIP 缺少第 ${index + 1} 幅图片：${page.image}`);
    const {format, mime} = imageFormat(data, page.image);
    const image = `images/${String(index + 1).padStart(2, '0')}.${format}`;
    images.push({name: image, bytes: data, mime});
    return {image, caption: text(page.caption, `第 ${index + 1} 幅旁白`, 3000)};
  });
  const url = sourceURL(options.sourceUrl || parsed.source.url);
  const manifest = {
    schemaVersion: 1, id, title: text(parsed.title, '标题', 200), hook: text(parsed.hook, '简介', 2000, true),
    book: text(options.book || parsed.book, '书名', 1000), theme: text(parsed.theme, '主题', 1000, true),
    artStyle: text(parsed.artStyle, '画风', 200, true), author, publishedAt,
    source: {title: text(parsed.source.title, '出处标题', 1000), ...(url ? {url} : {})},
    adaptationNote: text(parsed.adaptationNote, '改编说明', 6000, true), reflection: text(parsed.reflection, '结语', 3000, true),
    ...(parsed.generationModels ? {generationModels: parsed.generationModels} : {}),
    ...(parsed.storyboardModels ? {storyboardModels: parsed.storyboardModels} : {}),
    aiGenerated: true, pages,
  };
  return {manifest, images};
}

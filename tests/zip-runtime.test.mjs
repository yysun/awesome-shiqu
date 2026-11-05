// 用合成导出验证浏览器与导入共用的解析器，不发布测试故事。
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readZip, crc32, ZIP_LIMITS } from '../site/assets/zip.mjs';
import { parseStoryArchive, parseStoryboard, parseStoryJSON, validateGenerationModels, validateStoryId } from '../site/assets/story-archive.mjs';
import { prepareStory } from '../scripts/import-story.mjs';
import { validateManifest } from '../scripts/content.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
const SOURCE = `# 螳螂捕蝉

少年用一则故事劝谏吴王。

主题：聪明与糊涂

出处：《说苑·正谏》

出处链接：https://example.org/source

画风：水墨写意

## 制作要求

PRIVATE-PRODUCTION-PROMPT

## 第 1 幅

图片：图片/01.png

### 旁白

吴王准备出兵，少年决定劝谏。

### 画面提示词

PRIVATE-IMAGE-PROMPT-ONE

## 第 2 幅

图片：图片/02.png

### 旁白

螳螂盯着蝉，身后的黄雀也在等待。

### 画面提示词

PRIVATE-IMAGE-PROMPT-TWO

## 余味

看见眼前的利益，也别忘了身后的风险。

## 改编说明

根据古典寓言改编，文字与插画使用 AI 辅助制作。
`;
const OPTIONS = { id: 'alice--tang-lang', author: 'alice', publishedAt: '2026-11-01' };
const JSON_STORY = {
  id: 'public-local-id', title: 'JSON 故事', hook: '从结构化数据读故事。', bookId: '说苑', theme: '聪明与糊涂',
  sourceReference: '《说苑·正谏》', sourceUrl: 'https://example.org/json-source', artStyleLabel: '水墨写意',
  sourceText: '保存的公开原文', productionPrompt: 'PRIVATE-PRODUCTION-PROMPT',
  generationModels: [
    { step: 'plan:0', model: ' text-model ', notes: 'PRIVATE-GENERATION-NOTES' },
    { step: 'reflection', model: 'text-model' }, { step: 'image:0', model: 'image-model' }, { step: 'image:1', model: 'image-model' },
  ],
  pages: [
    { image: '图片/01.png', caption: '第一幅：## 余味\n<html>只是文本。</html>', prompt: 'PRIVATE-IMAGE-PROMPT' },
    { image: '图片/02.png', caption: '第二幅。', prompt: 'PRIVATE-IMAGE-PROMPT' },
  ],
  reflection: 'JSON 结语。', adaptationNote: 'JSON 改编说明。', revision: 7, createdAt: '2026-11-01T00:00:00.000Z',
};

function zip(entries, { deflate = false, descriptor = false } = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, input] of entries) {
    const rawName = Buffer.from(name), data = Buffer.from(input);
    const compressed = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0, crc = crc32(data), flags = 0x800 | (descriptor ? 8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(rawName.length, 26);
    if (!descriptor) {
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22);
    }
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(rawName.length, 28); directory.writeUInt32LE(offset, 42);
    const suffix = Buffer.alloc(descriptor ? 16 : 0);
    if (descriptor) {
      suffix.writeUInt32LE(0x08074b50); suffix.writeUInt32LE(crc, 4);
      suffix.writeUInt32LE(compressed.length, 8); suffix.writeUInt32LE(data.length, 12);
    }
    locals.push(local, rawName, compressed, suffix); central.push(directory, rawName);
    offset += local.length + rawName.length + compressed.length + suffix.length;
  }
  const localBytes = Buffer.concat(locals), directoryBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, directoryBytes, end]);
}
const entries = () => [['分镜.md', SOURCE], ['图片/', ''], ['图片/01.png', PNG], ['图片/02.png', PNG]];
const storyZip = options => zip(entries(), options);
const jsonZip = (input = JSON.stringify(JSON_STORY), options) => zip([
  ['故事.json', input], ['分镜.md', 'This obsolete Markdown is deliberately invalid.'], ['图片/01.png', PNG], ['图片/02.png', PNG],
], options);
const centralOffset = bytes => bytes.readUInt32LE(bytes.length - 6);

test('portable parser reads UTF-8 STORE exports from a Uint8Array slice and matches the legacy importer', async () => {
  const input = storyZip(), wrapped = Buffer.concat([Buffer.alloc(13), input, Buffer.alloc(7)]);
  const parsed = await parseStoryArchive(new Uint8Array(wrapped.buffer, wrapped.byteOffset + 13, input.length), OPTIONS);
  const legacy = prepareStory(input, { slug: 'tang-lang', author: OPTIONS.author, date: OPTIONS.publishedAt });
  assert.deepEqual(parsed.manifest, { ...legacy.manifest, id: OPTIONS.id });
  assert.equal(JSON.stringify(parsed.manifest).includes('PRIVATE-'), false);
  assert.equal(parsed.images[0].name, 'images/01.png');
  assert.equal(parsed.images[0].mime, 'image/png');
  assert.deepEqual(Buffer.from(parsed.images[1].bytes), PNG);
});

test('browser-compatible decompression reads DEFLATE and streaming data descriptors', async () => {
  for (const descriptor of [false, true]) {
    const bytes = storyZip({ deflate: true, descriptor });
    const parsed = await parseStoryArchive(bytes, OPTIONS);
    assert.equal(parsed.manifest.title, '螳螂捕蝉');
    assert.equal(parsed.manifest.pages.length, 2);
    assert.deepEqual(Buffer.from(parsed.images[0].bytes), PNG);
  }
  const bytes = storyZip();
  const isolated = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal((await readZip(isolated)).size, 3);
});

test('JSON takes precedence over Markdown and shares public fields with the synchronous importer', async () => {
  for (const options of [{}, { deflate: true }, { deflate: true, descriptor: true }]) {
    const bytes = jsonZip(undefined, options), parsed = await parseStoryArchive(bytes, OPTIONS);
    const imported = prepareStory(bytes, { slug: 'tang-lang', author: OPTIONS.author, date: OPTIONS.publishedAt });
    assert.deepEqual(parsed.manifest, { ...imported.manifest, id: OPTIONS.id });
    assert.equal(parsed.manifest.title, JSON_STORY.title);
    assert.equal(parsed.manifest.hook, JSON_STORY.hook);
    assert.equal(parsed.manifest.book, JSON_STORY.bookId);
    assert.equal(parsed.manifest.artStyle, JSON_STORY.artStyleLabel);
    assert.equal(parsed.manifest.source.title, JSON_STORY.sourceReference);
    assert.equal(parsed.manifest.source.url, JSON_STORY.sourceUrl);
    assert.equal(parsed.manifest.reflection, JSON_STORY.reflection);
    assert.equal(parsed.manifest.adaptationNote, JSON_STORY.adaptationNote);
    assert.equal(parsed.manifest.pages[0].caption, JSON_STORY.pages[0].caption);
    assert.deepEqual(parsed.manifest.generationModels, ['text-model', 'image-model']);
    assert.deepEqual(parsed.manifest.storyboardModels, ['text-model']);
    assert.equal(JSON.stringify(parsed.manifest).includes('PRIVATE-'), false);
    assert.equal(JSON.stringify(parsed.manifest).includes('plan:0'), false);
    assert.deepEqual(Buffer.from(parsed.images[0].bytes), PNG);
  }
  const withoutMarkdown = zip([['故事.json', JSON.stringify(JSON_STORY)], ['图片/01.png', PNG], ['图片/02.png', PNG]]);
  assert.equal((await parseStoryArchive(withoutMarkdown, OPTIONS)).manifest.title, JSON_STORY.title);
  const withoutModels = { ...JSON_STORY }; delete withoutModels.generationModels;
  assert.equal(parseStoryJSON(JSON.stringify(withoutModels)).generationModels, undefined);
  assert.equal(parseStoryJSON(JSON.stringify(withoutModels)).storyboardModels, undefined);
  assert.equal((await parseStoryArchive(storyZip(), OPTIONS)).manifest.generationModels, undefined);
  assert.equal((await parseStoryArchive(storyZip(), OPTIONS)).manifest.storyboardModels, undefined);
});

test('image credits use the last saved model for each current frame across preview and import', async () => {
  for (const [history, expected] of [
    [[{step: 'image:0', model: 'old-image'}, {step: 'image:1', model: 'old-image'},
      {step: 'image:0', model: 'new-image'}, {step: 'image:1', model: 'new-image'}], ['text-model', 'new-image']],
    [[{step: 'image:0', model: 'old-image'}, {step: 'image:1', model: 'old-image'},
      {step: 'image:0', model: 'new-image'}], ['text-model', 'new-image', 'old-image']],
    [[{step: 'image:1', model: 'first-image'}, {step: 'image:0', model: 'new-image'},
      {step: 'image:1', model: 'last-image'}, {step: 'image:0', model: 'new-image'}], ['text-model', 'last-image', 'new-image']],
    [[{step: 'image:2', model: 'removed-frame'}, {step: 'image:99', model: 'removed-frame'}], ['text-model']],
    [[{model: 'legacy-model'}, {step: 'image:unknown', model: 'unspecified-model'}], ['text-model', 'legacy-model', 'unspecified-model']],
  ]) {
    const data = {...JSON_STORY, generationModels: [{step: 'plan:0', model: 'text-model'}, ...history]};
    const input = JSON.stringify(data), bytes = jsonZip(input);
    const preview = await parseStoryArchive(bytes, OPTIONS);
    const imported = prepareStory(bytes, {slug: 'tang-lang', author: OPTIONS.author});
    for (const story of [parseStoryJSON(input), preview.manifest, imported.manifest]) {
      assert.deepEqual(story.generationModels, expected);
      assert.deepEqual(story.storyboardModels, ['text-model']);
      assert.equal(JSON.stringify(story).includes('image:0'), false);
    }
  }
  const input = JSON.stringify({...JSON_STORY, generationModels: [
    {step: 'image:0', model: ''}, {step: 'image:0', model: 'valid-image'},
  ]});
  assert.throws(() => parseStoryJSON(input), /模型名/);
  await assert.rejects(parseStoryArchive(jsonZip(input), OPTIONS), /模型名/);
});

test('JSON summary and legacy hook normalize to the existing public hook field', async () => {
  const { hook, ...base } = JSON_STORY;
  for (const [fields, expected] of [
    [{ summary: '  新版简介。  ' }, '新版简介。'],
    [{ hook }, hook],
    [{ summary: '新版简介。', hook }, '新版简介。'],
    [{ summary: '', hook }, ''],
    [{ summary: '   ', hook }, ''],
    [{}, ''],
    [{ summary: '字'.repeat(2000) }, '字'.repeat(2000)],
    [{ summary: '<img src=x onerror=alert(1)>' }, '<img src=x onerror=alert(1)>'],
  ]) {
    const input = JSON.stringify({ ...base, ...fields }), bytes = jsonZip(input);
    const parsed = await parseStoryArchive(bytes, OPTIONS);
    const imported = prepareStory(bytes, { slug: 'tang-lang', author: OPTIONS.author, date: OPTIONS.publishedAt });
    for (const story of [parseStoryJSON(input), parsed.manifest, imported.manifest]) {
      assert.equal(story.hook, expected);
      assert.equal(Object.hasOwn(story, 'summary'), false);
    }
  }
});

test('invalid JSON summary is rejected instead of silently using legacy hook', async () => {
  for (const summary of [null, 7, {}, [], '字'.repeat(2001), '无效\0简介']) {
    const input = JSON.stringify({ ...JSON_STORY, summary }), bytes = jsonZip(input);
    assert.throws(() => parseStoryJSON(input), /简介/);
    await assert.rejects(parseStoryArchive(bytes, OPTIONS), /简介/);
    assert.throws(() => prepareStory(bytes, { slug: 'tang-lang', author: OPTIONS.author }), /简介/);
  }
});

test('storyboard credits use batch models rather than outline, reflection, review, or image models', async () => {
  const data = {
    ...JSON_STORY, generationModels: [
      { step: 'plan', model: 'outline-model' }, { step: 'recommend', model: 'recommend-model' },
      { step: 'plan:0', model: ' storyboard-a ' }, { step: 'plan:20', model: 'storyboard-b' }, { step: 'plan:40', model: 'storyboard-a' },
      { step: 'reflection', model: 'ending-model' }, { step: 'review:0', model: 'review-model' }, { step: 'image:0', model: 'image-model' },
    ]
  };
  const parsed = await parseStoryArchive(jsonZip(JSON.stringify(data)), OPTIONS);
  assert.deepEqual(parsed.manifest.storyboardModels, ['storyboard-a', 'storyboard-b']);
  assert.deepEqual(parseStoryJSON(JSON.stringify({ ...JSON_STORY, generationModels: [{ step: 'plan', model: 'legacy-model' }] })).storyboardModels,
    ['legacy-model']);
  for (const records of [[], [{ step: 'image:0', model: 'image-model' }], [{ model: 'unspecified-model' }], [{ step: 'plan:unknown', model: 'unknown-model' }]]) {
    assert.equal(parseStoryJSON(JSON.stringify({ ...JSON_STORY, generationModels: records })).storyboardModels, undefined);
  }
});

test('malformed JSON fails explicitly rather than falling back to Markdown', async () => {
  for (const input of ['{', 'null', '[]', Buffer.from([0xff])]) {
    const bytes = zip([['故事.json', input], ...entries()]);
    await assert.rejects(parseStoryArchive(bytes, OPTIONS), /故事.json/);
    assert.throws(() => prepareStory(bytes, { slug: 'tang-lang', author: OPTIONS.author }), /故事.json/);
  }
  await assert.rejects(parseStoryArchive(zip([['图片/01.png', PNG]]), OPTIONS), /缺少故事.json 或分镜.md/);
  assert.equal(parseStoryJSON('\uFEFF' + JSON.stringify(JSON_STORY)).title, JSON_STORY.title);
});

test('JSON validates public fields, image paths, model records, and exact size limits', async () => {
  const invalid = [
    [{ title: '' }, /标题/], [{ hook: null }, /简介/], [{ sourceReference: '' }, /出处/],
    [{ sourceUrl: 'javascript:alert(1)' }, /http/], [{ pages: [] }, /1–80/],
    [{ pages: Array(81).fill(JSON_STORY.pages[0]) }, /1–80/],
    [{ pages: [null] }, /第 1 幅/], [{ pages: [{ image: '../escape.png', caption: '旁白' }] }, /ZIP/],
    [{ pages: [{ image: '图片/01.png', caption: 'a'.repeat(3001) }] }, /旁白/],
    [{ generationModels: null }, /生成模型/], [{ generationModels: ['text-model'] }, /记录/],
    [{ generationModels: [{ model: 7 }] }, /模型名/], [{ generationModels: [{ model: '' }] }, /模型名/],
    [{ generationModels: [{ model: 'm'.repeat(201) }] }, /模型名/],
    [{ generationModels: Array(1001).fill({ model: 'text-model' }) }, /1000/],
  ];
  for (const [changes, message] of invalid) {
    const input = JSON.stringify({ ...JSON_STORY, ...changes }), bytes = jsonZip(input);
    assert.throws(() => parseStoryJSON(input), message);
    await assert.rejects(parseStoryArchive(bytes, OPTIONS), message);
    assert.throws(() => prepareStory(bytes, { slug: 'tang-lang', author: OPTIONS.author }), message);
  }
  const duplicate = { ...JSON_STORY, pages: [JSON_STORY.pages[0], JSON_STORY.pages[0]] };
  await assert.rejects(parseStoryArchive(jsonZip(JSON.stringify(duplicate)), OPTIONS), /重复引用/);
  const missing = { ...JSON_STORY, pages: [{ image: '图片/missing.png', caption: '缺图' }] };
  await assert.rejects(parseStoryArchive(jsonZip(JSON.stringify(missing)), OPTIONS), /缺少第 1/);
  const oversized = zip([['故事.json', ' '.repeat(ZIP_LIMITS.markdownBytes + 1)], ...entries()]);
  await assert.rejects(parseStoryArchive(oversized, OPTIONS), /过大/);
  assert.throws(() => prepareStory(oversized, { slug: 'tang-lang', author: OPTIONS.author }), /过大/);
  assert.equal(parseStoryJSON(JSON.stringify({ ...JSON_STORY, generationModels: [{ model: 'm'.repeat(200) }] })).generationModels[0].length, 200);
  assert.equal(parseStoryJSON(JSON.stringify({ ...JSON_STORY, pages: [{ image: '图片/01.png', caption: 'a'.repeat(3000) }] })).pages[0].caption.length, 3000);
});

test('public manifests retain only validated model names while legacy manifests remain unchanged', () => {
  const manifest = prepareStory(storyZip(), { slug: 'tang-lang', author: OPTIONS.author }).manifest;
  assert.deepEqual(validateManifest({ ...manifest, generationModels: [' text-model ', 'text-model', 'image-model'] }).generationModels,
    ['text-model', 'image-model']);
  assert.equal(validateManifest(manifest).generationModels, undefined);
  assert.deepEqual(validateManifest({ ...manifest, storyboardModels: [' storyboard-model ', 'storyboard-model'] }).storyboardModels,
    ['storyboard-model']);
  assert.equal(validateManifest(manifest).storyboardModels, undefined);
  assert.deepEqual(validateGenerationModels(['<img src=x onerror=alert(1)>']), ['<img src=x onerror=alert(1)>']);
  for (const value of [null, 'model', [7], [''], ['m'.repeat(201)], Array(1001).fill('model')]) {
    assert.throws(() => validateManifest({ ...manifest, generationModels: value }), /模型/);
    assert.throws(() => validateManifest({ ...manifest, storyboardModels: value }), /模型/);
  }
});

test('ZIP parser refuses traversal, malformed UTF-8, case collisions, special files, and encryption', async () => {
  for (const name of ['../escape.png', '/escape.png', 'C:/escape.png', 'images/../../escape.png', 'images\\escape.png', 'images//escape.png', Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(readZip(zip([[name, PNG]])), /ZIP/);
  }
  await assert.rejects(readZip(zip([['A.PNG', PNG], ['a.png', PNG]])), /冲突/);
  await assert.rejects(readZip(zip([['é.png', PNG], ['e\u0301.png', PNG]])), /冲突/);
  const linked = zip([['link.png', PNG]]);
  linked.writeUInt32LE((0xa1ff << 16) >>> 0, centralOffset(linked) + 38);
  await assert.rejects(readZip(linked), /符号链接/);
  const encrypted = zip([['image.png', PNG]]);
  encrypted.writeUInt16LE(0x801, centralOffset(encrypted) + 8);
  await assert.rejects(readZip(encrypted), /加密/);
});

test('ZIP parser rejects corruption, truncated directories, false sizes, and bounded-decompression bombs', async () => {
  const corrupt = storyZip(); corrupt[30 + Buffer.byteLength('分镜.md')] ^= 1;
  await assert.rejects(readZip(corrupt), /校验/);
  await assert.rejects(readZip(storyZip().subarray(0, -1)), /有效 ZIP/);
  const overImage = zip([['image.png', PNG]]);
  overImage.writeUInt32LE(ZIP_LIMITS.imageBytes + 1, centralOffset(overImage) + 24);
  await assert.rejects(readZip(overImage), /过大/);
  const bomb = zip([['image.png', Buffer.alloc(1024 * 1024, 97)]], { deflate: true });
  bomb.writeUInt32LE(2, 22); bomb.writeUInt32LE(2, centralOffset(bomb) + 24);
  await assert.rejects(readZip(bomb), /超过声明大小/);
  const textBomb = zip([['分镜.md', 'small']]);
  textBomb.writeUInt32LE(ZIP_LIMITS.markdownBytes + 1, centralOffset(textBomb) + 24);
  await assert.rejects(readZip(textBomb), /过大/);
  const descriptor = zip([['image.png', PNG]], { deflate: true, descriptor: true });
  descriptor[centralOffset(descriptor) - 12] ^= 1;
  await assert.rejects(readZip(descriptor), /描述符/);
  await assert.rejects(readZip(new Uint8Array(ZIP_LIMITS.archiveBytes + 1)), /100 MiB/);
  await assert.rejects(readZip(zip(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, index) => [`${index}.txt`, '']))), /文件数量/);
});

test('prompt support files are not limited as root story metadata', async () => {
  const name = '提示词/画面提示词.md', prompt = Buffer.alloc(ZIP_LIMITS.markdownBytes + 1, 97);
  const files = await readZip(zip([[name, prompt]]));
  assert.equal(files.get(name).length, prompt.length);
});

test('public fields omit private prompt sections even when legacy prompts include reserved headings', () => {
  const privateHeadings = SOURCE.replace('PRIVATE-PRODUCTION-PROMPT', '## 余味\n\nPRIVATE-END-TEXT\n\n## 第 1 幅\n\nPRIVATE-FRAME-TEMPLATE');
  assert.deepEqual(parseStoryboard(privateHeadings), parseStoryboard(SOURCE));
  const intermediate = SOURCE.replace('PRIVATE-IMAGE-PROMPT-ONE', '## 余味\n\nPRIVATE-INTERMEDIATE-ENDING');
  assert.deepEqual(parseStoryboard(intermediate), parseStoryboard(SOURCE));
  const ambiguous = SOURCE.replace('PRIVATE-IMAGE-PROMPT-TWO', '## 余味\n\nPRIVATE-LAST-ENDING');
  assert.throws(() => parseStoryboard(ambiguous), /歧义/);
  assert.deepEqual(parseStoryboard(SOURCE.replaceAll('\n', '\r\n')), parseStoryboard(SOURCE));
});

test('story parser rejects incomplete exports and preserves safe source and authorship metadata', async () => {
  await assert.rejects(parseStoryArchive(zip([['分镜.md', SOURCE], ['图片/01.png', PNG]]), OPTIONS), /缺少第 2/);
  await assert.rejects(parseStoryArchive(zip([['分镜.md', SOURCE], ['图片/01.png', '<html>invalid</html>'], ['图片/02.png', PNG]]), OPTIONS), /不是可识别/);
  await assert.rejects(parseStoryArchive(storyZip(), { ...OPTIONS, publishedAt: '2026-02-30' }), /有效日期/);
  await assert.rejects(parseStoryArchive(storyZip(), { ...OPTIONS, sourceUrl: 'javascript:alert(1)' }), /http/);
  await assert.rejects(parseStoryArchive(storyZip(), { ...OPTIONS, sourceUrl: 'https://user:secret@example.org' }), /凭据/);
  await assert.rejects(parseStoryArchive(storyZip(), { ...OPTIONS, author: '' }), /署名/);
  await assert.rejects(parseStoryArchive(storyZip(), { ...OPTIONS, id: '../story' }), /作品 ID/);
  const parsed = await parseStoryArchive(storyZip(), { ...OPTIONS, author: '爱读书的人', book: '说苑', sourceUrl: 'https://example.org/new' });
  assert.equal(parsed.manifest.author, '');
  assert.equal(parsed.manifest.contributor, '爱读书的人');
  assert.equal(parsed.manifest.book, '说苑');
  assert.equal(parsed.manifest.source.url, 'https://example.org/new');
  assert.equal(parsed.manifest.aiGenerated, true);
  assert.equal(validateStoryId('github-user--story-slug'), 'github-user--story-slug');
});

test('PNG dimensions cannot request an oversized browser decoding surface', async () => {
  for (const [width, height] of [[16385, 1], [1, 16385], [10000, 5000], [0xffffffff, 0xffffffff]]) {
    const oversized = Buffer.from(PNG);
    oversized.writeUInt32BE(width, 16); oversized.writeUInt32BE(height, 20);
    await assert.rejects(parseStoryArchive(zip([['分镜.md', SOURCE], ['图片/01.png', oversized], ['图片/02.png', PNG]]), OPTIONS), /PNG 图片尺寸过大/);
  }
  assert.equal((await parseStoryArchive(storyZip(), OPTIONS)).images[0].mime, 'image/png');
});

test('STORE exports larger than 25 MiB remain within the aligned 100 MiB archive limit', async () => {
  // Allocate one 26 MiB archive rather than making several copies of a large
  // fixture. STORE output views must share it without copying each file.
  const sizes = [9, 9, 8].map(size => size * 1024 * 1024);
  const names = sizes.map((_, index) => Buffer.from(`images/${index + 1}.bin`));
  const localSize = sizes.reduce((total, size, index) => total + 30 + names[index].length + size, 0);
  const centralSize = names.reduce((total, name) => total + 46 + name.length, 0);
  const bytes = Buffer.alloc(localSize + centralSize + 22);
  let local = 0, central = localSize;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i], name = names[i], start = local + 30 + name.length;
    const checksum = crc32(bytes.subarray(start, start + size));
    bytes.writeUInt32LE(0x04034b50, local); bytes.writeUInt16LE(20, local + 4);
    bytes.writeUInt16LE(0x800, local + 6); bytes.writeUInt32LE(checksum, local + 14);
    bytes.writeUInt32LE(size, local + 18); bytes.writeUInt32LE(size, local + 22);
    bytes.writeUInt16LE(name.length, local + 26); name.copy(bytes, local + 30);
    bytes.writeUInt32LE(0x02014b50, central); bytes.writeUInt16LE(20, central + 4);
    bytes.writeUInt16LE(20, central + 6); bytes.writeUInt16LE(0x800, central + 8);
    bytes.writeUInt32LE(checksum, central + 16); bytes.writeUInt32LE(size, central + 20);
    bytes.writeUInt32LE(size, central + 24); bytes.writeUInt16LE(name.length, central + 28);
    bytes.writeUInt32LE(local, central + 42); name.copy(bytes, central + 46);
    local = start + size; central += 46 + name.length;
  }
  bytes.writeUInt32LE(0x06054b50, central);
  bytes.writeUInt16LE(sizes.length, central + 8); bytes.writeUInt16LE(sizes.length, central + 10);
  bytes.writeUInt32LE(centralSize, central + 12); bytes.writeUInt32LE(localSize, central + 16);
  assert.equal(ZIP_LIMITS.archiveBytes, 100 * 1024 * 1024);
  assert.ok(bytes.length > 25 * 1024 * 1024 && bytes.length < ZIP_LIMITS.archiveBytes);
  const files = await readZip(bytes);
  assert.equal(files.size, sizes.length);
  for (let i = 0; i < sizes.length; i++) {
    const file = files.get(names[i].toString());
    assert.equal(file.length, sizes[i]); assert.equal(file.buffer, bytes.buffer);
  }
  assert.equal(ZIP_LIMITS.expandedBytes, 256 * 1024 * 1024);
  assert.equal(ZIP_LIMITS.imageBytes, 12 * 1024 * 1024);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {argumentsForImport, importStory, parseStoryboard, prepareStory} from '../scripts/import-story.mjs';
import {build} from '../scripts/build.mjs';
import {LIMITS, makeCatalog, readLibrary, validateManifest} from '../scripts/content.mjs';
import {crc32, readZip} from '../scripts/zip.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
const SOURCE = `# 螳螂捕蝉\n\n少年用一则故事劝谏吴王。\n\n主题：聪明与糊涂\n\n出处：《说苑·正谏》\n\n出处链接：https://example.org/source\n\n画风：水墨写意\n\n## 制作要求\n\nPRIVATE-PRODUCTION-PROMPT\n\n## 第 1 幅\n\n图片：图片/01.png\n\n### 旁白\n\n吴王准备出兵，少年决定劝谏。\n\n### 画面提示词\n\nPRIVATE-IMAGE-PROMPT-ONE\n\n## 第 2 幅\n\n图片：图片/02.png\n\n### 旁白\n\n螳螂盯着蝉，身后的黄雀也在等待。\n\n### 画面提示词\n\nPRIVATE-IMAGE-PROMPT-TWO\n\n## 余味\n\n看见眼前的利益，也别忘了身后的风险。\n\n## 改编说明\n\n根据古典寓言改编，文字与插画使用 AI 辅助制作。\n`;
const OPTIONS = {slug: 'tang-lang-bu-chan', author: '测试作者', date: '2026-11-01'};

// Build standards-shaped archives without adding a runtime package dependency.
function zip(entries, {deflate = false} = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, input] of entries) {
    const rawName = Buffer.from(name), data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const compressed = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0, crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(rawName.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(rawName.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, rawName, compressed); central.push(directory, rawName);
    offset += local.length + rawName.length + compressed.length;
  }
  const localBytes = Buffer.concat(locals), directoryBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, directoryBytes, end]);
}
function storyZip(options) { return zip([['分镜.md', SOURCE], ['图片/01.png', PNG], ['图片/02.png', PNG]], options); }
function centralOffset(buffer) { return buffer.readUInt32LE(buffer.length - 22 + 16); }
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'awesome-shiqu-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'site'), {recursive: true});
  await writeFile(path.join(root, 'site', 'index.html'), '<!doctype html><title>书架</title>');
  await writeFile(path.join(root, 'site', 'reader.html'),
    '<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="description" content="在拾趣好故事，翻开一篇精选古典连环画。"><title>阅读 · 拾趣好故事</title><link rel="stylesheet" href="./assets/site.css"></head><body><a href="./">作品集</a></body></html>');
  await writeFile(path.join(root, 'site', 'config.json'), JSON.stringify({
    github: {owner: 'yysun', repo: 'awesome-shiqu', branch: 'main', directory: 'works', catalog: 'catalog/catalog.json'},
  }) + '\n');
  return root;
}

test('imports a real-shaped UTF-8 export, publishes only selected fields, and builds portable paths', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await writeFile(input, storyZip());
  const manifest = await importStory(input, OPTIONS, root);
  assert.equal(manifest.title, '螳螂捕蝉');
  assert.equal(manifest.book, '说苑·正谏');
  assert.equal(manifest.author, OPTIONS.author);
  assert.equal(manifest.pages.length, 2);
  assert.equal(manifest.pages[1].image, 'images/02.png');
  assert.equal(JSON.stringify(manifest).includes('PRIVATE-'), false);
  await writeFile(path.join(root, 'stories', manifest.id, 'private-notes.md'), 'MUST-NOT-PUBLISH');
  const summary = await build(root);
  assert.equal(summary.count, 1); assert.equal(summary.pages, 2);
  const catalog = JSON.parse(await readFile(path.join(root, 'dist', 'catalog.json'), 'utf8'));
  assert.equal(catalog.schemaVersion, 1);
  const entry = catalog.stories[0];
  assert.equal('pages' in entry, false);
  assert.equal(entry.cover, `stories/${manifest.id}/images/01.png`);
  assert.equal(entry.url, `stories/${manifest.id}/story.json`);
  const hostedRoot = new URL('https://yysun.github.io/awesome-shiqu/');
  const jsonUrl = new URL(entry.url, hostedRoot);
  assert.equal(new URL(manifest.pages[0].image, jsonUrl).pathname,
    `/awesome-shiqu/stories/${manifest.id}/images/01.png`);
  assert.deepEqual((await readdir(path.join(root, 'dist', 'stories', manifest.id))).sort(), ['images', 'story.json']);
  await assert.rejects(importStory(input, OPTIONS, root), /已存在/);
  assert.deepEqual(await readFile(path.join(root, 'stories', manifest.id, 'images', '01.png')), PNG);
});

test('accepts deflated archives and Windows newlines, keeping prompts out of all public metadata', () => {
  const parsed = prepareStory(storyZip({deflate: true}), {...OPTIONS, book: '说苑', sourceUrl: 'https://example.org/new'});
  assert.equal(parsed.manifest.book, '说苑');
  assert.equal(parsed.manifest.source.url, 'https://example.org/new');
  assert.equal(JSON.stringify(makeCatalog([parsed])).includes('PRIVATE-'), false);
  assert.deepEqual(parseStoryboard(SOURCE.replaceAll('\n', '\r\n')), parseStoryboard(SOURCE));
});

test('ignores reserved headings in private production prompts and rejects ambiguous final-frame footers', () => {
  const privateHeadings = SOURCE.replace('PRIVATE-PRODUCTION-PROMPT', '## 余味\n\nPRIVATE-END-TEXT\n\n## 第 1 幅\n\nPRIVATE-FRAME-TEMPLATE');
  assert.deepEqual(parseStoryboard(privateHeadings), parseStoryboard(SOURCE));
  const intermediateHeading = SOURCE.replace('PRIVATE-IMAGE-PROMPT-ONE', '## 余味\n\nPRIVATE-INTERMEDIATE-ENDING');
  assert.deepEqual(parseStoryboard(intermediateHeading), parseStoryboard(SOURCE));
  const ambiguous = SOURCE.replace('PRIVATE-IMAGE-PROMPT-TWO', '## 余味\n\nPRIVATE-LAST-ENDING');
  assert.throws(() => parseStoryboard(ambiguous), /歧义/);
});

test('rejects traversal, absolute paths, duplicate names, and symlink entries', () => {
  for (const name of ['../escape.png', '/escape.png', 'C:/escape.png', 'images/../../escape.png', 'images\\escape.png']) {
    assert.throws(() => readZip(zip([[name, PNG]])), /ZIP/);
  }
  assert.throws(() => readZip(zip([['图片/01.png', PNG], ['图片/01.png', PNG]])), /重复/);
  assert.throws(() => readZip(zip([['IMAGE.PNG', PNG], ['image.png', PNG]])), /冲突/);
  const linked = zip([['link.png', PNG]]);
  linked.writeUInt32LE((0xa1ff << 16) >>> 0, centralOffset(linked) + 38);
  assert.throws(() => readZip(linked), /符号链接/);
});

test('rejects corrupted archives, mismatched headers, and declared or actual decompression bombs', () => {
  const corrupt = storyZip(); corrupt[35] ^= 1;
  assert.throws(() => readZip(corrupt), /不一致|校验/);
  const tooLarge = zip([['image.png', PNG]]);
  tooLarge.writeUInt32LE(LIMITS.imageBytes + 1, centralOffset(tooLarge) + 24);
  assert.throws(() => readZip(tooLarge), /过大/);
  const bomb = zip([['image.png', Buffer.alloc(1024 * 1024, 97)]], {deflate: true});
  bomb.writeUInt32LE(2, 22); bomb.writeUInt32LE(2, centralOffset(bomb) + 24);
  assert.throws(() => readZip(bomb), /超过声明大小/);
  assert.throws(() => readZip(storyZip().subarray(0, -1)), /有效 ZIP/);
});

test('rejects incomplete storyboards, missing images, non-images, and invalid dates or links', () => {
  assert.throws(() => parseStoryboard(SOURCE.replace('## 第 2 幅', '## 第 3 幅')), /连续/);
  assert.throws(() => parseStoryboard(SOURCE.replace('### 旁白', '### 其他')), /没有找到画面/);
  assert.throws(() => prepareStory(zip([['分镜.md', SOURCE], ['图片/01.png', PNG]]), OPTIONS), /缺少第 2/);
  assert.throws(() => prepareStory(zip([['分镜.md', SOURCE], ['图片/01.png', '<html>not image</html>'], ['图片/02.png', PNG]]), OPTIONS), /不是可识别/);
  assert.throws(() => prepareStory(storyZip(), {...OPTIONS, date: '2026-02-30'}), /有效日期/);
  assert.throws(() => prepareStory(storyZip(), {...OPTIONS, sourceUrl: 'javascript:alert(1)'}), /http/);
  assert.throws(() => prepareStory(storyZip(), {...OPTIONS, sourceUrl: 'https://user:secret@example.org'}), /凭据/);
  assert.throws(() => prepareStory(storyZip(), {...OPTIONS, slug: '../other'}), /slug/);
});

test('validates manually edited manifests and refuses image paths or symlinks outside a story', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await writeFile(input, storyZip());
  const manifest = await importStory(input, OPTIONS, root);
  assert.throws(() => validateManifest({...manifest, productionPrompt: 'private'}), /未知字段/);
  assert.throws(() => validateManifest({...manifest, pages: [{image: '../other/images/01.png', caption: '坏路径'}]}), /本作品/);
  assert.throws(() => validateManifest({...manifest, pages: [{image: 'https://example.org/image.png', caption: '远程图片'}]}), /本作品/);
  const image = path.join(root, 'stories', manifest.id, 'images', '01.png');
  await rm(image);
  const external = path.join(root, 'outside.png'); await writeFile(external, PNG);
  await symlink(external, image);
  await assert.rejects(readLibrary(root), /符号链接/);
});

test('publishes SEO-friendly book and story pages with canonical URLs and a sitemap', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await writeFile(input, storyZip());
  const manifest = await importStory(input, OPTIONS, root);
  const summary = await build(root);
  assert.equal(summary.books, 1);
  const storyPage = await readFile(path.join(root, 'dist', 'books', '说苑-正谏', '螳螂捕蝉', 'index.html'), 'utf8');
  assert.match(storyPage, /<title>螳螂捕蝉 · 说苑·正谏 · 拾趣好故事<\/title>/);
  assert.equal(storyPage.includes(`<meta name="shiqu:story" content="${manifest.id}">`), true);
  assert.equal(storyPage.includes('href="../../../assets/site.css"'), true);
  const canonical = new URL('books/说苑-正谏/螳螂捕蝉/', 'https://yysun.github.io/awesome-shiqu/').href;
  assert.equal(storyPage.includes(`<link rel="canonical" href="${canonical}">`), true);
  assert.equal(storyPage.includes(`<meta property="og:image" content="${new URL(`stories/${manifest.id}/images/01.png`, 'https://yysun.github.io/awesome-shiqu/').href}">`), true);
  const bookPage = await readFile(path.join(root, 'dist', 'books', '说苑-正谏', 'index.html'), 'utf8');
  assert.equal(bookPage.includes('href="./螳螂捕蝉/"'), true);
  assert.equal(bookPage.includes(`src="../../stories/${manifest.id}/images/01.png"`), true);
  const sitemap = await readFile(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.includes(`<loc>${canonical}</loc>`), true);
  assert.equal(sitemap.includes('<loc>https://yysun.github.io/awesome-shiqu/</loc>'), true);
});

test('empty collections build, and failed builds preserve the previous published output', async t => {
  const root = await workspace(t);
  const empty = await build(root);
  assert.equal(empty.count, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist', 'catalog.json'), 'utf8')), {schemaVersion: 1, stories: []});
  const input = path.join(root, 'export.zip'); await writeFile(input, storyZip());
  const manifest = await importStory(input, OPTIONS, root);
  await rm(path.join(root, 'stories', manifest.id, 'images', '02.png'));
  await assert.rejects(build(root), /02.png/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'dist', 'catalog.json'), 'utf8')).stories.length, 0);
});

test('CLI requires explicit authorship and rejects unknown or repeated parameters', () => {
  assert.deepEqual(argumentsForImport(['sample.zip', '--slug', 'story', '--author', '作者']).options, {slug: 'story', author: '作者'});
  assert.throws(() => argumentsForImport(['sample.zip', '--slug', 'story']), /必填/);
  assert.throws(() => argumentsForImport(['sample.zip', '--slug', 'story', '--author', '作者', '--force', 'true']), /无效/);
  assert.throws(() => argumentsForImport(['sample.zip', '--slug', 'a', '--slug', 'b']), /重复/);
});

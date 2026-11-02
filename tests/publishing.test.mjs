// Exercise import and static publication using temporary, non-production story fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
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
  assert.equal(manifest.author, '');
  assert.equal(manifest.contributor,OPTIONS.author);
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
  assert.equal(bookPage.includes('<a class="nav-link active" href="../../books/" aria-current="page">书目</a>'), true);
  assert.equal(bookPage.includes('<nav class="breadcrumb" aria-label="位置"><a href="../../">首页</a><a href="../">书目</a><span aria-current="page">说苑·正谏</span></nav>'), true);
  assert.equal(bookPage.includes(`<a href="../../themes/${encodeURIComponent('聪明与糊涂')}/">`) || bookPage.includes('<a href="../../themes/聪明与糊涂/">'), true);
  const sitemap = await readFile(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.includes(`<loc>${canonical}</loc>`), true);
  for (const relative of ['', 'books/', 'collection/', 'themes/', 'themes/聪明与糊涂/', 'styles/水墨写意/']) {
    assert.equal(sitemap.includes(`<loc>${new URL(relative, 'https://yysun.github.io/awesome-shiqu/').href}</loc>`), true, relative);
  }
  assert.equal(sitemap.includes('/featured/</loc>'), false);
});

test('publishes a static books overview with grouped counts, escaped titles, and portable links', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await writeFile(input, storyZip());
  await importStory(input, OPTIONS, root);
  await importStory(input, {...OPTIONS, slug: 'second-story'}, root);
  await importStory(input, {...OPTIONS, slug: 'third-story', book: '三国演义 <script> & "选"'}, root);
  const summary = await build(root);
  assert.equal(summary.books, 2);
  const overview = await readFile(path.join(root, 'dist', 'books', 'index.html'), 'utf8');
  assert.match(overview, /<title>原著书目 · 拾趣好故事<\/title>/);
  assert.match(overview, /<span class="count">2 部<\/span>/);
  assert.equal((overview.match(/<article class="story-card group-card">/g) || []).length, 2);
  assert.match(overview, /<h2 class="card-title">说苑·正谏<\/h2><p class="card-hook">2 篇精选连环画 · 最近收录 2026-11-01<\/p>/);
  assert.match(overview, /<h2 class="card-title">三国演义 &lt;script&gt; &amp; &quot;选&quot;<\/h2><p class="card-hook">1 篇精选连环画 · 最近收录 2026-11-01<\/p>/);
  assert.match(overview, /<span class="cover-label">2 篇<\/span>/);
  assert.equal(overview.includes('<script>'), false);
  assert.ok(overview.indexOf('三国演义 &lt;script&gt;') < overview.indexOf('说苑·正谏'));
  const base = new URL('https://yysun.github.io/awesome-shiqu/books/');
  assert.equal(overview.includes(`<link rel="canonical" href="${base.href}">`), true);
  assert.equal(overview.includes(`<meta property="og:url" content="${base.href}">`), true);
  assert.equal(overview.includes('href="../assets/site.css"'), true);
  assert.equal(overview.includes('href="../assets/mark.svg"'), true);
  assert.equal(overview.includes('<a class="nav-link" href="../collection/">全部作品</a>'), true);
  assert.equal(overview.includes('<form class="masthead-search" role="search" action="../collection/" method="get">'), true);
  assert.equal(overview.includes('<a href="./#contribute">投稿</a>'), false);
  assert.equal(overview.includes('<a href="../#contribute">投稿</a>'), true);
  assert.doesNotMatch(overview, /(?:href|src)="\//);
  for (const [, href] of overview.matchAll(/class="card-link" href="([^"]+)"/g)) {
    const url = new URL(href, base);
    assert.ok(url.pathname.startsWith('/awesome-shiqu/books/'));
    const relative = decodeURIComponent(url.pathname.slice('/awesome-shiqu/'.length));
    await readFile(path.join(root, 'dist', relative, 'index.html'));
  }
});

test('publishes the books overview without requiring GitHub configuration', async t => {
  const root = await workspace(t);
  await rm(path.join(root, 'site', 'config.json'));
  await build(root);
  const overview = await readFile(path.join(root, 'dist', 'books', 'index.html'), 'utf8');
  assert.match(overview, /<title>原著书目 · 拾趣好故事<\/title>/);
  assert.equal(overview.includes('rel="canonical"'), false);
  assert.equal(overview.includes('property="og:url"'), false);
});

test('stamps one cache-busting version on asset references so pages never mix module versions', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await mkdir(path.join(root, 'site', 'assets'));
  await writeFile(path.join(root, 'site', 'assets', 'site.css'), 'body{margin:0}\n');
  await writeFile(path.join(root, 'site', 'assets', 'common.mjs'), 'export const ok = true;\n');
  await writeFile(path.join(root, 'site', 'assets', 'shelf.mjs'), "import {ok} from './common.mjs';\nconsole.log(ok);\n");
  await writeFile(path.join(root, 'site', 'index.html'),
    '<!doctype html><title>书架</title><link rel="stylesheet" href="./assets/site.css"><script type="module" src="./assets/shelf.mjs"></script>');
  await writeFile(input, storyZip());
  await importStory(input, OPTIONS, root);
  await build(root);
  const shelf = await readFile(path.join(root, 'dist', 'assets', 'shelf.mjs'), 'utf8');
  const version = shelf.match(/from '\.\/common\.mjs\?v=([0-9a-f]{10})'/)?.[1];
  assert.ok(version, '模块导入需要带上版本参数');
  const index = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.equal(index.includes(`src="./assets/shelf.mjs?v=${version}"`), true);
  assert.equal(index.includes(`href="./assets/site.css?v=${version}"`), true);
  const storyPage = await readFile(path.join(root, 'dist', 'books', '说苑-正谏', '螳螂捕蝉', 'index.html'), 'utf8');
  assert.equal(storyPage.includes(`href="../../../assets/site.css?v=${version}"`), true);
  const bookPage = await readFile(path.join(root, 'dist', 'books', '说苑-正谏', 'index.html'), 'utf8');
  assert.equal(bookPage.includes(`href="../../assets/site.css?v=${version}"`), true);
  const overview = await readFile(path.join(root, 'dist', 'books', 'index.html'), 'utf8');
  assert.equal(overview.includes(`href="../assets/site.css?v=${version}"`), true);
  await writeFile(path.join(root, 'site', 'assets', 'common.mjs'), 'export const ok = false;\n');
  await build(root);
  const changed = await readFile(path.join(root, 'dist', 'assets', 'shelf.mjs'), 'utf8');
  assert.notEqual(changed.match(/\?v=([0-9a-f]{10})'/)?.[1], version, '资源内容变化后版本号必须变化');
});

test('empty collections build, and failed builds preserve the previous published output', async t => {
  const root = await workspace(t);
  const empty = await build(root);
  assert.equal(empty.count, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist', 'catalog.json'), 'utf8')), {schemaVersion: 1, stories: []});
  const overview = await readFile(path.join(root, 'dist', 'books', 'index.html'), 'utf8');
  assert.match(overview, /<span class="count">0 部<\/span>/);
  assert.match(overview, /好故事，正在收集。/);
  assert.equal(overview.includes('class="story-card"'), false);
  const input = path.join(root, 'export.zip'); await writeFile(input, storyZip());
  const manifest = await importStory(input, OPTIONS, root);
  await rm(path.join(root, 'stories', manifest.id, 'images', '02.png'));
  await assert.rejects(build(root), /02.png/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'dist', 'catalog.json'), 'utf8')).stories.length, 0);
  assert.equal(await readFile(path.join(root, 'dist', 'books', 'index.html'), 'utf8'), overview);
});

test('CLI requires explicit contributor identity and rejects unknown or repeated parameters', () => {
  assert.deepEqual(argumentsForImport(['sample.zip', '--slug', 'story', '--author', '作者']).options, {slug: 'story', author: '作者'});
  assert.throws(() => argumentsForImport(['sample.zip', '--slug', 'story']), /必填/);
  assert.throws(() => argumentsForImport(['sample.zip', '--slug', 'story', '--author', '作者', '--force', 'true']), /无效/);
  assert.throws(() => argumentsForImport(['sample.zip', '--slug', 'a', '--slug', 'b']), /重复/);
});

// Every relative link or asset in dist must resolve to a published file at that page's depth.
async function assertLinksResolve(root, relativeFile, html) {
  const pageURL = pathToFileURL(path.join(root, 'dist', relativeFile));
  for (const [, attribute, value] of html.matchAll(/\s(href|src|action)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#)/.test(value)) continue;
    assert.doesNotMatch(value, /^\//, `${relativeFile} 使用了绝对路径 ${attribute}="${value}"`);
    const target = new URL(value, pageURL);
    let file = decodeURIComponent(fileURLToPath(target));
    if (file.endsWith(path.sep) || (await stat(file).then(info => info.isDirectory(), () => false))) file = path.join(file, 'index.html');
    await stat(file).catch(() => assert.fail(`${relativeFile} 的 ${attribute}="${value}" 指向不存在的 ${path.relative(root, file)}`));
  }
}
async function htmlFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isDirectory()) result.push(...await htmlFiles(path.join(directory, entry.name), prefix + entry.name + '/'));
    else if (entry.name.endsWith('.html')) result.push(prefix + entry.name);
  }
  return result;
}
const SITE_INDEX = '<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="description" content="首页描述 &amp; 测试"><title>拾趣好故事 · 精选连环画</title><link rel="stylesheet" href="./assets/site.css"></head><body>'
  + '<header class="masthead wrap"><a class="brand" href="./">旧品牌</a><nav aria-label="主导航"><a class="nav-link" href="#collection">作品集</a></nav></header>'
  + '<main><section id="contribute"></section></main><footer class="footer wrap"><a href="./#contribute">投稿</a><a href="./reader.html?preview=1">试读</a></footer></body></html>';

test('publishes category pages and a consistent masthead whose links resolve at every depth', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await writeFile(path.join(root, 'site', 'index.html'), SITE_INDEX);
  await mkdir(path.join(root, 'site', 'assets'));
  for (const name of ['mark.svg', 'site.css', 'shelf.mjs', 'featured-page.mjs']) await writeFile(path.join(root, 'site', 'assets', name), '');
  await writeFile(input, storyZip());
  await importStory(input, OPTIONS, root);
  await writeFile(input, zip([['分镜.md', SOURCE.replace('主题：聪明与糊涂\n\n', '').replace('画风：水墨写意', '画风：<b>剪纸</b>')], ['图片/01.png', PNG], ['图片/02.png', PNG]]));
  await importStory(input, {...OPTIONS, slug: 'no-theme', book: '三国演义'}, root);
  const summary = await build(root);
  assert.equal(summary.themes, 1); assert.equal(summary.styles, 2); assert.equal(summary.featured, 0);
  const themes = await readFile(path.join(root, 'dist', 'themes', 'index.html'), 'utf8');
  assert.match(themes, /<title>故事分类 · 拾趣好故事<\/title>/);
  assert.match(themes, /<h2 id="themes-title">按主题 <span class="count">1 类<\/span><\/h2>/);
  assert.match(themes, /<h2 id="styles-title">按画风 <span class="count">2 类<\/span><\/h2>/);
  assert.equal(themes.includes('href="../themes/聪明与糊涂/"'), true);
  assert.equal(themes.includes('href="../styles/b-剪纸-b/"'), true);
  assert.equal(themes.includes('&lt;b&gt;剪纸&lt;/b&gt;'), true);
  assert.equal(themes.includes('<b>剪纸</b>'), false);
  assert.equal(themes.includes('<a class="nav-link active" href="../themes/" aria-current="page">分类</a>'), true);
  const theme = await readFile(path.join(root, 'dist', 'themes', '聪明与糊涂', 'index.html'), 'utf8');
  assert.match(theme, /<h1 id="facet-title">聪明与糊涂 <span class="count">1 篇<\/span><\/h1>/);
  assert.equal(theme.includes('href="../../books/说苑-正谏/螳螂捕蝉/"'), true);
  assert.equal(theme.includes('href="../../books/三国演义/'), false, '缺少主题的作品不进入分类页');
  assert.equal(theme.includes('<span class="cover-label">说苑·正谏</span>'), true);
  assert.equal(theme.includes('<a class="nav-link active" href="../../themes/" aria-current="page">分类</a>'), true);
  const style = await readFile(path.join(root, 'dist', 'styles', 'b-剪纸-b', 'index.html'), 'utf8');
  assert.equal(style.includes('href="../../styles/水墨写意/"'), true, '其他画风入口');
  const bookPage = await readFile(path.join(root, 'dist', 'books', '三国演义', 'index.html'), 'utf8');
  assert.equal(bookPage.includes('<span class="chip-kicker">画风</span>&lt;b&gt;剪纸&lt;/b&gt;'), true);
  assert.equal(bookPage.includes('<span class="chip-kicker">主题</span>'), false);
  assert.equal(bookPage.includes('href="../说苑-正谏/"'), true, '其他书目入口');
  const home = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
  assert.equal(home.includes('旧品牌'), false, '首页 masthead 由构建统一生成');
  assert.equal(home.includes('<a class="nav-link" href="books/">书目</a>'), true);
  assert.equal(home.includes('aria-current'), false);
  assert.equal(home.includes('href="featured/"'), false, '无精选时导航不含精选');
  assert.equal(home.includes('<link rel="canonical" href="https://yysun.github.io/awesome-shiqu/">'), true);
  assert.equal(home.includes('<meta property="og:description" content="首页描述 &amp; 测试">'), true);
  const featured = await readFile(path.join(root, 'dist', 'featured', 'index.html'), 'utf8');
  assert.equal(featured.includes('aria-current'), false);
  assert.match(featured, /src="\.\.\/assets\/featured-page\.mjs\?v=[0-9a-f]{10}"/);
  const collection = await readFile(path.join(root, 'dist', 'collection', 'index.html'), 'utf8');
  assert.equal(collection.includes('<a class="nav-link active" href="../collection/" aria-current="page">全部作品</a>'), true);
  assert.equal(collection.includes('id="theme-filter"') && collection.includes('id="style-filter"'), true);
  const files = await htmlFiles(path.join(root, 'dist'));
  assert.ok(files.length >= 9, files.join(','));
  for (const file of files) {
    const html = await readFile(path.join(root, 'dist', file), 'utf8');
    const readerPage = file === 'reader.html' || /^books\/[^/]+\/[^/]+\/index\.html$/.test(file);
    if (readerPage) {
      assert.equal(html.includes('<nav aria-label="主导航">'), false, file);
    } else {
      assert.equal((html.match(/<nav aria-label="主导航">/g) || []).length, 1, file);
      assert.equal((html.match(/class="nav-link active" href="[^"]+" aria-current="page">/g) || []).length, file === 'index.html' || file === 'featured/index.html' ? 0 : 1, file);
      assert.equal(html.includes('<footer class="footer wrap">'), true, file);
      assert.equal(html.includes('#contribute">投稿</a>'), true, file);
    }
    await assertLinksResolve(root, file, html);
  }
});

test('featured lists must reference catalogued works and switch the featured navigation on', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await writeFile(input, storyZip());
  await importStory(input, OPTIONS, root);
  await mkdir(path.join(root, 'works', 'alice'), {recursive: true});
  await writeFile(path.join(root, 'works', 'alice', '测试 故事.zip'), storyZip());
  await writeFile(path.join(root, 'site', 'featured.json'), '{"stories":[{"path":"works/alice/测试 故事.zip","note":"<b>值得</b>一读"}]}');
  const summary = await build(root);
  assert.equal(summary.featured, 1);
  const catalog = JSON.parse(await readFile(path.join(root, 'dist', 'catalog.json'), 'utf8'));
  assert.equal(catalog.stories.find(story => story.archive).sourcePath, 'works/alice/测试 故事.zip');
  assert.equal(catalog.stories.find(story => story.url).sourcePath, undefined);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist', 'featured.json'), 'utf8')).stories[0].path, 'works/alice/测试 故事.zip');
  for (const file of ['books/index.html', 'collection/index.html', 'themes/index.html']) {
    const html = await readFile(path.join(root, 'dist', file), 'utf8');
    assert.equal(html.includes('<a class="nav-link" href="../featured/">精选</a>'), true, file);
  }
  const featured = await readFile(path.join(root, 'dist', 'featured', 'index.html'), 'utf8');
  assert.equal(featured.includes('<a class="nav-link active" href="../featured/" aria-current="page">精选</a>'), true);
  const sitemap = await readFile(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.includes('<loc>https://yysun.github.io/awesome-shiqu/featured/</loc>'), true);
  const previous = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
  await writeFile(path.join(root, 'site', 'featured.json'), '{"stories":[{"path":"works/alice/missing.zip"}]}');
  await assert.rejects(build(root), /未收录的作品：works\/alice\/missing\.zip/);
  await writeFile(path.join(root, 'site', 'featured.json'), '{"stories":[{"path":"stories/x/story.json"}]}');
  await assert.rejects(build(root), /works\//);
  await writeFile(path.join(root, 'site', 'featured.json'), '{"stories":[');
  await assert.rejects(build(root), /JSON/);
  assert.equal(await readFile(path.join(root, 'dist', 'index.html'), 'utf8'), previous, '失败的构建保留上一次输出');
  await rm(path.join(root, 'site', 'featured.json'));
  assert.equal((await build(root)).featured, 0);
});

test('distinct titles that share one slug stop the build instead of merging pages', async t => {
  const root = await workspace(t), input = path.join(root, 'export.zip');
  await writeFile(input, storyZip());
  await importStory(input, OPTIONS, root);
  await importStory(input, {...OPTIONS, slug: 'second', book: '说苑 正谏'}, root);
  await assert.rejects(build(root), /同一页面地址.*书名 说苑-正谏（说苑 正谏、说苑·正谏）/);
});

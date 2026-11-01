import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {archiveStoryId, readArchiveLibrary} from '../scripts/archive-library.mjs';
import {encodeArchivePath} from '../site/assets/archive-path.mjs';
import {validateCatalog} from '../site/assets/library.mjs';
import {build} from '../scripts/build.mjs';
import {createRepositoryCatalog} from '../scripts/catalog.mjs';
import {addStory} from '../scripts/add-story.mjs';
import {importStory} from '../scripts/import-story.mjs';
import {crc32} from '../scripts/zip.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
const MARKDOWN = '# 测试故事\n\n一本书的一篇故事。\n\n出处：《测试古书》\n\n画风：水墨\n\n## 制作要求\n\nPRIVATE-PROMPT\n\n## 第 1 幅\n\n图片：图片/01.png\n\n### 旁白\n\n第一幅旁白。\n\n### 画面提示词\n\nPRIVATE-IMAGE-PROMPT\n\n## 第 2 幅\n\n图片：图片/02.png\n\n### 旁白\n\n第二幅旁白。\n';

function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, input] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(input), compressed = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30), record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); central.push(record, filename); offset += local.length + filename.length + compressed.length;
  }
  const localData = Buffer.concat(locals), centralData = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}
const ARCHIVE = zip([['分镜.md', MARKDOWN], ['图片/01.png', PNG], ['图片/02.png', PNG]]);

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'awesome-shiqu-zip-build-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'site'));
  await writeFile(path.join(root, 'site/index.html'), '<!doctype html><title>测试书架</title>');
  await writeFile(path.join(root, 'site/reader.html'), '<!doctype html><title>测试阅读器</title>');
  await mkdir(path.join(root, 'works/alice'), {recursive: true});
  await writeFile(path.join(root, 'works/alice/test-story.zip'), ARCHIVE);
  return root;
}

test('a ZIP-only contribution builds an indexed cover and the unchanged original archive', async t => {
  const root = await workspace(t), library = await readArchiveLibrary(root);
  assert.equal(library.length, 1);
  assert.equal(library[0].manifest.id, 'alice--test-story');
  assert.equal(library[0].manifest.author, 'alice');
  assert.equal(library[0].manifest.title, '测试故事');
  assert.equal(library[0].manifest.pages.length, 2);
  assert.equal(JSON.stringify(library[0].manifest).includes('PRIVATE-'), false);
  const summary = await build(root);
  assert.equal(summary.count, 1); assert.equal(summary.pages, 2);
  const catalog = JSON.parse(await readFile(path.join(root, 'dist/catalog.json'), 'utf8')), story = catalog.stories[0];
  assert.equal(story.archive, 'works/alice/test-story.zip');
  assert.equal(story.cover, 'covers/alice--test-story.png');
  assert.equal(story.sha256, createHash('sha256').update(ARCHIVE).digest('hex'));
  assert.equal(story.archiveBytes, ARCHIVE.length);
  assert.equal(story.url, undefined); assert.equal(story.pages, undefined);
  assert.equal(JSON.stringify(catalog).includes('PRIVATE-'), false);
  assert.deepEqual(await readFile(path.join(root, 'dist', story.archive)), ARCHIVE);
  assert.deepEqual(await readFile(path.join(root, 'dist', story.cover)), PNG);
  assert.deepEqual(await readdir(path.join(root, 'dist/works/alice')), ['test-story.zip']);
  const base = new URL('https://example.org/awesome-shiqu/');
  assert.equal(new URL(story.archive, base).pathname, '/awesome-shiqu/works/alice/test-story.zip');
});

test('the remote catalogue pins ZIPs to source commits and retains old hashed covers', async t => {
  const root = await workspace(t), commit = 'a'.repeat(40);
  const catalog = await createRepositoryCatalog(root, {owner: 'yysun', repo: 'awesome-shiqu', branch: 'main', commit});
  const story = catalog.stories[0];
  assert.equal(catalog.sourceCommit, commit);
  assert.equal(story.archive, `https://raw.githubusercontent.com/yysun/awesome-shiqu/${commit}/works/alice/test-story.zip`);
  assert.equal(story.sourcePath, 'works/alice/test-story.zip');
  assert.equal(story.cover, `https://raw.githubusercontent.com/yysun/awesome-shiqu/main/catalog/covers/${story.sha256}.png`);
  const oldCover = path.join(root, 'catalog/covers/old-cover.png');
  await writeFile(oldCover, PNG);
  await createRepositoryCatalog(root, {owner: 'yysun', repo: 'awesome-shiqu', branch: 'main', commit: 'b'.repeat(40)});
  assert.deepEqual(await readFile(oldCover), PNG);
  assert.equal(JSON.stringify(catalog).includes('PRIVATE-'), false);
  await assert.rejects(createRepositoryCatalog(root, {owner: 'yysun', repo: 'awesome-shiqu', commit: 'main'}), /commit SHA/);
  await assert.rejects(createRepositoryCatalog(root, {owner: 'yysun', repo: 'awesome-shiqu', commit: 'a'.repeat(64)}), /40 字符/);
});

test('Shiqu export filenames keep Chinese, spaces and punctuation through build and reader URLs', async t => {
  const root = await workspace(t), commit = 'd'.repeat(40);
  const names = ['黄忠智取定军山.zip', 'A Story #1 (100%).zip', '《拾趣》·后记.ZIP'];
  for (const name of names) await writeFile(path.join(root, 'works/alice', name), ARCHIVE);
  const before = await readArchiveLibrary(root);
  assert.equal(new Set(before.map(story => story.manifest.id)).size, 4);
  assert.equal(before.find(story => story.relativePath.endsWith('test-story.zip')).manifest.id, 'alice--test-story');
  const summary = await build(root);
  assert.equal(summary.count, 4);
  const local = JSON.parse(await readFile(path.join(root, 'dist/catalog.json'), 'utf8'));
  const base = new URL('https://example.org/awesome-shiqu/');
  const localStories = validateCatalog(local, {root: base});
  const github = {owner: 'yysun', repo: 'awesome-shiqu', branch: 'main', directory: 'works', catalog: 'catalog/catalog.json'};
  const remote = await createRepositoryCatalog(root, {...github, commit});
  const remoteStories = validateCatalog(remote, {root: base, github});
  for (const name of names) {
    const id = archiveStoryId('alice', name), relative = `works/alice/${name}`;
    assert.match(id, /^alice--zip-[a-f0-9]{24}$/);
    const localStory = localStories.find(story => story.id === id), remoteStory = remoteStories.find(story => story.id === id);
    assert.equal(localStory.archiveURL, new URL(encodeArchivePath(relative), base).href);
    assert.equal(remoteStory.archiveURL, `https://raw.githubusercontent.com/yysun/awesome-shiqu/${commit}/${encodeArchivePath(relative)}`);
    assert.equal(remoteStory.sourcePath, relative);
    assert.deepEqual(await readFile(path.join(root, 'dist', relative)), ARCHIVE);
    assert.equal(localStory.sha256, createHash('sha256').update(ARCHIVE).digest('hex'));
  }
  const updated = zip([['分镜.md', MARKDOWN.replace('测试故事', '更新后的故事')], ['图片/01.png', PNG], ['图片/02.png', PNG]]);
  await writeFile(path.join(root, 'works/alice', names[0]), updated);
  const changed = (await readArchiveLibrary(root)).find(story => story.relativePath.endsWith(names[0]));
  assert.equal(changed.manifest.id, archiveStoryId('alice', names[0]));
  assert.equal(changed.manifest.title, '更新后的故事');
});

test('the remote index refuses legacy-only readers, unsupported paths, and symlink outputs', async t => {
  const root = await workspace(t), options = {owner: 'yysun', repo: 'awesome-shiqu', commit: 'c'.repeat(40)};
  await writeFile(path.join(root, 'site/config.json'), JSON.stringify({github: {directory: 'other'}}));
  await assert.rejects(createRepositoryCatalog(root, options), /directory 必须/);
  await writeFile(path.join(root, 'site/config.json'), JSON.stringify({github: {directory: 'works', catalog: 'other.json'}}));
  await assert.rejects(createRepositoryCatalog(root, options), /catalog 必须/);
  await rm(path.join(root, 'site/config.json'));
  await mkdir(path.join(root, 'catalog'));
  const outside = path.join(root, 'must-stay.txt');
  await writeFile(outside, 'unchanged');
  await symlink(outside, path.join(root, 'catalog/catalog.json'));
  await assert.rejects(createRepositoryCatalog(root, options), /普通文件/);
  assert.equal(await readFile(outside, 'utf8'), 'unchanged');
  await rm(path.join(root, 'catalog/catalog.json'));
  await importStory(path.join(root, 'works/alice/test-story.zip'), {slug: 'legacy', author: 'alice', date: '2026-11-01'}, root);
  await assert.rejects(createRepositoryCatalog(root, options), /远程目录只支持/);
});

test('contribution paths reject ambiguous names, nested submissions, symlinks, and missing images', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'works/Alice'));
  await assert.rejects(readArchiveLibrary(root), /用户名目录/);
  await rm(path.join(root, 'works/Alice'), {recursive: true});
  await writeFile(path.join(root, 'works/alice/bad?.zip'), ARCHIVE);
  await assert.rejects(readArchiveLibrary(root), /作品必须/);
  await rm(path.join(root, 'works/alice/bad?.zip'));
  await mkdir(path.join(root, 'works/alice/nested'));
  await assert.rejects(readArchiveLibrary(root), /作品必须/);
  await rm(path.join(root, 'works/alice/nested'), {recursive: true});
  await symlink(path.join(root, 'works/alice/test-story.zip'), path.join(root, 'works/alice/link.zip'));
  await assert.rejects(readArchiveLibrary(root), /作品必须/);
  await rm(path.join(root, 'works/alice/link.zip'));
  await writeFile(path.join(root, 'works/alice/incomplete.zip'), zip([['分镜.md', MARKDOWN], ['图片/01.png', PNG]]));
  await assert.rejects(readArchiveLibrary(root), /缺少第 2/);
});

test('case and Unicode aliases cannot publish the same contribution twice', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'works/alice/test-story.ZIP'), ARCHIVE);
  await assert.rejects(readArchiveLibrary(root), /文件名仅大小写或 Unicode/);
  await rm(path.join(root, 'works/alice/test-story.ZIP'));
  await writeFile(path.join(root, 'works/alice/café.zip'), ARCHIVE);
  await writeFile(path.join(root, 'works/alice/cafe\u0301.zip'), ARCHIVE);
  await assert.rejects(readArchiveLibrary(root), /文件名仅大小写或 Unicode/);
});

test('the optional add command copies only checked archives and refuses replacing a story', async t => {
  const root = await workspace(t), input = path.join(root, 'input.zip');
  await writeFile(input, ARCHIVE);
  await addStory(input, {author: 'bob', slug: 'same-title'}, root);
  assert.deepEqual(await readFile(path.join(root, 'works/bob/same-title.zip')), ARCHIVE);
  await assert.rejects(addStory(input, {author: 'bob', slug: 'same-title'}, root), /已存在/);
  await assert.rejects(addStory(input, {author: '../escape', slug: 'other'}, root), /GitHub/);
  const story = await addStory(input, {author: 'bob', slug: '黄忠智取定军山'}, root);
  assert.equal(story.id, archiveStoryId('bob', '黄忠智取定军山.zip'));
  assert.deepEqual(await readFile(path.join(root, 'works/bob/黄忠智取定军山.zip')), ARCHIVE);
});

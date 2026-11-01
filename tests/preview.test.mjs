// Exercise the real preview server with temporary builds, leaving public configuration untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPreviewServer} from '../scripts/preview.mjs';
import {loadCatalog} from '../site/assets/library.mjs';

const CONFIG = {
  github: {owner: 'yysun', repo: 'awesome-shiqu', branch: 'main', directory: 'works', catalog: 'catalog/catalog.json'},
  preferRemoteCatalog: true,
};
const CATALOG = {schemaVersion: 1, stories: [{
  id: 'alice--story', title: '测试故事', author: 'alice', publishedAt: '2026-11-01', pageCount: 1,
  cover: 'covers/story.png', archive: 'works/alice/story.zip', archiveBytes: 1, sha256: 'a'.repeat(64),
  storyboardModels: ['storyboard-model'],
}]};

async function preview(t) {
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'awesome-shiqu-preview-')));
  const root = path.join(folder, 'dist');
  await mkdir(path.join(root, 'assets'), {recursive: true});
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>测试书架</title>');
  await writeFile(path.join(root, 'reader.html'), '<!doctype html><title>测试阅读器</title>');
  await writeFile(path.join(root, 'assets/site.css'), 'body{}');
  await writeFile(path.join(root, 'config.json'), JSON.stringify(CONFIG));
  await writeFile(path.join(root, 'catalog.json'), JSON.stringify(CATALOG));
  const server = createPreviewServer(root);
  t.after(async () => {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(folder, {recursive: true, force: true});
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {root, folder, url: new URL(`http://127.0.0.1:${address.port}/`)};
}

test('real local preview loads current storyboard credits without GitHub requests or rewriting published config', async t => {
  const {root, url} = await preview(t), requests = [];
  const loaded = await loadCatalog({root: url, fetcher: async (input, options) => {
    requests.push(String(input));
    assert.equal(new URL(input).origin, url.origin);
    return fetch(input, options);
  }});
  assert.equal(loaded.source, 'local');
  assert.equal(loaded.remoteUnavailable, false);
  assert.deepEqual(loaded.github, CONFIG.github);
  assert.deepEqual(loaded.stories[0].storyboardModels, ['storyboard-model']);
  assert.deepEqual(requests, [new URL('config.json', url).href, new URL('catalog.json', url).href]);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8')), CONFIG);
  const response = await fetch(new URL('config.json', url));
  const content = await response.text();
  assert.equal(JSON.parse(content).preferRemoteCatalog, false);
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(content));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const head = await fetch(new URL('config.json', url), {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(content));
  assert.equal(await head.text(), '');
});

test('invalid preview configuration reports an HTTP error and logs the failure', async t => {
  const {root, url} = await preview(t), errors = [];
  t.mock.method(console, 'error', message => errors.push(message));
  for (const content of ['{', 'null', '[]', Buffer.from([0xff])]) {
    await writeFile(path.join(root, 'config.json'), content);
    const response = await fetch(new URL('config.json', url));
    assert.equal(response.status, 500);
    assert.match(await response.text(), /预览配置无效/);
  }
  assert.equal(errors.length, 4);
  assert.ok(errors.every(message => message.startsWith('预览配置无效：')));
});

test('preview keeps static routes, method restrictions, and file boundaries intact', async t => {
  const {root, folder, url} = await preview(t);
  const index = await fetch(url);
  assert.equal(index.status, 200); assert.match(await index.text(), /测试书架/);
  const reader = await fetch(new URL('reader.html', url));
  assert.equal(reader.status, 200); assert.match(await reader.text(), /测试阅读器/);
  const stylesheet = await fetch(new URL('assets/site.css', url));
  assert.equal(stylesheet.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(await stylesheet.text(), 'body{}');
  const post = await fetch(new URL('config.json', url), {method: 'POST'});
  assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET, HEAD');
  const outside = path.join(folder, 'outside.txt'); await writeFile(outside, 'NOT-PUBLIC');
  await symlink(outside, path.join(root, 'escape.txt'));
  for (const relative of ['escape.txt', '%2e%2e%2foutside.txt', 'missing.txt']) {
    const response = await fetch(new URL(relative, url));
    assert.equal(response.status, 404); assert.equal((await response.text()).includes('NOT-PUBLIC'), false);
  }
});

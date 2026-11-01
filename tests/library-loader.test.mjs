import test from 'node:test';
import assert from 'node:assert/strict';
import {assetURL, githubConfig, loadCatalog, loadArchive, responseBytes, validateCatalog, MAX_ZIP_BYTES} from '../site/assets/library.mjs';
import {crc32} from '../site/assets/zip.mjs';

const ROOT = new URL('https://reader.example/awesome-shiqu/');
const GITHUB = {owner: 'yysun', repo: 'awesome-shiqu', branch: 'main', directory: 'works', catalog: 'catalog/catalog.json'};
const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const RAW = `https://raw.githubusercontent.com/${GITHUB.owner}/${GITHUB.repo}`;
const API = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/contents/catalog/catalog.json?ref=main`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
const SOURCE = '# 小故事\n\n从一幅画读起。\n\n出处：《测试古书》\n\n## 第 1 幅\n\n图片：图片/01.png\n\n### 旁白\n\n这是一段故事。\n\n### 画面提示词\n\nPRIVATE-IMAGE-PROMPT\n';

function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, value] of entries) {
    const rawName = Buffer.from(name), data = Buffer.from(value), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(rawName.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(rawName.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, rawName, data); central.push(directory, rawName);
    offset += 30 + rawName.length + data.length;
  }
  const localBytes = Buffer.concat(locals), directoryBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, directoryBytes, end]);
}
const ZIP = zip([['分镜.md', SOURCE], ['图片/01.png', PNG]]);
const SHA256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', ZIP))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function entry(remote = true) {
  return {
    id: 'alice--tiny', title: '小故事', author: 'alice', publishedAt: '2026-11-01', pageCount: 1,
    archive: remote ? `${RAW}/${COMMIT}/works/alice/tiny.zip` : 'works/alice/tiny.zip',
    archiveBytes: ZIP.length, sha256: SHA256,
    cover: remote ? `${RAW}/main/catalog/covers/alice--tiny.png` : 'catalog/covers/alice--tiny.png',
  };
}
const catalog = (...stories) => ({schemaVersion: 1, stories});
const jsonResponse = data => new Response(JSON.stringify(data), {headers: {'content-type': 'application/json'}});
function fakeFetcher(routes) {
  const calls = [];
  return {
    calls,
    fetcher: async (input, options = {}) => {
      const url = String(input); calls.push({url, options});
      if (url === API && !routes.has(url)) return new Response('Not found', {status: 404});
      assert.ok(routes.has(url), `Unexpected request: ${url}`);
      const result = routes.get(url);
      if (result instanceof Error) throw result;
      return typeof result === 'function' ? result() : result;
    },
  };
}

test('remote catalogue is requested from the configured repository and archive URLs pin a Git commit', async () => {
  const remoteCatalog = `${RAW}/main/catalog/catalog.json`;
  const mock = fakeFetcher(new Map([
    [new URL('config.json', ROOT).href, jsonResponse({github: GITHUB})],
    [remoteCatalog, jsonResponse(catalog(entry()))],
  ]));
  const loaded = await loadCatalog({root: ROOT, fetcher: mock.fetcher});
  assert.equal(loaded.source, 'github'); assert.equal(loaded.remoteUnavailable, false);
  assert.equal(loaded.stories[0].archiveURL, `${RAW}/${COMMIT}/works/alice/tiny.zip`);
  assert.equal(loaded.stories[0].coverURL, `${RAW}/main/catalog/covers/alice--tiny.png`);
  assert.deepEqual(mock.calls.map(call => call.url), [new URL('config.json', ROOT).href, remoteCatalog]);
  for (const {url, options} of mock.calls) {
    assert.equal(options.credentials, new URL(url).origin === ROOT.origin ? 'same-origin' : 'omit'); assert.ok(options.signal instanceof AbortSignal);
  }
});

test('404 and network failures use the local published catalogue without losing the failure state', async () => {
  for (const failure of [new Response('Not found', {status: 404}), new TypeError('Network unavailable')]) {
    const mock = fakeFetcher(new Map([
      [new URL('config.json', ROOT).href, jsonResponse({github: GITHUB})],
      [`${RAW}/main/catalog/catalog.json`, failure],
      [new URL('catalog.json', ROOT).href, jsonResponse(catalog(entry(false)))],
    ]));
    const loaded = await loadCatalog({root: ROOT, fetcher: mock.fetcher});
    assert.equal(loaded.source, 'local'); assert.equal(loaded.remoteUnavailable, true);
    assert.equal(loaded.stories[0].archiveURL, new URL('works/alice/tiny.zip', ROOT).href);
    assert.equal(loaded.stories[0].coverURL, new URL('catalog/covers/alice--tiny.png', ROOT).href);
  }
});

test('a newly published GitHub catalogue can use the public Contents API when the raw URL is not ready', async () => {
  const mock = fakeFetcher(new Map([
    [new URL('config.json', ROOT).href, jsonResponse({github: GITHUB})],
    [`${RAW}/main/catalog/catalog.json`, new Response('Not found', {status: 404})],
    [API, jsonResponse(catalog(entry()))],
  ]));
  const loaded = await loadCatalog({root: ROOT, fetcher: mock.fetcher});
  assert.equal(loaded.source, 'github'); assert.equal(loaded.remoteUnavailable, false);
  assert.equal(loaded.stories[0].archiveURL, `${RAW}/${COMMIT}/works/alice/tiny.zip`);
  assert.equal(mock.calls.length, 3);
  assert.equal(mock.calls[2].options.credentials, 'omit');
  assert.equal(mock.calls[2].options.headers.Accept, 'application/vnd.github.raw+json');
});

test('legacy missing configuration and explicitly local mode make no GitHub request', async () => {
  for (const configResponse of [new Response('', {status: 404}), jsonResponse({github: GITHUB, preferRemoteCatalog: false})]) {
    const mock = fakeFetcher(new Map([
      [new URL('config.json', ROOT).href, configResponse],
      [new URL('catalog.json', ROOT).href, jsonResponse(catalog())],
    ]));
    const loaded = await loadCatalog({root: ROOT, fetcher: mock.fetcher});
    assert.equal(loaded.source, 'local'); assert.equal(loaded.remoteUnavailable, false);
    assert.equal(mock.calls.length, 2);
    assert.deepEqual(loaded.stories, []);
  }
});

test('private Sites keep same-origin authentication for config, fallback catalog, and bundled ZIP', async () => {
  const seen = [];
  const fetcher = async (input, options) => {
    const url = new URL(input); seen.push({url: url.href, credentials: options.credentials});
    if (url.origin !== ROOT.origin || options.credentials !== 'same-origin') return new Response('Unauthorized', {status: 401});
    if (url.pathname.endsWith('/config.json')) return jsonResponse({github: GITHUB, preferRemoteCatalog: false});
    if (url.pathname.endsWith('/catalog.json')) return jsonResponse(catalog(entry(false)));
    if (url.pathname.endsWith('/tiny.zip')) return new Response(ZIP);
    throw Error('Unexpected private-site request');
  };
  const loaded = await loadCatalog({root: ROOT, fetcher});
  assert.equal(loaded.source, 'local'); assert.equal(loaded.stories.length, 1);
  const artwork = await loadArchive(loaded.stories[0], {root: ROOT, fetcher});
  try { assert.equal(artwork.story.title, '小故事'); assert.equal(seen.length, 3); }
  finally { artwork.dispose(); }
});

test('asset boundaries reject other origins, repositories, moving ZIP refs, and traversal', () => {
  const options = {root: ROOT, github: GITHUB, archive: true};
  for (const value of [
    'https://evil.example/works/alice/tiny.zip',
    `${RAW.replace('/yysun/', '/other/')}/${COMMIT}/works/alice/tiny.zip`,
    `${RAW}/main/works/alice/tiny.zip`,
    `${RAW}/${COMMIT}/private/tiny.zip`,
    `${RAW}/${COMMIT}/works/%2e%2e/private/tiny.zip`,
    `${RAW}/${COMMIT}/works/alice%2f..%2f..%2fprivate/tiny.zip`,
    '../../works/alice/tiny.zip',
    'works/alice%2f..%2f..%2fprivate/tiny.zip',
    'https://user:secret@raw.githubusercontent.com/yysun/awesome-shiqu/' + COMMIT + '/works/alice/tiny.zip',
    'data:application/zip;base64,AAAA',
    'javascript:alert(1)',
  ]) assert.throws(() => assetURL(value, options), /作品/);
  assert.throws(() => assetURL(`${RAW}/main/works/cover.png`, {root: ROOT, github: GITHUB}), /封面/);
  assert.throws(() => githubConfig({github: {...GITHUB, catalog: '../catalog.json'}}), /目录/);
  assert.throws(() => githubConfig({github: {...GITHUB, owner: 'owner/other'}}), /账号/);
});

test('a malformed remote catalogue falls back before fetching an unapproved archive', async () => {
  const malicious = {...entry(), archive: 'https://evil.example/tiny.zip'};
  assert.throws(() => validateCatalog(catalog(malicious), {root: ROOT, github: GITHUB}), /作品/);
  const mock = fakeFetcher(new Map([
    [new URL('config.json', ROOT).href, jsonResponse({github: GITHUB})],
    [`${RAW}/main/catalog/catalog.json`, jsonResponse(catalog(malicious))],
    [new URL('catalog.json', ROOT).href, jsonResponse(catalog())],
  ]));
  const loaded = await loadCatalog({root: ROOT, fetcher: mock.fetcher});
  assert.equal(loaded.source, 'local'); assert.equal(loaded.remoteUnavailable, true);
  assert.equal(mock.calls.length, 4);
  assert.equal(mock.calls.some(call => call.url.startsWith('https://evil.example')), false);
});

test('archive loading verifies byte count and SHA-256 before interpreting the story', async () => {
  const [valid] = validateCatalog(catalog(entry()), {root: ROOT, github: GITHUB});
  await assert.rejects(loadArchive({...valid, archiveBytes: ZIP.length + 1}, {fetcher: async () => new Response(ZIP)}), /大小与收录/);
  await assert.rejects(loadArchive({...valid, sha256: '0'.repeat(64)}, {fetcher: async () => new Response(ZIP)}), /收录版本/);
  await assert.rejects(loadArchive(valid, {fetcher: async () => new Response('missing', {status: 404})}), /暂时无法下载/);
  await assert.rejects(loadArchive(valid, {fetcher: async () => new Response(ZIP, {headers: {'content-length': String(MAX_ZIP_BYTES + 1)}})}), /允许大小/);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(responseBytes(new Response(stream, {headers: {'content-length': '1'}}), 6), /允许大小/);
  assert.equal(cancelled, true);
});

test('verified archives yield readable PNG Blob URLs and release them on disposal', async () => {
  const [valid] = validateCatalog(catalog(entry()), {root: ROOT, github: GITHUB});
  let fetched, progress = 0;
  const artwork = await loadArchive(valid, {
    fetcher: async (url, options) => { fetched = {url, options}; return new Response(ZIP); },
    onProgress(bytes) { progress = bytes; },
  });
  const url = artwork.imageURLs.get('images/01.png');
  try {
    assert.equal(fetched.url, valid.archiveURL); assert.equal(fetched.options.credentials, 'omit');
    assert.equal(progress, ZIP.length);
    assert.equal(artwork.story.id, valid.id); assert.equal(artwork.story.title, '小故事');
    assert.equal(JSON.stringify(artwork.story).includes('PRIVATE-'), false);
    assert.ok(url.startsWith('blob:'));
    const response = await fetch(url), blob = await response.blob();
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), PNG);
  } finally { artwork.dispose(); }
  await assert.rejects(fetch(url));
});

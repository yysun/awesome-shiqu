// Validate lightweight catalogue loading and archive boundaries without external network requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetURL, githubConfig, loadCatalog, loadArchive, responseBytes, responseJSON, validateCatalog, MAX_ZIP_BYTES } from '../site/assets/library.mjs';
import { crc32, ZIP_LIMITS } from '../site/assets/zip.mjs';
import { encodeArchivePath } from '../site/assets/archive-path.mjs';
import { loadFeatured, matchFeatured, validateFeatured } from '../site/assets/featured.mjs';

const ROOT = new URL('https://reader.example/awesome-shiqu/');
const GITHUB = { owner: 'yysun', repo: 'awesome-shiqu', branch: 'main', directory: 'works', catalog: 'catalog/catalog.json' };
const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const RAW = `https://raw.githubusercontent.com/${GITHUB.owner}/${GITHUB.repo}`;
const PAGES = 'https://yysun.github.io/awesome-shiqu/';
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
function publishedEntry() {
  const {archive, ...data} = entry(false), directory = `public/${data.id}/${SHA256}`;
  return {...data, version: SHA256, cover: `${directory}/images/01.png`, url: `${directory}/story.json`};
}
const catalog = (...stories) => ({ schemaVersion: 1, stories });
const jsonResponse = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function fakeFetcher(routes) {
  const calls = [];
  return {
    calls,
    fetcher: async (input, options = {}) => {
      const url = String(input); calls.push({ url, options });
      if (url === API && !routes.has(url)) return new Response('Not found', { status: 404 });
      assert.ok(routes.has(url), `Unexpected request: ${url}`);
      const result = routes.get(url);
      if (result instanceof Error) throw result;
      return typeof result === 'function' ? result() : result;
    },
  };
}

test('remote catalogue comes from the selected published Pages deployment with immutable resources', async () => {
  const remoteCatalog = new URL('catalog.json', PAGES).href;
  const mock = fakeFetcher(new Map([
    [new URL('config.json', ROOT).href, jsonResponse({ github: GITHUB })],
    [remoteCatalog, jsonResponse(catalog(publishedEntry()))],
  ]));
  const loaded = await loadCatalog({ root: ROOT, fetcher: mock.fetcher });
  assert.equal(loaded.source, 'github'); assert.equal(loaded.remoteUnavailable, false);
  assert.equal(loaded.stories[0].manifestURL, new URL(publishedEntry().url, PAGES).href);
  assert.equal(loaded.stories[0].coverURL, new URL(publishedEntry().cover, PAGES).href);
  assert.deepEqual(mock.calls.map(call => call.url), [new URL('config.json', ROOT).href, remoteCatalog]);
  for (const { url, options } of mock.calls) {
    assert.equal(options.credentials, new URL(url).origin === ROOT.origin ? 'same-origin' : 'omit'); assert.ok(options.signal instanceof AbortSignal);
  }
});

test('catalogue storyboard credits validate model names without guessing from generic generation models', () => {
  const loaded = validateCatalog(catalog({ ...entry(false), storyboardModels: [' storyboard-model ', 'storyboard-model'] }), { root: ROOT });
  assert.deepEqual(loaded[0].storyboardModels, ['storyboard-model']);
  assert.equal(validateCatalog(catalog({ ...entry(false), generationModels: ['image-model'] }), { root: ROOT })[0].storyboardModels, undefined);
  for (const value of [null, 'model', [7], [''], ['m'.repeat(201)], Array(1001).fill('model')]) {
    assert.throws(() => validateCatalog(catalog({ ...entry(false), storyboardModels: value }), { root: ROOT }), /模型/);
  }
});

test('remote storyboard credits load from the lightweight catalogue without downloading ZIPs', async () => {
  const mock = fakeFetcher(new Map([
    [new URL('config.json', ROOT).href, jsonResponse({ github: GITHUB })],
    [new URL('catalog.json', PAGES).href, jsonResponse(catalog({ ...publishedEntry(), storyboardModels: ['storyboard-model'] }))],
  ]));
  const loaded = await loadCatalog({ root: ROOT, fetcher: mock.fetcher });
  assert.equal(loaded.source, 'github');
  assert.deepEqual(loaded.stories[0].storyboardModels, ['storyboard-model']);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls.some(call => call.url.endsWith('.zip')), false);
});

test('404 and network failures use the local published catalogue without losing the failure state', async () => {
  for (const failure of [new Response('Not found', { status: 404 }), new TypeError('Network unavailable')]) {
    const mock = fakeFetcher(new Map([
      [new URL('config.json', ROOT).href, jsonResponse({ github: GITHUB })],
      [new URL('catalog.json', PAGES).href, failure],
      [new URL('catalog.json', ROOT).href, jsonResponse(catalog(entry(false)))],
    ]));
    const loaded = await loadCatalog({ root: ROOT, fetcher: mock.fetcher });
    assert.equal(loaded.source, 'local'); assert.equal(loaded.remoteUnavailable, true);
    assert.equal(loaded.stories[0].archiveURL, new URL('works/alice/tiny.zip', ROOT).href);
    assert.equal(loaded.stories[0].coverURL, new URL('catalog/covers/alice--tiny.png', ROOT).href);
  }
});

test('an unavailable publication falls back only to a complete local catalogue', async () => {
  const mock = fakeFetcher(new Map([
    [new URL('config.json', ROOT).href, jsonResponse({github:GITHUB})],
    [new URL('catalog.json', PAGES).href, new Response('', {status:404})],
    [new URL('catalog.json', ROOT).href, jsonResponse(catalog(publishedEntry()))],
  ]));
  const loaded = await loadCatalog({root:ROOT, fetcher:mock.fetcher});
  assert.equal(loaded.source, 'local'); assert.equal(loaded.remoteUnavailable, true);
  assert.equal(loaded.stories[0].manifestURL, new URL(publishedEntry().url, ROOT).href);
  assert.equal(mock.calls.length, 3);
});

test('legacy missing configuration and explicitly local mode make no GitHub request', async () => {
  for (const configResponse of [new Response('', { status: 404 }), jsonResponse({ github: GITHUB, preferRemoteCatalog: false })]) {
    const mock = fakeFetcher(new Map([
      [new URL('config.json', ROOT).href, configResponse],
      [new URL('catalog.json', ROOT).href, jsonResponse(catalog())],
    ]));
    const loaded = await loadCatalog({ root: ROOT, fetcher: mock.fetcher });
    assert.equal(loaded.source, 'local'); assert.equal(loaded.remoteUnavailable, false);
    assert.equal(mock.calls.length, 2);
    assert.deepEqual(loaded.stories, []);
  }
});

test('private Sites keep same-origin authentication for config, fallback catalog, and bundled ZIP', async () => {
  const seen = [];
  const fetcher = async (input, options) => {
    const url = new URL(input); seen.push({ url: url.href, credentials: options.credentials });
    if (url.origin !== ROOT.origin || options.credentials !== 'same-origin') return new Response('Unauthorized', { status: 401 });
    if (url.pathname.endsWith('/config.json')) return jsonResponse({ github: GITHUB, preferRemoteCatalog: false });
    if (url.pathname.endsWith('/catalog.json')) return jsonResponse(catalog(entry(false)));
    if (url.pathname.endsWith('/tiny.zip')) return new Response(ZIP);
    throw Error('Unexpected private-site request');
  };
  const loaded = await loadCatalog({ root: ROOT, fetcher });
  assert.equal(loaded.source, 'local'); assert.equal(loaded.stories.length, 1);
  const artwork = await loadArchive(loaded.stories[0], { root: ROOT, fetcher });
  try { assert.equal(artwork.story.title, '小故事'); assert.equal(seen.length, 3); }
  finally { artwork.dispose(); }
});

test('asset boundaries reject other origins, repositories, moving ZIP refs, and traversal', () => {
  const options = { root: ROOT, github: GITHUB, archive: true };
  for (const value of [
    'https://evil.example/works/alice/tiny.zip',
    `${RAW.replace('/yysun/', '/other/')}/${COMMIT}/works/alice/tiny.zip`,
    `${RAW}/main/works/alice/tiny.zip`,
    `${RAW}/${COMMIT}/private/tiny.zip`,
    `${RAW}/${COMMIT}/works/%2e%2e/private/tiny.zip`,
    `${RAW}/${COMMIT}/works/alice%2f..%2f..%2fprivate/tiny.zip`,
    '../../works/alice/tiny.zip',
    'works/alice%2f..%2f..%2fprivate/tiny.zip',
    'works/alice/子目录%2f作品.zip',
    `${RAW}/${COMMIT}/works/alice/子目录%2f作品.zip`,
    `${RAW}/${COMMIT}/works/alice/nested/tiny.zip`,
    `${RAW}/${COMMIT}/works/alice/名字%00.zip`,
    'https://user:secret@raw.githubusercontent.com/yysun/awesome-shiqu/' + COMMIT + '/works/alice/tiny.zip',
    'data:application/zip;base64,AAAA',
    'javascript:alert(1)',
  ]) assert.throws(() => assetURL(value, options), /作品/);
  assert.throws(() => assetURL(`${RAW}/main/works/cover.png`, { root: ROOT, github: GITHUB }), /封面/);
  assert.throws(() => githubConfig({ github: { ...GITHUB, catalog: '../catalog.json' } }), /目录/);
  assert.throws(() => githubConfig({ github: { ...GITHUB, owner: 'owner/other' } }), /账号/);
});

test('catalogues accept large Shiqu exports and correctly encoded Chinese filenames', async () => {
  assert.equal(MAX_ZIP_BYTES, ZIP_LIMITS.archiveBytes);
  const path = encodeArchivePath('works/alice/黄忠 Story #1 (100%).zip');
  for (const remote of [false, true]) {
    const item = { ...entry(remote), archive: remote ? `${RAW}/${COMMIT}/${path}` : path, archiveBytes: 96680790 };
    const [valid] = validateCatalog(catalog(item), { root: ROOT, github: GITHUB });
    assert.equal(decodeURIComponent(new URL(valid.archiveURL).pathname).endsWith('/works/alice/黄忠 Story #1 (100%).zip'), true);
    assert.throws(() => validateCatalog(catalog({ ...item, archiveBytes: MAX_ZIP_BYTES + 1 }), { root: ROOT, github: GITHUB }), /目录信息/);
    let requested;
    const artwork = await loadArchive({ ...valid, archiveBytes: ZIP.length }, {
      root: ROOT, fetcher: async url => { requested = url; return new Response(ZIP); },
    });
    try { assert.equal(requested, valid.archiveURL); assert.equal(artwork.story.title, '小故事'); }
    finally { artwork.dispose(); }
  }
});

test('a malformed remote catalogue falls back before fetching an unapproved archive', async () => {
  const malicious = { ...entry(), archive: 'https://evil.example/tiny.zip' };
  assert.throws(() => validateCatalog(catalog(malicious), { root: ROOT, github: GITHUB }), /作品/);
  const mock = fakeFetcher(new Map([
    [new URL('config.json', ROOT).href, jsonResponse({ github: GITHUB })],
    [new URL('catalog.json', PAGES).href, jsonResponse(catalog(malicious))],
    [new URL('catalog.json', ROOT).href, jsonResponse(catalog())],
  ]));
  const loaded = await loadCatalog({ root: ROOT, fetcher: mock.fetcher });
  assert.equal(loaded.source, 'local'); assert.equal(loaded.remoteUnavailable, true);
  assert.equal(mock.calls.length, 3);
  assert.equal(mock.calls.some(call => call.url.startsWith('https://evil.example')), false);
});

test('archive loading verifies byte count and SHA-256 before interpreting the story', async () => {
  const [valid] = validateCatalog(catalog(entry()), { root: ROOT, github: GITHUB });
  await assert.rejects(loadArchive({ ...valid, archiveBytes: ZIP.length + 1 }, { fetcher: async () => new Response(ZIP) }), /大小与收录/);
  await assert.rejects(loadArchive({ ...valid, archiveBytes: ZIP.length - 1 }, { fetcher: async () => new Response(ZIP) }), /大小与收录/);
  await assert.rejects(loadArchive({ ...valid, sha256: '0'.repeat(64) }, { fetcher: async () => new Response(ZIP) }), /收录版本/);
  await assert.rejects(loadArchive(valid, { fetcher: async () => new Response('missing', { status: 404 }) }), /暂时无法下载/);
  await assert.rejects(loadArchive(valid, { fetcher: async () => new Response(ZIP, { headers: { 'content-length': String(MAX_ZIP_BYTES + 1) } }) }), /允许大小/);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(responseBytes(new Response(stream, { headers: { 'content-length': '1' } }), 6), /允许大小/);
  assert.equal(cancelled, true);
  cancelled = false;
  const oversized = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(responseBytes(new Response(oversized), 10, () => { }, 6), /大小与收录/);
  assert.equal(cancelled, true);
});

test('JSON responses are bounded by encoded bytes before parsing', async () => {
  const encoded = JSON.stringify({ value: '界'.repeat(22000) });
  assert.ok(encoded.length < 64 * 1024);
  await assert.rejects(responseJSON(new Response(encoded), 64 * 1024), /允许大小/);
  assert.deepEqual(await responseJSON(new Response('{"value":"界"}'), 64 * 1024), { value: '界' });
});

test('verified archives yield readable PNG Blob URLs and release them on disposal', async () => {
  const [valid] = validateCatalog(catalog(entry()), { root: ROOT, github: GITHUB });
  let fetched, progress = 0;
  const artwork = await loadArchive(valid, {
    fetcher: async (url, options) => { fetched = { url, options }; return new Response(ZIP); },
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

test('catalogue source paths are optional but must point into the works directory', () => {
  assert.equal(validateCatalog(catalog(entry(false)), { root: ROOT })[0].sourcePath, undefined);
  assert.equal(validateCatalog(catalog({ ...entry(false), sourcePath: 'works/alice/tiny.zip' }), { root: ROOT })[0].sourcePath, 'works/alice/tiny.zip');
  for (const bad of ['stories/alice/tiny.zip', 'works/alice/../tiny.zip', 'works/Alice/tiny.zip', 42]) {
    assert.throws(() => validateCatalog(catalog({ ...entry(false), sourcePath: bad }), { root: ROOT }), /来源路径/);
  }
});

test('featured lists validate strictly, tolerate a missing file, and only match catalogued paths', async () => {
  const good = validateFeatured({ stories: [{ path: 'works/alice/tiny.zip', note: ' 推荐语 ' }, { path: 'works/bob/另一篇.zip' }] });
  assert.deepEqual(good, { stories: [{ path: 'works/alice/tiny.zip', note: '推荐语' }, { path: 'works/bob/另一篇.zip', note: '' }] });
  assert.throws(() => validateFeatured([]), /stories/);
  assert.throws(() => validateFeatured({ stories: [{ path: 'stories/x/story.json' }] }), /works/);
  assert.throws(() => validateFeatured({ stories: [{ path: 'works/alice/tiny.zip', prompt: 'x' }] }), /只能包含/);
  assert.throws(() => validateFeatured({ stories: [{ path: 'works/alice/tiny.zip' }, { path: 'works/alice/tiny.zip' }] }), /重复/);
  assert.throws(() => validateFeatured({ stories: [{ path: 'works/alice/tiny.zip', note: 'a'.repeat(201) }] }), /note/);
  assert.throws(() => validateFeatured({ stories: Array.from({ length: 51 }, (_, i) => ({ path: `works/alice/${i}.zip` })) }), /50/);

  const url = new URL('featured.json', ROOT).href;
  const missing = fakeFetcher(new Map([[url, new Response('Not found', { status: 404 })]]));
  assert.deepEqual(await loadFeatured({ root: ROOT, fetcher: missing.fetcher }), { stories: [] });
  assert.equal(missing.calls[0].options.credentials, 'same-origin');
  const warnings = [], warn = console.warn; console.warn = message => warnings.push(message);
  try {
    const broken = fakeFetcher(new Map([[url, new Response('{"stories":[{"path":"../x.zip"}]}', { headers: { 'content-type': 'application/json' } })]]));
    assert.deepEqual(await loadFeatured({ root: ROOT, fetcher: broken.fetcher }), { stories: [] });
    assert.equal(warnings.length, 1);
  } finally { console.warn = warn; }
  const offline = fakeFetcher(new Map([[url, new TypeError('offline')]]));
  assert.deepEqual(await loadFeatured({ root: ROOT, fetcher: offline.fetcher }), { stories: [] });
  const live = fakeFetcher(new Map([[url, jsonResponse({ stories: [{ path: 'works/alice/tiny.zip', note: '值得一读' }, { path: 'works/alice/missing.zip' }] })]]));
  const featured = await loadFeatured({ root: ROOT, fetcher: live.fetcher });
  const stories = [{ ...entry(false), sourcePath: 'works/alice/tiny.zip' }, { id: 'legacy', title: '旧作品', pageCount: 1 }];
  assert.deepEqual(matchFeatured(featured, stories).map(({ story, note }) => [story.id, note]), [['alice--tiny', '值得一读']]);
});

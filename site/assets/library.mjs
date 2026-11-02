// Load lightweight catalogues and verified ZIPs only from the selected repository or site.
import {parseStoryArchive, validateGenerationModels} from './story-archive.mjs';
import {sha256Hex} from './sha256.mjs';
import {ZIP_LIMITS} from './zip.mjs';
import {pagePublicFields} from './story-publication.mjs';
import {validArchivePath} from './archive-path.mjs';

export const ROOT = new URL('../', import.meta.url);
export const MAX_ZIP_BYTES = ZIP_LIMITS.archiveBytes;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(value);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
function check(condition, message) { if (!condition) throw Error(message); }
function cleanPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 400 && !/[\\?#\u0000-\u0020]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function githubConfig(input) {
  const value = input?.github;
  if (!isObject(value)) return null;
  check(typeof value.owner === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value.owner), '作品仓库的账号设置无效。');
  check(typeof value.repo === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.repo), '作品仓库名称无效。');
  check(cleanPath(value.branch) && cleanPath(value.directory) && cleanPath(value.catalog), '作品仓库的目录设置无效。');
  return {...value};
}
function rawURL(github, ref, path) {
  return new URL(`https://raw.githubusercontent.com/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`);
}

function pathSegments(pathname) {
  return pathname.split('/').map(part => {
    const decoded = decodeURIComponent(part);
    check(!/[\\/]/.test(decoded), '作品文件路径无效。');
    return decoded;
  });
}

// Only the selected repository or this site's own files can supply artwork.
export function assetURL(value, {root = ROOT, github = null, archive = false} = {}) {
  check(typeof value === 'string' && value.length <= 2000 && !/[\\\u0000-\u0020]/.test(value), '作品文件地址无效。');
  const url = new URL(value, root);
  check(/^https?:$/.test(url.protocol) && !url.username && !url.password && !url.hash, '作品文件地址无效。');
  if (url.origin === root.origin && url.pathname.startsWith(root.pathname)) {
    const relative = pathSegments(url.pathname.slice(root.pathname.length)).join('/');
    if (archive) check(validArchivePath(relative), '作品 ZIP 必须位于投稿目录，且使用有效文件名。');
    else check(cleanPath(relative), '作品文件路径无效。');
    return url;
  }
  check(github && url.origin === 'https://raw.githubusercontent.com', '作品文件必须来自已设置的 GitHub 仓库。');
  const segments = pathSegments(url.pathname.slice(1));
  check(segments[0] === github.owner && segments[1] === github.repo, '作品文件来自其他仓库。');
  const ref = segments[2], relative = segments.slice(3).join('/');
  if (archive) {
    check(/^[0-9a-f]{40}$/i.test(ref) && validArchivePath(relative, github.directory), '作品 ZIP 必须指向已经收录的 GitHub 提交。');
  } else {
    check(cleanPath(relative), '作品文件路径无效。');
    const directory = github.catalog.split('/').slice(0, -1).join('/');
    check((ref === github.branch || /^[0-9a-f]{40}$/i.test(ref)) && relative.startsWith((directory ? directory + '/' : '') + 'covers/'), '作品封面路径无效。');
  }
  return url;
}

export async function responseBytes(response, maximum, onProgress = () => {}, expectedBytes = 0) {
  check(Number.isSafeInteger(expectedBytes) && expectedBytes >= 0 && expectedBytes <= maximum, '下载文件大小无效。');
  const length = Number(response.headers.get('content-length')) || 0;
  check(!length || length <= maximum, '下载文件超过允许大小。');
  if (!response.body?.getReader) {
    const data = new Uint8Array(await response.arrayBuffer());
    check(data.length <= maximum, '下载文件超过允许大小。');
    onProgress(data.length, length || data.length); return data;
  }
  // Catalogued ZIPs have a verified size: keep one download buffer for large exports.
  const data = expectedBytes ? new Uint8Array(expectedBytes) : null;
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(size <= maximum, '下载文件超过允许大小。');
      if (data) {
        check(size <= data.length, '作品 ZIP 大小与收录记录不符，请刷新作品集重试。');
        data.set(value, size - value.byteLength);
      } else chunks.push(value);
      onProgress(size, expectedBytes || length);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (data) return data.subarray(0, size);
  const collected = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { collected.set(chunk, offset); offset += chunk.byteLength; }
  return collected;
}
async function jsonFile(url, fetcher, maximum, milliseconds, credentials = 'omit', headers = {}) {
  const response = await fetcher(url, {cache: 'no-cache', credentials, headers, signal: AbortSignal.timeout(milliseconds)});
  check(response.ok, `作品目录暂时无法加载（${response.status}）。`);
  const bytes = await responseBytes(response, maximum);
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
export function validateCatalog(data, {root = ROOT, github = null} = {}) {
  check(data?.schemaVersion === 1 && Array.isArray(data.stories) && data.stories.length <= 2000, '作品集目录格式不正确。');
  const seen = new Set();
  return data.stories.map(story => {
    check(isObject(story) && validId(story.id) && !seen.has(story.id) && typeof story.title === 'string' && story.title.trim() && story.title.length <= 200 && Number.isSafeInteger(story.pageCount) && story.pageCount >= 1 && story.pageCount <= 80, '作品集目录包含无效或重复作品。');
    seen.add(story.id);
    const result = {...story, coverURL: assetURL(story.cover, {root, github}).href};
    if (story.storyboardModels !== undefined) result.storyboardModels = validateGenerationModels(story.storyboardModels);
    if (story.sourcePath !== undefined) check(validArchivePath(story.sourcePath, github?.directory || 'works'), '作品来源路径无效。');
    if (story.archive !== undefined) {
      check(typeof story.sha256 === 'string' && /^[0-9a-f]{64}$/.test(story.sha256) && Number.isSafeInteger(story.archiveBytes) && story.archiveBytes > 0 && story.archiveBytes <= MAX_ZIP_BYTES && typeof story.author === 'string' && story.author.length <= 120 && validDate(story.publishedAt), '作品 ZIP 的目录信息不完整。');
      result.archiveURL = assetURL(story.archive, {root, github, archive: true}).href;
    } else {
      const url = assetURL(story.url, {root});
      check(url.pathname.startsWith(new URL('stories/', root).pathname) && url.pathname.endsWith('/story.json'), '作品清单路径无效。');
      result.manifestURL = url.href;
    }
    return result;
  });
}
export async function loadCatalog({root = ROOT, fetcher = fetch} = {}) {
  let config = {}, github = null;
  try { config = await jsonFile(new URL('config.json', root), fetcher, 32768, 5000, 'same-origin'); github = githubConfig(config); }
  catch { /* Older collections may have no remote configuration. */ }
  let remoteUnavailable = false;
  if (github && config.preferRemoteCatalog !== false) {
    const api = new URL(`https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/contents/${github.catalog.split('/').map(encodeURIComponent).join('/')}`);
    api.searchParams.set('ref', github.branch);
    // A freshly created branch may not yet be available at the raw-content CDN.
    // Use the public Contents API only if that normal, cacheable route fails.
    for (const [url, headers] of [[rawURL(github, github.branch, github.catalog), {}], [api, {Accept: 'application/vnd.github.raw+json'}]]) {
      try {
        const data = await jsonFile(url, fetcher, MAX_CATALOG_BYTES, 6500, 'omit', headers);
        return {stories: validateCatalog(data, {root, github}), github, source: 'github', remoteUnavailable: false};
      } catch { remoteUnavailable = true; }
    }
  }
  const data = await jsonFile(new URL('catalog.json', root), fetcher, MAX_CATALOG_BYTES, 10000, 'same-origin');
  return {stories: validateCatalog(data, {root, github}), github, source: 'local', remoteUnavailable};
}

function createArtwork(prepared) {
  const imageURLs = new Map(), allocated = [];
  try {
    for (const image of prepared.images) {
      const url = URL.createObjectURL(new Blob([image.bytes], {type: image.mime}));
      allocated.push(url); imageURLs.set(image.name, url);
    }
  } catch (error) { for (const url of allocated) URL.revokeObjectURL(url); throw error; }
  return {story: prepared.manifest, imageURLs, dispose() { for (const url of allocated) URL.revokeObjectURL(url); }};
}
export async function loadArchive(entry, {fetcher = fetch, onProgress = () => {}, root = ROOT} = {}) {
  check(typeof entry.archiveURL === 'string', '作品 ZIP 地址缺失。');
  const credentials = new URL(entry.archiveURL).origin === root.origin ? 'same-origin' : 'omit';
  const response = await fetcher(entry.archiveURL, {credentials, signal: AbortSignal.timeout(300000)});
  check(response.ok, '作品 ZIP 暂时无法下载，请稍后重试。');
  const bytes = await responseBytes(response, MAX_ZIP_BYTES, onProgress, entry.archiveBytes);
  check(bytes.length === entry.archiveBytes, '作品 ZIP 大小与收录记录不符，请刷新作品集重试。');
  const digest = await sha256Hex(bytes);
  check(digest === entry.sha256, '作品 ZIP 与收录版本不符，请刷新作品集重试。');
  const prepared = await parseStoryArchive(bytes, {id: entry.id, author: entry.contributor||entry.author||'未注明投稿者', publishedAt: entry.publishedAt});
  check(prepared.manifest.pages.length === entry.pageCount, '故事页数与收录记录不符。');
  return createArtwork(prepared);
}
// Hash-bearing standalone works are verified before display, then use the exact checked bytes.
// Hashless pages keep their original confined URL; all newly allocated URLs have one disposal path.
export async function loadManifestArtwork(story,manifestURL,{fetcher=fetch,onProgress=()=>{}}={}){
  check(Array.isArray(story.pages)&&story.pages.length>=1&&story.pages.length<=ZIP_LIMITS.pages,'故事页数无效。');
  const seen=new Set();
  for(const page of story.pages){
    check(typeof page.image==='string'&&/^images\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/.test(page.image),'画面文件路径无效。');
    const key=page.image.toLowerCase();check(!seen.has(key),'作品清单含有重复图片路径。');seen.add(key);
  }
  const root=new URL('./',manifestURL),imageURLs=new Map(),allocated=[];let total=0;
  const dispose=()=>{for(const url of allocated.splice(0))URL.revokeObjectURL(url);};
  try{
    for(const [index,page] of story.pages.entries()){
      const metadata=pagePublicFields(page),url=assetURL(page.image,{root});
      check(!url.search&&/\.(png|jpe?g|webp)$/i.test(url.pathname),'画面文件路径无效。');
      if(!metadata.sha256){imageURLs.set(page.image,url.href);continue;}
      onProgress(`正在核对第 ${index+1} / ${story.pages.length} 幅图片…`);
      check(total<MAX_ZIP_BYTES,'已校验图片合计超过 100 MiB。');
      const response=await fetcher(url,{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});
      check(response.ok,`第 ${index+1} 幅图片暂时无法读取。`);
      const bytes=await responseBytes(response,Math.min(ZIP_LIMITS.imageBytes,MAX_ZIP_BYTES-total));
      check(bytes.length>0,'图片为空。');total+=bytes.length;
      check(await sha256Hex(bytes)===metadata.sha256,`第 ${index+1} 幅图片 SHA-256 与声明不符。`);
      const extension=url.pathname.match(/\.([a-z]+)$/i)[1].toLowerCase(),type=extension==='jpg'||extension==='jpeg'?'image/jpeg':`image/${extension}`;
      const objectURL=URL.createObjectURL(new Blob([bytes],{type}));allocated.push(objectURL);imageURLs.set(page.image,objectURL);
    }
    return {story,imageURLs,dispose};
  }catch(error){dispose();throw error;}
}
export async function loadLocalArchive(file) {
  check(file && /\.zip$/i.test(file.name) && file.size > 0 && file.size <= MAX_ZIP_BYTES, `请选择不超过 ${MAX_ZIP_BYTES / 1024 / 1024} MiB 的拾趣 ZIP 文件。`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const prepared=await parseStoryArchive(bytes, {id: 'preview--story', author: '本地试读', publishedAt: new Date().toISOString().slice(0, 10)});
  // Opening a local file is not a submission and supplies no contributor identity.
  delete prepared.manifest.contributor;
  return createArtwork(prepared);
}

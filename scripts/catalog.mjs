#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {assert, readLibrary} from './content.mjs';
import {archiveCatalogEntry, mergeCatalogs, readArchiveLibrary} from './archive-library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const rawURL = (owner, repo, ref, relative) => `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${ref.split('/').map(encodeURIComponent).join('/')}/${relative.split('/').map(encodeURIComponent).join('/')}`;

async function directory(folder) {
  await mkdir(folder, {recursive: true});
  const stat = await lstat(folder);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `目录不能是符号链接：${folder}`);
}

async function writeGenerated(filename, bytes) {
  try {
    const stat = await lstat(filename);
    assert(stat.isFile() && !stat.isSymbolicLink(), `生成目标必须是普通文件：${filename}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(filename, bytes);
}

export async function createRepositoryCatalog(root = ROOT, options = {}) {
  let configured = {};
  try { configured = JSON.parse(await readFile(path.join(root, 'site', 'config.json'), 'utf8')).github || {}; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert(configured.directory === undefined || configured.directory === 'works', '当前版本的 GitHub directory 必须为 works。');
  assert(configured.catalog === undefined || configured.catalog === 'catalog/catalog.json', '当前版本的 GitHub catalog 必须为 catalog/catalog.json。');
  const [environmentOwner, environmentRepo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  const owner = options.owner || environmentOwner || configured.owner;
  const repo = options.repo || environmentRepo || configured.repo;
  const branch = options.branch || configured.branch || 'main';
  let commit = options.commit || process.env.GITHUB_SHA;
  if (!commit) {
    try { commit = (await run('git', ['rev-parse', 'HEAD'], {cwd: root})).stdout.trim(); }
    catch { throw new Error('生成 GitHub 目录需要已提交的源码；请在 Git 仓库内运行 pnpm catalog。'); }
  }
  assert(typeof owner === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner), 'GitHub owner 无效。');
  assert(typeof repo === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(repo) && !['.', '..'].includes(repo), 'GitHub repo 无效。');
  assert(typeof branch === 'string' && branch.length < 200 && branch.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && !['.', '..'].includes(part)), 'GitHub branch 无效。');
  assert(/^[a-f0-9]{40}$/.test(commit), 'sourceCommit 必须是完整的 40 字符 Git commit SHA。');
  const archives = await readArchiveLibrary(root, {retainArchive: false});
  const legacy = await readLibrary(root, {retainImages: false});
  assert(!legacy.length, '远程目录只支持 works/ ZIP；请先把已有 stories/ 作品改用原始拾趣 ZIP 提交。旧格式仍可在本地构建阅读。');
  const destination = path.join(root, 'catalog');
  await directory(destination);
  await directory(path.join(destination, 'covers'));
  const entries = [];
  for (const story of archives) {
    const coverPath = `catalog/covers/${story.sha256}${story.coverExtension}`;
    // Keep content-addressed old covers: readers with a cached catalogue can still use them.
    await writeGenerated(path.join(root, coverPath), story.cover);
    entries.push({...archiveCatalogEntry(story),
      archive: rawURL(owner, repo, commit, story.relativePath),
      cover: rawURL(owner, repo, branch, coverPath), sourcePath: story.relativePath});
  }
  const catalog = {...mergeCatalogs({stories: entries}), sourceCommit: commit};
  await writeGenerated(path.join(destination, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const catalog = await createRepositoryCatalog();
    console.log(`已生成 catalog/catalog.json：${catalog.stories.length} 篇作品，ZIP 固定到源码提交 ${catalog.sourceCommit.slice(0, 12)}。`);
  } catch (error) { console.error(`生成目录失败：${error.message}`); process.exitCode = 1; }
}

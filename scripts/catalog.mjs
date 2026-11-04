#!/usr/bin/env node
// Generate a source-review index pointing at the same immutable resources served by Pages.
import {execFile} from 'node:child_process';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {assert} from './content.mjs';
import {build, siteBase} from './build.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
export async function createRepositoryCatalog(root = ROOT, options = {}) {
  let configured = {};
  try { configured = JSON.parse(await readFile(path.join(root, 'site/config.json'), 'utf8')).github || {}; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert(configured.directory === undefined || configured.directory === 'works', '当前版本的 GitHub directory 必须为 works。');
  assert(configured.catalog === undefined || configured.catalog === 'catalog/catalog.json', '当前版本的 GitHub catalog 必须为 catalog/catalog.json。');
  const [environmentOwner, environmentRepo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  const owner = options.owner || environmentOwner || configured.owner, repo = options.repo || environmentRepo || configured.repo;
  assert(typeof owner === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner), 'GitHub owner 无效。');
  assert(typeof repo === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(repo) && !['.', '..'].includes(repo), 'GitHub repo 无效。');
  let commit = options.commit || process.env.GITHUB_SHA;
  if (!commit) commit = (await run('git', ['rev-parse', 'HEAD'], {cwd: root})).stdout.trim();
  assert(/^[a-f0-9]{40}$/.test(commit), 'sourceCommit 必须是完整的 40 字符 Git commit SHA。');
  const destination = path.join(root, 'catalog');
  await mkdir(destination, {recursive: true});
  for (const file of [destination, path.join(destination, 'catalog.json')]) {
    try { const stat = await lstat(file); assert(!stat.isSymbolicLink() && (file === destination ? stat.isDirectory() : stat.isFile()), '目录与生成目标必须是普通文件或真实目录。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await build(root);
  const data = JSON.parse(await readFile(path.join(root, 'dist/catalog.json'), 'utf8')), base = siteBase({github:{owner,repo}});
  const catalog = {...data, sourceCommit: commit, stories: data.stories.map(story => ({...story, url: new URL(story.url, base).href, cover: new URL(story.cover, base).href}))};
  await writeFile(path.join(destination, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  return catalog;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const catalog = await createRepositoryCatalog(); console.log(`已生成静态发布目录：${catalog.stories.length} 篇作品。线上阅读器读取已部署的 Pages catalog.json。`); }
  catch (error) { console.error(`生成目录失败：${error.message}`); process.exitCode = 1; }
}

#!/usr/bin/env node
// Import only public story fields and validated images; never overwrite a reviewed story.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assert, LIMITS, localDate, validateImageName, validateManifest, validateSlug } from './content.mjs';
import { readZip } from './zip.mjs';
import { parseStoryFiles } from '../site/assets/story-archive.mjs';
export { parseStoryboard } from '../site/assets/story-archive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function prepareStory(zip, options) {
  const files = readZip(zip), parsed = parseStoryFiles(files);
  const images = [], used = new Set();
  const digits = Math.max(2, String(parsed.pages.length).length);
  const pages = parsed.pages.map((page, index) => {
    assert(!used.has(page.image), '分镜中重复引用了同一张图片。');
    used.add(page.image);
    const data = files.get(page.image);
    assert(data, `ZIP 缺少第 ${index + 1} 幅图片：${page.image}`);
    const extension = validateImageName(data, page.image);
    const image = `images/${String(index + 1).padStart(digits, '0')}.${extension}`;
    images.push({ name: image, bytes: data });
    assert(!page.sha256 || createHash('sha256').update(data).digest('hex') === page.sha256, `第 ${index + 1} 幅图片 SHA-256 与声明不符。`);
    return { ...page, image };
  });
  const manifest = validateManifest({
    schemaVersion: 1, ...parsed, id: validateSlug(options.slug), author: parsed.author ?? '', contributor: options.author,
    publishedAt: options.date || localDate(), book: options.book || parsed.book,
    source: { ...parsed.source, ...(options.sourceUrl ? { url: options.sourceUrl } : {}) },
    aiGenerated: parsed.aiGenerated === undefined ? true : parsed.aiGenerated, pages,
  });
  return { manifest, images };
}

export async function importStory(inputPath, options, root = ROOT) {
  const stat = await lstat(inputPath);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMITS.archiveBytes,
    `输入必须是普通 ZIP 文件，最大 ${LIMITS.archiveBytes / 1024 / 1024} MiB。`);
  const prepared = prepareStory(await readFile(inputPath), options);
  const storiesRoot = path.join(root, 'stories');
  await mkdir(storiesRoot, { recursive: true });
  const rootStat = await lstat(storiesRoot);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'stories 必须是真实文件夹。');
  const destination = path.join(storiesRoot, prepared.manifest.id);
  try { await mkdir(destination); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`作品 ${prepared.manifest.id} 已存在；不会覆盖，请换 slug 或人工编辑现有作品。`);
    throw error;
  }
  try {
    await mkdir(path.join(destination, 'images'));
    for (const image of prepared.images) await writeFile(path.join(destination, image.name), image.bytes, { flag: 'wx' });
    await writeFile(path.join(destination, 'story.json'), JSON.stringify(prepared.manifest, null, 2) + '\n', { flag: 'wx' });
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
  return prepared.manifest;
}

function help() {
  console.log(`导入拾趣导出的“分镜与图片 ZIP”，生成公开阅读内容。\n\n用法：\n  pnpm import:story /路径/作品.zip --slug cu-zhi --author "投稿者署名"\n\n必填：\n  --slug        小写英文字母、数字及连字符组成的唯一作品 ID\n  --author      作品提交者的公开署名；制作署名以 ZIP 内声明为准\n\n可选：\n  --date        YYYY-MM-DD，默认本地日期\n  --source-url  原作出处的 http/https 链接\n  --book        书名，默认从出处提取\n  --help        显示帮助\n\n导入到 stories/<slug>/；已有作品不会被覆盖。\n制作提示词和画面提示词不写入公开作品。导入后请审阅并运行 pnpm build。`);
}

export function argumentsForImport(args) {
  assert(args.length && !args[0].startsWith('--'), '请提供 ZIP 路径。运行 pnpm import:story --help 查看用法。');
  const result = { inputPath: args[0], options: {} };
  const keys = { '--slug': 'slug', '--author': 'author', '--date': 'date', '--source-url': 'sourceUrl', '--book': 'book' };
  for (let index = 1; index < args.length; index += 2) {
    const key = keys[args[index]], value = args[index + 1];
    assert(key && typeof value === 'string' && value.trim() && !value.startsWith('--'), `无效或缺少值的参数：${args[index]}`);
    assert(!(key in result.options), `重复参数：${args[index]}`);
    result.options[key] = value.trim();
  }
  assert(result.options.slug && result.options.author, '--slug 和 --author 为必填参数。');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) help();
  else {
    try {
      const { inputPath, options } = argumentsForImport(process.argv.slice(2));
      const story = await importStory(path.resolve(inputPath), options);
      console.log(`已导入《${story.title}》：${story.pages.length} 幅，stories/${story.id}/\n请审阅署名、出处、图片和字幕，再运行 pnpm build。`);
    } catch (error) { console.error(`导入失败：${error.message}`); process.exitCode = 1; }
  }
}

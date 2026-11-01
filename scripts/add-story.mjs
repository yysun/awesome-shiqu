#!/usr/bin/env node
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assert} from './content.mjs';
import {MAX_ARCHIVE_BYTES, archiveStoryId, validArchiveSlug, validContributor} from './archive-library.mjs';
import {parseStoryArchive} from '../site/assets/story-archive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function addStory(input, {author, slug}, root = ROOT) {
  assert(validContributor(author), '--author 必须是小写 GitHub 用户名。');
  assert(validArchiveSlug(slug), '--slug 请填写作品文件名（不含 .zip），支持中文；不能含路径分隔符、控制字符或过长。');
  const stat = await lstat(input);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_ARCHIVE_BYTES, `输入必须是最多 ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB 的普通 ZIP 文件。`);
  const bytes = await readFile(input);
  const parsed = await parseStoryArchive(bytes, {id: archiveStoryId(author, `${slug}.zip`), author, publishedAt: stat.mtime.toISOString().slice(0, 10)});
  const works = path.join(root, 'works'), destination = path.join(works, author);
  for (const folder of [works, destination]) {
    await mkdir(folder, {recursive: true});
    const folderStat = await lstat(folder);
    assert(folderStat.isDirectory() && !folderStat.isSymbolicLink(), '作品目录不能是符号链接。');
  }
  try { await writeFile(path.join(destination, `${slug}.zip`), bytes, {flag: 'wx'}); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('作品已存在；更新时请自行审阅后替换原 ZIP。'); throw error; }
  return parsed.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法：pnpm add:story /路径/作品.zip --author github-login --slug story-name\n校验并原样复制到 works/<GitHub 用户名>/<作品编号>.zip；已有文件不会覆盖。');
  } else {
    try {
      assert(args.length === 5 && !args[0].startsWith('--'), '需要 ZIP 路径、--author 和 --slug。');
      const options = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = {'--author': 'author', '--slug': 'slug'}[args[i]];
        assert(key && !options[key] && args[i + 1], '参数无效或重复。'); options[key] = args[i + 1];
      }
      const story = await addStory(path.resolve(args[0]), options);
      console.log(`已添加《${story.title}》：works/${options.author}/${options.slug}.zip。请审阅 ZIP 完整内容后提交 PR。`);
    } catch (error) { console.error(`添加失败：${error.message}`); process.exitCode = 1; }
  }
}

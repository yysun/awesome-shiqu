#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readLibrary} from './content.mjs';
import {readArchiveLibrary} from './archive-library.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('用法：pnpm validate\n检查 works/ 中的 ZIP、分镜、署名目录、图片及大小；兼容已有 stories/，允许空作品集。');
} else {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const stories = await readLibrary(root, {retainImages: false});
    const archives = await readArchiveLibrary(root, {retainArchive: false, retainCover: false});
    const all = [...stories, ...archives];
    console.log(`内容检查通过：${all.length} 篇作品，${all.reduce((sum, story) => sum + story.manifest.pages.length, 0)} 幅画面。`);
  } catch (error) { console.error(`内容检查失败：${error.message}`); process.exitCode = 1; }
}

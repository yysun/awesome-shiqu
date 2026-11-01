#!/usr/bin/env node
import {lstat, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assert, LIMITS, localDate, safeArchivePath, validateImageName, validateManifest, validateSlug} from './content.mjs';
import {readZip} from './zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseStoryboard(input) {
  assert(typeof input === 'string' && input.length && !input.includes('\0'), '分镜.md 为空或不是文本。');
  const markdown = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const parts = markdown.split(/^##\s+(.+?)\s*$/m);
  const header = parts[0].trim(), heading = header.match(/^#\s+([^\n]+)\n?/);
  assert(heading, '分镜.md 缺少一级故事标题。');
  const remaining = header.slice(heading[0].length).trim();
  const metadata = new Map();
  for (const match of remaining.matchAll(/^(主题|出处|出处链接|画风)[：:]\s*(.+)$/gm)) {
    assert(!metadata.has(match[1]), `分镜.md 重复声明${match[1]}。`);
    metadata.set(match[1], match[2].trim());
  }
  const firstMetadata = remaining.search(/^(主题|出处|出处链接|画风)[：:]/m);
  const hook = (firstMetadata < 0 ? remaining : remaining.slice(0, firstMetadata)).trim();
  const pages = [], extras = new Map();
  for (let index = 1; index < parts.length; index += 2) {
    const label = parts[index].trim(), body = (parts[index + 1] || '').trim();
    const frame = label.match(/^第\s*(\d+)\s*幅$/);
    // The legacy export writes production prompts as unescaped Markdown. Ignore
    // headings inside that private prefix until a complete first frame begins.
    if (!pages.length && !(frame?.[1] === '1' && /^图片[：:]\s*.+$/m.test(body) && /^###\s+旁白\s*$/m.test(body))) continue;
    if (frame) {
      assert(Number(frame[1]) === pages.length + 1, '分镜页码必须从 1 开始连续排列，不能重复或缺页。');
      const sections = body.split(/^###\s+(.+?)\s*$/m);
      const images = [...sections[0].matchAll(/^图片[：:]\s*(.+)$/gm)];
      assert(images.length === 1, `第 ${frame[1]} 幅必须包含唯一的图片路径。`);
      const image = safeArchivePath(images[0][1].trim());
      let caption;
      for (let section = 1; section < sections.length; section += 2) {
        if (sections[section].trim() !== '旁白') continue;
        assert(caption === undefined, `第 ${frame[1]} 幅重复声明旁白。`);
        caption = sections[section + 1]?.trim();
      }
      assert(caption, `第 ${frame[1]} 幅缺少旁白。`);
      // A footer-like heading before another frame belongs to a private image
      // prompt. Only the final frame may be followed by public ending sections.
      extras.clear();
      pages.push({image, caption});
      assert(pages.length <= LIMITS.pages, '作品超过 80 幅画面。');
    } else if (label === '余味' || label === '改编说明') {
      assert(!extras.has(label), `分镜.md 的${label}标题存在歧义；请检查提示词中的同名 Markdown 标题后重新导出。`);
      extras.set(label, body);
    }
    // All other sections, including production and image prompts, stay private.
  }
  assert(pages.length, '分镜.md 中没有找到画面。');
  const sourceTitle = metadata.get('出处');
  assert(sourceTitle, '分镜.md 缺少出处。');
  return {
    title: heading[1].trim(), hook, theme: metadata.get('主题') || '',
    artStyle: metadata.get('画风') || '',
    book: sourceTitle.match(/《([^》]+)》/)?.[1] || sourceTitle,
    source: {title: sourceTitle, ...(metadata.get('出处链接') ? {url: metadata.get('出处链接')} : {})},
    reflection: extras.get('余味') || '', adaptationNote: extras.get('改编说明') || '', pages,
  };
}

export function prepareStory(zip, options) {
  const files = readZip(zip), storyboard = files.get('分镜.md');
  assert(storyboard, 'ZIP 根目录缺少分镜.md；请使用拾趣的“分镜与图片 ZIP”导出。');
  let markdown;
  try { markdown = new TextDecoder('utf-8', {fatal: true}).decode(storyboard); }
  catch { throw new Error('分镜.md 必须使用 UTF-8 编码。'); }
  const parsed = parseStoryboard(markdown);
  const images = [], used = new Set();
  const digits = Math.max(2, String(parsed.pages.length).length);
  const pages = parsed.pages.map((page, index) => {
    assert(!used.has(page.image), '分镜中重复引用了同一张图片。');
    used.add(page.image);
    const data = files.get(page.image);
    assert(data, `ZIP 缺少第 ${index + 1} 幅图片：${page.image}`);
    const extension = validateImageName(data, page.image);
    const image = `images/${String(index + 1).padStart(digits, '0')}.${extension}`;
    images.push({name: image, bytes: data});
    return {image, caption: page.caption};
  });
  const manifest = validateManifest({
    schemaVersion: 1, ...parsed, id: validateSlug(options.slug), author: options.author,
    publishedAt: options.date || localDate(), book: options.book || parsed.book,
    source: {...parsed.source, ...(options.sourceUrl ? {url: options.sourceUrl} : {})},
    aiGenerated: true, pages,
  });
  return {manifest, images};
}

export async function importStory(inputPath, options, root = ROOT) {
  const stat = await lstat(inputPath);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMITS.archiveBytes,
    '输入必须是普通 ZIP 文件，最大 256 MiB。');
  const prepared = prepareStory(await readFile(inputPath), options);
  const storiesRoot = path.join(root, 'stories');
  await mkdir(storiesRoot, {recursive: true});
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
    for (const image of prepared.images) await writeFile(path.join(destination, image.name), image.bytes, {flag: 'wx'});
    await writeFile(path.join(destination, 'story.json'), JSON.stringify(prepared.manifest, null, 2) + '\n', {flag: 'wx'});
  } catch (error) { await rm(destination, {recursive: true, force: true}); throw error; }
  return prepared.manifest;
}

function help() {
  console.log(`导入拾趣导出的“分镜与图片 ZIP”，生成公开阅读内容。\n\n用法：\n  pnpm import:story /路径/作品.zip --slug cu-zhi --author "作者署名"\n\n必填：\n  --slug        小写英文字母、数字及连字符组成的唯一作品 ID\n  --author      作品提交者或制作人的公开署名\n\n可选：\n  --date        YYYY-MM-DD，默认本地日期\n  --source-url  原作出处的 http/https 链接\n  --book        书名，默认从出处提取\n  --help        显示帮助\n\n导入到 stories/<slug>/；已有作品不会被覆盖。\n制作提示词和画面提示词不写入公开作品。导入后请审阅并运行 pnpm build。`);
}

export function argumentsForImport(args) {
  assert(args.length && !args[0].startsWith('--'), '请提供 ZIP 路径。运行 pnpm import:story --help 查看用法。');
  const result = {inputPath: args[0], options: {}};
  const keys = {'--slug': 'slug', '--author': 'author', '--date': 'date', '--source-url': 'sourceUrl', '--book': 'book'};
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
      const {inputPath, options} = argumentsForImport(process.argv.slice(2));
      const story = await importStory(path.resolve(inputPath), options);
      console.log(`已导入《${story.title}》：${story.pages.length} 幅，stories/${story.id}/\n请审阅署名、出处、图片和字幕，再运行 pnpm build。`);
    } catch (error) { console.error(`导入失败：${error.message}`); process.exitCode = 1; }
  }
}

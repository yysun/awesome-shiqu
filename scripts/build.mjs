#!/usr/bin/env node
import {copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assert, LIMITS, makeCatalog, readLibrary} from './content.mjs';
import {archiveCatalogEntry, mergeCatalogs, readArchiveLibrary} from './archive-library.mjs';
import {storyRoutes} from '../site/assets/story-url.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,219}$/u;
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function summarize(value, fallback = '') {
  const text = String(value || fallback).replace(/\s+/g, ' ').trim();
  const short = [...text].slice(0, 160).join('');
  return short.length < text.length ? short + '…' : short;
}

// GitHub Pages project URL for canonical links and the sitemap; custom domains can be added later.
export function siteBase(config) {
  const github = config?.github;
  if (!github || typeof github.owner !== 'string' || typeof github.repo !== 'string' || !github.owner || !github.repo) return null;
  const owner = github.owner.toLowerCase();
  try {
    return new URL(github.repo.toLowerCase() === `${owner}.github.io`
      ? `https://${owner}.github.io/` : `https://${owner}.github.io/${encodeURIComponent(github.repo)}/`);
  } catch { return null; }
}

function headBlock(lines) { return lines.filter(Boolean).map(line => '  ' + line).join('\n'); }

function seoMeta({title, description, canonical, cover, type}) {
  return [
    canonical && `<link rel="canonical" href="${escapeHTML(canonical)}">`,
    `<meta property="og:type" content="${type}">`,
    '<meta property="og:site_name" content="拾趣好故事">',
    `<meta property="og:title" content="${escapeHTML(title)}">`,
    `<meta property="og:description" content="${escapeHTML(description)}">`,
    canonical && `<meta property="og:url" content="${escapeHTML(canonical)}">`,
    cover && `<meta property="og:image" content="${escapeHTML(cover)}">`,
  ];
}

function coverURL(cover, base) {
  if (typeof cover !== 'string' || !cover) return null;
  if (/^https?:\/\//.test(cover)) return cover;
  return base ? new URL(cover, base).href : null;
}

export function storyPageHTML(template, entry, route, base) {
  assert(/<title>.*?<\/title>/s.test(template) && /<meta name="description" content="[^"]*">/.test(template) && template.includes('</head>'),
    'site/reader.html 需要包含 <title>、description 和 </head>，才能生成作品页面。');
  const title = `${entry.title} · ${route.bookTitle} · 拾趣好故事`;
  const description = summarize(entry.hook, `《${entry.title}》出自${route.bookTitle}，在拾趣好故事在线阅读这篇连环画。`);
  const extra = headBlock([
    `<meta name="shiqu:story" content="${escapeHTML(entry.id)}">`,
    ...seoMeta({title, description, canonical: base ? new URL(route.path, base).href : null, cover: coverURL(entry.cover, base), type: 'article'}),
  ]);
  return template.replaceAll('"./', '"../../../')
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHTML(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHTML(description)}">`)
    .replace('</head>', `${extra}\n</head>`);
}

export function bookPageHTML(book, base) {
  const title = `${book.title} · 拾趣好故事`;
  const description = summarize(`《${book.title}》的 ${book.entries.length} 篇精选连环画，在拾趣好故事在线阅读。`);
  const cards = book.entries.map(({entry, route}) => {
    const cover = entry.cover && /^https?:\/\//.test(entry.cover) ? entry.cover : entry.cover ? `../../${entry.cover}` : '';
    return `<article class="story-card"><a class="card-link" href="./${escapeHTML(route.storySlug)}/">`
      + (cover ? `<div class="cover-wrap"><img src="${escapeHTML(cover)}" alt="${escapeHTML(entry.title)}封面" loading="lazy" decoding="async"></div>` : '')
      + `<h3 class="card-title">${escapeHTML(entry.title)}</h3><p class="card-hook">${escapeHTML(summarize(entry.hook, '翻开这段故事，读到一点余味。'))}</p>`
      + `<div class="card-meta"><span class="card-credit">${escapeHTML([entry.author, entry.pageCount + ' 幅'].filter(Boolean).join(' · '))}</span><span class="card-action">开始阅读 →</span></div></a></article>`;
  }).join('\n      ');
  const head = headBlock(seoMeta({title, description, canonical: base ? new URL(book.route.bookPath, base).href : null,
    cover: coverURL(book.entries[0]?.entry.cover, base), type: 'website'}));
  return `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7f4ed">
  <meta name="description" content="${escapeHTML(description)}">
  <title>${escapeHTML(title)}</title>
${head}
  <link rel="icon" href="../../assets/mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../../assets/site.css">
</head>
<body>
  <header class="masthead wrap"><a class="brand" href="../../" aria-label="拾趣好故事首页"><span class="seal" aria-hidden="true">拾</span><span>拾趣<span class="brand-small">好故事</span></span></a><nav aria-label="主导航"><a class="nav-link" href="../../#collection">作品集</a></nav></header>
  <main>
    <section class="collection wrap" aria-labelledby="book-title">
      <div class="section-heading"><div><p class="eyebrow">THE BOOK</p><h1 id="book-title">${escapeHTML(book.title)} <span class="count">${book.entries.length} 篇</span></h1></div></div>
      <div class="story-grid">
      ${cards}
      </div>
    </section>
  </main>
  <footer class="footer wrap"><span>拾趣好故事</span><span>古典有余味，画页有新意。</span><a href="../../">返回作品集</a></footer>
</body>
</html>
`;
}

export function sitemapXML(base, books) {
  const urls = [`  <url><loc>${escapeHTML(base.href)}</loc></url>`];
  for (const book of books.values()) {
    const lastmod = book.entries.map(({entry}) => entry.publishedAt).filter(Boolean).sort().at(-1);
    urls.push(`  <url><loc>${escapeHTML(new URL(book.route.bookPath, base).href)}</loc>${lastmod ? `<lastmod>${escapeHTML(lastmod)}</lastmod>` : ''}</url>`);
    for (const {entry, route} of book.entries) {
      urls.push(`  <url><loc>${escapeHTML(new URL(route.path, base).href)}</loc>${entry.publishedAt ? `<lastmod>${escapeHTML(entry.publishedAt)}</lastmod>` : ''}</url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

async function copySite(source, destination, topLevel = true) {
  const stat = await lstat(source);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'site/ 必须是真实文件夹。');
  let bytes = 0;
  for (const entry of await readdir(source, {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    assert(!topLevel || !['stories', 'works', 'covers', 'books', 'sitemap.xml'].includes(entry.name), `site/${entry.name} 是作品构建保留路径。`);
    assert(!entry.isSymbolicLink(), `site/ 不允许符号链接：${entry.name}`);
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to);
      bytes += await copySite(from, to, false);
      assert(bytes <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
    } else {
      assert(entry.isFile(), `site/ 不允许特殊文件：${entry.name}`);
      bytes += (await lstat(from)).size;
      assert(bytes <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
      await copyFile(from, to);
    }
  }
  return bytes;
}

export async function build(root = ROOT) {
  const stories = await readLibrary(root);
  const archives = await readArchiveLibrary(root);
  const destination = path.join(root, 'dist');
  try {
    const stat = await lstat(destination);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'dist/ 必须是真实输出文件夹，不能是符号链接。');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = await mkdtemp(path.join(root, '.dist-build-'));
  try {
    let size = await copySite(path.join(root, 'site'), staging);
    assert((await lstat(path.join(staging, 'index.html'))).isFile(), 'site/index.html 不存在。');
    assert((await lstat(path.join(staging, 'reader.html'))).isFile(), 'site/reader.html 不存在。');
    for (const {manifest, images} of stories) {
      const storyDirectory = path.join(staging, 'stories', manifest.id);
      await mkdir(path.join(storyDirectory, 'images'), {recursive: true});
      const json = JSON.stringify(manifest, null, 2) + '\n';
      size += Buffer.byteLength(json);
      await writeFile(path.join(storyDirectory, 'story.json'), json);
      for (const image of images) {
        size += image.bytes.length;
        assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
        await writeFile(path.join(storyDirectory, image.name), image.bytes);
      }
    }
    for (const story of archives) {
      for (const [relative, bytes] of [[story.relativePath, story.archive], [story.coverName, story.cover]]) {
        size += bytes.length;
        assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
        const destinationFile = path.join(staging, relative);
        await mkdir(path.dirname(destinationFile), {recursive: true});
        await writeFile(destinationFile, bytes);
      }
    }
    const catalog = mergeCatalogs(makeCatalog(stories), {stories: archives.map(archiveCatalogEntry)});
    // SEO-friendly pages: books/<book>/ and books/<book>/<story>/ for every published story.
    let config = null;
    try { config = JSON.parse(await readFile(path.join(root, 'site', 'config.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const base = siteBase(config);
    const template = await readFile(path.join(root, 'site', 'reader.html'), 'utf8');
    const routes = storyRoutes(catalog.stories);
    const books = new Map();
    for (const entry of catalog.stories) {
      const route = routes.get(entry.id);
      assert(route && SEGMENT.test(route.bookSlug) && SEGMENT.test(route.storySlug), `无法为作品生成页面路径：${entry.id}`);
      const html = storyPageHTML(template, entry, route, base);
      size += Buffer.byteLength(html);
      assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
      const file = path.join(staging, 'books', route.bookSlug, route.storySlug, 'index.html');
      await mkdir(path.dirname(file), {recursive: true});
      await writeFile(file, html);
      if (!books.has(route.bookSlug)) books.set(route.bookSlug, {title: route.bookTitle, route, entries: []});
      books.get(route.bookSlug).entries.push({entry, route});
    }
    for (const book of books.values()) {
      const html = bookPageHTML(book, base);
      size += Buffer.byteLength(html);
      assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
      await writeFile(path.join(staging, 'books', book.route.bookSlug, 'index.html'), html);
    }
    if (base) {
      const sitemap = sitemapXML(base, books);
      size += Buffer.byteLength(sitemap);
      assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
      await writeFile(path.join(staging, 'sitemap.xml'), sitemap);
    }
    const catalogJson = JSON.stringify(catalog, null, 2) + '\n';
    size += Buffer.byteLength(catalogJson);
    assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
    await writeFile(path.join(staging, 'catalog.json'), catalogJson);
    await writeFile(path.join(staging, '.nojekyll'), '');
    await rm(destination, {recursive: true, force: true});
    await rename(staging, destination);
    return {count: catalog.stories.length, pages: catalog.stories.reduce((sum, story) => sum + story.pageCount, 0), books: books.size, bytes: size};
  } catch (error) { await rm(staging, {recursive: true, force: true}); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('用法：pnpm build\n验证 works/<GitHub 用户名>/<作品编号>.zip，生成书架目录和封面，并原样复制 ZIP。\n兼容已有 stories/ 作品。空作品集可以正常构建。');
  } else {
    try {
      const result = await build();
      console.log(`已生成 dist/：${result.count} 篇作品，${result.pages} 幅画面，${result.books} 个书目页面，${(result.bytes / 1024 / 1024).toFixed(2)} MiB。`);
    } catch (error) { console.error(`构建失败：${error.message}`); process.exitCode = 1; }
  }
}

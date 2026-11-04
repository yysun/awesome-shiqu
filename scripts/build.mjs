#!/usr/bin/env node
// Publish reviewed stories and portable static book pages without exposing private metadata.
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assert, LIMITS, makeCatalog, readLibrary } from './content.mjs';
import { mergeCatalogs, readArchiveLibrary } from './archive-library.mjs';
import { FACETS, facetOf, facetRoutes, groupByBook, slugConflicts, storyRoutes } from '../site/assets/story-url.mjs';
import { validateFeatured } from '../site/assets/featured.mjs';

import {preparePublication, writePublication, retainPublications} from './static-publication.mjs';
import {staticStoryHTML} from './story-html.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,219}$/u;
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unescapeHTML = value => String(value).replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[name]));

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

function seoMeta({ title, description, canonical, cover, type }) {
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
    ...seoMeta({ title, description, canonical: base ? new URL(route.path, base).href : null, cover: coverURL(entry.cover, base), type: 'article' }),
  ]);
  return template.replaceAll('"./', '"../../../')
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHTML(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHTML(description)}">`)
    .replace('</head>', `${extra}\n</head>`);
}

const NAV = [
  { key: 'featured', path: 'featured/', label: '精选' },
  { key: 'books', path: 'books/', label: '书目' },
  { key: 'themes', path: 'themes/', label: '分类' },
  { key: 'collection', path: 'collection/', label: '全部作品' },
];
const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"></circle><path d="m16 16 4.2 4.2"></path></svg>';
const prefixFor = depth => '../'.repeat(depth);
const homeHref = prefix => prefix || './';

// One masthead for every shell page; the featured item disappears when site/featured.json is empty.
export function mastheadHTML({ prefix = '', active = null, featured = true } = {}) {
  const items = NAV.filter(item => featured || item.key !== 'featured').map(item => item.key === active
    ? `<a class="nav-link active" href="${prefix}${item.path}" aria-current="page">${item.label}</a>`
    : `<a class="nav-link" href="${prefix}${item.path}">${item.label}</a>`).join('');
  return `<header class="masthead wrap"><a class="brand" href="${homeHref(prefix)}" aria-label="拾趣好故事首页"><span class="seal" aria-hidden="true">拾</span><span>拾趣<span class="brand-small">好故事</span></span></a><nav aria-label="主导航">${items}</nav><form class="masthead-search" role="search" action="${prefix}collection/" method="get"><label><span class="sr-only">搜索故事、原著或作者</span><input type="search" name="q" placeholder="搜索…" maxlength="120" autocomplete="off"></label><button type="submit" aria-label="搜索">${SEARCH_ICON}</button></form></header>`;
}

export function footerHTML(prefix = '') {
  return `<footer class="footer wrap"><span>拾趣好故事</span><span>古典有余味，画页有新意。</span><nav class="footer-links" aria-label="页脚"><a href="${homeHref(prefix)}#contribute">投稿</a><a href="${prefix}reader.html?preview=1">ZIP 试读</a><a href="https://github.com/yysun/shiqu" target="_blank" rel="noopener noreferrer">开源项目 ↗</a></nav></footer>`;
}

function pageShell({ depth, active, featured, title, description, canonical, cover, type = 'website', skip, body, scripts = [] }) {
  const prefix = prefixFor(depth);
  const head = headBlock([
    ...seoMeta({ title, description, canonical, cover, type }),
    `<link rel="icon" href="${prefix}assets/mark.svg" type="image/svg+xml">`,
    `<link rel="stylesheet" href="${prefix}assets/site.css">`,
    ...scripts.map(name => `<script type="module" src="${prefix}assets/${name}"></script>`),
  ]);
  const interactive = scripts.length > 0;
  return `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7f4ed">
  <meta name="description" content="${escapeHTML(description)}">
  <title>${escapeHTML(title)}</title>
${head}
</head>
<body>
  <a class="skip-link" href="#${skip.id}">${escapeHTML(skip.label)}</a>
  ${mastheadHTML({ prefix, active, featured })}
  <main>
${body}
  </main>
  ${footerHTML(prefix)}${interactive ? `
  <div id="toast" class="toast" role="status" hidden></div>
  <noscript><p class="noscript wrap">请启用 JavaScript 以浏览作品集。</p></noscript>` : ''}
</body>
</html>
`;
}

const coverSrc = (cover, prefix) => typeof cover === 'string' && cover ? (/^https?:\/\//.test(cover) ? cover : prefix + cover) : '';
const canonicalFor = (base, path) => base ? new URL(path, base).href : null;

function storyCardHTML(entry, { href, prefix, label = '' }) {
  const cover = coverSrc(entry.cover, prefix);
  return `<article class="story-card"><a class="card-link" href="${escapeHTML(href)}">`
    + (cover ? `<div class="cover-wrap"><img src="${escapeHTML(cover)}" alt="${escapeHTML(entry.title)}封面" loading="lazy" decoding="async">${label ? `<span class="cover-label">${escapeHTML(label)}</span>` : ''}</div>` : '')
    + `<h3 class="card-title">${escapeHTML(entry.title)}</h3><p class="card-hook">${escapeHTML(summarize(entry.hook, '翻开这段故事，读到一点余味。'))}</p>`
    + `<div class="card-meta"><span class="card-credit">${escapeHTML([entry.author, entry.pageCount + ' 幅'].filter(Boolean).join(' · '))}</span><span class="card-action">开始阅读 →</span></div></a></article>`;
}

function groupCardHTML({ href, prefix, title, count, cover, hook, heading = 'h2' }) {
  const src = coverSrc(cover, prefix);
  return `<article class="story-card group-card"><a class="card-link" href="${escapeHTML(href)}">`
    + (src ? `<div class="cover-wrap"><img src="${escapeHTML(src)}" alt="${escapeHTML(title)}封面" loading="lazy" decoding="async"><span class="cover-label">${count} 篇</span></div>` : '')
    + `<${heading} class="card-title">${escapeHTML(title)}</${heading}><p class="card-hook">${escapeHTML(hook)}</p>`
    + `<div class="card-meta"><span class="card-credit">${count} 篇</span><span class="card-action">查看故事 →</span></div></a></article>`;
}

function chipsHTML(items, label) {
  if (items.length === 0) return '';
  return `<ul class="facet-chips" aria-label="${escapeHTML(label)}">` + items.map(item =>
    `<li><a href="${escapeHTML(item.href)}">${item.kicker ? `<span class="chip-kicker">${escapeHTML(item.kicker)}</span>` : ''}${escapeHTML(item.title)}<span class="count">${item.count} 篇</span></a></li>`).join('') + '</ul>';
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'zh-Hans');
const facetsOfStories = (stories, facets) => Object.keys(FACETS).flatMap(kind => {
  const seen = new Set();
  return stories.map(story => facetOf(story, kind, facets)).filter(group => group && !seen.has(group.slug) && seen.add(group.slug));
});

export function booksPageHTML(books, { base, featured }) {
  const prefix = prefixFor(1);
  const sorted = [...books.values()].sort(byTitle);
  const title = '原著书目 · 拾趣好故事';
  const description = `按原著浏览 ${sorted.length} 部书目的精选连环画，在拾趣好故事慢慢读。`;
  const cards = sorted.map(book => groupCardHTML({
    href: `./${book.slug}/`, prefix, title: book.title, count: book.stories.length, cover: book.latest.cover,
    hook: `${book.stories.length} 篇精选连环画${book.latest.publishedAt ? ` · 最近收录 ${book.latest.publishedAt}` : ''}`
  })).join('\n      ');
  const body = `    <section id="books" class="collection wrap" aria-labelledby="books-title">
      <div class="section-heading"><div><p class="eyebrow">THE BOOKS</p><h1 id="books-title">原著书目 <span class="count">${sorted.length} 部</span></h1></div></div>
      ${cards ? `<div class="story-grid">
      ${cards}
      </div>` : '<div class="empty-state"><h2>好故事，正在收集。</h2><p>收录作品后，这里将显示原著书目及篇数。</p></div>'}
    </section>`;
  return pageShell({
    depth: 1, active: 'books', featured, title, description, canonical: canonicalFor(base, 'books/'), cover: coverURL(sorted[0]?.latest.cover, base),
    skip: { id: 'books', label: '跳到原著书目' }, body
  });
}

export function bookPageHTML(book, { base, featured, facets, books, routes }) {
  const prefix = prefixFor(2);
  const title = `${book.title} · 拾趣好故事`;
  const description = summarize(`《${book.title}》的 ${book.stories.length} 篇精选连环画，在拾趣好故事在线阅读。`);
  const cards = book.stories.map(entry => storyCardHTML(entry, { href: `./${routes.get(entry.id).storySlug}/`, prefix })).join('\n      ');
  const chips = chipsHTML(facetsOfStories(book.stories, facets).map(group =>
    ({ href: prefix + group.path, kicker: FACETS[group.kind].label, title: group.title, count: group.stories.filter(story => routes.get(story.id).bookSlug === book.slug).length })), '这本书的分类');
  const others = chipsHTML([...books.values()].filter(other => other.slug !== book.slug).sort(byTitle).map(other =>
    ({ href: `../${other.slug}/`, title: other.title, count: other.stories.length })), '其他书目');
  const body = `    <section id="book" class="collection wrap" aria-labelledby="book-title">
      <nav class="breadcrumb" aria-label="位置"><a href="${prefix}">首页</a><a href="../">书目</a><span aria-current="page">${escapeHTML(book.title)}</span></nav>
      <div class="section-heading"><div><p class="eyebrow">THE BOOK</p><h1 id="book-title">${escapeHTML(book.title)} <span class="count">${book.stories.length} 篇</span></h1></div></div>
      ${chips}
      <div class="story-grid">
      ${cards}
      </div>
    </section>${others ? `
    <section class="related wrap" aria-labelledby="other-books"><h2 id="other-books" class="related-title">其他书目</h2>${others}</section>` : ''}`;
  return pageShell({
    depth: 2, active: 'books', featured, title, description, canonical: canonicalFor(base, book.path), cover: coverURL(book.latest.cover, base),
    skip: { id: 'book', label: '跳到故事列表' }, body
  });
}

export function themesPageHTML(facets, { base, featured }) {
  const prefix = prefixFor(1);
  const sections = Object.entries(FACETS).map(([kind, { label }]) => {
    const groups = [...facets[kind].values()].sort(byTitle);
    const cards = groups.map(group => groupCardHTML({
      href: prefix + group.path, prefix, title: group.title, count: group.stories.length, cover: group.stories[0].cover,
      hook: `${label} · ${group.stories.length} 篇精选连环画`
    })).join('\n      ');
    return `    <section id="${kind}s" class="collection wrap" aria-labelledby="${kind}s-title">
      <div class="section-heading"><div><p class="eyebrow">BY ${kind.toUpperCase()}</p><h2 id="${kind}s-title">按${label} <span class="count">${groups.length} 类</span></h2></div></div>
      ${cards ? `<div class="story-grid">
      ${cards}
      </div>` : `<div class="empty-state"><p>收录作品后，这里将按${label}列出分类。</p></div>`}
    </section>`;
  });
  const total = Object.values(facets).reduce((sum, groups) => sum + groups.size, 0);
  const title = '故事分类 · 拾趣好故事';
  const description = `按作者、主题与画风浏览拾趣好故事的 ${total} 个分类。`;
  const body = `    <section id="categories" class="collection wrap page-intro" aria-labelledby="categories-title">
      <div class="section-heading"><div><p class="eyebrow">THE CATEGORIES</p><h1 id="categories-title">故事分类 <span class="count">${total} 类</span></h1></div></div>
    </section>
${sections.join('\n')}`;
  return pageShell({ depth: 1, active: 'themes', featured, title, description, canonical: canonicalFor(base, 'themes/'), skip: { id: 'categories', label: '跳到故事分类' }, body });
}

export function facetPageHTML(group, { base, featured, facets, routes }) {
  const prefix = prefixFor(2), label = FACETS[group.kind].label;
  const title = `${group.title} · ${label} · 拾趣好故事`;
  const description = summarize(`${label}「${group.title}」下的 ${group.stories.length} 篇精选连环画，在拾趣好故事在线阅读。`);
  const cards = group.stories.map(entry => storyCardHTML(entry, { href: prefix + routes.get(entry.id).path, prefix, label: routes.get(entry.id).bookTitle })).join('\n      ');
  const others = chipsHTML([...facets[group.kind].values()].filter(other => other.slug !== group.slug).sort(byTitle).map(other =>
    ({ href: prefix + other.path, title: other.title, count: other.stories.length })), `其他${label}`);
  const body = `    <section id="facet" class="collection wrap" aria-labelledby="facet-title">
      <nav class="breadcrumb" aria-label="位置"><a href="${prefix}">首页</a><a href="${prefix}themes/">分类</a><span aria-current="page">${escapeHTML(group.title)}</span></nav>
      <div class="section-heading"><div><p class="eyebrow">${label}</p><h1 id="facet-title">${escapeHTML(group.title)} <span class="count">${group.stories.length} 篇</span></h1></div></div>
      <div class="story-grid">
      ${cards}
      </div>
    </section>${others ? `
    <section class="related wrap" aria-labelledby="other-facets"><h2 id="other-facets" class="related-title">其他${label}</h2>${others}</section>` : ''}`;
  return pageShell({
    depth: 2, active: 'themes', featured, title, description, canonical: canonicalFor(base, group.path), cover: coverURL(group.stories[0].cover, base),
    skip: { id: 'facet', label: '跳到故事列表' }, body
  });
}

export function featuredPageHTML({ base, featured }) {
  const body = `    <section id="featured" class="collection wrap" aria-labelledby="featured-title">
      <div class="section-heading"><div><p class="eyebrow">EDITOR'S PICKS</p><h1 id="featured-title">精选 <span id="story-count" class="count"></span></h1></div></div>
      <div id="shelf-status" class="status" role="status">正在翻开精选…</div>
      <div id="stories" class="story-grid"></div>
      <div id="empty" class="empty-state" hidden><span class="empty-seal" aria-hidden="true">选</span><h2>精选正在挑选中。</h2><p>维护者还没有设置精选作品，先去全部作品里逛逛。</p><a class="secondary-button" href="../collection/">浏览全部作品</a></div>
    </section>`;
  return pageShell({
    depth: 1, active: 'featured', featured, title: '精选 · 拾趣好故事', description: '维护者挑选的拾趣连环画，值得从头读到最后。',
    canonical: canonicalFor(base, 'featured/'), skip: { id: 'featured', label: '跳到精选' }, body, scripts: ['featured-page.mjs']
  });
}

export function collectionPageHTML({ base, featured }) {
  const body = `    <section id="collection" class="collection wrap" aria-labelledby="collection-title">
      <div class="section-heading"><div><p class="eyebrow">THE COLLECTION</p><h1 id="collection-title">全部作品 <span id="story-count" class="count"></span></h1></div><div class="shelf-tabs" role="group" aria-label="作品范围"><button class="tab active" data-scope="all" aria-pressed="true">全部</button><button class="tab" data-scope="saved" aria-pressed="false">我的收藏</button></div></div>
      <form class="filters" role="search" onsubmit="return false"><label class="search-box">${SEARCH_ICON}<span class="sr-only">搜索故事、原著或作者</span><input id="search" type="search" name="q" placeholder="找一篇故事，或一本古书…" maxlength="120" autocomplete="off"></label><label class="book-filter"><span class="sr-only">原著</span><select id="book-filter"><option value="">所有原著</option></select></label><label class="author-filter"><span class="sr-only">作者</span><select id="author-filter"><option value="">所有作者</option></select></label><label class="theme-filter"><span class="sr-only">主题</span><select id="theme-filter"><option value="">所有主题</option></select></label><label class="style-filter"><span class="sr-only">画风</span><select id="style-filter"><option value="">所有画风</option></select></label><label class="sort-filter"><span class="sr-only">排序</span><select id="sort"><option value="latest">最近收录</option><option value="title">按故事名称</option></select></label></form>
      <div id="shelf-status" class="status" role="status">正在翻开作品集…</div>
      <p id="catalog-notice" class="catalog-notice" role="status" hidden></p>
      <div id="stories" class="story-grid"></div>
      <div id="empty" class="empty-state" hidden><span class="empty-seal" aria-hidden="true">藏</span><h2 id="empty-title">好故事，正在收集。</h2><p id="empty-description">这里将收录经过挑选的拾趣连环画。<br>每一篇，都值得从头读到最后。</p><a id="empty-preview" class="secondary-button" href="../reader.html?preview=1">先试读自己的 ZIP</a><button id="clear-filters" class="secondary-button" hidden>查看全部作品</button></div>
    </section>`;
  return pageShell({
    depth: 1, active: 'collection', featured, title: '全部作品 · 拾趣好故事', description: '搜索并筛选拾趣好故事收录的全部连环画：按原著、作者、主题、画风浏览，或查看我的收藏。',
    canonical: canonicalFor(base, 'collection/'), skip: { id: 'collection', label: '跳到作品列表' }, body, scripts: ['shelf.mjs']
  });
}

// The hand-written home keeps its hero; the masthead and metadata come from the same shell helpers.
export function homePageHTML(template, base, featured) {
  let html = template.replace(/<header class="masthead wrap">.*?<\/header>/s, () => mastheadHTML({ prefix: '', active: null, featured }));
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1], description = html.match(/<meta name="description" content="([^"]*)">/)?.[1];
  if (base && title && description !== undefined && html.includes('</head>')) {
    const extra = headBlock(seoMeta({ title: unescapeHTML(title), description: unescapeHTML(description), canonical: base.href, type: 'website' }));
    html = html.replace('</head>', `${extra}\n</head>`);
  }
  return html;
}

export function sitemapXML(base, { books, facets, featured, routes }) {
  const entry = (path, lastmod) => `  <url><loc>${escapeHTML(new URL(path, base).href)}</loc>${lastmod ? `<lastmod>${escapeHTML(lastmod)}</lastmod>` : ''}</url>`;
  const latest = stories => stories.map(story => story.publishedAt).filter(Boolean).sort().at(-1);
  const urls = [entry(''), ...(featured ? [entry('featured/')] : []), entry('collection/'), entry('books/'), entry('themes/')];
  for (const book of books.values()) {
    urls.push(entry(book.path, latest(book.stories)));
    for (const story of book.stories) urls.push(entry(routes.get(story.id).path, story.publishedAt));
  }
  for (const kind of Object.keys(FACETS)) for (const group of facets[kind].values()) urls.push(entry(group.path, latest(group.stories)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

async function readFeatured(root, stories) {
  let text;
  try { text = await readFile(path.join(root, 'site', 'featured.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { stories: [] }; throw error; }
  let data;
  try { data = JSON.parse(text); } catch { assert(false, 'site/featured.json 不是有效的 JSON。'); }
  let featured;
  try { featured = validateFeatured(data); } catch (error) { assert(false, `site/featured.json：${error.message}`); }
  const known = new Set(stories.map(story => story.sourcePath).filter(Boolean));
  for (const { path: archive } of featured.stories) assert(known.has(archive), `site/featured.json 引用了未收录的作品：${archive}`);
  return featured;
}

async function copySite(source, destination, topLevel = true) {
  const stat = await lstat(source);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'site/ 必须是真实文件夹。');
  let bytes = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    assert(!topLevel || !['public', 'stories', 'works', 'covers', 'books', 'themes', 'styles', 'featured', 'collection', 'sitemap.xml'].includes(entry.name), `site/${entry.name} 是作品构建保留路径。`);
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

// GitHub Pages caches assets for ten minutes, so right after a deploy a fresh page script can
// import a stale cached module and fail on a missing export. Stamp one content-hash version on
// every asset reference so each page always loads a consistent module graph.
export async function versionAssets(staging) {
  const assetsDirectory = path.join(staging, 'assets');
  let names;
  try { names = (await readdir(assetsDirectory)).filter(name => /\.(mjs|css)$/.test(name)).sort(); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  if (names.length === 0) return 0;
  const hash = createHash('sha256');
  for (const name of names) hash.update(name).update('\0').update(await readFile(path.join(assetsDirectory, name)));
  const version = hash.digest('hex').slice(0, 10);
  let delta = 0;
  const rewrite = async (file, replace) => {
    const before = await readFile(file, 'utf8');
    const after = replace(before);
    if (after === before) return;
    delta += Buffer.byteLength(after) - Buffer.byteLength(before);
    await writeFile(file, after);
  };
  for (const name of names) {
    if (!name.endsWith('.mjs')) continue;
    await rewrite(path.join(assetsDirectory, name), text => names.reduce((code, dep) =>
      code.replaceAll(`'./${dep}'`, `'./${dep}?v=${version}'`).replaceAll(`"./${dep}"`, `"./${dep}?v=${version}"`), text));
  }
  const stack = [staging];
  while (stack.length > 0) {
    for (const entry of await readdir(stack.pop(), { withFileTypes: true })) {
      const file = path.join(entry.parentPath, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (entry.name.endsWith('.html')) await rewrite(file, text => names.reduce((html, dep) =>
        html.replaceAll(`assets/${dep}"`, `assets/${dep}?v=${version}"`), text));
    }
  }
  return delta;
}

export async function build(root = ROOT) {
  const stories = await readLibrary(root);
  const archives = await readArchiveLibrary(root, {retainArchive: false, retainCover: false, retainImages: true});
  const publications = [...stories, ...archives].map(preparePublication);
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
    for (const publication of publications) {
      size += await writePublication(staging, publication);
      assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB。');
    }
    const retained = new Set(publications.map(item => item.directory));
    size += await retainPublications(destination, staging, retained, LIMITS.siteBytes - size);
    if (process.env.SHIQU_PREVIOUS_PUBLICATION) size += await retainPublications(path.resolve(process.env.SHIQU_PREVIOUS_PUBLICATION), staging, retained, LIMITS.siteBytes - size);
    const catalog = mergeCatalogs({stories: publications.map(item => item.entry)});
    // SEO-friendly pages: books, categories, and one page per published story.
    let config = null;
    try { config = JSON.parse(await readFile(path.join(root, 'site', 'config.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const base = siteBase(config);
    const template = await readFile(path.join(root, 'site', 'reader.html'), 'utf8');
    const conflicts = slugConflicts(catalog.stories);
    assert(conflicts.length === 0, '以下标题会映射到同一页面地址，请修改后重试：' + conflicts.map(c => `${c.kind} ${c.slug}（${c.titles.join('、')}）`).join('；'));
    const routes = storyRoutes(catalog.stories);
    const books = groupByBook(catalog.stories, routes), facets = facetRoutes(catalog.stories);
    const featured = await readFeatured(root, catalog.stories), hasFeatured = featured.stories.length > 0;
    const write = async (relative, html) => {
      size += Buffer.byteLength(html);
      assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
      const file = path.join(staging, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, html);
    };
    for (const entry of catalog.stories) {
      const route = routes.get(entry.id);
      assert(route && SEGMENT.test(route.bookSlug) && SEGMENT.test(route.storySlug), `无法为作品生成页面路径：${entry.id}`);
      await write(path.join('books', route.bookSlug, route.storySlug, 'index.html'), staticStoryHTML(storyPageHTML(template, entry, route, base), publications.find(item => item.entry.id === entry.id).manifest, entry, route, routes, catalog.stories, base));
    }
    const legacyLinks = catalog.stories.map(entry => `<li><a href="${escapeHTML(routes.get(entry.id).path)}">${escapeHTML(entry.title)}</a></li>`).join('');
    size -= Buffer.byteLength(template);
    await write('reader.html', template.replace('</head>', '<meta name="robots" content="noindex,follow">\n</head>').replace(/<noscript>.*?<\/noscript>/s, `<noscript><nav aria-label="故事目录"><ul>${legacyLinks}</ul></nav></noscript>`));
    for (const book of books.values()) {
      await write(path.join('books', book.slug, 'index.html'), bookPageHTML(book, { base, featured: hasFeatured, facets, books, routes }));
    }
    for (const kind of Object.keys(FACETS)) {
      for (const group of facets[kind].values()) {
        assert(SEGMENT.test(group.slug), `无法为分类生成页面路径：${group.title}`);
        await write(path.join(FACETS[kind].directory, group.slug, 'index.html'), facetPageHTML(group, { base, featured: hasFeatured, facets, routes }));
      }
    }
    await write(path.join('books', 'index.html'), booksPageHTML(books, { base, featured: hasFeatured }));
    await write(path.join('themes', 'index.html'), themesPageHTML(facets, { base, featured: hasFeatured }));
    await write(path.join('featured', 'index.html'), featuredPageHTML({ base, featured: hasFeatured }));
    await write(path.join('collection', 'index.html'), collectionPageHTML({ base, featured: hasFeatured }));
    const home = homePageHTML(await readFile(path.join(staging, 'index.html'), 'utf8'), base, hasFeatured);
    size -= (await lstat(path.join(staging, 'index.html'))).size;
    await write('index.html', home);
    if (base) await write('sitemap.xml', sitemapXML(base, { books, facets, featured: hasFeatured, routes }));
    const catalogJson = JSON.stringify(catalog, null, 2) + '\n';
    size += Buffer.byteLength(catalogJson);
    assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
    await writeFile(path.join(staging, 'catalog.json'), catalogJson);
    size += await versionAssets(staging);
    assert(size <= LIMITS.siteBytes, '站点文件超过 950 MiB，请先压缩或移除大图。');
    await writeFile(path.join(staging, '.nojekyll'), '');
    const backup = staging + '-previous';
    let moved = false;
    try { await rename(destination, backup); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, destination); }
    catch (error) { if (moved) await rename(backup, destination); throw error; }
    // Promotion is complete; cleanup failure must not turn a successful release into a failed build.
    if (moved) await rm(backup, {recursive: true, force: true}).catch(() => console.warn('站点已生成，但旧输出备份未能清理。'));
    return { count: catalog.stories.length, pages: catalog.stories.reduce((sum, story) => sum + story.pageCount, 0), books: books.size, themes: facets.theme.size, styles: facets.style.size, featured: featured.stories.length, bytes: size };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('用法：pnpm build\n验证 works/<GitHub 用户名>/<作品编号>.zip，生成版本隔离的公开清单、原字节图片和完整故事页面；部署不包含 ZIP。\n兼容已有 stories/ 作品。空作品集可以正常构建。');
  } else {
    try {
      const result = await build();
      console.log(`已生成 dist/：${result.count} 篇作品，${result.pages} 幅画面，${result.books} 个书目、${result.themes + result.styles} 个分类页面，${result.featured} 篇精选，${(result.bytes / 1024 / 1024).toFixed(2)} MiB。`);
    } catch (error) { console.error(`构建失败：${error.message}`); process.exitCode = 1; }
  }
}

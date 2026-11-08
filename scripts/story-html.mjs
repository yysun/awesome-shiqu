// Fill the reader shell with escaped, crawlable public content before JavaScript enhancement.
import {publicJSON} from './static-publication.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function staticStoryHTML(html, manifest, entry, route, routes, entries, base) {
  const prefix = '../../../', p = manifest.publication || {};
  const text = (id, value) => {
    html = html.replace(new RegExp(`(<([a-z0-9]+)[^>]*\\bid="${id}"[^>]*>).*?(</\\2>)`, 's'), (_, start, tag, end) => start.replace(/ hidden\b/g, '') + esc(value) + end);
  };
  const content = (id, value) => {
    html = html.replace(new RegExp(`(<([a-z0-9]+)[^>]*\\bid="${id}"[^>]*>).*?(</\\2>)`, 's'), (_, start, tag, end) => start.replace(/ hidden\b/g, '') + value + end);
  };
  const reveal = id => { html = html.replace(new RegExp(`(<[a-z0-9]+[^>]*id="${id}"[^>]*) hidden`, 'g'), '$1'); };
  const link = (url, title) => `<a href="${esc(url)}">${esc(title)}</a>`;
  text('story-title', manifest.title); text('story-hook', manifest.hook); text('story-reflection', manifest.reflection);
  content('story-source', link(prefix + route.bookPath, route.bookTitle));
  text('story-credit', [manifest.author || '未署名', manifest.artStyle, `${manifest.pages.length} 幅`, ...(manifest.generationModels?.length ? [`模型：${manifest.generationModels.join(' / ')}`] : [])].filter(Boolean).join(' · '));
  const ai = manifest.aiDisclosure || (manifest.aiGenerated === true ? '本作品包含 AI 生成的画面或改编文字。原作出处与改编内容分别注明。' : manifest.aiGenerated === false ? '提交声明未使用 AI；此声明未经本站独立认证。' : '创作方式未注明，AI 参与情况请向制作人核实。');
  for (const [id, value] of Object.entries({author: manifest.author || '未署名', contributor: manifest.contributor, ai, model: manifest.generationModels?.join(' / '), adaptation: manifest.adaptationNote, license: p.sourceNote, reuse: p.reuse || '未提供额外转载授权；请核对来源许可，必要时联系相应权利人。', contact: p.contact, identity: manifest.exportIdentity && `${manifest.exportIdentity.storyId} · 版本 ${manifest.exportIdentity.revision}`})) {
    if (value) { text(id + '-detail', value); reveal(id + '-label'); }
  }
  content('source-detail', manifest.source.url ? link(manifest.source.url, manifest.source.title) : esc(manifest.source.title));
  if (p.workUrl) content('work-detail', link(p.workUrl, '查看公开作品'));
  if (manifest.sourceText) { reveal('original-notes'); text('original-text', manifest.sourceText); }
  content('breadcrumb', link(prefix, '首页') + link(prefix + 'books/', '书目') + link(prefix + route.bookPath, route.bookTitle) + `<span aria-current="page">${esc(manifest.title)}</span>`);
  const figures = manifest.pages.map((page, index) => `<figure class="story-page" data-page="${index}" aria-label="第 ${index + 1} 幅，共 ${manifest.pages.length} 幅"><div class="page-art"><img src="${esc(prefix + entry.url.replace(/story\.json$/, '') + page.image)}" alt="${esc(`${manifest.title}，第 ${index + 1} 幅`)}" width="${page.width}" height="${page.height}" loading="${index === 0 ? 'eager' : 'lazy'}"${index === 0 ? ' fetchpriority="high"' : ''} decoding="async" aria-describedby="caption-${index}" draggable="false"></div><figcaption id="caption-${index}"><p class="caption-text">${index + 1}. ${esc(page.caption)}</p></figcaption></figure>`).join('\n');
  content('story-viewer', figures);
  if (!html.includes('id="story-viewer"')) html = html.replace('</body>', `<article><h1>${esc(manifest.title)}</h1><p>${esc(manifest.hook)}</p>${figures}</article></body>`);
  const siblings = entries.filter(item => routes.get(item.id).bookSlug === route.bookSlug), index = siblings.findIndex(item => item.id === entry.id);
  content('story-nav', [[index - 1, '上一篇'], [index + 1, '下一篇']].filter(([i]) => siblings[i]).map(([i, title]) => link(prefix + routes.get(siblings[i].id).path, title + '：' + siblings[i].title)).join(''));
  reveal('story-ending'); reveal('reader-content');
  html = html.replace(/(<div id="reader-status"[^>]*)(>)/, '$1 hidden$2').replace(/<noscript>.*?<\/noscript>/s, '');
  html = html.replace('id="back-link" class="back-link" href="../../../"', `id="back-link" class="back-link" href="${esc(prefix + route.bookPath)}"`);
  text('back-label', route.bookTitle);
  const canonical = base ? new URL(route.path, base).href : undefined;
  const cover = base ? new URL(entry.cover, base).href : prefix + entry.cover;
  const structured = {'@context':'https://schema.org', '@type':'CreativeWork', name: manifest.title, description: manifest.hook, url: canonical, image: cover, datePublished: manifest.publishedAt, ...(manifest.author ? {author:{'@type':'Person',name:manifest.author}} : {}), isBasedOn: {'@type':'CreativeWork',name:manifest.source.title, ...(manifest.source.url ? {url:manifest.source.url} : {})}, text: manifest.pages.map(page => page.caption).join('\n'), creditText: [manifest.author, manifest.contributor, ai, p.sourceNote, p.reuse].filter(Boolean).join('\n')};
  return html.replace('</head>', `<meta name="shiqu:manifest" content="${esc(prefix + entry.url)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${esc(manifest.title + ' · ' + route.bookTitle + ' · 拾趣好故事')}">\n<meta name="twitter:description" content="${esc(manifest.hook)}">\n<meta name="twitter:image" content="${esc(cover)}">\n<script type="application/ld+json">${publicJSON(structured)}</script>\n</head>`).replace('</body>', `<script type="application/json" id="story-data">${publicJSON(manifest)}</script>\n</body>`);
}

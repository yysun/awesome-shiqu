// Render untrusted story prose as text and retain reading progress across grid and scroll layouts.
import { ROOT, validId, catalog, internalURL, externalURL, storyLink, storyRoute, publicationURL, hasLocalStoryPages, savedStories, toggleSaved, progressFor, saveProgress, node, toast } from './common.mjs';
import { facetOf, facetRoutes, groupByBook, storyRoutes } from './story-url.mjs';
import { storyCard } from './cards.mjs';
import { loadLocalArchive, loadPublishedStory, publishedArtwork } from './library.mjs';
import { publicationFields, pagePublicFields, publicText, validateAI, publicURL } from './story-publication.mjs';
import { validateGenerationModels } from './story-archive.mjs';
import { ZIP_LIMITS } from './zip.mjs';
const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const id = params.get('story') || document.querySelector('meta[name="shiqu:story"]')?.content || null;
const initialStory = document.querySelector('#story-data');
const localPreview = params.get('preview') === '1';
let story, imageURLs, artwork, entries = [], current = 0, mode = 'multi', pages = [], ticking = false;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function updatePage(index, save = true) {
  current = Math.max(0, Math.min(pages.length - 1, index));
  if (save && !localPreview) saveProgress(story.id, current);

}
function goTo(index, behavior = reduceMotion ? 'auto' : 'smooth') {
  updatePage(index);
  pages[current].scrollIntoView({ behavior, block: 'start' });
}
function setMode(nextMode) {
  if (nextMode === mode) return;
  const retained = current; mode = nextMode;
  $('#story-viewer').classList.toggle('scroll-mode', mode === 'scroll');
  $('#story-viewer').setAttribute('aria-label', mode === 'scroll' ? '连续阅读故事画页' : '多页阅读，全部故事画页');
  for (const name of ['multi', 'scroll']) { const button = $('#mode-' + name); button.classList.toggle('active', mode === name); button.setAttribute('aria-pressed', String(mode === name)); }
  requestAnimationFrame(() => goTo(retained, 'auto'));
}
function saveButton() {
  const saved = savedStories().has(story.id);
  $('#save-story').setAttribute('aria-pressed', String(saved));
  $('#save-story').setAttribute('aria-label', saved ? '取消收藏这篇故事' : '收藏这篇故事');
}
function pageElement(page, index, manifestURL) {
  const figure = node('figure', 'story-page'); figure.dataset.page = String(index); figure.setAttribute('aria-label', `第 ${index + 1} 幅，共 ${story.pages.length} 幅`);
  const art = node('div', 'page-art'), image = node('img');
  let url;
  if (imageURLs) {
    url = imageURLs.get(page.image);
    if (!url) throw Error('ZIP 缺少这幅画面。');
  } else {
    url = internalURL(page.image, manifestURL);
    if (!url.pathname.startsWith(new URL('./', manifestURL).pathname)) throw Error('画面文件路径无效。');
  }
  image.src = url; image.alt = `${story.title}，第 ${index + 1} 幅：${page.caption}`; image.loading = index === 0 ? 'eager' : 'lazy'; if (page.width) image.width = page.width; if (page.height) image.height = page.height; image.decoding = 'async'; image.draggable = false;
  image.addEventListener('error', () => { if (!art.querySelector('.image-error')) art.append(node('p', 'image-error', '这幅画面暂时无法加载，请刷新重试。')); });
  art.append(image);
  const caption = node('figcaption'); caption.append(node('p', 'caption-text', `${index + 1}. ${page.caption}`));
  figure.append(art, caption); return figure;
}
// Tell deep-linked readers where they are and what to read next, all from the lightweight catalogue.
function placeStory(route, bookName) {
  const bookURL = publicationURL(route.bookPath);
  $('#back-link').href = bookURL; $('#back-link').setAttribute('aria-label', `返回${bookName}`); $('#back-label').textContent = bookName;
  $('#read-more').href = bookURL;
  const crumb = (text, href) => { const item = href ? node('a', '', text) : node('span', '', text); if (href) item.href = href; else item.setAttribute('aria-current', 'page'); return item; };
  $('#breadcrumb').replaceChildren(crumb('首页', ROOT), crumb('书目', publicationURL('books/')), crumb(bookName, bookURL), crumb(story.title));
  $('#breadcrumb').hidden = false;
  if (params.get('story')) {
    const canonical = document.querySelector('link[rel="canonical"]') || document.head.appendChild(node('link'));
    canonical.rel = 'canonical'; canonical.href = publicationURL(route.path).href;
  }
  const routes = storyRoutes(entries), facets = facetRoutes(entries), saved = savedStories();
  const book = groupByBook(entries, routes).get(route.bookSlug), index = book ? book.stories.findIndex(entry => entry.id === story.id) : -1;
  const neighbours = [];
  if (index > 0) neighbours.push(['上一篇', book.stories[index - 1]]);
  if (index >= 0 && index < book.stories.length - 1) neighbours.push(['下一篇', book.stories[index + 1]]);
  $('#story-nav').replaceChildren(...neighbours.map(([label, entry]) => {
    const link = node('a', 'story-nav-link'); link.href = storyLink(entry.id);
    link.classList.add(label === '上一篇' ? 'story-nav-prev' : 'story-nav-next'); link.append(node('span', 'story-nav-label', label), node('span', 'story-nav-title', entry.title)); return link;
  }));
  $('#story-nav').hidden = neighbours.length === 0;
  const skip = new Set([story.id, ...neighbours.map(([, entry]) => entry.id)]);
  const moreBook = book ? book.stories.filter(entry => !skip.has(entry.id)).slice(0, 3) : [];
  const theme = facetOf(story, 'theme', facets);
  for (const entry of moreBook) skip.add(entry.id);
  const moreTheme = theme ? [...theme.stories].sort((a, b) => Number(routes.get(a.id)?.bookSlug === route.bookSlug) - Number(routes.get(b.id)?.bookSlug === route.bookSlug)).filter(entry => !skip.has(entry.id)).slice(0, 3) : [];
  const fill = (id, list, title, href, linkText) => {
    const group = $(id); group.hidden = list.length === 0; if (!list.length) return;
    group.querySelector('h2').textContent = title; group.querySelector('.text-link').href = href; group.querySelector('.text-link').textContent = linkText;
    group.querySelector('.story-grid').replaceChildren(...list.map(entry => storyCard(entry, { saved })));
  };
  fill('#more-book', moreBook, `《${bookName}》更多`, bookURL, `全部 ${book?.stories.length || 0} 篇 →`);
  fill('#more-theme', moreTheme, `同主题：${theme?.title || ''}`, theme ? publicationURL(theme.path) : ROOT, theme ? `全部 ${theme.stories.length} 篇 →` : '');
  $('#recommend').hidden = moreBook.length === 0 && moreTheme.length === 0;
}
async function share() {
  if (localPreview) return;
  const url = storyLink(story.id).href;
  if (navigator.share) {
    try { await navigator.share({ title: story.title + ' · 拾趣好故事', text: story.hook || story.title, url }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('故事链接已复制'); }
  catch { $('#share-url').value = url; $('#share-dialog').showModal(); $('#share-url').focus(); $('#share-url').select(); }
}
async function selectLocalZip() {
  document.title = 'ZIP 试读 · 拾趣好故事';
  $('#preview-panel').hidden = false; $('#reader-status').hidden = true;
  return new Promise(resolve => {
    $('#preview-file').addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      event.target.disabled = true; $('#reader-status').hidden = false;
      $('#reader-status').textContent = '正在打开这份 ZIP…';
      try {
        const result = await loadLocalArchive(file);
        $('#preview-panel').hidden = true; resolve(result);
      } catch (error) {
        $('#reader-status').textContent = error.message || '无法打开这份 ZIP，请检查后重试。';
        event.target.value = ''; event.target.disabled = false;
      }
    });
  });
}
try {
  let manifestURL;
  if (localPreview) {
    artwork = await selectLocalZip(); story = artwork.story; imageURLs = artwork.imageURLs;
    $('#preview-notice').hidden = false;
  } else {
    if (!validId(id)) throw Error('请先从作品集中选择一篇故事。');
    if (initialStory) {
      story = JSON.parse(initialStory.textContent);
      manifestURL = new URL(document.querySelector('meta[name="shiqu:manifest"]').content, location.href);
      imageURLs = publishedArtwork(story, manifestURL).imageURLs;
      entries = await catalog().catch(() => []);
    } else {
      entries = await catalog();
      const entry = entries.find(value => value.id === id);
      if (!entry) throw Error('这篇故事尚未收录，或已从作品集中移除。');
      const route = storyRoute(id);
      if (params.get('story') && route && hasLocalStoryPages()) location.replace(new URL(route.path, ROOT));
      manifestURL = entry.manifestURL;
      const loaded = await loadPublishedStory(entry);
      story = loaded.story; imageURLs = loaded.imageURLs;
    }
    const entry = initialStory ? {pageCount: story.pages.length} : entries.find(value => value.id === id);
    if (story.schemaVersion !== 1 || story.id !== id || typeof story.title !== 'string' || !Array.isArray(story.pages) || story.pages.length !== entry.pageCount || story.pages.some(page => typeof page.image !== 'string' || typeof page.caption !== 'string')) throw Error('故事内容不完整，请联系作品维护者。');
  }
  story = { ...story, ...publicationFields(story), author: publicText(story.author ?? '', '制作署名', 120), aiGenerated: validateAI(story.aiGenerated), pages: story.pages.map(page => ({ ...page, ...pagePublicFields(page) })) };

  if (artwork) window.addEventListener('pagehide', event => { if (!event.persisted) artwork.dispose(); });
  if (!initialStory) document.title = story.title + ' · 拾趣好故事';
  if (!initialStory) $('meta[name="description"]').content = story.hook || story.title;
  const bookName = story.book || story.source?.title || '拾趣精选';
  const route = localPreview ? null : storyRoute(story.id);
  if (route) { const bookLink = node('a', '', bookName); bookLink.href = publicationURL(route.bookPath); $('#story-source').replaceChildren(bookLink); }
  else $('#story-source').textContent = bookName;
  if (route) placeStory(route, bookName);
  $('#story-title').textContent = story.title;
  $('#story-hook').textContent = story.hook || '';
  const models = validateGenerationModels(story.generationModels);
  const modelCredit = models.length ? `模型：${models.join(' / ')}` : '';
  $('#story-credit').textContent = [story.author || '未署名', story.artStyle, `${story.pages.length} 幅`, modelCredit].filter(Boolean).join(' · ');
  $('#story-reflection').textContent = story.reflection || '故事有了结尾，留给我们的思考还在继续。';
  $('#author-detail').textContent = story.author || '未署名';
  $('#ai-detail').textContent = story.aiDisclosure || (story.aiGenerated === true ? '本作品包含 AI 生成的画面或改编文字。原作出处与改编内容分别注明。' : story.aiGenerated === false ? '提交声明未使用 AI；此声明未经本站独立认证。' : '创作方式未注明，AI 参与情况请向制作人核实。');
  const p = story.publication || {};
  const optional = (name, value) => { $('#' + name + '-detail').textContent = value || ''; $('#' + name + '-detail').hidden = !value; $('#' + name + '-label').hidden = !value; };
  optional('contributor', story.contributor); optional('contact', p.contact); optional('license', p.sourceNote);
  $('#reuse-detail').textContent = p.reuse || '未提供额外转载授权；请核对来源许可，必要时联系相应权利人。';
  const workURL = p.workUrl ? publicURL(p.workUrl) : '';
  if (workURL) { const a = node('a', '', '查看公开作品'); a.href = workURL; a.target = '_blank'; a.rel = 'noopener noreferrer'; $('#work-detail').replaceChildren(a); } else { $('#work-label').hidden = true; $('#work-detail').hidden = true; }
  optional('identity', story.exportIdentity ? `${story.exportIdentity.storyId} · 版本 ${story.exportIdentity.revision}` : '');
  $('#original-notes').hidden = !story.sourceText; $('#original-text').textContent = story.sourceText || '';
  $('#model-detail').textContent = models.join(' / ');
  $('#model-detail').hidden = !models.length; $('#model-label').hidden = !models.length;
  $('#adaptation-detail').textContent = story.adaptationNote || '';
  $('#adaptation-detail').hidden = !story.adaptationNote; $('#adaptation-label').hidden = !story.adaptationNote;
  const sourceURL = externalURL(story.source?.url);
  if (sourceURL) { const link = node('a', '', story.source?.title || '查看原作出处'); link.href = sourceURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; $('#source-detail').replaceChildren(link); }
  else $('#source-detail').textContent = story.source?.title || '未注明';
  pages = initialStory ? [...$('#story-viewer').querySelectorAll('.story-page')] : story.pages.map((page, index) => pageElement(page, index, manifestURL));
  if (!initialStory) $('#story-viewer').append(...pages);
  $('#story-ending').hidden = false;
  $('#reader-status').hidden = true; $('#reader-content').hidden = false;
  $('#save-story').disabled = localPreview; $('#share-story').disabled = localPreview;
  $('#mode-multi').disabled = false; $('#mode-scroll').disabled = false; if (!localPreview) saveButton();
  $('#save-story').addEventListener('click', () => { const result = toggleSaved(story.id); if (!result.stored) toast('当前浏览器无法保存收藏。'); else { saveButton(); toast(result.saved ? '已加入我的收藏' : '已取消收藏'); } });
  $('#share-story').addEventListener('click', share);
  $('#mode-multi').addEventListener('click', () => setMode('multi'));
  $('#mode-scroll').addEventListener('click', () => setMode('scroll'));
  $('#read-again').addEventListener('click', () => goTo(0, 'auto'));
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const target = innerHeight * 0.35;
      const found = pages.findIndex(page => { const rect = page.getBoundingClientRect(); return rect.top <= target && rect.bottom > target; });
      if (found >= 0 && found !== current) updatePage(found);
    });
  }, { passive: true });
  if (!localPreview) window.addEventListener('storage', saveButton);
  const resume = localPreview ? 0 : Math.min(pages.length - 1, progressFor(id)?.page || 0);
  updatePage(resume, false);
  requestAnimationFrame(() => { if (resume > 0) goTo(resume, 'auto'); });
} catch (error) {
  artwork?.dispose();
  $('#reader-content').hidden = !initialStory; $('#reader-status').hidden = false;
  $('#reader-status').textContent = error.message || '故事暂时无法打开，请稍后重试。';
  const back = node('a', '', '返回作品集 →'); back.href = ROOT; $('#reader-status').append(back);
}

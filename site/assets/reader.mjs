import { ROOT, validId, catalog, internalURL, externalURL, storyLink, savedStories, toggleSaved, progressFor, saveProgress, node, toast } from './common.mjs';
import {loadArchive, loadLocalArchive} from './library.mjs';
const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search), id = params.get('story');
const localPreview = params.get('preview') === '1';
let story, imageURLs, artwork, current = 0, mode = 'paged', pages = [], scrollTimer, resizeObserver, ticking = false;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function updatePage(index, save = true) {
  current = Math.max(0, Math.min(pages.length - 1, index));
  $('#page-select').value = String(current);
  $('#previous-page').disabled = current === 0;
  $('#next-page').disabled = current === pages.length - 1;
  $('#story-ending').hidden = mode !== 'scroll' && current !== pages.length - 1;
  if (save && !localPreview) saveProgress(story.id, current);
  const image = pages[current]?.querySelector('img'); if (image) image.loading = 'eager';
  const next = pages[current + 1]?.querySelector('img'); if (next) next.loading = 'eager';
}
function goTo(index, behavior = reduceMotion ? 'auto' : 'smooth') {
  updatePage(index);
  if (mode === 'scroll') pages[current].scrollIntoView({ behavior, block: 'start' });
  else $('#story-viewer').scrollTo({ left: current * $('#story-viewer').clientWidth, behavior });
}
function setMode(nextMode) {
  if (nextMode === mode) return;
  clearTimeout(scrollTimer);
  const retained = current; mode = nextMode;
  $('#story-viewer').classList.toggle('scroll-mode', mode === 'scroll');
  $('#story-viewer').setAttribute('aria-label', mode === 'scroll' ? '连续阅读故事画页' : '故事画页，使用左右方向键翻页');
  $('#page-controls').hidden = mode === 'scroll';
  $('#swipe-hint').hidden = mode === 'scroll';
  for (const name of ['paged','scroll']) { const button = $('#mode-' + name); button.classList.toggle('active', mode === name); button.setAttribute('aria-pressed', String(mode === name)); }
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
  image.src = url; image.alt = `${story.title}，第 ${index + 1} 幅：${page.caption}`; image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
  image.addEventListener('error', () => { if (!art.querySelector('.image-error')) art.append(node('p', 'image-error', '这幅画面暂时无法加载，请刷新重试。')); });
  art.append(image);
  const caption = node('figcaption'); caption.append(node('span', 'page-number', `${String(index + 1).padStart(2,'0')} / ${String(story.pages.length).padStart(2,'0')}`), node('p', 'caption-text', page.caption));
  figure.append(art, caption); return figure;
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
    const entries = await catalog(), entry = entries.find(value => value.id === id);
    if (!entry) throw Error('这篇故事尚未收录，或已从作品集中移除。');
    if (entry.archiveURL) {
      $('#reader-status').textContent = '正在下载故事 ZIP…';
      artwork = await loadArchive(entry, {onProgress(bytes, total) {
        $('#reader-status').textContent = total ? `正在下载故事 ZIP · ${Math.min(100, Math.round(bytes / total * 100))}%` : `正在下载故事 ZIP · ${(bytes / 1024 / 1024).toFixed(1)} MiB`;
      }});
      story = artwork.story; imageURLs = artwork.imageURLs;
      $('#download-story').href = entry.archiveURL; $('#download-story').hidden = false;
    } else {
      manifestURL = internalURL(entry.manifestURL);
      const response = await fetch(manifestURL, {cache: 'no-cache'});
      if (!response.ok) throw Error('故事暂时无法打开，请稍后重试。');
      story = await response.json();
    }
    if (story.schemaVersion !== 1 || story.id !== id || typeof story.title !== 'string' || !Array.isArray(story.pages) || story.pages.length !== entry.pageCount || story.pages.some(page => typeof page.image !== 'string' || typeof page.caption !== 'string')) throw Error('故事内容不完整，请联系作品维护者。');
  }
  if (artwork) window.addEventListener('pagehide', event => { if (!event.persisted) artwork.dispose(); });
  document.title = story.title + ' · 拾趣好故事';
  $('meta[name="description"]').content = story.hook || story.title;
  $('#story-source').textContent = story.book || story.source?.title || '拾趣精选';
  $('#story-title').textContent = story.title;
  $('#story-hook').textContent = story.hook || '';
  $('#story-credit').textContent = [story.author, story.artStyle, `${story.pages.length} 幅`].filter(Boolean).join(' · ');
  $('#page-total').textContent = `/ ${story.pages.length} 页`;
  $('#story-reflection').textContent = story.reflection || '故事有了结尾，留给我们的思考还在继续。';
  $('#author-detail').textContent = story.author || '未注明';
  $('#ai-detail').textContent = story.aiGenerated ? '本作品包含 AI 生成的画面或改编文字。原作出处与改编内容分别注明。' : '创作方式请以作者说明为准。';
  $('#adaptation-detail').textContent = story.adaptationNote || '';
  $('#adaptation-detail').hidden = !story.adaptationNote; $('#adaptation-label').hidden = !story.adaptationNote;
  const sourceURL = externalURL(story.source?.url);
  if (sourceURL) { const link = node('a', '', story.source?.title || '查看原作出处'); link.href = sourceURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; $('#source-detail').append(link); }
  else $('#source-detail').textContent = story.source?.title || '未注明';
  pages = story.pages.map((page,index) => pageElement(page,index,manifestURL));
  $('#story-viewer').append(...pages);
  for (let i = 0; i < pages.length; i++) { const option = node('option', '', String(i + 1)); option.value = String(i); $('#page-select').append(option); }
  $('#reader-status').hidden = true; $('#reader-content').hidden = false;
  $('#save-story').disabled = localPreview; $('#share-story').disabled = localPreview;
  $('#mode-paged').disabled = false; $('#mode-scroll').disabled = false; if (!localPreview) saveButton();
  $('#save-story').addEventListener('click', () => { const result = toggleSaved(story.id); if (!result.stored) toast('当前浏览器无法保存收藏。'); else { saveButton(); toast(result.saved ? '已加入我的收藏' : '已取消收藏'); } });
  $('#share-story').addEventListener('click', share);
  $('#previous-page').addEventListener('click', () => goTo(current - 1));
  $('#next-page').addEventListener('click', () => goTo(current + 1));
  $('#page-select').addEventListener('change', event => goTo(Number(event.target.value)));
  $('#mode-paged').addEventListener('click', () => setMode('paged'));
  $('#mode-scroll').addEventListener('click', () => setMode('scroll'));
  $('#read-again').addEventListener('click', () => { goTo(0, 'auto'); if (mode === 'paged') $('#story-viewer').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); });
  $('#story-viewer').addEventListener('scroll', () => {
    if (mode !== 'paged') return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { if (mode === 'paged') updatePage(Math.round($('#story-viewer').scrollLeft / $('#story-viewer').clientWidth)); }, 90);
  }, { passive: true });
  document.addEventListener('keydown', event => {
    if (mode !== 'paged' || event.altKey || event.ctrlKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); goTo(current + (event.key === 'ArrowRight' ? 1 : -1)); }
    if (event.key === 'Home' && document.activeElement === $('#story-viewer')) { event.preventDefault(); goTo(0); }
    if (event.key === 'End' && document.activeElement === $('#story-viewer')) { event.preventDefault(); goTo(pages.length - 1); }
  });
  window.addEventListener('scroll', () => {
    if (mode !== 'scroll' || ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false; if (mode !== 'scroll') return;
      const target = innerHeight * 0.35;
      const found = pages.findIndex(page => { const rect = page.getBoundingClientRect(); return rect.top <= target && rect.bottom > target; });
      if (found >= 0 && found !== current) updatePage(found);
    });
  }, { passive: true });
  if (!localPreview) window.addEventListener('storage', saveButton);
  const resume = localPreview ? 0 : Math.min(pages.length - 1, progressFor(id)?.page || 0);
  updatePage(resume, false);
  requestAnimationFrame(() => { goTo(resume, 'auto'); });
  let previousWidth = $('#story-viewer').clientWidth;
  resizeObserver = new ResizeObserver(entries => {
    const width = Math.round(entries[0].contentRect.width);
    if (mode === 'paged' && width !== previousWidth) { previousWidth = width; clearTimeout(scrollTimer); $('#story-viewer').scrollTo({ left: current * $('#story-viewer').clientWidth, behavior: 'auto' }); }
  });
  resizeObserver.observe($('#story-viewer'));
} catch (error) {
  artwork?.dispose();
  $('#reader-content').hidden = true; $('#reader-status').hidden = false;
  $('#reader-status').textContent = error.message || '故事暂时无法打开，请稍后重试。';
  const back = node('a', '', '返回作品集 →'); back.href = ROOT; $('#reader-status').append(back);
}

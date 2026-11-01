// Render lightweight catalogue cards without downloading story ZIPs to obtain model credits.
import { catalog, libraryInfo, storyLink, savedStories, toggleSaved, progressFor, node, bookmarkIcon, toast } from './common.mjs';
const $ = selector => document.querySelector(selector);
let stories = [], scope = 'all';
function card(story, saved) {
  const article = node('article', 'story-card');
  const link = node('a', 'card-link'); link.href = storyLink(story.id);
  const cover = node('div', 'cover-wrap');
  const image = node('img'); image.src = story.coverURL; image.alt = story.title + '封面'; image.loading = 'lazy'; image.decoding = 'async';
  image.addEventListener('error', () => { image.alt = '封面暂时无法显示'; }, { once: true });
  cover.append(image);
  const book = story.book || story.source?.title || '';
  if (book) cover.append(node('span', 'cover-label', book));
  const title = node('h3', 'card-title', story.title), hook = node('p', 'card-hook', story.hook || '翻开这段故事，读到一点余味。');
  const meta = node('div', 'card-meta'), credit = node('span', 'card-credit', [story.author, story.pageCount + ' 幅'].filter(Boolean).join(' · '));
  if (story.storyboardModels?.length) credit.append(node('span', 'card-model', `分镜模型：${story.storyboardModels.join(' / ')}`));
  meta.append(credit);
  const current = Math.min(story.pageCount - 1, progressFor(story.id)?.page || 0);
  meta.append(node('span', 'card-action', current > 0 ? `继续第 ${current + 1} 页 →` : '开始阅读 →'));
  link.append(cover, title, hook, meta);
  const save = node('button', 'save-button'); save.type = 'button'; save.setAttribute('aria-label', (saved.has(story.id) ? '取消收藏：' : '收藏：') + story.title); save.setAttribute('aria-pressed', String(saved.has(story.id))); save.append(bookmarkIcon());
  save.addEventListener('click', () => {
    const result = toggleSaved(story.id);
    if (!result.stored) { toast('当前浏览器无法保存收藏。'); return; }
    save.setAttribute('aria-pressed', String(result.saved)); save.setAttribute('aria-label', (result.saved ? '取消收藏：' : '收藏：') + story.title);
    toast(result.saved ? '已加入我的收藏' : '已取消收藏');
    if (scope === 'saved') render();
  });
  article.append(link, save); return article;
}
function render() {
  const query = $('#search').value.trim().toLocaleLowerCase(), book = $('#book-filter').value, saved = savedStories();
  const filtered = stories.filter(story => (scope !== 'saved' || saved.has(story.id)) && (!book || (story.book || story.source?.title || '') === book) && (!query || [story.title, story.hook, story.book, story.source?.title, story.theme, story.artStyle, story.author].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)));
  filtered.sort($('#sort').value === 'title' ? (a,b) => a.title.localeCompare(b.title, 'zh-Hans') : (a,b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')) || a.title.localeCompare(b.title, 'zh-Hans'));
  $('#stories').replaceChildren(...filtered.map(story => card(story, saved)));
  $('#story-count').textContent = `${filtered.length} 篇`;
  $('#shelf-status').textContent = `共 ${filtered.length} 篇作品`;
  $('#shelf-status').className = 'sr-only';
  $('#empty').hidden = filtered.length > 0;
  const hasFilters = Boolean(query || book || scope === 'saved');
  $('#clear-filters').hidden = !hasFilters;
  $('#empty-preview').hidden = hasFilters;
  $('#empty-title').textContent = hasFilters ? (scope === 'saved' && !query && !book ? '把喜欢的故事，留下来。' : '这里还没有找到这篇故事。') : '好故事，正在收集。';
  $('#empty-description').textContent = hasFilters ? (scope === 'saved' && !query && !book ? '点一下封面上的收藏图标，下次就能在这里找到。' : '换个关键词，或回到全部作品看看。') : '这里将收录经过挑选的拾趣连环画。每一篇，都值得从头读到最后。';
}
function setScope(value) {
  scope = value;
  document.querySelectorAll('[data-scope]').forEach(button => { button.classList.toggle('active', button.dataset.scope === scope); button.setAttribute('aria-pressed', String(button.dataset.scope === scope)); });
}
try {
  stories = await catalog();
  const info = await libraryInfo();
  if (info.github && (info.source === 'github' || location.hostname.endsWith('.github.io'))) {
    const repository = `https://github.com/${encodeURIComponent(info.github.owner)}/${encodeURIComponent(info.github.repo)}`;
    $('#submit-github').href = repository + '/blob/' + encodeURIComponent(info.github.branch) + '/CONTRIBUTING.md';
    $('#submit-github').hidden = false; $('#submission-pending').hidden = true;
  }
  if (info.remoteUnavailable && stories.length) {
    $('#catalog-notice').hidden = false;
    $('#catalog-notice').textContent = '当前显示已保存的作品集；最新收录暂时无法同步，请稍后刷新。';
  }
  for (const title of [...new Set(stories.map(story => story.book || story.source?.title || '').filter(Boolean))].sort((a,b) => a.localeCompare(b, 'zh-Hans'))) { const option = node('option', '', title); option.value = title; $('#book-filter').append(option); }
  for (const id of ['#search', '#book-filter', '#sort']) $(id).addEventListener(id === '#search' ? 'input' : 'change', render);
  document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => { setScope(button.dataset.scope); render(); }));
  $('#clear-filters').addEventListener('click', () => { $('#search').value = ''; $('#book-filter').value = ''; setScope('all'); render(); });
  window.addEventListener('storage', render);
  window.addEventListener('pageshow', render);
  render();
} catch (error) {
  $('#shelf-status').className = 'status error'; $('#shelf-status').textContent = error.message || '作品集暂时无法加载，请稍后重试。';
  const retry = node('button', 'secondary-button', '重新加载'); retry.addEventListener('click', () => location.reload()); $('#shelf-status').append(node('br'), retry);
}

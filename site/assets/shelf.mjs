// Collection page: search, combinable book/theme/style filters, sorting, and saved stories from the
// lightweight catalogue only. ?q= and ?scope=saved deep-link into the same view.
import {ROOT, catalog, libraryInfo, savedStories, node} from './common.mjs';
import {compareLatest, facetOf, facetRoutes, groupByBook, storyRoutes} from './story-url.mjs';
import {storyCard} from './cards.mjs';
const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
let stories = [], routes = new Map(), facets = {theme: new Map(), style: new Map()}, scope = 'all';
const matches = (story, query) => !query || [story.title, story.hook, story.book, story.source?.title, story.theme, story.artStyle, story.author].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
function render() {
  const query = $('#search').value.trim().toLocaleLowerCase(), saved = savedStories();
  const book = $('#book-filter').value, theme = $('#theme-filter').value, style = $('#style-filter').value;
  const filtered = stories.filter(story => (scope !== 'saved' || saved.has(story.id)) && matches(story, query)
    && (!book || routes.get(story.id)?.bookSlug === book)
    && (!theme || facetOf(story, 'theme', facets)?.slug === theme)
    && (!style || facetOf(story, 'style', facets)?.slug === style));
  filtered.sort($('#sort').value === 'title' ? (a, b) => a.title.localeCompare(b.title, 'zh-Hans') || compareLatest(a, b) : compareLatest);
  $('#stories').replaceChildren(...filtered.map(story => storyCard(story, {saved, onChange: () => { if (scope === 'saved') render(); }})));
  $('#story-count').textContent = `${filtered.length} 篇`;
  $('#shelf-status').textContent = `共 ${filtered.length} 篇作品`;
  $('#shelf-status').className = 'sr-only';
  $('#empty').hidden = filtered.length > 0;
  const hasFilters = Boolean(query || book || theme || style || scope === 'saved');
  $('#clear-filters').hidden = !hasFilters;
  $('#empty-preview').hidden = hasFilters;
  const savedOnly = scope === 'saved' && !query && !book && !theme && !style;
  $('#empty-title').textContent = hasFilters ? (savedOnly ? '把喜欢的故事，留下来。' : '这里还没有找到这篇故事。') : '好故事，正在收集。';
  $('#empty-description').textContent = hasFilters ? (savedOnly ? '点一下封面上的收藏图标，下次就能在这里找到。' : '换个关键词或筛选条件，或回到全部作品看看。') : '这里将收录经过挑选的拾趣连环画。每一篇，都值得从头读到最后。';
}
function setScope(value) {
  scope = value === 'saved' ? 'saved' : 'all';
  document.querySelectorAll('[data-scope]').forEach(button => { button.classList.toggle('active', button.dataset.scope === scope); button.setAttribute('aria-pressed', String(button.dataset.scope === scope)); });
}
function fillOptions(select, groups) {
  for (const group of [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans'))) {
    const option = node('option', '', `${group.title}（${group.stories.length}）`); option.value = group.slug; select.append(option);
  }
}
try {
  stories = await catalog();
  const info = await libraryInfo();
  if (info.remoteUnavailable && stories.length) {
    $('#catalog-notice').hidden = false;
    $('#catalog-notice').textContent = '当前显示已保存的作品集；最新收录暂时无法同步，请稍后刷新。';
  }
  routes = storyRoutes(stories); facets = facetRoutes(stories);
  fillOptions($('#book-filter'), groupByBook(stories, routes));
  fillOptions($('#theme-filter'), facets.theme);
  fillOptions($('#style-filter'), facets.style);
  $('#search').value = (params.get('q') || '').slice(0, 120);
  for (const [id, key] of [['#book-filter', 'book'], ['#theme-filter', 'theme'], ['#style-filter', 'style']]) {
    const value = params.get(key); if (value && [...$(id).options].some(option => option.value === value)) $(id).value = value;
  }
  setScope(params.get('scope'));
  for (const id of ['#search', '#book-filter', '#theme-filter', '#style-filter', '#sort']) $(id).addEventListener(id === '#search' ? 'input' : 'change', render);
  document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => { setScope(button.dataset.scope); render(); }));
  $('#clear-filters').addEventListener('click', () => { for (const id of ['#search', '#book-filter', '#theme-filter', '#style-filter']) $(id).value = ''; setScope('all'); render(); });
  window.addEventListener('storage', render);
  window.addEventListener('pageshow', render);
  render();
} catch (error) {
  $('#shelf-status').className = 'status error'; $('#shelf-status').textContent = error.message || '作品集暂时无法加载，请稍后重试。';
  const retry = node('button', 'secondary-button', '重新加载'); retry.addEventListener('click', () => location.reload()); $('#shelf-status').append(node('br'), retry);
}

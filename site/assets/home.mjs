// Home page sections from the lightweight catalogue: featured picks, latest stories, books, facets,
// and this browser's reading history. Sections without data stay hidden.
import { ROOT, catalog, libraryInfo, savedStories, progressFor, node } from './common.mjs';
import { compareLatest, facetRoutes, groupByBook, storyRoutes, FACETS } from './story-url.mjs';
import { loadFeatured, matchFeatured } from './featured.mjs';
import { storyCard, groupCard, facetChips } from './cards.mjs';
const $ = selector => document.querySelector(selector);
if (location.hash === '#collection') location.replace(new URL('collection/', ROOT));
function show(id, children) {
  const section = $(id); section.hidden = children.length === 0;
  section.querySelector('.story-grid, .facet-rail')?.replaceChildren(...children);
}
function continueReading(stories) {
  const saved = savedStories();
  const recent = stories.filter(story => progressFor(story.id)).sort((a, b) => (progressFor(b.id).at || 0) - (progressFor(a.id).at || 0)).slice(0, 4);
  show('#continue', recent.map(story => storyCard(story, { saved })));
  $('#saved-link').hidden = saved.size === 0;
  $('#saved-link').textContent = saved.size ? `我的收藏 ${saved.size} 篇 →` : '';
  $('#continue').hidden = recent.length === 0 && saved.size === 0;
}
try {
  const [stories, featured, info] = await Promise.all([catalog(), loadFeatured({ root: ROOT }), libraryInfo()]);
  if (info.remoteUnavailable && stories.length) { $('#catalog-notice').hidden = false; $('#catalog-notice').textContent = '当前显示已保存的作品集；最新收录暂时无法同步，请稍后刷新。'; }
  const routes = storyRoutes(stories), books = groupByBook(stories, routes), facets = facetRoutes(stories);
  const saved = savedStories();
  const picks = matchFeatured(featured, stories).slice(0, 6);
  show('#featured', picks.map(({ story, note }) => storyCard(story, { saved, note })));
  show('#latest', [...stories].sort(compareLatest).slice(0, 6).map(story => storyCard(story, { saved })));
  show('#books', [...books.values()].slice(0, 6).map(book => groupCard({
    path: book.path, title: book.title, count: book.stories.length, cover: book.latest.coverURL,
    hook: `最近收录：《${book.latest.title}》`
  })));
  const chips = Object.keys(FACETS).flatMap(kind => [...facets[kind].values()].sort((a, b) => b.stories.length - a.stories.length || a.title.localeCompare(b.title, 'zh-Hans'))
    .map(group => ({ path: group.path, kicker: FACETS[kind].label, title: group.title, count: group.stories.length })));
  show('#themes', chips.length ? [facetChips(chips, '按作者、主题与画风浏览')] : []);
  continueReading(stories);
  $('#story-total').textContent = stories.length ? `${stories.length} 篇 · ${books.size} 部原著` : '';
  $('#home-status').hidden = true;
  if (info.github && (info.source === 'github' || location.hostname.endsWith('.github.io'))) {
    const repository = `https://github.com/${encodeURIComponent(info.github.owner)}/${encodeURIComponent(info.github.repo)}`;
    $('#submit-github').href = repository + '/blob/' + encodeURIComponent(info.github.branch) + '/CONTRIBUTING.md';
    $('#submit-github').hidden = false; $('#submission-pending').hidden = true;
  }
  window.addEventListener('storage', () => continueReading(stories));
  window.addEventListener('pageshow', () => continueReading(stories));
} catch (error) {
  $('#home-status').className = 'status error'; $('#home-status').textContent = error.message || '作品集暂时无法加载，请稍后重试。';
  const retry = node('button', 'secondary-button', '重新加载'); retry.addEventListener('click', () => location.reload()); $('#home-status').append(node('br'), retry);
}

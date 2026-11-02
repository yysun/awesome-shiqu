// Featured page: maintainer picks from featured.json in their listed order, with optional notes.
import {ROOT, catalog, node} from './common.mjs';
import {loadFeatured, matchFeatured} from './featured.mjs';
import {storyCard} from './cards.mjs';
const $ = selector => document.querySelector(selector);
try {
  const [stories, featured] = await Promise.all([catalog(), loadFeatured({root: ROOT})]);
  const picks = matchFeatured(featured, stories);
  $('#stories').replaceChildren(...picks.map(({story, note}) => storyCard(story, {note})));
  $('#story-count').textContent = picks.length ? `${picks.length} 篇` : '';
  $('#shelf-status').textContent = `共 ${picks.length} 篇精选`; $('#shelf-status').className = 'sr-only';
  $('#empty').hidden = picks.length > 0;
  window.addEventListener('storage', () => { $('#stories').replaceChildren(...picks.map(({story, note}) => storyCard(story, {note}))); });
} catch (error) {
  $('#shelf-status').className = 'status error'; $('#shelf-status').textContent = error.message || '精选暂时无法加载，请稍后重试。';
  const retry = node('button', 'secondary-button', '重新加载'); retry.addEventListener('click', () => location.reload()); $('#shelf-status').append(node('br'), retry);
}

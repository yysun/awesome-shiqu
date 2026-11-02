// Shared catalogue cards: story cards with bookmarks and progress, group cards, and facet chips.
// Every title, hook, and note is rendered as text because story metadata is untrusted.
import {ROOT, storyLink, savedStories, toggleSaved, progressFor, node, bookmarkIcon, toast} from './common.mjs';

export function storyCard(story, {saved = savedStories(), label = story.book || story.source?.title || '', note = '', onChange} = {}) {
  const article = node('article', 'story-card');
  const link = node('a', 'card-link'); link.href = storyLink(story.id);
  const cover = node('div', 'cover-wrap');
  const image = node('img'); image.src = story.coverURL; image.alt = story.title + '封面'; image.loading = 'lazy'; image.decoding = 'async';
  image.addEventListener('error', () => { image.alt = '封面暂时无法显示'; }, {once: true});
  cover.append(image);
  if (label) cover.append(node('span', 'cover-label', label));
  const title = node('h3', 'card-title', story.title), hook = node('p', 'card-hook', story.hook || '翻开这段故事，读到一点余味。');
  const meta = node('div', 'card-meta'), credit = node('span', 'card-credit', [story.author, story.pageCount + ' 幅'].filter(Boolean).join(' · '));
  if (story.storyboardModels?.length) credit.append(node('span', 'card-model', `分镜模型：${story.storyboardModels.join(' / ')}`));
  meta.append(credit);
  const current = Math.min(story.pageCount - 1, progressFor(story.id)?.page || 0);
  meta.append(node('span', 'card-action', current > 0 ? `继续第 ${current + 1} 页 →` : '开始阅读 →'));
  link.append(cover, title);
  if (note) link.append(node('p', 'card-note', note));
  link.append(hook, meta);
  const save = node('button', 'save-button'); save.type = 'button';
  const reflect = isSaved => { save.setAttribute('aria-label', (isSaved ? '取消收藏：' : '收藏：') + story.title); save.setAttribute('aria-pressed', String(isSaved)); };
  reflect(saved.has(story.id)); save.append(bookmarkIcon());
  save.addEventListener('click', () => {
    const result = toggleSaved(story.id);
    if (!result.stored) { toast('当前浏览器无法保存收藏。'); return; }
    reflect(result.saved); toast(result.saved ? '已加入我的收藏' : '已取消收藏');
    onChange?.(result.saved);
  });
  article.append(link, save); return article;
}

export function groupCard({path, title, count, cover, hook, action = '查看故事 →'}) {
  const article = node('article', 'story-card group-card');
  const link = node('a', 'card-link'); link.href = new URL(path, ROOT);
  if (cover) {
    const wrap = node('div', 'cover-wrap');
    const image = node('img'); image.src = cover; image.alt = title + '封面'; image.loading = 'lazy'; image.decoding = 'async';
    wrap.append(image, node('span', 'cover-label', `${count} 篇`)); link.append(wrap);
  }
  link.append(node('h3', 'card-title', title), node('p', 'card-hook', hook));
  const meta = node('div', 'card-meta'); meta.append(node('span', 'card-credit', `${count} 篇`), node('span', 'card-action', action));
  link.append(meta); article.append(link); return article;
}

export function facetChips(items, label) {
  const list = node('ul', 'facet-chips'); list.setAttribute('aria-label', label);
  for (const item of items) {
    const link = node('a'); link.href = new URL(item.path, ROOT);
    if (item.kicker) link.append(node('span', 'chip-kicker', item.kicker));
    link.append(document.createTextNode(item.title), node('span', 'count', `${item.count} 篇`));
    const entry = node('li'); entry.append(link); list.append(entry);
  }
  return list;
}

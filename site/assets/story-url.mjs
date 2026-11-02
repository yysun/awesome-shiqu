// Shared SEO-friendly page paths: the build script and the site must map stories identically.
export function slugify(value) {
  const slug = String(value ?? '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return [...slug].slice(0, 80).join('').replace(/-+$/, '');
}

// Deterministic and order-independent: duplicate titles within a book all gain an id suffix.
export function storyRoutes(stories) {
  const counts = new Map(), routes = new Map();
  const entries = (Array.isArray(stories) ? stories : []).map(story => {
    const bookTitle = (typeof story.book === 'string' && story.book.trim())
      || (typeof story.source?.title === 'string' && story.source.title.trim()) || '';
    const bookSlug = slugify(bookTitle) || '拾趣精选';
    const titleSlug = slugify(story.title) || String(story.id);
    const key = `${bookSlug}/${titleSlug}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    return {id: story.id, bookTitle: bookTitle || '拾趣精选', bookSlug, titleSlug, key};
  });
  for (const entry of entries) {
    const storySlug = counts.get(entry.key) > 1 ? `${entry.titleSlug}--${entry.id}` : entry.titleSlug;
    routes.set(entry.id, {
      bookTitle: entry.bookTitle, bookSlug: entry.bookSlug, storySlug,
      bookPath: `books/${entry.bookSlug}/`, path: `books/${entry.bookSlug}/${storySlug}/`,
    });
  }
  return routes;
}

// Newest first, then title, then id so ordering never depends on catalogue order.
export function compareLatest(a, b) {
  return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))
    || String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans')
    || String(a.id).localeCompare(String(b.id));
}

export const FACETS = {
  theme: {field: 'theme', directory: 'themes', label: '主题'},
  style: {field: 'artStyle', directory: 'styles', label: '画风'},
};

const facetTitle = (story, field) => (typeof story?.[field] === 'string' ? story[field].trim() : '');

// Facet pages: themes/<slug>/ and styles/<slug>/. Stories without the field join no group.
export function facetRoutes(stories) {
  const result = {theme: new Map(), style: new Map()};
  for (const [kind, {field, directory}] of Object.entries(FACETS)) {
    const groups = result[kind];
    for (const story of Array.isArray(stories) ? stories : []) {
      const title = facetTitle(story, field), slug = slugify(title);
      if (!slug) continue;
      let group = groups.get(slug);
      if (!group) { group = {kind, slug, title, titles: [], path: `${directory}/${slug}/`, stories: []}; groups.set(slug, group); }
      if (!group.titles.includes(title)) group.titles.push(title);
      group.stories.push(story);
    }
    for (const group of groups.values()) {
      group.titles.sort((a, b) => a.localeCompare(b, 'zh-Hans'));
      group.title = group.titles[0];
      group.stories.sort(compareLatest);
    }
  }
  return result;
}

export function facetOf(story, kind, facets) {
  return facets[kind].get(slugify(facetTitle(story, FACETS[kind].field))) || null;
}

// Books in the order of their newest story; each book lists its stories newest first.
export function groupByBook(stories, routes = storyRoutes(stories)) {
  const books = new Map();
  for (const story of Array.isArray(stories) ? stories : []) {
    const route = routes.get(story.id);
    if (!route) continue;
    let book = books.get(route.bookSlug);
    if (!book) { book = {slug: route.bookSlug, title: route.bookTitle, titles: [], path: route.bookPath, stories: []}; books.set(route.bookSlug, book); }
    const title = slugify(route.bookTitle) ? route.bookTitle : '拾趣精选';
    if (!book.titles.includes(title)) book.titles.push(title);
    book.stories.push(story);
  }
  for (const book of books.values()) {
    book.stories.sort(compareLatest);
    book.latest = book.stories[0];
    book.titles.sort((a, b) => a.localeCompare(b, 'zh-Hans'));
  }
  return new Map([...books].sort((a, b) => compareLatest(a[1].latest, b[1].latest) || a[0].localeCompare(b[0], 'zh-Hans')));
}

// Distinct titles that collapse into one URL would silently merge; the build refuses them.
export function slugConflicts(stories) {
  const conflicts = [];
  for (const book of groupByBook(stories).values()) if (book.titles.length > 1) conflicts.push({kind: '书名', slug: book.slug, titles: book.titles});
  const facets = facetRoutes(stories);
  for (const kind of Object.keys(FACETS)) for (const group of facets[kind].values()) if (group.titles.length > 1) conflicts.push({kind: FACETS[kind].label, slug: group.slug, titles: group.titles});
  return conflicts;
}

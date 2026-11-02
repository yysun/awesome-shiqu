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

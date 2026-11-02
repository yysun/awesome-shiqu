import test from 'node:test';
import assert from 'node:assert/strict';
import {compareLatest, facetOf, facetRoutes, groupByBook, slugConflicts, slugify, storyRoutes} from '../site/assets/story-url.mjs';

test('slugify keeps CJK letters and numbers, collapsing punctuation into single hyphens', () => {
  assert.equal(slugify('说苑·正谏'), '说苑-正谏');
  assert.equal(slugify('  红楼梦  '), '红楼梦');
  assert.equal(slugify('《三国演义》第8回！'), '三国演义-第8回');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(undefined), '');
  assert.equal([...slugify('字'.repeat(120))].length, 80);
});

test('story routes put the book in the URL and resolve duplicates deterministically', () => {
  const stories = [
    {id: 'a1', title: '黛玉剪香囊', book: '红楼梦'},
    {id: 'b2', title: '黄忠智取定军山', book: '三国演义'},
    {id: 'c3', title: '螳螂捕蝉', source: {title: '说苑·正谏'}},
    {id: 'd4', title: '黛玉剪香囊', book: '红楼梦'},
  ];
  const routes = storyRoutes(stories);
  assert.equal(routes.get('b2').path, 'books/三国演义/黄忠智取定军山/');
  assert.equal(routes.get('b2').bookPath, 'books/三国演义/');
  assert.equal(routes.get('c3').bookTitle, '说苑·正谏');
  assert.equal(routes.get('c3').path, 'books/说苑-正谏/螳螂捕蝉/');
  assert.equal(routes.get('a1').path, 'books/红楼梦/黛玉剪香囊--a1/');
  assert.equal(routes.get('d4').path, 'books/红楼梦/黛玉剪香囊--d4/');
  const reversed = storyRoutes([...stories].reverse());
  for (const [id, route] of routes) assert.deepEqual(reversed.get(id), route);
});

test('stories without usable titles or books still get safe fallback paths', () => {
  const routes = storyRoutes([{id: 'x9', title: '！！！', book: '……'}]);
  assert.equal(routes.get('x9').path, 'books/拾趣精选/x9/');
  assert.equal(routes.get('x9').bookTitle, '……');
  assert.equal(storyRoutes([{id: 'y1', title: '标题'}]).get('y1').bookTitle, '拾趣精选');
});

test('compareLatest orders newest first, then title, then id regardless of input order', () => {
  const stories = [
    {id: 'b', title: '乙', publishedAt: '2026-11-01'},
    {id: 'a', title: '乙', publishedAt: '2026-11-01'},
    {id: 'c', title: '甲', publishedAt: '2026-11-01'},
    {id: 'd', title: '丁', publishedAt: '2026-11-02'},
    {id: 'e', title: '无日期'},
  ];
  const expected = ['d', 'c', 'a', 'b', 'e'];
  assert.deepEqual([...stories].sort(compareLatest).map(s => s.id), expected);
  assert.deepEqual([...stories].reverse().sort(compareLatest).map(s => s.id), expected);
});

test('facet routes group by theme and art style, skipping stories without the field', () => {
  const stories = [
    {id: 'a1', title: '一', theme: '爱情与错过', artStyle: '清新卡通', publishedAt: '2026-11-01'},
    {id: 'b2', title: '二', theme: '原典故事', artStyle: '黏土定格', publishedAt: '2026-11-02'},
    {id: 'c3', title: '三', theme: ' 爱情与错过 ', publishedAt: '2026-11-03'},
    {id: 'd4', title: '四', theme: '', artStyle: '！！！'},
  ];
  const facets = facetRoutes(stories);
  assert.deepEqual([...facets.theme.keys()], ['爱情与错过', '原典故事']);
  assert.equal(facets.theme.get('爱情与错过').path, 'themes/爱情与错过/');
  assert.deepEqual(facets.theme.get('爱情与错过').stories.map(s => s.id), ['c3', 'a1']);
  assert.equal(facets.style.get('黏土定格').path, 'styles/黏土定格/');
  assert.equal(facets.style.size, 2);
  assert.equal(facetOf(stories[2], 'theme', facets).title, '爱情与错过');
  assert.equal(facetOf(stories[3], 'theme', facets), null);
  assert.equal(facetOf(stories[3], 'style', facets), null);
});

test('groupByBook orders books by newest story and lists each book newest first', () => {
  const stories = [
    {id: 'a1', title: '一', book: '红楼梦', publishedAt: '2026-10-01'},
    {id: 'b2', title: '二', book: '三国演义', publishedAt: '2026-11-02'},
    {id: 'c3', title: '三', book: '红楼梦', publishedAt: '2026-11-03'},
    {id: 'x9', title: '无书'},
  ];
  const books = groupByBook(stories);
  assert.deepEqual([...books.keys()], ['红楼梦', '三国演义', '拾趣精选']);
  assert.deepEqual(books.get('红楼梦').stories.map(s => s.id), ['c3', 'a1']);
  assert.equal(books.get('红楼梦').latest.id, 'c3');
  assert.equal(books.get('拾趣精选').path, 'books/拾趣精选/');
});

test('slugConflicts reports distinct book, theme, and style titles that share one slug', () => {
  const long = '字'.repeat(80);
  const stories = [
    {id: 'a', title: '一', book: '说苑·正谏', theme: '爱情 与错过', artStyle: '清新·卡通'},
    {id: 'b', title: '二', book: '说苑 正谏', theme: '爱情，与错过', artStyle: '清新 卡通'},
    {id: 'c', title: '三', book: long + '甲'},
    {id: 'd', title: '四', book: long + '乙'},
    {id: 'e', title: '五', book: '……'},
    {id: 'f', title: '六'},
  ];
  const conflicts = slugConflicts(stories);
  assert.deepEqual(conflicts.map(c => c.kind + ':' + c.slug), ['书名:说苑-正谏', `书名:${long}`, '主题:爱情-与错过', '画风:清新-卡通']);
  assert.deepEqual(conflicts[0].titles, ['说苑 正谏', '说苑·正谏']);
  assert.deepEqual(slugConflicts([{id: 'a', title: '一', book: '红楼梦', theme: '爱情'}, {id: 'b', title: '二', book: '红楼梦', theme: '爱情'}]), []);
});

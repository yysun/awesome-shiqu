import test from 'node:test';
import assert from 'node:assert/strict';
import {slugify, storyRoutes} from '../site/assets/story-url.mjs';

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

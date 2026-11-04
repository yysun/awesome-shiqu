// Exercise independent-reader route origins through the real shared catalogue and card renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
const version='a'.repeat(64),publication='https://yysun.github.io/awesome-shiqu/';
const story={id:'alice--new',title:'新增故事',book:'新书',theme:'新主题',pageCount:1,version,url:`public/alice--new/${version}/story.json`,cover:`public/alice--new/${version}/images/01.png`};
test('independent reader opens stories in its existing reader and routes new book/theme links to the selected publication',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async input=>{
    const url=String(input);calls.push(url);
    if(url.endsWith('/config.json'))return new Response(JSON.stringify({github:{owner:'yysun',repo:'awesome-shiqu',branch:'main',directory:'works',catalog:'catalog/catalog.json'}}));
    assert.equal(url,new URL('catalog.json',publication).href);return new Response(JSON.stringify({schemaVersion:1,stories:[story]}));
  });
  const original=globalThis.document;
  globalThis.document={createElement(tag){return{tag,children:[],append(...items){this.children.push(...items);},setAttribute(name,value){this[name]=value;}};},createTextNode(text){return{textContent:text};}};
  t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
  const common=await import('../site/assets/common.mjs'),cards=await import('../site/assets/cards.mjs');
  const entries=await common.catalog();assert.equal(entries[0].manifestURL,new URL(story.url,publication).href);assert.equal(calls.length,2);
  assert.equal(common.hasLocalStoryPages(),false);assert.equal(common.storyLink(story.id).search,'?story=alice--new');assert.ok(common.storyLink(story.id).pathname.endsWith('/reader.html'));
  const book=cards.groupCard({path:'books/新书/',title:'新书',count:1,hook:'新增'});
  assert.equal(String(book.children[0].href),new URL('books/新书/',publication).href);
  const themes=cards.facetChips([{path:'themes/新主题/',title:'新主题',count:1}],'主题');
  assert.equal(String(themes.children[0].children[0].href),new URL('themes/新主题/',publication).href);
  assert.equal(common.publicationURL('themes/新主题/').origin,'https://yysun.github.io');
});

// 直接核验当前来源的公开产物、隐私边界和原生图片加载的资源限制。
import test from 'node:test';
import assert from 'node:assert/strict';
import filesystem, {cp, mkdtemp, mkdir, readFile, readdir, writeFile, rm} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {build} from '../scripts/build.mjs';
import {readZip, crc32} from '../scripts/zip.mjs';
import {preparePublication, imageDimensions} from '../scripts/static-publication.mjs';
import {parseStoryArchive} from '../site/assets/story-archive.mjs';
import {loadPublishedStory, publishedArtwork, validateCatalog, assetURL} from '../site/assets/library.mjs';
const archive = await readFile(new URL('./fixtures/publication.zip', import.meta.url)), files = readZip(archive), source = JSON.parse(files.get('故事.json'));
const hash = value => createHash('sha256').update(value).digest('hex');
const ROOT = new URL('https://independent.example/project/');
const github = {owner:'yysun',repo:'awesome-shiqu',branch:'main',directory:'works',catalog:'catalog/catalog.json'};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64');
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(bytes), compressed = deflateRawSync(data), crc = crc32(data), a = Buffer.alloc(30), b = Buffer.alloc(46);
    a.writeUInt32LE(0x04034b50); a.writeUInt16LE(20,4); a.writeUInt16LE(0x800,6); a.writeUInt16LE(8,8); a.writeUInt32LE(crc,14); a.writeUInt32LE(compressed.length,18); a.writeUInt32LE(data.length,22); a.writeUInt16LE(filename.length,26);
    b.writeUInt32LE(0x02014b50); b.writeUInt16LE(20,4); b.writeUInt16LE(20,6); b.writeUInt16LE(0x800,8); b.writeUInt16LE(8,10); b.writeUInt32LE(crc,16); b.writeUInt32LE(compressed.length,20); b.writeUInt32LE(data.length,24); b.writeUInt16LE(filename.length,28); b.writeUInt32LE(offset,42);
    locals.push(a,filename,compressed); central.push(b,filename); offset += a.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
function changedArchive(data, extra = []) { return zip([...files].map(([name, bytes]) => [name,name === '故事.json' ? JSON.stringify(data) : bytes]).concat(extra)); }
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shiqu-static-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  await cp('site',path.join(root,'site'),{recursive:true}); await rm(path.join(root,'site/featured.json'),{force:true});
  await mkdir(path.join(root,'works/alice'),{recursive:true}); await writeFile(path.join(root,'works/alice/story.zip'),archive);
  return root;
}
const catalogue = async root => JSON.parse(await readFile(path.join(root,'dist/catalog.json'),'utf8'));
async function htmlFor(root) {
  const index = await catalogue(root), entry = index.stories[0];
  const {storyRoutes} = await import('../site/assets/story-url.mjs');
  const route = storyRoutes(index.stories).get(entry.id);
  return {entry,html:await readFile(path.join(root,'dist',route.path,'index.html'),'utf8'),route};
}
async function allFiles(folder) {
  const result = [];
  for (const entry of await readdir(folder,{withFileTypes:true})) {
    if (entry.isDirectory()) result.push(...await allFiles(path.join(folder,entry.name)));
    else result.push(path.join(folder,entry.name));
  }
  return result;
}

test('initial HTML contains the actual ordered story, public disclosures, dimensions, SEO and safe structured values', async t => {
  const root = await workspace(t);
  const data = {...source,title:'标题 </script><script>alert(1)</script> & "字"',sourceText:'公开原文 <img src=x onerror=alert(1)>',pages:source.pages.map(p=>({...p,caption:p.caption+' <b>正文</b>'})),productionPrompt:'PRIVATE-ROOT'};
  await writeFile(path.join(root,'works/alice/story.zip'),changedArchive(data,[['PRIVATE-FILENAME.txt','PRIVATE-ENTRY'],['unused.png',PNG]]));
  await build(root);
  const {entry,html,route} = await htmlFor(root), manifest = JSON.parse(await readFile(path.join(root,'dist',entry.url),'utf8'));
  assert.match(html,/<div id="reader-content">/); assert.match(html,/<div id="reader-status"[^>]* hidden>/);
  assert.ok(html.includes('标题 &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;字&quot;'));
  assert.ok(html.includes('公开原文 &lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes(source.publication.contact)); assert.ok(html.includes(source.aiDisclosure));
  assert.ok(html.includes(source.publication.reuse)); assert.ok(html.includes(source.publication.sourceNote));
  assert.equal((html.match(/<figure /g)||[]).length,manifest.pages.length);
  assert.equal((html.match(/loading="eager"/g)||[]).length,1); assert.equal((html.match(/loading="lazy"/g)||[]).length,manifest.pages.length-1);
  assert.match(html, /width="\d+" height="\d+" loading="eager" fetchpriority="high"/);
  assert.match(html,/aria-describedby="caption-0"/); assert.match(html,/<figcaption id="caption-0">/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld.name,data.title); assert.equal(ld['@type'],'CreativeWork'); assert.equal(ld.text,manifest.pages.map(p=>p.caption).join('\n'));
  assert.equal(ld.url,new URL(route.path,'https://yysun.github.io/awesome-shiqu/').href); assert.equal(ld.image,new URL(entry.cover,'https://yysun.github.io/awesome-shiqu/').href);
  assert.ok(html.includes(`<meta name="twitter:image" content="${ld.image}">`)); assert.ok(html.includes(`<link rel="canonical" href="${ld.url}">`));
  assert.equal(html.includes('</script><script>alert(1)'),false); assert.doesNotMatch(html,/(?:href|src)="\//);
  const publicFiles = await allFiles(path.join(root,'dist'));
  for (const file of publicFiles) {
    assert.equal(file.endsWith('.zip'),false);
    if (/\.(?:html|json|xml)$/.test(file)) assert.doesNotMatch(await readFile(file,'utf8'),/PRIVATE-|productionPrompt|unused\.png/);
  }
  for (const [i,page] of manifest.pages.entries()) {
    const bytes = await readFile(path.join(root,'dist',path.dirname(entry.url),page.image));
    assert.deepEqual(bytes,files.get(source.pages[i].image)); assert.equal(hash(bytes),page.sha256);
    assert.ok(html.includes(`src="../../../${path.dirname(entry.url)}/${page.image}"`));
    assert.deepEqual(imageDimensions(bytes),{width:page.width,height:page.height});
  }
  assert.equal(manifest.provenance.sha256,entry.sha256); assert.equal(manifest.provenance.archiveBytes,entry.archiveBytes);
  const sitemap = await readFile(path.join(root,'dist/sitemap.xml'),'utf8'); assert.ok(sitemap.includes(ld.url));
  const legacy = await readFile(path.join(root,'dist/reader.html'),'utf8'); assert.match(legacy,/noindex,follow/); assert.ok(legacy.includes(route.path));
});

test('updates publish only current assets; repeated and clean builds agree and preserve canonical routes',async t=>{
  const root = await workspace(t); await build(root);
  const {entry:first,route:firstRoute}=await htmlFor(root);
  await writeFile(path.join(root,'works/alice/story.zip'),changedArchive({...source,summary:'新版本简介'})); await build(root);
  const {entry:second,html,route:secondRoute}=await htmlFor(root);
  assert.notEqual(second.version,first.version); assert.equal(secondRoute.path,firstRoute.path);
  await assert.rejects(readFile(path.join(root,'dist',first.url)),/ENOENT/);
  await assert.rejects(readFile(path.join(root,'dist',first.cover)),/ENOENT/);
  assert.deepEqual(await readdir(path.join(root,'dist/public',second.id)),[second.version]);
  assert.ok(html.includes(second.version)); assert.equal(html.includes(first.version),false);
  const snapshot=async()=>Promise.all((await allFiles(path.join(root,'dist'))).sort().map(async file=>[path.relative(path.join(root,'dist'),file),hash(await readFile(file))]));
  const repeated=await snapshot();
  await rm(path.join(root,'dist'),{recursive:true}); await build(root);
  assert.deepEqual(await snapshot(),repeated);
});

test('failed validation and failed promotion preserve the previous complete release',async t=>{
  const root = await workspace(t); await build(root);
  const entry=(await catalogue(root)).stories[0];
  const previous=await readFile(path.join(root,'dist/catalog.json'));
  const manifest=await readFile(path.join(root,'dist',entry.url)),image=await readFile(path.join(root,'dist',entry.cover));
  const assertPrevious=async()=>{
    assert.deepEqual(await readFile(path.join(root,'dist/catalog.json')),previous);
    assert.deepEqual(await readFile(path.join(root,'dist',entry.url)),manifest);
    assert.deepEqual(await readFile(path.join(root,'dist',entry.cover)),image);
  };
  await writeFile(path.join(root,'works/alice/story.zip'),Buffer.from('PRIVATE-CORRUPT-ARCHIVE'));
  await assert.rejects(build(root),error=>!error.message.includes('PRIVATE-')&&error.message.includes('验证失败'));
  await assertPrevious();
  await writeFile(path.join(root,'works/alice/story.zip'),changedArchive({...source,summary:'晋升失败的新版本'}));
  const rename=filesystem.rename; let failed=false;
  const mock=t.mock.method(filesystem,'rename',async(from,to)=>{
    if(!failed&&to===path.join(root,'dist')){failed=true;throw Object.assign(Error('promotion failed'),{code:'EIO'});}
    return rename(from,to);
  });syncBuiltinESMExports();
  try {await assert.rejects(build(root),/promotion failed/);await assertPrevious();}
  finally {mock.mock.restore();syncBuiltinESMExports();}
});

test('old-output cleanup failure reports a successful promoted release',async t=>{
  const root=await workspace(t);await build(root);const previous=(await catalogue(root)).stories[0].version;
  await writeFile(path.join(root,'works/alice/story.zip'),changedArchive({...source,summary:'promoted'}));
  const rm=filesystem.rm,warnings=[];
  const mock=t.mock.method(filesystem,'rm',async(file,options)=>{
    if(String(file).startsWith(path.join(root,'.dist-build-'))&&String(file).endsWith('-previous'))throw Error('cleanup failed');
    return rm(file,options);
  });const warning=t.mock.method(console,'warn',message=>warnings.push(message));syncBuiltinESMExports();
  try {assert.equal((await build(root)).count,1);assert.notEqual((await catalogue(root)).stories[0].version,previous);assert.equal(warnings.length,1);}
  finally {mock.mock.restore();warning.mock.restore();syncBuiltinESMExports();}
});

test('withdrawing a selected source removes its public resources from subsequent deployments',async t=>{
  const root=await workspace(t);await build(root);const entry=(await catalogue(root)).stories[0];
  await rm(path.join(root,'works/alice/story.zip'));await build(root);
  assert.equal((await catalogue(root)).stories.length,0);
  await assert.rejects(readFile(path.join(root,'dist',entry.url)),/ENOENT/);
});

test('static remote loading fetches one exact manifest and never downloads images or substitutes ZIP/version on failure',async()=>{
  const parsed=await parseStoryArchive(archive,{id:'alice--story',author:'alice',publishedAt:'2026-11-04'});
  const prepared=preparePublication({...parsed,relativePath:'works/alice/story.zip',sha256:hash(archive),archiveBytes:archive.length});
  const remote=new URL('https://yysun.github.io/awesome-shiqu/');
  const [entry]=validateCatalog({schemaVersion:1,stories:[{...prepared.entry,url:new URL(prepared.entry.url,remote).href,cover:new URL(prepared.entry.cover,remote).href}]},{root:ROOT,github});
  const calls=[],original=URL.createObjectURL;URL.createObjectURL=()=>{throw Error('No Blob allocation allowed');};
  try {
    const loaded=await loadPublishedStory(entry,{fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(prepared.manifest));}});
    assert.equal(calls.length,1);assert.equal(calls[0].url,entry.manifestURL);assert.equal(calls[0].options.redirect,'error');
    assert.equal(loaded.imageURLs.size,2);assert.ok([...loaded.imageURLs.values()].every(url=>url.startsWith(new URL('./',entry.manifestURL).href)));
    await assert.rejects(loadPublishedStory(entry,{fetcher:async()=>new Response('',{status:503})}),/暂时无法打开/);
    await assert.rejects(loadPublishedStory(entry,{fetcher:async()=>new Response(JSON.stringify({...prepared.manifest,hook:'wrong version'}))}),/版本/);
    for (const image of ['../other.png','https://evil.example/a.png','images/a.png?x=1']) assert.throws(()=>publishedArtwork({...prepared.manifest,pages:[{...prepared.manifest.pages[0],image}]},entry.manifestURL),/路径/);
    for(const url of ['https://evil.example/public/a/'+entry.version+'/story.json','https://other.github.io/awesome-shiqu/public/a/'+entry.version+'/story.json']) assert.throws(()=>assetURL(url,{root:ROOT,github}));
  } finally {URL.createObjectURL=original;}
});

test('legal original text with many markup characters survives escaped publication and remote loading', async t => {
  const root = await workspace(t), data = {...source,sourceText:'<'.repeat(400000)};
  await writeFile(path.join(root,'works/alice/story.zip'),changedArchive(data)); await build(root);
  const entry=(await catalogue(root)).stories[0],manifest=await readFile(path.join(root,'dist',entry.url));
  assert.ok(manifest.length>2*1024*1024);
  const loaded=await loadPublishedStory({...entry,manifestURL:new URL(entry.url,ROOT).href},{fetcher:async()=>new Response(manifest)});
  assert.equal(loaded.story.sourceText,data.sourceText);
});

// Valid PNG with a large ancillary text chunk; actual image pixels remain a decodable 1×1.
function paddedPNG(size) {
  const data=Buffer.alloc(size-PNG.length-12,97);data.write('Comment\0',0,'ascii');
  const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length,0);chunk.write('tEXt',4,'ascii');data.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
  return Buffer.concat([PNG.subarray(0,-12),chunk,PNG.subarray(-12)]);
}
test('a legal 80-page ZIP near 256 MiB with a near-12-MiB image opens through metadata alone',async t=>{
  const root=await workspace(t),entries=[],pages=[],MiB=1024*1024;
  const nearImage=paddedPNG(Math.floor(11.99*MiB)),normal=paddedPNG(Math.floor(3.08*MiB));
  for(let i=0;i<80;i++){const image=`images/${i+1}.png`;entries.push([image,i===0?nearImage:normal]);pages.push({image,caption:`第 ${i+1} 幅`});}
  const data={...source,title:'大故事',pages};entries.unshift(['故事.json',JSON.stringify(data)]);
  await writeFile(path.join(root,'works/alice/story.zip'),zip(entries));await build(root);
  const {entry,html}=await htmlFor(root);let calls=0;
  const loaded=await loadPublishedStory({...entry,manifestURL:new URL(entry.url,ROOT).href},{fetcher:async()=>{calls++;return new Response(await readFile(path.join(root,'dist',entry.url)));}});
  assert.equal(calls,1);assert.equal(loaded.imageURLs.size,80);assert.equal((html.match(/loading="lazy"/g)||[]).length,79);assert.equal((html.match(/loading="eager"/g)||[]).length,1);
  assert.equal(loaded.story.pages[79].caption,'第 80 幅');
  const imageBytes=nearImage.length+79*normal.length;assert.ok(imageBytes>255*MiB&&imageBytes<256*MiB);
  assert.ok((await readFile(path.join(root,'dist',entry.cover))).length>11.9*MiB);
});

// Verify the actual upstream ZIP across browser, importer and static publication; valid-CRC tampering targets SHA checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,cp,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {parseStoryArchive,parseStoryJSON} from '../site/assets/story-archive.mjs';
import {loadLocalArchive,loadArchive} from '../site/assets/library.mjs';
import {publicationFields} from '../site/assets/story-publication.mjs';
import {readZip,crc32} from '../scripts/zip.mjs';
import {prepareStory,importStory} from '../scripts/import-story.mjs';
import {readLibrary,validateManifest} from '../scripts/content.mjs';
import {build} from '../scripts/build.mjs';
import {readArchiveLibrary} from '../scripts/archive-library.mjs';
const bytes=await readFile(new URL('./fixtures/publication.zip',import.meta.url)),files=readZip(bytes),source=JSON.parse(files.get('故事.json'));
const options={id:'submitter--publication',author:'submitter',publishedAt:'2026-11-02'},importOptions={slug:'publication',author:'submitter',date:'2026-11-02'};
const hash=value=>createHash('sha256').update(value).digest('hex');
function zip(entries){
 const local=[],central=[];let offset=0;
 for(const [name,value] of entries){const filename=Buffer.from(name),data=Buffer.from(value),crc=crc32(data),a=Buffer.alloc(30),b=Buffer.alloc(46);
  a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt16LE(0x800,6);a.writeUInt32LE(crc,14);a.writeUInt32LE(data.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(filename.length,26);
  b.writeUInt32LE(0x02014b50);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt16LE(0x800,8);b.writeUInt32LE(crc,16);b.writeUInt32LE(data.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(filename.length,28);b.writeUInt32LE(offset,42);
  local.push(a,filename,data);central.push(b,filename);offset+=a.length+filename.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
function jsonArchive(data){const changed=new Map(files);changed.set('故事.json',Buffer.from(JSON.stringify(data)));return zip(changed);}
async function workspace(t){const root=await mkdtemp(path.join(os.tmpdir(),'awesome-publication-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp('site',path.join(root,'site'),{recursive:true});await rm(path.join(root,'site/featured.json'),{force:true});return root;}

test('real production export retains public credits, original source, version, AI and exact WebP/XMP bytes in both parsers',async()=>{
 const parsed=await parseStoryArchive(bytes,options),imported=prepareStory(bytes,importOptions);
 assert.deepEqual(parsed.manifest,{...imported.manifest,id:options.id});
 const m=parsed.manifest;assert.equal(m.author,source.author);assert.notEqual(m.author,options.author);assert.equal(m.contributor,options.author);assert.deepEqual(m.publication,source.publication);assert.equal(m.sourceText,source.sourceText);assert.equal(m.aiGenerated,true);assert.equal(m.aiDisclosure,source.aiDisclosure);assert.equal(m.exportIdentity.storyId,source.id);assert.equal(m.exportIdentity.revision,source.revision);assert.equal(m.pages.length,2);
 for(const [i,image] of parsed.images.entries()){
  assert.deepEqual(Buffer.from(image.bytes),files.get(source.pages[i].image));assert.equal(hash(image.bytes),m.pages[i].sha256);assert.equal(m.pages[i].watermark,undefined);assert.equal(source.pages[i].watermark,undefined);assert.ok(!Buffer.from(image.bytes).includes(Buffer.from('shiqu:Invisible')));
 }
 assert.ok(!JSON.stringify(m).includes('PRIVATE_'));
});
test('local and catalogued ZIP readers preserve creator separately from contributor',async()=>{
 const local=await loadLocalArchive(new File([bytes],'publication.zip'));try{assert.equal(local.story.author,source.author);assert.equal(local.story.contributor,undefined);assert.equal(local.story.aiDisclosure,source.aiDisclosure);}finally{local.dispose();}
 const loaded=await loadArchive({...options,contributor:'submitter',author:source.author,archiveURL:'https://example.org/project/works/submitter/publication.zip',archiveBytes:bytes.length,sha256:hash(bytes),pageCount:2},{root:new URL('https://example.org/project/'),fetcher:async()=>new Response(bytes)});
 try{assert.equal(loaded.story.contributor,'submitter');assert.equal(loaded.story.author,source.author);}finally{loaded.dispose();}
});
test('actual import and static build retain bytes and keep original text out of lightweight catalogues',async t=>{
 const root=await workspace(t);await mkdir(path.join(root,'works/submitter'),{recursive:true});await writeFile(path.join(root,'works/submitter/publication.zip'),bytes);
 await importStory(path.join(root,'works/submitter/publication.zip'),importOptions,root);
 const archives=await readArchiveLibrary(root);assert.equal(archives[0].manifest.author,source.author);assert.equal(archives[0].manifest.contributor,'submitter');
 const summary=await build(root);assert.equal(summary.count,2);
 const catalog=JSON.parse(await readFile(path.join(root,'dist/catalog.json')));assert.ok(catalog.stories.every(s=>!Object.hasOwn(s,'sourceText')));assert.ok(catalog.stories.every(s=>s.author===source.author&&s.contributor==='submitter'));
 assert.deepEqual(await readFile(path.join(root,'dist/works/submitter/publication.zip')),bytes);assert.deepEqual(await readdir(path.join(root,'dist/works/submitter')),['publication.zip']);
 const manifest=JSON.parse(await readFile(path.join(root,'dist/stories/publication/story.json')));assert.equal(manifest.sourceText,source.sourceText);
 for(const [i,page] of manifest.pages.entries())assert.deepEqual(await readFile(path.join(root,'dist/stories/publication',page.image)),files.get(source.pages[i].image));
 const archiveEntry=catalog.stories.find(s=>s.archive);assert.equal(new URL(archiveEntry.archive,'https://example.org/project/').pathname,'/project/works/submitter/publication.zip');
 const tampered=Buffer.from(files.get(source.pages[0].image));tampered[tampered.length-5]^=1;await writeFile(path.join(root,'stories/publication/images/01.webp'),tampered);await assert.rejects(readLibrary(root),/SHA-256/);
});
test('valid-CRC metadata tampering fails final image SHA in browser and importer',async()=>{
 const changed=new Map(files),image=Buffer.from(changed.get(source.pages[0].image));image[image.length-5]^=1;changed.set(source.pages[0].image,image);const bad=zip(changed);assert.equal(readZip(bad).size,files.size);
 await assert.rejects(parseStoryArchive(bad,options),/SHA-256/);assert.throws(()=>prepareStory(bad,importOptions),/SHA-256/);
});
test('unknown authors and AI remain unknown; old explicit manifest authors survive; unsafe public records fail',async()=>{
 for(const ai of [null,false]){
  const data={...source,author:'',publication:{...source.publication,author:''},aiGenerated:ai};const archive=jsonArchive(data);
  assert.equal((await parseStoryArchive(archive,options)).manifest.author,'');assert.equal((await parseStoryArchive(archive,options)).manifest.aiGenerated,ai);assert.equal(prepareStory(archive,importOptions).manifest.aiGenerated,ai);
 }
 const legacy={...source};for(const key of ['author','publication','aiGenerated','aiDisclosure'])delete legacy[key];assert.equal((await parseStoryArchive(jsonArchive(legacy),options)).manifest.author,'');
 const manifest=prepareStory(bytes,importOptions).manifest;assert.equal(validateManifest({...manifest,publication:undefined,author:'原有明确署名'}).author,'原有明确署名');
 assert.throws(()=>validateManifest({...manifest,privateNotes:'secret'}),/未知字段/);
 for(const workUrl of ['javascript:alert(1)','https://user:password@example.org/'])assert.throws(()=>publicationFields({publication:{...source.publication,workUrl}}),/作品链接/);
 assert.throws(()=>parseStoryJSON(JSON.stringify({...source,publication:{...source.publication,privatePrompt:'secret'}})),/未知字段/);
 assert.throws(()=>parseStoryJSON(JSON.stringify({...source,pages:[{...source.pages[0],sha256:'invalid'}]})),/SHA-256/);
 const publicData=parseStoryJSON(JSON.stringify({...source,productionPrompt:'PRIVATE_ROOT',pages:source.pages.map(p=>({...p,prompt:'PRIVATE_PAGE'}))}));assert.ok(!JSON.stringify(publicData).includes('PRIVATE_'));
});

test('standalone browser loader verifies exact displayed bytes, mixed legacy pages, confinement and failure cleanup',async t=>{
 const {loadManifestArtwork}=await import('../site/assets/library.mjs');
 const manifest=prepareStory(bytes,importOptions).manifest,base=new URL('https://example.org/project/stories/publication/story.json'),allocated=[],revoked=[],fetched=[];
 t.mock.method(URL,'createObjectURL',blob=>{allocated.push(blob);return 'blob:verified-'+allocated.length;});t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 const fetcher=async(url,options)=>{fetched.push(url.href);assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin');return new Response(files.get(source.pages[fetched.length%2===1?0:1].image));};
 const mixed={...manifest,pages:[manifest.pages[0],{image:'images/old.webp',caption:'旧画面'}]};
 const prepared=await loadManifestArtwork(mixed,base,{fetcher});
 assert.equal(prepared.imageURLs.get(mixed.pages[0].image),'blob:verified-1');assert.equal(prepared.imageURLs.get('images/old.webp'),'https://example.org/project/stories/publication/images/old.webp');assert.equal(fetched.length,1);assert.deepEqual(Buffer.from(await allocated[0].arrayBuffer()),files.get(source.pages[0].image));prepared.dispose();prepared.dispose();assert.deepEqual(revoked,['blob:verified-1']);
 fetched.length=0;const tampered=Buffer.from(files.get(source.pages[1].image));tampered[tampered.length-5]^=1;
 await assert.rejects(loadManifestArtwork(manifest,base,{fetcher:async()=>new Response(++fetched.length===1?files.get(source.pages[0].image):tampered)}),/SHA-256/);assert.ok(revoked.includes('blob:verified-2'));
 for(const image of ['../../outside.webp','https://evil.example/image.webp','images/a.webp?query=1'])await assert.rejects(loadManifestArtwork({...mixed,pages:[{...mixed.pages[0],image}]},base,{fetcher}),/地址|路径|仓库/);
 await assert.rejects(loadManifestArtwork(mixed,base,{fetcher:async()=>new Response('x',{headers:{'content-length':String(12*1024*1024+1)}})}),/超过/);
});
test('standalone hash loading enforces its aggregate budget and revokes successful earlier allocations',async t=>{
 const {loadManifestArtwork}=await import('../site/assets/library.mjs');
 const data=new Uint8Array(12*1024*1024),digest=hash(data),revoked=[];let allocated=0,calls=0;
 t.mock.method(URL,'createObjectURL',()=>`blob:budget-${++allocated}`);t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 const story={pages:Array.from({length:9},(_,i)=>({image:`images/${i}.webp`,caption:'预算',sha256:digest}))};
 await assert.rejects(loadManifestArtwork(story,new URL('https://example.org/project/stories/test/story.json'),{fetcher:async()=>{calls++;return new Response(data,{headers:{'content-length':String(data.length)}});}}),/超过/);
 assert.equal(calls,9);assert.equal(allocated,8);assert.equal(revoked.length,8);
});
test('duplicate mixed references cannot overwrite a verified image with an unchecked URL',async()=>{
 const {loadManifestArtwork}=await import('../site/assets/library.mjs');let calls=0;
 for(const image of ['images/01.webp','images/01.WEbP','images/ONE.webp']){
  const first=image==='images/ONE.webp'?'images/one.webp':'images/01.webp';
  await assert.rejects(loadManifestArtwork({pages:[{image:first,sha256:source.pages[0].sha256},{image}]},new URL('https://example.org/project/stories/test/story.json'),{fetcher:async()=>{calls++;return new Response(files.get(source.pages[0].image));}}),/重复图片|路径无效/);
 }
 assert.equal(calls,0);
});

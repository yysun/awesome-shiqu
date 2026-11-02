// Validate only public attribution and tracing records; these declarations do not establish ownership.
function check(ok,message){if(!ok)throw Error(message);}
export function publicText(value,label,max,empty=true){check(typeof value==='string'&&value.length<=max&&!value.includes('\0')&&(empty||value.trim()),`${label}为空或超过长度限制。`);return value.trim();}
export function publicURL(value){const input=publicText(value,'作品链接',1000);if(!input)return '';let url;try{url=new URL(input);}catch{throw Error('作品链接必须是完整的 http 或 https 链接。');}check(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'作品链接只允许 http 或 https，不能包含登录凭据。');return url.href;}
function only(value,keys,label){check(value&&typeof value==='object'&&!Array.isArray(value),`${label}必须是对象。`);for(const key of Object.keys(value))check(keys.includes(key),`${label}含有不应公开的未知字段：${key}`);}
export function validateAI(value){check(value===null||typeof value==='boolean','AI 声明必须为 boolean 或 null。');return value;}
export function publicationFields(input){
 const result={};
 if(input.publication!==undefined&&input.publication!==null){
  const p=input.publication;only(p,['author','workUrl','contact','sourceNote','reuse'],'署名说明');
  result.publication={author:publicText(p.author,'制作署名',80),workUrl:publicURL(p.workUrl),contact:publicText(p.contact,'公开联系',200),sourceNote:publicText(p.sourceNote,'来源许可',1200),reuse:publicText(p.reuse,'转载条件',1200)};
 }
 if(result.publication&&input.author!==undefined)check(result.publication.author===publicText(input.author,'制作署名',120),'公开制作署名不一致。');
 if(input.contributor!==undefined)result.contributor=publicText(input.contributor,'投稿者',120,false);
 if(input.sourceText!==undefined){publicText(input.sourceText,'保存原文',500000);result.sourceText=input.sourceText;}
 if(input.aiDisclosure!==undefined)result.aiDisclosure=publicText(input.aiDisclosure,'AI 披露',3000);
 if(input.exportIdentity!==undefined){const e=input.exportIdentity;only(e,['storyId','revision','createdAt','updatedAt'],'导出身份');check(Number.isSafeInteger(e.revision)&&e.revision>=0,'导出版本无效。');result.exportIdentity={storyId:publicText(e.storyId,'原作品编号',200,false),revision:e.revision,...(e.createdAt===undefined?{}:{createdAt:publicText(e.createdAt,'创建时间',80)}),...(e.updatedAt===undefined?{}:{updatedAt:publicText(e.updatedAt,'保存时间',80)})};}
 return result;
}
export function pagePublicFields(page){
 const result={};for(const key of ['sha256','originalSha256','imagePayloadSha256'])if(page[key]!==undefined){check(typeof page[key]==='string'&&/^[0-9a-f]{64}$/.test(page[key]),'图片 SHA-256 格式无效。');result[key]=page[key];}
 // Keep previously exported optional records readable; no watermark generation or detection runs here.
 if(page.watermark!==undefined){const w=page.watermark;only(w,['scheme','token'],'图片水印');check(typeof w.scheme==='string'&&/^[a-z0-9][a-z0-9._-]{0,79}$/.test(w.scheme)&&typeof w.token==='string'&&/^[0-9a-f]{12}$/.test(w.token),'图片水印编号格式无效。');result.watermark={scheme:w.scheme,token:w.token};}
 return result;
}

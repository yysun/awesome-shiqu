// Execute the exact CI snapshot/restore shell against a disposable local Git remote.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const run=promisify(execFile);
const workflow=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
function script(name){
  const section=workflow.split(`      - name: ${name}\n`)[1];assert.ok(section,`missing ${name}`);
  return section.split('        run: |\n')[1].split('\n').filter((line,index,lines)=>{
    const end=lines.findIndex(l=>l&&!l.startsWith('          '));return end<0||index<end;
  }).map(line=>line.slice(10)).join('\n');
}
test('CI saves only public resources on a separate branch, restores historical versions, and handles an empty library',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-workflow-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const remote=path.join(root,'remote.git'),repo=path.join(root,'source'),artifact=path.join(root,'artifact');
  await run('git',['init','--bare',remote]);await mkdir(repo);const git=(...args)=>run('git',args,{cwd:repo});
  await git('init','-b','main');await git('config','user.name','Test');await git('config','user.email','test@example.org');
  await writeFile(path.join(repo,'source.zip'),'SOURCE-PRIVATE');await git('add','.');await git('commit','-m','source');await git('remote','add','origin',remote);await git('push','origin','main');
  await mkdir(path.join(artifact,'public'),{recursive:true});await writeFile(path.join(artifact,'index.html'),'must not enter snapshot');
  const save=script('Save a durable snapshot without source ZIPs').replaceAll('/tmp/publication',artifact);
  // First publication may have no stories; its durable marker must still establish the branch.
  await run('bash',['-e','-o','pipefail','-c',save],{cwd:repo});
  let tree=(await git('ls-tree','-r','--name-only','HEAD')).stdout.trim().split('\n');assert.deepEqual(tree,['.nojekyll']);
  await git('checkout','main');await mkdir(path.join(artifact,'public/id/version'),{recursive:true});await writeFile(path.join(artifact,'public/id/version/story.json'),'version-one');
  await run('bash',['-e','-o','pipefail','-c',save],{cwd:repo});tree=(await git('ls-tree','-r','--name-only','HEAD')).stdout.trim().split('\n');assert.deepEqual(tree,['.nojekyll','public/id/version/story.json']);
  assert.equal((await git('show','main:source.zip')).stdout,'SOURCE-PRIVATE');
  await git('checkout','main');await run('bash',['-e','-o','pipefail','-c',script('Restore immutable publication resources')],{cwd:repo});
  assert.equal(await readFile(path.join(repo,'.previous-publication/public/id/version/story.json'),'utf8'),'version-one');
  assert.ok(workflow.includes('needs: [build, retain]'));assert.ok(workflow.includes('path: /tmp/publication\n'));assert.ok(!workflow.includes('git push origin HEAD:main'));
});

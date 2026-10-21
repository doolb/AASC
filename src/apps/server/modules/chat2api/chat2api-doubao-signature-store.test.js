const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDoubaoSignatureStore, MAX_BYTES } = require('./chat2api-doubao-signature-store');
const { createChat2ApiDataStore } = require('./chat2api-data-store');
const record = (id='one') => ({fingerprint:'a'.repeat(64),mode:0,upstreamId:'upstream-'+id,
  url:'https://www.doubao.com/chat/completion?aid=497858&a_bogus=private-signature-'+id,
  headers:{Origin:'https://www.doubao.com','User-Agent':'Mozilla/5.0 test'}});
const key = id => JSON.stringify(['account',id]);
const directory = async t => {
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-signature-private-'));
  t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));return rootDir;
};

test('成功签名私有原子落盘，重建存储可读，权限0600且不进入配置导出',async t=>{
  const rootDir=await directory(t),store=createDoubaoSignatureStore({rootDir});
  assert.equal(await store.put(key('one'),record()),true);
  const file=path.join(rootDir,'doubao-signatures.json');
  assert.equal((await fs.stat(file)).mode&0o777,0o600);
  assert.equal((await createDoubaoSignatureStore({rootDir}).get(key('one'))).url,record().url);
  const dataStore=createChat2ApiDataStore({rootDir,restoreLegacyAccounts:false});
  assert.doesNotMatch(JSON.stringify(await dataStore.exportConfiguration()),/private-signature|doubao-signatures/u);
  assert.deepEqual((await fs.readdir(rootDir)).filter(name=>name.endsWith('.tmp')),[]);
});

test('损坏、超大、Cookie头、跨来源和符号链接不加载；替换链接不修改目标',async t=>{
  const rootDir=await directory(t),store=createDoubaoSignatureStore({rootDir});
  const file=path.join(rootDir,'doubao-signatures.json');
  for(const value of ['bad-json',JSON.stringify({version:1,entries:[{key:key('one'),...record(),headers:{Cookie:'forbidden'}}]}),
    JSON.stringify({version:1,entries:[{key:key('one'),...record(),url:'https://evil.test/chat/completion?a_bogus=x'}]})]){
    await fs.writeFile(file,value);assert.equal(await store.get(key('one')),null);
  }
  await fs.writeFile(file,'x'.repeat(MAX_BYTES+1));assert.equal(await store.get(key('one')),null);
  const target=path.join(rootDir,'unrelated');await fs.writeFile(target,'leave-me');
  await fs.unlink(file);await fs.symlink(target,file);
  assert.equal(await store.get(key('one')),null);
  assert.equal(await store.put(key('one'),record()),true);
  assert.equal(await fs.readFile(target,'utf8'),'leave-me');
  assert.equal((await fs.lstat(file)).isSymbolicLink(),false);
});

test('同目录多实例串行写入不丢记录，128项淘汰及有条件删除不误删新签名',async t=>{
  const rootDir=await directory(t),one=createDoubaoSignatureStore({rootDir}),two=createDoubaoSignatureStore({rootDir});
  await Promise.all(Array.from({length:129},(_,i)=>(i%2?one:two).put(key(String(i)),record(String(i)))));
  assert.equal(await one.get(key('0')),null);assert.ok(await two.get(key('128')));
  const changed={...record('128'),url:record('128').url+'-new'};
  await one.put(key('128'),changed);
  await two.delete(key('128'),record('128'));assert.equal((await one.get(key('128'))).url,changed.url);
  await two.delete(key('128'),changed);assert.equal(await one.get(key('128')),null);
  const badRoot=path.join(rootDir,'not-a-directory');await fs.writeFile(badRoot,'x');
  assert.equal(await createDoubaoSignatureStore({rootDir:badRoot}).put(key('x'),record('x')),false);
});

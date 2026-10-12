'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalizeDoubaoWebConfig}=require('./chat2api-doubao-web-config');
test('网页运行默认禁用，启用须显式账号/标签/会话检查授权且拒绝秘密及远端地址',()=>{
 const defaults=normalizeDoubaoWebConfig();assert.equal(defaults.enabled,false);assert.equal(defaults.port,9222);
 const valid={enabled:true,port:9222,accountId:'demo',targetId:'target',contextId:'',allowSessionCheck:true};
 assert.deepEqual(normalizeDoubaoWebConfig(valid),valid);
 for(const raw of [{enabled:true},{...valid,allowSessionCheck:false},{...valid,port:80},{...valid,cookie:'secret'},{...valid,host:'remote'},{enabled:'true'}])assert.throws(()=>normalizeDoubaoWebConfig(raw));
});

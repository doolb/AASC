'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createDoubaoWebWs}=require('./chat2api-doubao-web-ws');
test('网页WS权威配置、控制端授权、保存失败恢复与元数据目录不读取秘密',async()=>{
 let value={},fail=false,listed=0;const sent=[],broadcast=[];
 const handler=createDoubaoWebWs({config:{get:()=>value,set:(key,v)=>{assert.equal(key,'doubaoWebRuntime');value=v;return !fail}},isControl:ws=>ws.control,broadcast:v=>broadcast.push(v),browser:{listTargets:async()=>{listed++;return[{origin:'https://www.doubao.com',targetId:'target',contextId:''}]}}});
 const ws={control:true,send:raw=>sent.push(JSON.parse(raw))};
 assert.equal(handler.snapshot().config.enabled,false);
 await handler.handle({...ws,control:false},{type:'getDoubaoWebTargets'});assert.equal(listed,0);
 await handler.handle(ws,{type:'setDoubaoWebRuntimeConfig',requestId:'save',config:{port:9333}});assert.equal(broadcast[0].config.port,9333);assert.equal(listed,0);
 fail=true;await handler.handle(ws,{type:'setDoubaoWebRuntimeConfig',config:{port:9444}});assert.equal(sent.at(-1).success,false);assert.equal(sent.at(-1).config.port,9333);
 await handler.handle(ws,{type:'getDoubaoWebTargets'});assert.equal(listed,1);assert.equal(sent.at(-1).targets[0].targetId,'target');
 await handler.handle(ws,{type:'setDoubaoWebRuntimeConfig',config:{cookie:'secret'}});assert.equal(sent.at(-1).success,false);assert.ok(!JSON.stringify(sent).includes('secret'));
});

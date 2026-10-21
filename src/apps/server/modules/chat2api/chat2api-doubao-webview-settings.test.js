const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDoubaoWebViewSettings, normalizeDoubaoWebViewSettings } = require('./chat2api-doubao-webview-settings');

test('关闭页面配置走权威WS：默认关闭，验证布尔值、持久化后广播，拒绝非控制端',()=>{
  let stored,fail=false,writes=0;
  const replies=[],broadcasts=[];
  const control={send:raw=>replies.push(JSON.parse(raw))},display={send(){throw Error('不能向显示端泄漏控制回执');}};
  const settings=createDoubaoWebViewSettings({config:{get:()=>stored,set:(key,value)=>{
    assert.equal(key,'chat2api.doubaoWebView');writes++;if(fail)return false;stored=value;return true;
  }},isControl:ws=>ws===control,broadcast:message=>broadcasts.push(message)});
  assert.equal(settings.snapshot().closeAfterSign,false);
  settings.handle(control,{type:'getDoubaoWebViewConfig',requestId:'initial'});
  assert.equal(replies.at(-1).requestId,'initial');
  settings.handle(display,{type:'setDoubaoWebViewConfig',closeAfterSign:true});assert.equal(writes,0);
  settings.handle(control,{type:'setDoubaoWebViewConfig',requestId:'on',closeAfterSign:true});
  assert.deepEqual(stored,{closeAfterSign:true});assert.equal(broadcasts[0].success,true);
  settings.handle(control,{type:'setDoubaoWebViewConfig',closeAfterSign:'false'});
  assert.equal(writes,1);assert.equal(replies.at(-1).success,false);assert.equal(replies.at(-1).closeAfterSign,true);
  fail=true;settings.handle(control,{type:'setDoubaoWebViewConfig',closeAfterSign:false});
  assert.equal(broadcasts.length,1);assert.equal(replies.at(-1).closeAfterSign,true);
  assert.equal(settings.get().closeAfterSign,true);
  assert.equal(normalizeDoubaoWebViewSettings({closeAfterSign:'true'}).closeAfterSign,false);
});

test('实际控制脚本保存开关只发WS，等权威回执、失败回退、断线与重连默认明确',async()=>{
  const field={},message={classList:{toggle(){}},style:{}},sent=[];
  const ws={readyState:1,send:raw=>sent.push(JSON.parse(raw))};
  const window={WebSocketManager:{ws}};
  const context={window,WebSocket:{OPEN:1},document:{getElementById:id=>id==='chat2apiCloseWebViewAfterSign'?field:message},
    setTimeout,clearTimeout,console};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../web-mediacenter/ui/public/js/chat2api.js'),'utf8'),context);
  const ui=window.Chat2APIControl;
  ui.renderDoubaoWebViewConfig();assert.equal(field.checked,false);assert.equal(field.disabled,true);
  ui.handleDoubaoWebViewConfig({closeAfterSign:false});assert.equal(field.disabled,false);
  ui.saveDoubaoWebViewConfig(true);assert.equal(sent.at(-1).type,'setDoubaoWebViewConfig');assert.equal(field.disabled,true);
  const requestId=sent.at(-1).requestId;
  ui.handleDoubaoWebViewConfig({requestId,closeAfterSign:true,success:true});
  assert.equal(field.checked,true);assert.equal(field.disabled,false);
  ui.saveDoubaoWebViewConfig(false);
  ui.handleDoubaoWebViewConfig({requestId:sent.at(-1).requestId,closeAfterSign:true,success:false,message:'磁盘失败'});
  assert.equal(field.checked,true);assert.match(message.textContent,/磁盘失败/u);
  ui.handleDoubaoWebViewDisconnected();assert.equal(field.disabled,true);assert.equal(field.checked,false);
  ui.ensureModal=()=>{};ui.refresh=async()=>{};
  await ui.open('127.0.0.1:8080');assert.equal(sent.at(-1).type,'getDoubaoWebViewConfig');
  ui.handleDoubaoWebViewConnected();assert.equal(sent.at(-1).type,'getDoubaoWebViewConfig');
  ui.handleDoubaoWebViewConfig({closeAfterSign:true});assert.equal(field.checked,true);
});

(function(){
 'use strict';
 let config={enabled:false,port:9222,accountId:'',targetId:'',contextId:'',allowSessionCheck:false};let targets=[],pending=null,timer=null,query=null,queryTimer=null;
 const get=id=>document.getElementById(id);
 const status=text=>{if(get('doubaoWebStatus'))get('doubaoWebStatus').textContent=text};
 const send=message=>{const ws=window.WebSocketManager?.ws;if(!ws||ws.readyState!==WebSocket.OPEN)throw new Error('连接已断开');ws.send(JSON.stringify(message))};
 const requestId=()=>`doubao-web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 function targetOptions(){const select=get('doubaoWebTarget');if(!select)return;select.replaceChildren();
  const values=[{targetId:'',contextId:'',origin:'请选择本机标签'},...targets];
  if(config.targetId&&!values.some(v=>v.targetId===config.targetId))values.push({targetId:config.targetId,contextId:config.contextId,origin:'已保存标签（待连接核对）'});
  for(const value of values){const option=document.createElement('option');option.value=value.targetId;option.dataset.contextId=value.contextId;option.textContent=`${value.origin}${value.targetId?' · '+value.targetId:''}`;select.appendChild(option)}select.value=config.targetId;
 }
 function fill(){if(!get('doubaoWebEnabled'))return;
  get('doubaoWebEnabled').checked=config.enabled;get('doubaoWebPort').value=config.port;get('doubaoWebAccount').value=config.accountId;
  get('doubaoWebAllowSession').checked=config.allowSessionCheck;targetOptions();get('doubaoWebSave').disabled=Boolean(pending);
 }
 function render(parent,accounts){get('doubaoWebSettings')?.remove();const section=document.createElement('section');section.id='doubaoWebSettings';section.className='chat2api-section';
  section.innerHTML='<h4>豆包普通LLM · 网页模式（实验）</h4><p>默认关闭。只使用所选本机登录标签；Android无受控Chrome时不可用。真实官网运行尚未验收。</p>'+
   '<label><input id="doubaoWebEnabled" type="checkbox">启用登录网页内请求</label><label>本机调试端口<input id="doubaoWebPort" type="number" min="1024" max="65535"></label>'+
   '<label>绑定账号<select id="doubaoWebAccount"></select></label><label>绑定标签<select id="doubaoWebTarget"></select></label>'+
   '<button id="doubaoWebTargets" type="button">查询本机豆包标签</button><p>改端口后先在关闭状态保存，再查询标签；查询只读取官方标签标识，不读取登录凭据或聊天。</p>'+
   '<label><input id="doubaoWebAllowSession" type="checkbox">允许服务在内存中核对所选账号与标签的登录会话；不保存或输出Cookie</label>'+
   '<p>启用后，普通LLM通过Chat2API选择doubao文字模型。请求会按你选择的账号执行；验证码或风控由你在官网处理。</p>'+
   '<button id="doubaoWebSave" type="button">保存网页运行配置</button><div id="doubaoWebStatus" role="status"></div>';
  const select=section.querySelector('#doubaoWebAccount');const empty=document.createElement('option');empty.value='';empty.textContent='请选择账号';select.appendChild(empty);
  for(const account of accounts.filter(a=>a.providerId==='doubaochat')){const option=document.createElement('option');option.value=account.accountId;option.textContent=account.label||account.accountId;select.appendChild(option)}
  if(config.accountId&&!accounts.some(a=>a.accountId===config.accountId)){const option=document.createElement('option');option.value=config.accountId;option.textContent='已保存账号（当前不可用）';select.appendChild(option)}
  parent.appendChild(section);fill();get('doubaoWebSave').addEventListener('click',save);get('doubaoWebTargets').addEventListener('click',listTargets);
 }
 function save(){try{if(pending)return;const target=get('doubaoWebTarget').selectedOptions[0];const next={enabled:get('doubaoWebEnabled').checked,port:Number(get('doubaoWebPort').value),accountId:get('doubaoWebAccount').value,targetId:target.value,contextId:target.dataset.contextId||'',allowSessionCheck:get('doubaoWebAllowSession').checked};
   const id=requestId();send({type:'setDoubaoWebRuntimeConfig',requestId:id,config:next});pending=id;get('doubaoWebSave').disabled=true;status('等待服务器确认');
   timer=setTimeout(()=>{pending=null;fill();status('未收到保存确认，已恢复最近权威配置')},10000);
  }catch(error){pending=null;fill();status(error.message)}
 }
 function listTargets(){try{if(query)return;query=requestId();get('doubaoWebTargets').disabled=true;send({type:'getDoubaoWebTargets',requestId:query});status('正在查询本机官方标签目录');
   queryTimer=setTimeout(()=>{query=null;if(get('doubaoWebTargets'))get('doubaoWebTargets').disabled=false;status('标签查询超时')},10000);
  }catch(error){query=null;if(get('doubaoWebTargets'))get('doubaoWebTargets').disabled=false;status(error.message)}
 }
 function handleMessage(message){
  if(message.type==='doubaoWebRuntimeConfig'&&message.config){config=message.config;if(message.requestId===pending){clearTimeout(timer);pending=null}fill();status(message.success===false?message.message:'已接收服务器网页运行配置');return;}
  if(message.type==='doubaoWebTargets'&&message.requestId===query){clearTimeout(queryTimer);query=null;if(get('doubaoWebTargets'))get('doubaoWebTargets').disabled=false;
   targets=message.success&&Array.isArray(message.targets)?message.targets:[];targetOptions();status(message.success?'请选择要绑定的账号和唯一标签':message.message);}
 }
 function handleDisconnected(){clearTimeout(timer);clearTimeout(queryTimer);pending=null;query=null;fill();if(get('doubaoWebTargets'))get('doubaoWebTargets').disabled=false;status('连接已断开，重连后等待服务器权威配置')}
 window.DoubaoWebSettings={render,handleMessage,handleDisconnected,getConfig:()=>({...config})};
}());

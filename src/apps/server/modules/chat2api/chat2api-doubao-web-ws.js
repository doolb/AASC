'use strict';
const {normalizeDoubaoWebConfig}=require('./chat2api-doubao-web-config');
// 复用AASC控制消息和主配置；查询只列官方标签元数据，不读取Cookie或聊天内容。
function createDoubaoWebWs({config,isControl,broadcast,browser}){
 const current=()=>{try{return normalizeDoubaoWebConfig(config.get('doubaoWebRuntime',{}))}catch{return normalizeDoubaoWebConfig()}};
 const snapshot=extra=>({type:'doubaoWebRuntimeConfig',config:current(),...extra});
 return {snapshot,async handle(ws,data){
  if(!['setDoubaoWebRuntimeConfig','getDoubaoWebTargets'].includes(data.type))return false;
  if(!isControl(ws))return true;
  if(data.type==='getDoubaoWebTargets'){
   try{ws.send(JSON.stringify({type:'doubaoWebTargets',requestId:data.requestId,targets:await browser.listTargets(),success:true}))}
   catch{ws.send(JSON.stringify({type:'doubaoWebTargets',requestId:data.requestId,targets:[],success:false,message:'无法读取本机豆包标签目录，请核对调试端口'}))}
   return true;
  }
  const previous=current();let changed=false;
  try{const next=normalizeDoubaoWebConfig(data.config);changed=true;
   if(config.set('doubaoWebRuntime',next)===false)throw new Error('保存失败');
   broadcast(snapshot({requestId:data.requestId,success:true}));
  }catch{
   if(changed){try{config.set('doubaoWebRuntime',previous)}catch{}}
   ws.send(JSON.stringify(snapshot({requestId:data.requestId,success:false,message:'豆包网页配置不合法或保存失败，已返回原配置'})));
  }return true;
 }};
}
module.exports={createDoubaoWebWs};

import * as scene from './scene.mjs';
import {sheet,bounds,corners,fold,cut,snapIndex} from './fold.mjs';
import {sound,unlock,paperSound} from './sound.mjs';
const $=id=>document.getElementById(id),uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const storageKey='gami.desks.v1';
let saves=JSON.parse(localStorage.getItem(storageKey)||'[]'),desk,id,tool='fold',selected=[],target=null,preview=null,gesture=null,history=[],timer,err='';
const current=()=>desk?.items.find(p=>p.id===id);
const safe=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function say(t){$('message').textContent=t;clearTimeout(timer);timer=setTimeout(()=>$('message').textContent='',3200)}
function modal(title,html){$('title').textContent=title;$('content').innerHTML=html;if(!$('dialog').open)$('dialog').showModal()}
$('close').onclick=()=>$('dialog').close();
function paper(front='#66949b',back='#f4e8cd'){
  return {id:uid(),front,back,seed:Math.floor(Math.random()*100000),faces:sheet(),x:0,y:0,rot:0,placed:false,folded:false};
}
function save(){
  desk.time=Date.now();desk.active=id;
  const next=[structuredClone(desk),...saves.filter(d=>d.id!==desk.id)];
  try{localStorage.setItem(storageKey,JSON.stringify(next));saves=next}catch{say('本机存储空间不足，请从浏览页导出桌面')}
}
function remember(){history.push(structuredClone(desk));if(history.length>25)history.shift()}
function savedAction(){save();reset();render()}
let snappedIndex=-1;
function reset(){snappedIndex=-1;selected=[];target=null;preview=null;err=''}
function grid(){const r=$('rows').valueAsNumber,c=$('cols').valueAsNumber;return Number.isInteger(r)&&Number.isInteger(c)&&r>0&&c>0&&r*c>=2&&r*c<=64?[r,c]:null}
const isHand=()=>$('foldType').value==='hand';
let settling=0;
function render(){
  cancelAnimationFrame(settling);
  const item=current(),g=grid();
  for(const key of ['fold','cut','place'])$(key+'Tools').hidden=tool!==key;
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===tool));
  $('undo').disabled=!history.length;$('commit').disabled=!preview;
  $('center').disabled=!selected.length||item?.placed;
  $('slice').disabled=!g||item?.placed||item?.folded;$('place').disabled=!item||item.placed;
  $('rotate').disabled=!item?.placed;
  for(const k of ['angleLabel','center','commit'])$(k).hidden=isHand();
  const hints={fold:{hand:'捏住纸角或边缘往里翻，松手压平。拖空白处环视。',corner:'拖动角点指定目标，或点角后选「折向中心」。',multi:'依次点选多个角，再点纸面目标或选「折向中心」。',edge:'从一条边拖向目标位置，整边将沿平行折线翻折。'}[$('foldType').value],
    cut:item?.folded?'请选择尚未折叠的纸片。':g?'预览 '+g[0]+' × '+g[1]+'，共 '+g[0]*g[1]+' 片。':'请输入正整数，共 2 至 64 片。',
    place:'选中纸片后加入陈列；拖动成品可调整位置。拖空白处环视。'};
  $('hint').textContent=err||(item?.placed&&tool!=='place'?'已摆放的作品，可切换摆放工具移动或旋转。':hints[tool]);
  if(snappedIndex>=0&&!err)$('hint').textContent='已吸附角点 · 拖远可解除';
  scene.show(desk,id,preview,selected,g,tool,snappedIndex>=0?target:null);
}
function enter(d){
  desk=structuredClone(d);id=desk.active||desk.items[0].id;history=[];reset();tool='fold';
  $('dialog').close();$('home').hidden=true;$('studio').hidden=false;scene.mode(false);render();
}
function home(){
  $('studio').hidden=true;$('home').hidden=false;scene.mode(true);$('resume').disabled=!saves.length;
  $('last').textContent=saves.length?saves[0].name:'暂无存档';
  $('new').classList.toggle('lead',!saves.length);$('resume').classList.toggle('lead',!!saves.length);
}
$('homeBtn').onclick=home;$('resume').onclick=()=>enter(saves[0]);
function setup(add){
  modal(add?'添一张纸':'新建折纸',(add?'':'<label>桌面名称<input id="deskName" type="text" maxlength="40" value="窗前的折纸"></label>')+'<label>纸样　水彩</label><label>正面颜色<input id="front" type="color" value="#668f99"></label><label><input id="double" type="checkbox">双面着色</label><label>背面颜色<input id="back" type="color" value="#c77e68" disabled></label><button class="primary" id="startDesk">开始折纸</button>');
  $('double').onchange=()=>$('back').disabled=!$('double').checked;
  $('startDesk').onclick=()=>{
    const p=paper($('front').value,$('double').checked?$('back').value:'#f5ead3');
    if(add){remember();desk.items.push(p);id=p.id;tool='fold';$('dialog').close();savedAction();return}
    enter({version:1,id:uid(),name:$('deskName').value.trim()||'窗前的折纸',items:[p],active:p.id});save();
  };
}
$('new').onclick=()=>setup(false);$('add').onclick=()=>setup(true);
function exportDesk(d){
  const url=URL.createObjectURL(new Blob([JSON.stringify(d)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=d.name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$('browse').onclick=()=>{
  modal('浏览桌面',saves.length?'':'<p>还没有保存的桌面。</p><button id="emptyNew">新建折纸</button>');
  if(!saves.length){$('emptyNew').onclick=()=>setup(false);return}
  for(const d of saves){
    const row=document.createElement('div');row.className='saveRow';
    row.innerHTML='<canvas width="90" height="62"></canvas><span>'+safe(d.name)+'<br><small>'+d.items.length+' 张纸 · '+new Date(d.time).toLocaleDateString()+'</small></span><button>打开</button><button>导出</button>';
    const ctx=row.querySelector('canvas').getContext('2d');ctx.fillStyle='#aa865e';ctx.fillRect(0,0,90,62);
    for(const p of d.items){ctx.save();ctx.translate(45+p.x*8,31+p.y*8);ctx.rotate(-p.rot);ctx.fillStyle=p.front;for(const f of p.faces){ctx.beginPath();f.forEach(([x,y],i)=>i?ctx.lineTo(x*8,y*8):ctx.moveTo(x*8,y*8));ctx.closePath();ctx.fill()}ctx.restore()}
    const [open,download]=row.querySelectorAll('button');open.onclick=()=>{enter(d);tool='place';render()};download.onclick=()=>exportDesk(d);$('content').append(row);
  }
};
function valid(d){
  const num=n=>Number.isFinite(n)&&Math.abs(n)<10000, color=c=>/^#[0-9a-f]{6}$/i.test(c);
  return d?.version===1&&typeof d.name==='string'&&d.name.length<=100&&Array.isArray(d.items)&&d.items.length>0&&d.items.length<=512&&new Set(d.items.map(i=>i.id)).size===d.items.length&&d.items.every(i=>typeof i.id==='string'&&color(i.front)&&color(i.back)&&Number.isInteger(i.seed)&&[i.x,i.y,i.rot].every(num)&&Array.isArray(i.faces)&&i.faces.length>0&&i.faces.length<=512&&i.faces.every(f=>Array.isArray(f)&&f.length>=3&&f.length<=128&&f.every(p=>Array.isArray(p)&&p.length===5&&p.every(num))));
}
$('import').onclick=()=>$('file').click();$('file').onchange=async()=>{
  const f=$('file').files[0];$('file').value='';if(!f)return;
  try{if(f.size>4e6)throw Error();const d=JSON.parse(await f.text());if(!valid(d))throw Error();
    modal('导入桌面','<p>'+safe(d.name)+' · '+d.items.length+' 张纸</p><button class="primary" id="confirmImport">作为副本打开</button>');
    $('confirmImport').onclick=()=>{d.id=uid();d.active=d.items[0].id;enter(d);save()};
  }catch{say('文件损坏、过大或版本不支持')}
};
function foldEndpoints(){
  const item=current(),pts=corners(item.faces);
  let starts=selected.map(i=>pts[i]),dest=target;
  if(($('foldType').value==='edge')||(isHand()&&gesture?.kind==='edge')){
    const a=starts[0],b=pts[(selected[0]+1)%pts.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],nx=-dy/len,ny=dx/len,d=(target[0]-mid[0])*nx+(target[1]-mid[1])*ny;
    starts=[mid];dest=[mid[0]+nx*d,mid[1]+ny*d];
  }
  return {starts,dest};
}
function makePreview(curl=0){
  preview=null;err='';if(!selected.length||!target)return;
  const {starts,dest}=foldEndpoints();
  const item=current();
  try{preview=fold(item.faces,starts,dest,isHand()?180*scene.facingSign():+$('angle').value,curl)}catch(e){err=e.message}
}
$('center').onclick=()=>{snappedIndex=-1;const [a,b,c,d]=bounds(current().faces);target=[(a+c)/2,(b+d)/2];makePreview();render()};
$('angle').oninput=()=>{$('degrees').textContent=$('angle').value+'°';makePreview();render();paperSound('drag')};
$('foldType').onchange=()=>{reset();render()};
function commitFold(){
  if(!preview)return;
  remember();current().faces=preview;current().folded=true;paperSound('fold');savedAction();
}
$('commit').onclick=commitFold;
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;reset();render()});
for(const k of ['rows','cols'])$(k).oninput=()=>{if($('link').checked)$(k==='rows'?'cols':'rows').value=$(k).value;render()};
$('link').onchange=()=>{if($('link').checked)$('cols').value=$('rows').value;render()};
document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{$('rows').value=$('cols').value=b.dataset.size;render()});
$('slice').onclick=()=>{
  const item=current();if(!grid()||item.folded||item.placed)return;
  const pieces=cut(item.faces,...grid()).map(f=>({...item,id:uid(),faces:f}));
  remember();desk.items.splice(desk.items.indexOf(item),1,...pieces);id=pieces[0].id;tool='fold';paperSound('cut');savedAction();
};
$('place').onclick=()=>{remember();current().placed=true;paperSound('place');savedAction()};
$('rotate').onclick=()=>{remember();current().rot+=Math.PI/12;savedAction()};
$('undo').onclick=()=>{if(history.length){desk=history.pop();id=desk.active||desk.items[0].id;savedAction()}};
function local(item,w){const dx=w[0]-item.x,dy=w[1]-item.y,c=Math.cos(item.rot),s=Math.sin(item.rot);return [dx*c-dy*s,dx*s+dy*c]}
function nearestIndex(pts,q,edge){
  const distances=pts.map((p,i)=>{
    const b=pts[(i+1)%pts.length],dx=b[0]-p[0],dy=b[1]-p[1];
    const t=edge?Math.max(0,Math.min(1,((q[0]-p[0])*dx+(q[1]-p[1])*dy)/(dx*dx+dy*dy))):0;
    return Math.hypot(q[0]-p[0]-dx*t,q[1]-p[1]-dy*t);
  });
  const d=Math.min(...distances);return [distances.indexOf(d),d];
}
$('view').onpointerdown=e=>{
  if($('studio').hidden)return;
  if(gesture){
    if(e.pointerType==='touch'&&gesture.action==='orbit'&&!gesture.second){
      gesture.second=e.pointerId;gesture.secondX=e.clientX;gesture.secondY=e.clientY;
      gesture.span=Math.hypot(e.clientX-gesture.lastX,e.clientY-gesture.lastY);
      $('view').setPointerCapture(e.pointerId);
    }
    return;
  }
  const hit=scene.pointer(e);$('view').setPointerCapture(e.pointerId);
  gesture={pid:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,start:hit.world,action:'orbit'};
  if(!hit.id&&tool==='fold'){reset();render()}
  if(!hit.id||!hit.world)return;
  if(id!==hit.id){id=hit.id;reset()}const item=current();
  gesture.action='select';
  if(tool==='place'&&item.placed){gesture.action='move';gesture.origin=[item.x,item.y]}
  if(tool==='fold'&&!item.placed){
    const pts=corners(item.faces),q=local(item,hit.world),type=$('foldType').value;
    if(type==='hand'){
      const screen=pts.map(p=>{const v=scene.projectedCorner(item,p);return [v.x,v.y]});
      const cursor=[e.clientX,e.clientY],radius=e.pointerType==='touch'?24:14;
      const [corner,dc]=nearestIndex(screen,cursor,false),[edge,de]=nearestIndex(screen,cursor,true);
      reset();
      if(dc<=radius||de<=radius){
        gesture.kind=dc<=radius?'corner':'edge';
        selected=[dc<=radius?corner:edge];gesture.action='fold';
      }
      render();return;
    }
    const [i,d]=nearestIndex(pts,q,type==='edge');
    snappedIndex=-1;
    if(type==='multi'&&selected.length&&d>.15){target=q;makePreview()}
    else{selected=type==='multi'?(selected.includes(i)?selected.filter(j=>j!==i):[...selected,i]):[i];target=null;preview=null;err='';gesture.action='fold'}
  }
  render();
};
$('view').onpointermove=e=>{
  if(!gesture)return;const g=gesture;
  if(g.second&&(e.pointerId===g.pid||e.pointerId===g.second)){
    if(e.pointerId===g.pid){g.lastX=e.clientX;g.lastY=e.clientY}
    else{g.secondX=e.clientX;g.secondY=e.clientY}
    const span=Math.max(1,Math.hypot(g.secondX-g.lastX,g.secondY-g.lastY));scene.zoom(g.span/span);g.span=span;return;
  }
  if(e.pointerId!==g.pid)return;
  if(g.action==='orbit'){scene.orbit(e.clientX-g.lastX,e.clientY-g.lastY);g.lastX=e.clientX;g.lastY=e.clientY;return}
  if(Math.hypot(e.clientX-g.x,e.clientY-g.y)<4){
    if(isHand()&&g.action==='fold'){target=null;preview=null;snappedIndex=-1;render()}
    return;
  }
  const w=scene.pointer(e).world,item=current();if(!w)return;
  if(g.action==='move'){
    if(!g.changed)remember();item.x=Math.max(-5,Math.min(5,g.origin[0]+w[0]-g.start[0]));item.y=Math.max(-3,Math.min(3,g.origin[1]+w[1]-g.start[1]));g.changed=true;
  }
  if(g.action==='fold'){
    target=local(item,w);
    if($('foldType').value!=='edge'&&g.kind!=='edge'){
      const pts=corners(item.faces),radius=e.pointerType==='touch'?24:14;
      const distances=pts.map((p,i)=>{
        if(selected.includes(i))return Infinity;
        const screen=scene.projectedCorner(item,p);
        return screen.visible?Math.hypot(screen.x-e.clientX,screen.y-e.clientY):Infinity;
      });
      snappedIndex=snapIndex(distances,radius,snappedIndex);
      if(snappedIndex>=0)target=pts[snappedIndex];
    }
    g.curl=isHand()?Math.min(.42,Math.hypot(w[0]-g.start[0],w[1]-g.start[1])*.45):0;
    makePreview(g.curl);paperSound('drag');
    clearTimeout(g.restTimer);
    if(isHand()&&preview)g.restTimer=setTimeout(()=>{
      if(gesture!==g||!target)return;
      g.curl*=.25;makePreview(g.curl);render();
    },240);
  }
  render();
};
// 松手时先保存精确平折，再从临时弯曲形状过渡到权威几何。任何新操作均可打断动画。
function finishGesture(e){
  const g=gesture;
  if(!g||(e.pointerId!==g.pid&&e.pointerId!==g.second))return;
  clearTimeout(g.restTimer);
  if(isHand()&&g.action==='fold'){
    if(e.type==='pointerup'&&preview){
      const original=current().faces,{starts,dest}=foldEndpoints();
      const angle=180*scene.facingSign(),begin=performance.now();
      makePreview();commitFold();
      const settle=now=>{
        const t=Math.max(0,1-(now-begin)/140);
        if(t===0){render();return}
        scene.show(desk,id,fold(original,starts,dest,angle,g.curl*t*t),[],null,tool,null);
        settling=requestAnimationFrame(settle);
      };
      settling=requestAnimationFrame(settle);
    }else{reset();render()}
  }
  if(g.changed)save();gesture=null;
}
$('view').onpointerup=$('view').onpointercancel=$('view').onlostpointercapture=finishGesture;
$('view').onwheel=e=>{if(!$('studio').hidden){e.preventDefault();scene.zoom(e.deltaY>0?1.08:.92)}};
for(const k of ['music','sfx']){
  const refresh=()=>{$(k).textContent=(k==='music'?'♫ 音乐':'♪ 音效')+(sound[k]?' 开':' 关');$(k).setAttribute('aria-pressed',String(sound[k]))};
  $(k).onclick=()=>{sound[k]=!sound[k];localStorage.setItem('gami.'+k,sound[k]?'on':'off');refresh()};refresh();
}
document.addEventListener('pointerdown',unlock,{once:true});document.addEventListener('keydown',unlock,{once:true});home();

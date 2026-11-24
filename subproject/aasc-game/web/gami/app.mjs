import {solveDragTarget} from './drag-projection.mjs';
import {initHUD,syncHUD} from './hud.mjs';
import * as scene from './scene.mjs';
import {sheet,bounds,corners,fold,cut,snapIndex} from './fold.mjs';
import {adjustedCurl,heldFaces,validHeldFold,flattenHeldFold,precreaseFold,cancelHeldFold} from './held-fold.mjs';
import {recordCreases,validPaperTopology,paperThickness,PAPER_THICKNESS,validThickness,LAYER_SPACING_VERSION,pointOnFace} from './paper-topology.mjs';
import {safeTurnCrease,resizedPaper,migratedLayerSpacing} from './paper-contact.mjs';
import {separationPick,sameCreaseAxis,orbitPoint,closestOrbitAngle} from './separate.mjs';
import {createPairControls} from './pair-controls.mjs';
import {sound,unlock,paperSound} from './sound.mjs';
const $=id=>document.getElementById(id),uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const storageKey='gami.desks.v1';
let pairControls=null,hud=null;
let saves=JSON.parse(localStorage.getItem(storageKey)||'[]'),desk,id,tool='fold',selected=[],target=null,preview=null,previewLayers=null,candidate=null,gesture=null,history=[],timer,err='';
const current=()=>desk?.items.find(p=>p.id===id);
const safe=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function say(t){$('message').textContent=t;clearTimeout(timer);timer=setTimeout(()=>$('message').textContent='',3200)}
function modal(title,html){$('title').textContent=title;$('content').innerHTML=html;if(!$('dialog').open)$('dialog').showModal()}
$('close').onclick=()=>$('dialog').close();
function paper(front='#66949b',back='#f4e8cd',thickness=PAPER_THICKNESS){
  return {id:uid(),front,back,thickness,seed:Math.floor(Math.random()*100000),faces:sheet(),x:0,y:0,rot:0,placed:false,folded:false};
}
function save(){
  desk.time=Date.now();desk.active=id;
  const next=[structuredClone(desk),...saves.filter(d=>d.id!==desk.id)];
  try{localStorage.setItem(storageKey,JSON.stringify(next));saves=next}catch{say('本机存储空间不足，请从浏览页导出桌面')}
}
function remember(){history.push(structuredClone(desk));if(history.length>25)history.shift()}
function savedAction(){save();reset();render()}
let snappedIndex=-1,snapAnchor=null,separateAxis=null;
function reset(){snappedIndex=-1;snapAnchor=null;selected=[];target=null;preview=null;previewLayers=null;candidate=null;err=''}
function grid(){const r=$('rows').valueAsNumber,c=$('cols').valueAsNumber;return Number.isInteger(r)&&Number.isInteger(c)&&r>0&&c>0&&r*c>=2&&r*c<=64?[r,c]:null}
const isHand=()=>$('foldType').value==='hand';
const isPrecrease=()=>$('foldMode').value==='precrease';
function render(){
  const item=current(),g=grid();
  const percent=Number(((item?paperThickness(item):PAPER_THICKNESS)*50).toPrecision(12));
  for(const key of ['thickness','thicknessValue']){$(key).value=percent;$(key).disabled=!item||!!gesture||!!pairControls?.busy}
  if(item?.heldFold){$('foldType').value='hand';$('foldMode').value=item.heldFold.mode||'fold'}
  $('foldMode').disabled=!!item?.heldFold||!!gesture||!!pairControls?.busy;
  $('angleLabel').hidden=isHand()||isPrecrease();
  $('cancelFold').hidden=!item?.heldFold&&!preview&&!pairControls?.hasPreview;
  $('flatten').textContent=isPrecrease()?'生成折痕并还原':'压平';
  $('commit').textContent=isPrecrease()?'生成折痕并还原':'确认折叠';
  $('pairMode').disabled=!!item?.heldFold||!!item?.placed;
  $('pairMode').setAttribute('aria-pressed',String(!!pairControls?.enabled));
  $('pairHint').textContent=pairControls?.enabled?'先选固定角，再拖另一层角；触屏双指抓编号角点':'拖动点或边展开 · 点折痕选择展开轴';
  $('foldType').disabled=!!item?.heldFold;
  for(const key of ['fold','separate','cut','place'])$(key+'Tools').hidden=tool!==key;
  document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('on',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool))});
  $('undo').disabled=!history.length;$('commit').disabled=!preview;
  $('center').disabled=!selected.length||item?.placed;
  $('slice').disabled=!g||item?.placed||item?.folded||!!item?.creases?.length||!!item?.heldFold;$('place').disabled=!item||item.placed||!!item.heldFold;
  $('rotate').disabled=!item?.placed;
  $('center').hidden=isHand();$('commit').hidden=isHand()||tool!=='fold'||!preview;
  $('flatten').hidden=!isHand()||!item?.heldFold||tool!=='fold';$('flatten').disabled=!item?.heldFold;
  const hints={fold:{hand:item?.heldFold?'继续拖动调整 · 压平留下折痕':'捏住角点或边折纸 · 拖空白环视',corner:'拖动角点指定目标，或点角后选「折向中心」。',multi:'依次点选多个角，再点纸面目标或选「折向中心」。',edge:'从一条边拖向目标位置，整边将沿平行折线翻折。'}[$('foldType').value],
    separate:item?.heldFold?'请先在「折叠」中压平，留下折痕后再分开。':item?.creases?.length?'抓住点或边展开 · 回拖收拢 · 松手保持':'这张纸还没有折痕，请先折叠并压平。',
    cut:item?.folded||item?.creases?.length?'请选择尚未折叠或预折痕的原纸。':g?'预览 '+g[0]+' × '+g[1]+'，共 '+g[0]*g[1]+' 片。':'请输入正整数，共 2 至 64 片。',
    place:'选中纸片后加入陈列；拖动成品可调整位置。拖空白处环视。'};
  if(tool==='fold'&&isPrecrease())hints.fold=item?.heldFold?'确认生成折痕并还原；取消弯折则不留痕。':'拖动点或边对齐，确认后留痕并还原起折前纸形。';
  $('hint').textContent=err||(item?.placed&&tool!=='place'?'已摆放的作品，可切换摆放工具移动或旋转。':hints[tool]);
  if(snappedIndex>=0&&!err)$('hint').textContent='已吸附角点 · 拖远可解除';
  $('hint').title=$('hint').textContent;
  syncHUD({tool,busy:!!gesture||!!pairControls?.busy,held:!!item?.heldFold});
  scene.show(desk,id,preview,selected,g,tool,snappedIndex>=0?(snapAnchor||{point:target}):null,previewLayers,separateAxis,gesture?.separating?gesture.side:null);
}
function enter(d){
  hud?.close();
  pairControls?.setEnabled(false);$('foldMode').value='fold';
  desk=structuredClone(d);id=desk.active||desk.items[0].id;history=[];reset();separateAxis=null;tool='fold';
  let migrated=false,warning='';
  desk.items=desk.items.map(item=>{
    try{const next=migratedLayerSpacing(item);migrated||=next!==item;return next}
    catch{warning='部分旧纸形暂时无法安全增加间隙，已保留原形，请先展开纸张';return item}
  });
  $('dialog').close();$('home').hidden=true;$('studio').hidden=false;scene.mode(false);render();
  if(migrated)save();if(warning)say(warning);
}
function home(){
  hud?.close();
  pairControls?.setEnabled(false);
  if(gesture)finishGesture({type:'pointercancel',pointerId:gesture.pid});
  $('studio').hidden=true;$('paperTools').hidden=true;$('home').hidden=false;scene.mode(true);$('resume').disabled=!saves.length;
  $('last').textContent=saves.length?saves[0].name:'暂无存档';
  $('new').classList.toggle('lead',!saves.length);$('resume').classList.toggle('lead',!!saves.length);
}
$('homeBtn').onclick=home;$('resume').onclick=()=>enter(saves[0]);
// 滑动仅同步输入，确认时才计算厚度过渡并保存一次，避免拖动期间反复求解接触。
function changeThickness(value){
  const item=current();if(!item)return;
  if(gesture||pairControls?.busy){say('请先结束当前拖动，再调整厚度');render();return}
  const thickness=Number(value)/50;
  if(thickness===paperThickness(item)){render();return}
  try{
    const next=resizedPaper(item,thickness,heldFaces(item));
    remember();Object.assign(item,next);savedAction();
  }catch(error){say(error.message);render()}
}
$('thickness').oninput=()=>{$('thicknessValue').value=Number(Number($('thickness').value).toFixed(4))};
$('thicknessValue').oninput=()=>{if($('thicknessValue').value!=='')$('thickness').value=$('thicknessValue').value};
$('thickness').onchange=()=>changeThickness($('thicknessValue').value);
$('thicknessValue').onchange=()=>changeThickness($('thicknessValue').value);
function setup(add){
  modal(add?'添一张纸':'新建折纸',(add?'':'<label>桌面名称<input id="deskName" type="text" maxlength="40" value="窗前的折纸"></label>')+'<label>纸样　水彩</label><label>正面颜色<input id="front" type="color" value="#668f99"></label><label><input id="double" type="checkbox">双面着色</label><label>背面颜色<input id="back" type="color" value="#c77e68" disabled></label><label>纸张厚度<input id="newThickness" type="number" min="0.1" max="1" step="0.05" value="0.4">% <small>原纸边长</small></label><button class="primary" id="startDesk">开始折纸</button>');
  $('double').onchange=()=>$('back').disabled=!$('double').checked;
  $('startDesk').onclick=()=>{
    const thickness=$('newThickness').valueAsNumber/50;
    if(!validThickness(thickness)){say('厚度请输入原纸边长的 0.1%～1%');return}
    const p=paper($('front').value,$('double').checked?$('back').value:'#f5ead3',thickness);
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
    for(const p of d.items){ctx.save();ctx.translate(45+p.x*8,31+p.y*8);ctx.rotate(-p.rot);ctx.fillStyle=p.front;for(const f of heldFaces(p)){ctx.beginPath();f.forEach(([x,y],i)=>i?ctx.lineTo(x*8,y*8):ctx.moveTo(x*8,y*8));ctx.closePath();ctx.fill()}ctx.restore()}
    const [open,download]=row.querySelectorAll('button');open.onclick=()=>{enter(d);tool='place';render()};download.onclick=()=>exportDesk(d);$('content').append(row);
  }
};
function valid(d){
  const num=n=>Number.isFinite(n)&&Math.abs(n)<10000, color=c=>/^#[0-9a-f]{6}$/i.test(c);
  return d?.version===1&&typeof d.name==='string'&&d.name.length<=100&&Array.isArray(d.items)&&d.items.length>0&&d.items.length<=512&&new Set(d.items.map(i=>i.id)).size===d.items.length&&d.items.every(i=>typeof i.id==='string'&&color(i.front)&&color(i.back)&&Number.isInteger(i.seed)&&[i.x,i.y,i.rot].every(num)&&Array.isArray(i.faces)&&i.faces.length>0&&i.faces.length<=512&&i.faces.every(f=>Array.isArray(f)&&f.length>=3&&f.length<=128&&f.every(p=>Array.isArray(p)&&p.length===5&&p.every(num)))&&validHeldFold(i)&&validPaperTopology(i));
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
  let starts=isHand()&&gesture?.pick?[gesture.pick]:selected.map(i=>pts[i]),dest=target;
  if(($('foldType').value==='edge')||(isHand()&&gesture?.kind==='edge')){
    const a=starts[0],b=gesture?.other||pts[(selected[0]+1)%pts.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],nx=-dy/len,ny=dx/len,d=(target[0]-mid[0])*nx+(target[1]-mid[1])*ny;
    starts=[mid];dest=[mid[0]+nx*d,mid[1]+ny*d];
  }
  return {starts,dest};
}
function makePreview(curl=0){
  preview=null;previewLayers=null;candidate=null;err='';if(!selected.length||!target)return;
  const {starts,dest}=foldEndpoints();
  const item=current();
  const angle=isHand()?(gesture?.angle||180*scene.facingSign()):isPrecrease()?180:+$('angle').value;
  try{
    preview=fold(item.faces,starts,dest,angle,curl);
    if(!validPaperTopology({...item,faces:preview,layers:undefined}))throw Error('纸面分区过多，请减少折叠次数');
    if(isHand())candidate={starts,dest,angle,curl,...(isPrecrease()?{mode:'precrease'}:{}),kind:gesture.kind,index:selected[0],...(gesture.pick?{pick:gesture.pick}:{}),...(gesture.material?{material:gesture.material}:{}),...(gesture.other?{other:gesture.other}:{}),...(snappedIndex>=0?{snapped:true,...(snapAnchor?.uv?{snapTarget:snapAnchor.uv}:{})}:{})};
  }catch(e){preview=null;err=e.message}
}
$('center').onclick=()=>{snappedIndex=-1;const [a,b,c,d]=bounds(current().faces);target=[(a+c)/2,(b+d)/2];makePreview();render()};
$('angle').oninput=()=>{$('degrees').textContent=$('angle').value+'°';makePreview();render();paperSound('drag')};
$('foldType').onchange=()=>{reset();render()};
$('foldMode').onchange=()=>{reset();render()};
function commitFold(){
  if(!preview)return;
  const item=current(),{starts,dest}=foldEndpoints(),next=structuredClone(item);
  try{
    if(isPrecrease())precreaseFold(next,starts,dest);
    else{
      if(Math.abs(+$('angle').value)===180)recordCreases(next,starts,dest);
      next.faces=preview;delete next.layers;delete next.layerSpacingVersion;next.folded=true;
    }
  }catch(e){say(e.message);return}
  // 候选全部校验后一次替换；预折痕的原层位移不能被普通压平清理逻辑删除。
  remember();desk.items[desk.items.indexOf(item)]=next;paperSound('fold');savedAction();
}
$('commit').onclick=commitFold;
$('flatten').onclick=()=>{
  const item=current();if(!item?.heldFold)return;
  const next=structuredClone(item);
  try{if(isPrecrease())precreaseFold(next,next.heldFold.starts,next.heldFold.dest);else flattenHeldFold(next)}catch(e){say(e.message);return}
  remember();desk.items[desk.items.indexOf(item)]=next;paperSound('fold');savedAction();
};
// 先解除手势身份，再释放捕获；迟到的 pointerup/lostpointercapture 不得重新保存预览。
$('cancelFold').onclick=()=>{
  const g=gesture;gesture=null;
  for(const pid of [g?.pid,g?.second])if(pid!==undefined&&$('view').hasPointerCapture(pid))$('view').releasePointerCapture(pid);
  pairControls?.reset();const item=current();
  if(item?.heldFold){remember();cancelHeldFold(item);save()}
  reset();render();
};
$('pairMode').onclick=()=>{
  if(gesture)finishGesture({type:'pointercancel',pointerId:gesture.pid});
  reset();pairControls.setEnabled(!pairControls.enabled);render();
};
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{
  pairControls?.setEnabled(false);
  if(gesture)finishGesture({type:'pointercancel',pointerId:gesture.pid});
  tool=b.dataset.tool;separateAxis=null;reset();render();
});
for(const k of ['rows','cols'])$(k).oninput=()=>{if($('link').checked)$(k==='rows'?'cols':'rows').value=$(k).value;render()};
$('link').onchange=()=>{if($('link').checked)$('cols').value=$('rows').value;render()};
document.querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{$('rows').value=$('cols').value=b.dataset.size;render()});
$('slice').onclick=()=>{
  const item=current();if(!grid()||item.folded||item.creases?.length||item.placed||item.heldFold)return;
  const pieces=cut(item.faces,...grid()).map(f=>({...item,id:uid(),faces:f}));
  remember();desk.items.splice(desk.items.indexOf(item),1,...pieces);id=pieces[0].id;tool='fold';paperSound('cut');savedAction();
};
$('place').onclick=()=>{if(current()?.heldFold)return;remember();current().placed=true;paperSound('place');savedAction()};
$('rotate').onclick=()=>{remember();current().rot+=Math.PI/12;savedAction()};
$('undo').onclick=()=>{pairControls?.reset();if(gesture)finishGesture({type:'pointercancel',pointerId:gesture.pid});if(history.length){desk=history.pop();id=desk.active||desk.items[0].id;savedAction()}};
function local(item,w){const dx=w[0]-item.x,dy=w[1]-item.y,c=Math.cos(item.rot),s=Math.sin(item.rot);return [dx*c-dy*s,dx*s+dy*c]}
function nearestIndex(pts,q,edge){
  const distances=pts.map((p,i)=>{
    const b=pts[(i+1)%pts.length],dx=b[0]-p[0],dy=b[1]-p[1];
    const t=edge?Math.max(0,Math.min(1,((q[0]-p[0])*dx+(q[1]-p[1])*dy)/(dx*dx+dy*dy))):0;
    return Math.hypot(q[0]-p[0]-dx*t,q[1]-p[1]-dy*t);
  });
  const d=Math.min(...distances);return [distances.indexOf(d),d];
}
function hitPaperControl(item,e,faces=item.faces){
  const controls=scene.paperControls(item,faces),cursor=[e.clientX,e.clientY],radius=e.pointerType==='touch'?24:14;
  const points=controls.points.map(p=>({value:p,distance:Math.hypot(p.screen.x-cursor[0],p.screen.y-cursor[1])})).sort((a,b)=>a.distance-b.distance);
  const edges=controls.edges.map(edge=>{
    const [a,b]=edge.screens,dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
    const t=den?Math.max(0,Math.min(1,((cursor[0]-a.x)*dx+(cursor[1]-a.y)*dy)/den)):0;
    // 屏幕线段参数需还原透视深度，斜视时才能抓住指针下的材料位置。
    const materialT=t*a.depth/((1-t)*b.depth+t*a.depth);
    return {value:{...edge,grabUV:edge.a.map((v,i)=>v+(edge.b[i]-v)*materialT)},distance:Math.hypot(cursor[0]-a.x-dx*t,cursor[1]-a.y-dy*t)};
  }).sort((a,b)=>a.distance-b.distance);
  const point=points[0]?.distance<=radius?points[0].value:null,edge=edges[0]?.distance<=radius?edges[0].value:null;
  return {controls,point,edge,distance:point?points[0].distance:edge?edges[0].distance:Infinity};
}
function beginCrease(item,edge,options,extra={}){
  Object.assign(gesture,{action:'crease',edge,edgeOptions:options,faces:structuredClone(item.faces),layers:item.layers?structuredClone(item.layers):undefined,spacingVersion:item.layers?(item.layerSpacingVersion??0):LAYER_SPACING_VERSION,...extra});
}
function beginSeparation(item,e){
  if(pairControls?.enabled){gesture.action='orbit';return}
  reset();
  if(item.heldFold||item.placed){render();return}
  const {controls,point,edge}=hitPaperControl(item,e);
  if(!point&&!edge){gesture.action='orbit';render();return}
  const pick=separationPick(item,point,edge,separateAxis);
  if(!pick){err='所选点或边还没有可展开的折痕，请先折叠并压平。';render();return}
  const value=pick.edge,face=item.faces[value.face];
  value.points=[pointOnFace(face,value.a),pointOnFace(face,value.b)];
  value.screens=value.points.map(p=>scene.projectedFacePoint(item,value.face,p));
  value.midScreen=scene.projectedFacePoint(item,value.face,value.points[0].map((v,i)=>(v+value.points[1][i])/2));
  const center=face.reduce((sum,p)=>sum.map((v,i)=>v+p[i]/face.length),[0,0,0]);
  value.centerScreen=scene.projectedFacePoint(item,value.face,center);
  const options=pick.direct?controls.edges.filter(p=>p.crease&&sameCreaseAxis(p,value)):[value];
  separateAxis={a:value.a,b:value.b};
  beginCrease(item,value,options,{separating:true,side:pick.side||Math.sign((value.b[0]-value.a[0])*(value.centerUV[1]-value.a[1])-(value.b[1]-value.a[1])*(value.centerUV[0]-value.a[0])),handleUV:pick.handleUV,direct:pick.direct});
  render();
}
// 起拖保存表面抓取点及按下偏移；每次移动按真实投影求角，接触扫描仍处理整张纸。
function separationAngle(item,g,e){
  if(!g.orbit){
    const uv=g.direct?g.edge.centerUV:g.handleUV,face=g.faces[g.edge.face];
    const anchor=scene.projectedFacePoint(item,g.edge.face,pointOnFace(face,uv));
    const local=anchor.local,point=[local[0],local[2],local[1]];
    const a=pointOnFace(face,g.edge.a),b=pointOnFace(face,g.edge.b);
    const project=angle=>scene.projectPaperPosition(item,orbitPoint(point,a,b,angle));
    const start=project(0);
    let min=-180,max=180;
    for(const sign of [-1,1]){
      const probe=safeTurnCrease(g.faces,g.edge,g.side,0,sign*3,paperThickness(item),g.layers,g.spacingVersion);
      if(probe.blocked&&Math.abs(probe.angle)<.5){if(sign<0)min=0;else max=0}
    }
    g.orbit={project,start,min,max};
  }
  const {project,start,min,max}=g.orbit;
  return closestOrbitAngle(project,{x:start.x+e.clientX-g.x,y:start.y+e.clientY-g.y},g.safeAngle||0,min,max);
}
$('view').onpointerdown=e=>{
  if($('studio').hidden||pairControls?.busy)return;
  if(gesture){
    if(e.pointerType==='touch'&&gesture.action==='orbit'&&!gesture.second){
      gesture.second=e.pointerId;gesture.secondX=e.clientX;gesture.secondY=e.clientY;
      gesture.span=Math.hypot(e.clientX-gesture.lastX,e.clientY-gesture.lastY);
      $('view').setPointerCapture(e.pointerId);
    }
    return;
  }
  const hit=scene.pointer(e);
  // 纸边和折痕恰在两个面片的接缝上时，射线可能未命中三角面；仍按可见点边的屏幕容差拾取。
  if(!hit.id&&(tool==='fold'||tool==='separate')){
    let closest=Infinity;
    for(const item of desk.items){
      if(item.placed)continue;
      const control=hitPaperControl(item,e,item.heldFold?heldFaces(item):item.faces);
      if(control.distance<closest){closest=control.distance;hit.id=item.id}
    }
  }
  $('view').setPointerCapture(e.pointerId);
  gesture={pid:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,start:hit.world,action:'orbit'};
  if(!hit.id&&(tool==='fold'||tool==='separate')){reset();render()}
  if(!hit.id||!hit.world)return;
  if(id!==hit.id){pairControls?.reset();id=hit.id;separateAxis=null;reset()}const item=current();
  gesture.action='select';
  if(tool==='separate'){beginSeparation(item,e);return}
  if(tool==='place'&&item.placed){gesture.action='move';gesture.origin=[item.x,item.y]}
  if(tool==='fold'&&!item.placed){
    const pts=corners(item.faces),q=local(item,hit.world),type=$('foldType').value;
    if(item.heldFold){
      const h=item.heldFold,hit=hitPaperControl(item,e,heldFaces(item));
      if(!hit.point&&!hit.edge){gesture.action='orbit';return}
      reset();selected=[h.index];target=h.dest.slice();
      Object.assign(gesture,{action:'fold',kind:h.kind,angle:h.angle,baseTarget:h.dest.slice(),baseScreen:hit.point?.screen||(h.material?scene.projectedMaterialPoint(item,h.material):null),grabMaterial:hit.point?.uv||h.material,pick:h.pick,other:h.other,material:h.material,controls:h.material?hit.controls:undefined});
      gesture.dragHeight=(gesture.baseScreen||hit.point?.screen||hit.edge?.midScreen)?.world[1]||0;
      gesture.start=scene.pointer(e,gesture.dragHeight).world;
      if(h.snapTarget&&gesture.controls){
        const points=gesture.controls.points,anchor=scene.projectedMaterialPoint(item,h.snapTarget);
        if(anchor&&!points.some(p=>Math.hypot(p.uv[0]-h.snapTarget[0],p.uv[1]-h.snapTarget[1])<1e-7))points.push({uv:h.snapTarget,point:anchor.point,screen:anchor});
        snappedIndex=points.findIndex(p=>Math.hypot(p.uv[0]-h.snapTarget[0],p.uv[1]-h.snapTarget[1])<1e-7);
        if(snappedIndex>=0)snapAnchor={uv:h.snapTarget};
      }
      render();return;
    }
    if(type==='hand'){
      const {controls,point,edge}=hitPaperControl(item,e);
      reset();
      if(point){
        gesture.kind='corner';gesture.pick=point.point.slice(0,2);gesture.material=point.uv;gesture.controls=controls;
        gesture.baseScreen=point.screen;
        gesture.dragHeight=point.screen.world[1];gesture.start=scene.pointer(e,gesture.dragHeight).world;
        selected=[0];gesture.action='fold';
      }else if(edge){
        const value=edge;
        if(value.crease){
          const matches=p=>Math.hypot(p.a[0]-value.a[0],p.a[1]-value.a[1])<1e-7&&Math.hypot(p.b[0]-value.b[0],p.b[1]-value.b[1])<1e-7;
          beginCrease(item,value,controls.edges.filter(p=>p.crease&&matches(p)));
        }else{
          Object.assign(gesture,{action:'fold',kind:'edge',pick:value.points[0].slice(0,2),other:value.points[1].slice(0,2)});selected=[0];
          gesture.dragHeight=value.midScreen.world[1];gesture.start=scene.pointer(e,gesture.dragHeight).world;
        }
      }else gesture.action='orbit';
      render();return;
    }
    const [i,d]=nearestIndex(pts,q,type==='edge');
    gesture.dragHeight=scene.projectedCorner(item,pts[i]).world[1];gesture.start=scene.pointer(e,gesture.dragHeight).world;
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
    if(isHand()&&g.action==='fold'&&!g.baseTarget){target=null;preview=null;candidate=null;snappedIndex=-1;render()}
    return;
  }
  const w=scene.pointer(e,g.dragHeight||0).world,item=current();if((!w||!g.start)&&g.action!=='crease')return;
  if(g.action==='move'){
    if(!g.changed)remember();item.x=Math.max(-5,Math.min(5,g.origin[0]+w[0]-g.start[0]));item.y=Math.max(-3,Math.min(3,g.origin[1]+w[1]-g.start[1]));g.changed=true;
  }
  if(g.action==='crease'){
    if(!g.side){
      // 同一内部折痕两侧都可见时，用按下位置和首次有效拖动确定活动纸面。
      const down=[g.x-g.edge.midScreen.x,g.y-g.edge.midScreen.y],drag=[e.clientX-g.x,e.clientY-g.y];
      const intent=Math.hypot(...down)>3?down:drag;
      const score=edge=>{
        const delta=[edge.centerScreen.x-edge.midScreen.x,edge.centerScreen.y-edge.midScreen.y],length=Math.hypot(...delta)||1;
        return (delta[0]*intent[0]+delta[1]*intent[1])/length;
      };
      g.edge=g.edgeOptions.reduce((best,edge)=>score(edge)>score(best)?edge:best,g.edge);
      const dx=g.edge.b[0]-g.edge.a[0],dy=g.edge.b[1]-g.edge.a[1];
      g.side=Math.sign(dx*(g.edge.centerUV[1]-g.edge.a[1])-dy*(g.edge.centerUV[0]-g.edge.a[0]));
    }
    const [a,b]=g.edge.screens,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    const shift=len?((e.clientX-g.x)*(-dy)+(e.clientY-g.y)*dx)/len:0;
    try{
      const angle=g.separating?separationAngle(item,g,e):Math.max(-180,Math.min(180,shift*scene.facingSign()*1.5));
      const safe=safeTurnCrease(g.faces,g.edge,g.side,g.safeAngle||0,angle,paperThickness(item),g.layers,g.spacingVersion);
      if(!validPaperTopology({...item,faces:safe.faces,layers:safe.layers}))throw Error('纸面分区过多，请减少折叠次数');
      preview=safe.faces;previewLayers=safe.layers;g.previewSpacingVersion=safe.layerSpacingVersion;g.safeAngle=safe.angle;g.changedCrease=Math.abs(safe.angle)>1e-6;
      err=safe.blocked?(g.separating?'纸层相互接触，请先展开压在上面的纸瓣。':'纸层相互接触，已停在可折叠的位置'):safe.limited?'已调整到安全位置，请分步继续拖动':g.separating?'正在沿已有折痕分开，松手保持当前角度':'沿已有折痕调整纸瓣，松手保持当前角度';
    }catch(error){err=error.message}
  }
  if(g.action==='fold'){
    target=g.baseTarget?(()=>{const a=local(item,w),b=local(item,g.start);return [g.baseTarget[0]+a[0]-b[0],g.baseTarget[1]+a[1]-b[1]]})():local(item,w);
    if($('foldType').value!=='edge'&&g.kind!=='edge'){
      const controls=isHand()&&g.controls?g.controls.points:null;
      const pts=controls?controls.map(p=>p.point.slice(0,2)):corners(item.faces),radius=e.pointerType==='touch'?24:14;
      const targetScreen=g.baseScreen?{x:g.baseScreen.x+e.clientX-g.x,y:g.baseScreen.y+e.clientY-g.y}:g.baseTarget?scene.projectedCorner(item,target):{x:e.clientX,y:e.clientY};
      const distances=pts.map((p,i)=>{
        if(controls?(g.material?Math.hypot(controls[i].uv[0]-g.material[0],controls[i].uv[1]-g.material[1])<1e-7:Math.hypot(p[0]-g.pick[0],p[1]-g.pick[1])<1e-7):selected.includes(i))return Infinity;
        const screen=controls?(scene.projectedMaterialPoint(item,controls[i].uv)||controls[i].screen):scene.projectedCorner(item,p);
        return screen.visible||i===snappedIndex?Math.hypot(screen.x-targetScreen.x,screen.y-targetScreen.y):Infinity;
      });
      snappedIndex=snapIndex(distances,radius,snappedIndex);
      snapAnchor=snappedIndex>=0?(controls?{uv:controls[snappedIndex].uv}:{point:pts[snappedIndex]}):null;
      if(snappedIndex>=0)target=pts[snappedIndex];
    }
    g.curl=isHand()?(g.baseTarget?adjustedCurl(item.heldFold,target):Math.min(.14,Math.hypot(w[0]-g.start[0],w[1]-g.start[1])*.16)):0;
    // 圆弧会让纸尖偏离折叠目标；锁定角点时先收平预览，确保松手保存的纸尖实际贴合目标。
    if(isHand()&&snappedIndex>=0)g.curl=0;
    // 使用按下位置的材料角点偏移，鼠标与触控抓取均不会突然跳到球心。
    if(isHand()&&g.kind==='corner'&&g.material&&g.baseScreen&&snappedIndex<0){
      const screen={x:g.baseScreen.x+e.clientX-g.x,y:g.baseScreen.y+e.clientY-g.y};
      target=solveDragTarget(target,screen,dest=>scene.projectedMaterialPoint(item,g.grabMaterial||g.material,fold(item.faces,[g.pick||item.heldFold?.starts[0]],dest,g.angle||180*scene.facingSign(),g.curl)));
    }
    makePreview(g.curl);paperSound('drag');
  }
  render();
};
// 只有有效松手才保存重建参数；指针取消和无效拖动保留操作前的纸形。
function finishGesture(e){
  const g=gesture;
  if(!g||(e.pointerId!==g.pid&&e.pointerId!==g.second))return;
  if(isHand()&&g.action==='fold'){
    if(e.type==='pointerup'&&preview&&candidate){remember();current().heldFold=structuredClone(candidate);save()}
    reset();render();
  }
  if(g.action==='crease'){
    if(e.type==='pointerup'&&preview&&g.changedCrease){remember();current().faces=preview;current().layers=previewLayers;if(g.previewSpacingVersion)current().layerSpacingVersion=g.previewSpacingVersion;else delete current().layerSpacingVersion;current().folded=true;save()}
    reset();render();
  }
  if(g.changed)save();gesture=null;render();
}
$('view').onpointerup=$('view').onpointercancel=$('view').onlostpointercapture=finishGesture;
$('view').onwheel=e=>{if(!$('studio').hidden){e.preventDefault();scene.zoom(e.deltaY>0?1.08:.92)}};
for(const k of ['music','sfx']){
  const refresh=()=>{$(k).textContent=(k==='music'?'♫ 音乐':'♪ 音效')+(sound[k]?' 开':' 关');$(k).setAttribute('aria-pressed',String(sound[k]))};
  $(k).onclick=()=>{sound[k]=!sound[k];localStorage.setItem('gami.'+k,sound[k]?'on':'off');refresh()};refresh();
}
pairControls=createPairControls({
  getItem:()=>current(),
  onPreview:(result,axis)=>{preview=result.faces;previewLayers=result.layers;separateAxis=axis;render()},
  onCommit:result=>{
    const item=current();remember();item.faces=result.faces;item.layers=result.layers;item.layerSpacingVersion=result.layerSpacingVersion;item.folded=true;
    save();reset();render();
  },
  onCancel:()=>{reset();render()},
  onStatus:message=>{err=message;$('hint').textContent=message;$('hint').title=message;for(const key of ['thickness','thicknessValue'])$(key).disabled=!!gesture||!!pairControls?.busy;$('cancelFold').hidden=!current()?.heldFold&&!preview&&!pairControls?.hasPreview;syncHUD({tool,busy:!!gesture||!!pairControls?.busy,held:!!current()?.heldFold});pairControls?.refresh()}
});
hud=initHUD(()=>pairControls?.refresh());
document.addEventListener('pointerdown',unlock,{once:true});document.addEventListener('keydown',unlock,{once:true});home();

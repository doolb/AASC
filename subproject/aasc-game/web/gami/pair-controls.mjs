import {hudRects,freeHandlePosition} from './hud.mjs';
import * as scene from './scene.mjs';
import {pointOnFace,paperThickness,LAYER_SPACING_VERSION,validPaperTopology} from './paper-topology.mjs';
import {separationPick,separationPair,orbitPoint,closestOrbitAngle} from './separate.mjs';
import {safeTurnCrease,safePairTurn} from './paper-contact.mjs';

// 编号控制柄单独负责选层及双指抓取，普通画布的单指折叠和双指环视仍由原手势管理。
export function createPairControls({getItem,onPreview,onCommit,onCancel,onStatus}){
  const root=document.getElementById('pairHandles');
  let enabled=false,pin=null,hold=null,drag=null,handles=[];
  const key=p=>p.face+':'+p.uv.join(',');
  const release=pid=>{if(pid!==undefined&&root.hasPointerCapture(pid))root.releasePointerCapture(pid)};
  const reset=()=>{
    const ids=[hold?.pid,...(drag?.pointers||[]).map(p=>p?.pid)],hadPreview=!!drag;
    drag=null;hold=null;pin=null;ids.forEach(release);
    if(hadPreview)onCancel();refresh();
  };
  function candidates(item){
    const unique=new Map();
    for(const p of scene.paperControls(item,item.faces,true).points){
      const pick=separationPick(item,p,null,null);
      if(!pick||Math.hypot(...pick.handleUV.map((v,i)=>v-p.uv[i]))>1e-7)continue;
      unique.set(key(p),p);
    }
    const all=[...unique.values()];
    // 只为可见角附近的对应层提供显式选层，不开放任意被遮挡的内部点。
    return all.filter(p=>p.screen.visible||all.some(q=>q.screen.visible&&Math.hypot(p.screen.x-q.screen.x,p.screen.y-q.screen.y)<24&&separationPair(item,p,q)));
  }
  function refresh(){
    const item=getItem();root.hidden=!enabled||!item||item.heldFold||item.placed;
    if(root.hidden)return;
    const points=drag?[drag.first,drag.second]:candidates(item);
    handles=points;
    const fragment=document.createDocumentFragment(),occupied=[],rects=hudRects();
    points.forEach((p,i)=>{
      const physical=drag?scene.projectedMaterialPoint(item,p.uv):p.screen;
      if(!physical)return;
      const position=freeHandlePosition(physical,occupied,rects,innerWidth,innerHeight);
      if(!position)return;
      const {x,y}=position;occupied.push(position);
      const line=document.createElement('span');line.className='pairLine';line.style.left=physical.x+'px';line.style.top=physical.y+'px';line.style.width=Math.hypot(x-physical.x,y-physical.y)+'px';line.style.transform=`rotate(${Math.atan2(y-physical.y,x-physical.x)}rad)`;
      const button=document.createElement('button');button.type='button';button.dataset.index=i;button.dataset.uv=p.uv.join(',');button.dataset.face=p.face;button.textContent=String(i+1);button.style.left=x+'px';button.style.top=y+'px';
      button.setAttribute('aria-label',`纸层 ${p.face+1} 的角点 ${i+1}`);button.classList.toggle('pinned',!!pin&&key(pin)===key(p));
      button.disabled=!!pin&&!drag&&key(pin)!==key(p)&&!separationPair(item,pin,p);
      fragment.append(line,button);
    });
    root.replaceChildren(fragment);
  }
  function start(second,e){
    const item=getItem(),pair=separationPair(item,pin,second);
    if(!pair){onStatus('请选择同一折轴另一侧的角点');return}
    const source=structuredClone(item),face=source.faces[second.face],a=pointOnFace(face,pair.edge.a),b=pointOnFace(face,pair.edge.b);
    const projectFor=p=>{
      const anchor=scene.projectedFacePoint(item,p.face,pointOnFace(source.faces[p.face],p.uv)),local=anchor.local,point=[local[0],local[2],local[1]];
      return angle=>scene.projectPaperPosition(item,orbitPoint(point,a,b,angle));
    };
    let min=-180,max=180;
    for(const sign of [-1,1]){
      const probe=safeTurnCrease(source.faces,pair.edge,pair.side,0,sign*3,paperThickness(source),source.layers,source.layers?(source.layerSpacingVersion??0):LAYER_SPACING_VERSION);
      if(probe.blocked&&Math.abs(probe.angle)<.5){if(sign<0)min=0;else max=0}
    }
    const pointer={pid:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};
    drag={source,...pair,first:pin,second,projects:[projectFor(pin),projectFor(second)],pointers:[hold?{...hold,startX:hold.x,startY:hold.y}:null,pointer],angles:[0,0],relative:0,min,max,result:null};
    root.setPointerCapture(e.pointerId);onStatus('双角已抓住 · 向两边拉开 · 松手保持');refresh();
  }
  root.onpointerdown=e=>{
    const button=e.target.closest('button');if(!button||button.disabled||drag)return;
    e.preventDefault();e.stopPropagation();const p=handles[Number(button.dataset.index)];if(!p)return;
    if(!pin||key(pin)===key(p)){
      pin=p;
      if(e.pointerType==='touch'){hold={pid:e.pointerId,x:e.clientX,y:e.clientY};root.setPointerCapture(e.pointerId)}
      onStatus('已固定一角 · 抓另一层编号，双指可对向拉开');refresh();return;
    }
    try{start(p,e)}catch(error){reset();onStatus(error.message)}
  };
  function move(e){
    if(!drag){if(hold?.pid===e.pointerId){hold.x=e.clientX;hold.y=e.clientY;e.stopImmediatePropagation()}return}
    const index=drag.pointers.findIndex(p=>p?.pid===e.pointerId);if(index<0)return;
    e.preventDefault();e.stopImmediatePropagation();const g=drag,p=g.pointers[index];p.x=e.clientX;p.y=e.clientY;
    try{
      const project=g.projects[index],start=project(0),target={x:start.x+p.x-p.startX,y:start.y+p.y-p.startY};
      g.angles[index]=closestOrbitAngle(project,target,g.angles[index],index===0?-g.max:g.min,index===0?-g.min:g.max);
      let relative=Math.max(g.min,Math.min(g.max,g.angles[1]-g.angles[0]));
      if(Math.abs(relative)>178)relative=Math.sign(relative)*180;
      const result=safePairTurn(g.source,g.edge,g.side,g.relative,relative,g.angles[0]);
      if(!validPaperTopology({...g.source,faces:result.faces,layers:result.layers}))throw Error('纸面分区过多，无法继续分开');
      g.relative=result.angle;g.angles[1]=g.angles[0]+result.angle;g.result=result;
      onPreview(result,g.edge,g.side);onStatus(result.blocked?'纸层接触，已停在安全位置':'正在对向分开，回拖可收拢，松手保持');
    }catch(error){onStatus(error.message)}
  }
  function finish(e){
    if(!drag){if(hold?.pid===e.pointerId){const pid=hold.pid;hold=null;release(pid);if(e.type!=='pointerup'){pin=null;refresh()}}return}
    if(!drag.pointers.some(p=>p?.pid===e.pointerId))return;
    e.stopImmediatePropagation();const g=drag,ids=g.pointers.map(p=>p?.pid);drag=null;hold=null;pin=null;ids.forEach(release);
    if(e.type==='pointerup'&&g.result&&(Math.abs(g.relative)>1e-6||Math.abs(g.angles[0])>1e-6))onCommit(g.result);else onCancel();
    refresh();
  }
  window.addEventListener('pointermove',move,{capture:true,passive:false});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(name,finish,true);
  scene.setOverlayUpdate(refresh);
  return {setEnabled(value){reset();enabled=value;refresh()},reset,refresh,get busy(){return !!drag||!!hold},get hasPreview(){return !!drag},get enabled(){return enabled}};
}

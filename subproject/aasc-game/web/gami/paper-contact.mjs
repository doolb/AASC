import {orbitPoint} from './separate.mjs';
import {layerDisplacements,layerPitch,LAYER_SPACING_VERSION,PAPER_THICKNESS,paperThickness,validThickness,pointOnFace,turnCrease} from './paper-topology.mjs';

const EPS=1e-8;
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=v=>{const length=Math.hypot(...v);return length<EPS?null:v.map(n=>n/length)};
const same=(a,b)=>Math.hypot(a[3]-b[3],a[4]-b[4])<EPS;

// 三角面扩为有厚度的凸棱柱，通过分离轴检查相交；仅表面相切不判为穿透。
function prism(triangle,offset,thickness){
  const delta=Array.isArray(offset)?offset:[0,0,offset];
  const points=triangle.map(p=>p.slice(0,3).map((v,i)=>v+delta[i]));
  const edges=[sub(points[1],points[0]),sub(points[2],points[1]),sub(points[0],points[2])];
  const normal=normalize(cross(edges[0],edges[1]));if(!normal)return null;
  const vertices=[];
  for(const sign of [-1,1])for(const p of points)vertices.push(p.map((v,i)=>v+sign*normal[i]*thickness/2));
  return {vertices,edges:[...edges,normal],normals:[normal,...edges.map(edge=>cross(edge,normal))]};
}
function overlappingPrisms(a,b){
  const axes=[...a.normals,...b.normals];
  for(const u of a.edges)for(const v of b.edges)axes.push(cross(u,v));
  for(const raw of axes){
    const axis=normalize(raw);if(!axis)continue;
    const aa=a.vertices.map(v=>dot(v,axis)),bb=b.vertices.map(v=>dot(v,axis));
    if(Math.max(...aa)<=Math.min(...bb)+EPS||Math.max(...bb)<=Math.min(...aa)+EPS)return false;
  }
  return true;
}
function trimHinge(face,shared,thickness){
  const a=shared[0].slice(0,3),b=shared[1].slice(0,3),axis=normalize(sub(b,a));if(!axis)return face;
  const center=face.reduce((sum,p)=>sum.map((v,i)=>v+p[i]/face.length),[0,0,0]),relative=sub(center,a),along=dot(relative,axis);
  const inward=normalize(relative.map((v,i)=>v-axis[i]*along));if(!inward)return [];
  const distance=p=>dot(sub(p.slice(0,3),a),inward)-thickness*1.5,out=[];
  for(let i=0;i<face.length;i++){
    const p=face[i],q=face[(i+1)%face.length],dp=distance(p),dq=distance(q);
    if(dp>=0)out.push(p);
    if(dp*dq<0){const t=dp/(dp-dq);out.push(p.map((v,k)=>v+(q[k]-v)*t))}
  }
  return out;
}
export function faceCollision(a,offsetA,b,offsetB,thickness=PAPER_THICKNESS){
  // 相邻面只排除折轴附近一个纸厚的弯折区，远离折轴的穿透仍参与检查。
  const shared=a.filter(p=>b.some(q=>same(p,q)));
  if(shared.length>=2){
    a=trimHinge(a,shared,thickness);
    const other=shared.map(p=>b.find(q=>same(p,q)));b=trimHinge(b,other,thickness);
  }
  for(let i=1;i<a.length-1;i++)for(let j=1;j<b.length-1;j++){
    const p=prism([a[0],a[i],a[i+1]],offsetA,thickness),q=prism([b[0],b[j],b[j+1]],offsetB,thickness);
    if(p&&q&&overlappingPrisms(p,q))return true;
  }
  return false;
}

// 按表面最大位移扫描层距或厚度变更，碰撞体额外包含净间隙，纸面网格仍只绘制材料厚度。
function checkLayerTransition(faces,base,layers,fromEnvelope,toEnvelope){
  if(faces.length>64)throw Error('纸层过多，无法安全调整层间距，请先展开或减少折叠');
  const travel=Math.max(...layers.map((p,i)=>Math.hypot(...sub(p,base[i]))),0)+Math.abs(toEnvelope-fromEnvelope)/2;
  const steps=Math.max(1,Math.ceil(travel/(Math.min(fromEnvelope,toEnvelope)*.5))),pairs=faces.length*(faces.length-1)/2;
  if(steps*pairs>16000)throw Error('层间距调整超出安全计算预算，请先展开纸张');
  for(let step=1;step<=steps;step++){
    const t=step/steps,value=fromEnvelope+(toEnvelope-fromEnvelope)*t;
    const offsets=layers.map((p,i)=>p.map((n,k)=>base[i][k]+(n-base[i][k])*t));
    for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
      if(faceCollision(faces[i],offsets[i],faces[j],offsets[j],value))throw Error('此层间距或厚度会使纸层穿透，请先展开纸张');
    }
  }
}

// 旧存档的层位移不含净间隙；只转换未标记的数据，失败时调用者保留原存档。
export function migratedLayerSpacing(item){
  if(!item.layers||item.layerSpacingVersion===LAYER_SPACING_VERSION)return item;
  const thickness=paperThickness(item),layers=item.layers.map(p=>p.map(n=>n*1.25));
  checkLayerTransition(item.faces,item.layers,layers,thickness,layerPitch(thickness));
  return {...item,layers,layerSpacingVersion:LAYER_SPACING_VERSION};
}

// 修改材料厚度时扫描过渡层位移；候选独立计算，失败不污染存档或撤销历史。
export function resizedPaper(item,thickness,faces=item.faces){
  if(!validThickness(thickness))throw Error('厚度请输入原纸边长的 0.1%～1%');
  if(faces.length>64)throw Error('纸层过多，无法安全调整厚度，请先展开或减少折叠');
  const source=migratedLayerSpacing(item),old=paperThickness(source),base=faces===source.faces&&source.layers?source.layers:layerDisplacements(faces,old);
  const layers=base.map(p=>p.map(n=>n*thickness/old));
  checkLayerTransition(faces,base,layers,layerPitch(old),layerPitch(thickness));
  const next={...source,thickness};
  // 弯纸预览条带不是持久材料面；其层位移由新的厚度即时重建。
  if(faces===item.faces){next.layers=layers;next.layerSpacingVersion=LAYER_SPACING_VERSION}
  return next;
}

// 扫描中间折角，避免一次快速鼠标移动跳过薄纸；超出计算预算时保留上个安全形状。
export function safeTurnCrease(faces,edge,side,from,to,thickness=PAPER_THICKNESS,layers,spacingVersion=LAYER_SPACING_VERSION){
  if(faces.length>64)throw Error('纸层过多，无法安全计算接触，请先减少折叠');
  const axisFace=faces.find(f=>pointOnFace(f,edge.a)&&pointOnFace(f,edge.b));
  if(!axisFace)throw Error('无法定位当前折痕');
  const axisOrigin=pointOnFace(axisFace,edge.a),axis=normalize(sub(pointOnFace(axisFace,edge.b),axisOrigin));
  const baseOffsets=layers||layerDisplacements(faces,thickness);
  const envelope=spacingVersion===LAYER_SPACING_VERSION?layerPitch(thickness):thickness;
  const length=Math.max(...faces.flatMap((face,i)=>face.map(p=>Math.hypot(...sub(p.slice(0,3),axisOrigin))+Math.hypot(...baseOffsets[i]))),1);
  const requestedSteps=Math.max(1,Math.ceil(Math.abs(to-from)*Math.PI/180*length/(thickness*.5)));
  const steps=Math.min(requestedSteps,1600,Math.max(1,Math.floor(16000/(faces.length*faces.length))));
  const direction=[edge.b[0]-edge.a[0],edge.b[1]-edge.a[1]];
  for(const face of faces){
    const distances=face.map(p=>direction[0]*(p[4]-edge.a[1])-direction[1]*(p[3]-edge.a[0]));
    if(Math.min(...distances)<-EPS&&Math.max(...distances)>EPS)throw Error('这段折痕未贯通相连纸面，请先调整相邻折痕');
  }
  const classify=face=>{
    const u=face.reduce((sum,p)=>sum+p[3],0)/face.length,v=face.reduce((sum,p)=>sum+p[4],0)/face.length;
    return Math.sign((direction[0]*(v-edge.a[1])-direction[1]*(u-edge.a[0]))*side);
  };
  const sourceIndex=face=>{
    const uv=[face.reduce((sum,p)=>sum+p[3],0)/face.length,face.reduce((sum,p)=>sum+p[4],0)/face.length];
    return faces.findIndex(f=>pointOnFace(f,uv));
  };
  const rotatedOffset=(offset,degrees)=>{
    const r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r),p=cross(axis,offset),along=dot(axis,offset);
    return offset.map((n,i)=>n*c+p[i]*s+axis[i]*along*(1-c));
  };
  const physicalLayers=(candidate,degrees)=>{
    // 完全展平或压折到另一面后，让接触层重新贴合，消除展开纸面上的历史层高台阶。
    if(Math.abs(Math.abs(degrees)-180)<1e-7)return layerDisplacements(candidate,thickness);
    return candidate.map(face=>{
    const index=sourceIndex(face);if(index<0)throw Error('无法确定纸层，请先展开相邻纸瓣');
    return classify(face)>0?rotatedOffset(baseOffsets[index],degrees):baseOffsets[index];
    });
  };
  let previous=turnCrease(faces,edge,side,from),previousLayers=physicalLayers(previous,from),angle=from;
  for(let step=1;step<=steps;step++){
    const next=from+(to-from)*step/requestedSteps,candidate=turnCrease(faces,edge,side,next);
    const candidateLayers=physicalLayers(candidate,next);
    if(spacingVersion!==LAYER_SPACING_VERSION&&Math.abs(Math.abs(next)-180)<1e-7){
      try{checkLayerTransition(candidate,candidateLayers,candidateLayers,layerPitch(thickness),layerPitch(thickness))}
      catch{return {faces:previous,layers:previousLayers,angle,blocked:true,layerSpacingVersion:spacingVersion}}
    }
    const fixed=candidate.map((face,i)=>({face,layer:candidateLayers[i]})).filter(({face})=>classify(face)<0),moving=candidate.map((face,i)=>({face,layer:candidateLayers[i]})).filter(({face})=>classify(face)>0);
    let collision=false;
    for(const a of fixed){
      for(const b of moving){
        if(faceCollision(a.face,a.layer,b.face,b.layer,envelope)){collision=true;break}
      }
      if(collision)break;
    }
    if(collision)return {faces:previous,layers:previousLayers,angle,blocked:true,layerSpacingVersion:Math.abs(Math.abs(angle)-180)<1e-7?LAYER_SPACING_VERSION:spacingVersion};
    previous=candidate;previousLayers=candidateLayers;angle=next;
  }
  return {faces:previous,layers:previousLayers,angle,blocked:false,limited:steps<requestedSteps,layerSpacingVersion:Math.abs(Math.abs(angle)-180)<1e-7?LAYER_SPACING_VERSION:spacingVersion};
}

// 双手相对开合复用接触扫描，再整体转动固定侧。公共刚性旋转不改变纸层间的相对接触。
export function safePairTurn(item,edge,side,from,relative,base){
  const safe=safeTurnCrease(item.faces,edge,side,from,relative,paperThickness(item),item.layers,item.layers?(item.layerSpacingVersion??0):LAYER_SPACING_VERSION);
  const face=item.faces.find(f=>pointOnFace(f,edge.a)&&pointOnFace(f,edge.b)),a=pointOnFace(face,edge.a),b=pointOnFace(face,edge.b),axis=b.slice(0,3).map((v,i)=>v-a[i]);
  return {...safe,faces:safe.faces.map(f=>f.map(p=>[...orbitPoint(p.slice(0,3),a,b,base),...p.slice(3)])),layers:safe.layers.map(p=>orbitPoint(p,[0,0,0],axis,base))};
}

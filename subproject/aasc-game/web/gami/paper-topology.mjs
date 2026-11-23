// 原纸 UV 是折叠和展开时不变的材料坐标；边界与折痕相交时在此坐标系分割。
const EPS=1e-8;
export const PAPER_THICKNESS=.008;
export const MIN_PAPER_THICKNESS=.002,MAX_PAPER_THICKNESS=.02;
export const LAYER_SPACING_VERSION=1;
// 中面间距包含纸本身的厚度与四分之一纸厚的空气间隙，表面厚度仍保持原值。
export const layerPitch=thickness=>thickness*1.25;
export const validThickness=value=>Number.isFinite(value)&&value>=MIN_PAPER_THICKNESS&&value<=MAX_PAPER_THICKNESS;
// 厚度属于每张纸的材料属性；旧存档缺少此字段时使用原默认值。
export const paperThickness=item=>item.thickness===undefined?PAPER_THICKNESS:item.thickness;
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<EPS;
const key=p=>p.map(n=>Math.round(n/EPS)).join(',');
const EMPTY_CREASES=Object.freeze([]),topologyCache=new WeakMap();

// 根据折轴与每个材料面的交点记录折痕，交点通过面片顶点插值得到原纸坐标。
export function foldCreases(faces,starts,target){
  const result=[];
  for(const start of starts){
    const normal=sub(start,target),mid=lerp(start,target,.5);
    if(Math.hypot(...normal)<EPS)continue;
    const distance=p=>(p[0]-mid[0])*normal[0]+(p[1]-mid[1])*normal[1];
    for(const face of faces){
      const points=[];
      for(let i=0;i<face.length;i++){
        const a=face[i],b=face[(i+1)%face.length],da=distance(a),db=distance(b);
        if(Math.abs(da)<EPS)points.push([a[3],a[4]]);
        if(da*db<-EPS*EPS){const p=lerp(a,b,da/(da-db));points.push([p[3],p[4]])}
      }
      const unique=points.filter((p,i)=>points.findIndex(q=>near(p,q))===i);
      if(unique.length<2)continue;
      let pair=[unique[0],unique[1]],length=0;
      for(const a of unique)for(const b of unique){const d=Math.hypot(...sub(a,b));if(d>length){length=d;pair=[a,b]}}
      if(length>EPS)result.push(pair);
    }
  }
  return result;
}

// 折痕以纸张自身坐标持久化；重复压同一条线不会无上限地累积记录。
export function recordCreases(item,starts,target){
  const existing=item.creases||[],next=[...existing],seen=new Set(existing.map(([a,b])=>[key(a),key(b)].sort().join('|')));
  for(const crease of foldCreases(item.faces,starts,target)){
    const id=crease.map(key).sort().join('|');
    // 交点细分后的短线可能已被原长折痕覆盖，按共线区间并集去重。
    const [a,b]=crease,delta=sub(b,a),length2=delta[0]**2+delta[1]**2;
    const intervals=next.filter(([p,q])=>Math.abs(cross(delta,sub(p,a)))<EPS*Math.sqrt(length2)&&Math.abs(cross(delta,sub(q,a)))<EPS*Math.sqrt(length2)).map(([p,q])=>{
      const parameter=v=>((v[0]-a[0])*delta[0]+(v[1]-a[1])*delta[1])/length2;
      return [parameter(p),parameter(q)].sort((x,y)=>x-y);
    }).sort((p,q)=>p[0]-q[0]);
    let end=0;
    for(const [from,to] of intervals){if(from>end+EPS)break;end=Math.max(end,to)}
    if(!seen.has(id)&&end<1-EPS){next.push(crease);seen.add(id)}
  }
  if(next.length>128)throw Error('折痕过多，请减少此纸的折叠次数');
  item.creases=next;
}

export function validPaperTopology(item){
  if(item.thickness!==undefined&&!validThickness(item.thickness))return false;
  if(item.layerSpacingVersion!==undefined&&item.layerSpacingVersion!==LAYER_SPACING_VERSION)return false;
  if(!Array.isArray(item.faces)||item.faces.reduce((sum,f)=>sum+(Array.isArray(f)?f.length:2049),0)>2048)return false;
  if(item.layers!==undefined&&(!Array.isArray(item.layers)||item.layers.length!==item.faces.length||!item.layers.every(p=>Array.isArray(p)&&p.length===3&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<10000))))return false;
  if(item.creases===undefined)return true;
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<10000);
  return Array.isArray(item.creases)&&item.creases.length<=128&&item.creases.every(s=>Array.isArray(s)&&s.length===2&&s.every(point)&&!near(s[0],s[1]));
}

function intersections(a,b,c,d){
  const r=sub(b,a),s=sub(d,c),q=sub(c,a),den=cross(r,s),rr=r[0]*r[0]+r[1]*r[1],ss=s[0]*s[0]+s[1]*s[1];
  if(rr<EPS*EPS||ss<EPS*EPS)return [];
  if(Math.abs(den)>EPS){
    const t=cross(q,s)/den,u=cross(q,r)/den;
    return t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS?[[Math.max(0,Math.min(1,t)),Math.max(0,Math.min(1,u))]]:[];
  }
  if(Math.abs(cross(q,r))>EPS)return [];
  const dot=(x,y)=>x[0]*y[0]+x[1]*y[1];
  const out=[];
  for(const [p,t] of [[a,0],[b,1]]){const u=dot(sub(p,c),s)/ss;if(u>=-EPS&&u<=1+EPS)out.push([t,Math.max(0,Math.min(1,u))])}
  for(const [p,u] of [[c,0],[d,1]]){const t=dot(sub(p,a),r)/rr;if(t>=-EPS&&t<=1+EPS)out.push([Math.max(0,Math.min(1,t)),u])}
  return out;
}

// 将所有边界与折痕线段互相切分，交点、端点和线段保持稳定的材料坐标。
export function buildTopology(faces,creases=EMPTY_CREASES){
  const cached=topologyCache.get(faces);if(cached?.creases===creases)return cached.result;
  const segments=[],known=new Map();
  const add=(a,b,crease)=>{
    if(near(a,b))return;
    const id=[key(a),key(b)].sort().join('|'),existing=known.get(id);
    if(existing){existing.crease||=crease;return}
    const segment={a,b,crease,cuts:[0,1]};segments.push(segment);known.set(id,segment);
  };
  for(const face of faces)for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length];add([a[3],a[4]],[b[3],b[4]],false);
  }
  for(const [a,b] of creases)add(a,b,true);
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const a=segments[i],b=segments[j];
    if(Math.max(a.a[0],a.b[0])+EPS<Math.min(b.a[0],b.b[0])||Math.max(b.a[0],b.b[0])+EPS<Math.min(a.a[0],a.b[0])||Math.max(a.a[1],a.b[1])+EPS<Math.min(b.a[1],b.b[1])||Math.max(b.a[1],b.b[1])+EPS<Math.min(a.a[1],a.b[1]))continue;
    for(const [t,u] of intersections(a.a,a.b,b.a,b.b)){a.cuts.push(t);b.cuts.push(u)}
  }
  const vertices=new Map(),edges=new Map();
  for(const segment of segments){
    const cuts=segment.cuts.sort((a,b)=>a-b).filter((v,i,all)=>i===0||v-all[i-1]>EPS);
    for(let i=1;i<cuts.length;i++){
      const a=lerp(segment.a,segment.b,cuts[i-1]),b=lerp(segment.a,segment.b,cuts[i]);
      if(near(a,b))continue;
      const ka=key(a),kb=key(b),id=[ka,kb].sort().join('|');
      if(!vertices.has(ka))vertices.set(ka,a);if(!vertices.has(kb))vertices.set(kb,b);
      const edge=edges.get(id);if(edge)edge.crease||=segment.crease;
      else edges.set(id,{a:vertices.get(ka),b:vertices.get(kb),crease:segment.crease});
    }
  }
  const result={vertices:[...vertices.values()],edges:[...edges.values()]};
  topologyCache.set(faces,{creases,result});return result;
}

// 同一面内 UV 到三维坐标是仿射映射；返回 null 表示点不属于这个材料面。
export function pointOnFace(face,uv){
  for(let i=1;i<face.length-1;i++){
    const a=face[0],b=face[i],c=face[i+1],ab=[b[3]-a[3],b[4]-a[4]],ac=[c[3]-a[3],c[4]-a[4]],ap=[uv[0]-a[3],uv[1]-a[4]],den=cross(ab,ac);
    if(Math.abs(den)<EPS)continue;
    const u=cross(ap,ac)/den,v=cross(ab,ap)/den;
    if(u>=-EPS&&v>=-EPS&&u+v<=1+EPS)return [0,1,2].map(k=>a[k]+u*(b[k]-a[k])+v*(c[k]-a[k]));
  }
  return null;
}

// 只裁分显示线段，不把弯纸渲染条带的交点加入可操作材料顶点。
export function clipMaterialSegment(face,a,b){
  const polygon=face.map(p=>[p[3],p[4]]),sign=Math.sign(polygonArea(polygon));
  if(!sign)return null;
  let from=0,to=1;
  for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],d=sub(q,p),da=cross(d,sub(a,p))*sign,db=cross(d,sub(b,p))*sign;
    if(da<-EPS&&db<-EPS)return null;
    if(da*db<0){const t=da/(da-db);if(da<0)from=Math.max(from,t);else to=Math.min(to,t)}
    if(to-from<EPS)return null;
  }
  return [lerp(a,b,from),lerp(a,b,to)];
}

function splitMaterialFace(face,a,b,side){
  const direction=sub(b,a),dist=p=>cross(direction,[p[3]-a[0],p[4]-a[1]])*side,out=[];
  for(let i=0;i<face.length;i++){
    const p=face[i],q=face[(i+1)%face.length],dp=dist(p),dq=dist(q);
    if(dp>=-EPS)out.push(p);
    if(dp*dq<-EPS*EPS)out.push(lerp(p,q,dp/(dp-dq)));
  }
  if(out.length<3)return [];
  const uv=out.map(p=>[p[3],p[4]]);
  return Math.abs(polygonArea(uv))>EPS?out:[];
}

// 直接绕材料折痕转动选中侧。折痕在空间中不再共线时拒绝操作，避免撕裂纸面。
export function turnCrease(faces,edge,side,degrees){
  if(!edge?.crease||![1,-1].includes(side)||!Number.isFinite(degrees)||Math.abs(degrees)>180)throw Error('请选择有效的折痕和翻折方向');
  let axis;
  for(const face of faces){
    const a=pointOnFace(face,edge.a),b=pointOnFace(face,edge.b);
    if(!a||!b)continue;
    if(!axis){axis=[a,b];continue}
    if(Math.hypot(...a.map((v,i)=>v-axis[0][i]))>1e-6||Math.hypot(...b.map((v,i)=>v-axis[1][i]))>1e-6)throw Error('相邻纸层的折痕不共线，请先调整相邻纸瓣');
  }
  if(!axis)throw Error('无法在当前纸面定位折痕');
  const delta=axis[1].map((v,i)=>v-axis[0][i]),length=Math.hypot(...delta);
  if(length<EPS)throw Error('折痕长度过短');
  const n=delta.map(v=>v/length),r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  // 同一材料折线可能已经被另一折弯折；整条活动折线必须仍在同一空间轴上。
  const materialDirection=sub(edge.b,edge.a),distance=p=>cross(materialDirection,[p[3]-edge.a[0],p[4]-edge.a[1]]);
  const onAxis=p=>{
    const v=p.slice(0,3).map((value,i)=>value-axis[0][i]),along=v.reduce((sum,value,i)=>sum+value*n[i],0);
    return Math.hypot(...v.map((value,i)=>value-along*n[i]))<1e-6;
  };
  for(const face of faces)for(let i=0;i<face.length;i++){
    const p=face[i],q=face[(i+1)%face.length],dp=distance(p),dq=distance(q);
    if(Math.abs(dp)<EPS&&!onAxis(p))throw Error('这条折痕已被其它折痕弯折，请先调整相邻纸瓣');
    if(dp*dq<-EPS*EPS&&!onAxis(lerp(p,q,dp/(dp-dq))))throw Error('这条折痕已被其它折痕弯折，请先调整相邻纸瓣');
  }
  const rotate=p=>{
    const v=p.slice(0,3).map((x,i)=>x-axis[0][i]),dot=v.reduce((sum,x,i)=>sum+x*n[i],0);
    const cp=[n[1]*v[2]-n[2]*v[1],n[2]*v[0]-n[0]*v[2],n[0]*v[1]-n[1]*v[0]];
    const pos=v.map((x,i)=>axis[0][i]+x*c+cp[i]*s+n[i]*dot*(1-c));
    return [...pos,p[3],p[4]];
  };
  const fixed=[],moving=[];
  for(const face of faces){
    const other=splitMaterialFace(face,edge.a,edge.b,-side),part=splitMaterialFace(face,edge.a,edge.b,side);
    if(other.length)fixed.push(other);
    if(part.length)moving.push(part.map(rotate));
  }
  if(!fixed.length||!moving.length)throw Error('折痕两侧需要都有纸面');
  return degrees<0?[...moving.reverse(),...fixed]:[...fixed,...moving.reverse()];
}

function polygonArea(points){return points.reduce((sum,p,i)=>sum+cross(p,points[(i+1)%points.length]),0)/2}
function overlappingPolygons(left,right){
  // 分层与棱柱接触使用相同量纲的线性容差，不能用面积阈值忽略细小重叠片。
  let tested=false;
  for(const polygon of [left,right])for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(length<EPS)continue;tested=true;
    const project=p=>(-dy*p[0]+dx*p[1])/length,aa=left.map(project),bb=right.map(project);
    if(Math.max(...aa)<=Math.min(...bb)+EPS||Math.max(...bb)<=Math.min(...aa)+EPS)return false;
  }
  return tested;
}

export function faceNormal(face){
  const a=face[0];
  for(let i=1;i<face.length-1;i++){
    const u=face[i].slice(0,3).map((n,k)=>n-a[k]),v=face[i+1].slice(0,3).map((n,k)=>n-a[k]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
    if(len>EPS)return n.map(value=>value/len);
  }
  return [0,0,1];
}

// 在各自的共面分组中按材料层序分配法向位移，竖起或翻到背面的纸层同样保留厚度。
export function layerDisplacements(faces,thickness=PAPER_THICKNESS){
  const ranks=[],planes=faces.map(face=>{
    const normal=faceNormal(face),dominant=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    if(normal[dominant]<0)for(let i=0;i<3;i++)normal[i]*=-1;
    const axes=[0,1,2].filter(i=>i!==dominant);
    return {normal,axes,distance:normal.reduce((sum,n,i)=>sum+n*face[0][i],0)};
  });
  for(let i=0;i<faces.length;i++){
    let rank=0;
    for(let j=0;j<i;j++){
      const a=planes[i],b=planes[j],parallel=a.normal.every((n,k)=>Math.abs(n-b.normal[k])<EPS);
      if(!parallel||Math.abs(a.distance-b.distance)>EPS)continue;
      const project=face=>face.map(p=>a.axes.map(k=>p[k]));
      if(overlappingPolygons(project(faces[i]),project(faces[j])))rank=Math.max(rank,ranks[j]+1);
    }
    ranks.push(rank);
  }
  return ranks.map((rank,i)=>planes[i].normal.map(n=>n*rank*layerPitch(thickness)));
}

export function layerOffsets(faces,thickness=PAPER_THICKNESS){return layerDisplacements(faces,thickness).map(d=>d[2])}

/* Browser-local geometry processing. No Blender/runtime/network dependency. */
function createContour3D(){
  'use strict';
  const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=a=>Math.hypot(...a),unit=a=>mul(a,1/(len(a)||1)),dist=(a,b)=>len(sub(a,b)),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),key=(a,b)=>a<b?a+':'+b:b+':'+a;
  let primitiveAPI=null,hierarchyAPI=null,guideAPI=null,csiSurfaceAPI=null;
  const copy=m=>({...m,vertices:m.vertices.map(p=>p.slice()),faces:m.faces.map(f=>f.slice())});
  function fingerprint(m){let h=2166136261;for(const v of m.vertices)for(const x of v){const s=Number(x).toPrecision(12);for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);}for(const f of m.faces)for(const i of f)h=Math.imul(h^i,16777619);return (h>>>0).toString(16);}
  function faceData(m,f){const p=f.map(i=>m.vertices[i]);let n=[0,0,0],area=0,c=[0,0,0];for(let i=1;i<p.length-1;i++){const q=cross(sub(p[i],p[0]),sub(p[i+1],p[0])),a=len(q)/2;n=add(n,q);area+=a;c=add(c,mul(add(add(p[0],p[i]),p[i+1]),a/3));}return {normal:unit(n),area,center:area?mul(c,1/area):p[0].slice()};}
  function bounds(m){const lo=[Infinity,Infinity,Infinity],hi=lo.map(v=>-v);for(const p of m.vertices)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}return {lo,hi,center:mul(add(lo,hi),.5),diagonal:dist(lo,hi)};}
  function topology(m){const data=m.faces.map(f=>faceData(m,f)),edges=new Map(),incident=m.vertices.map(()=>[]),adj=m.faces.map(()=>[]);m.faces.forEach((f,fi)=>{for(let j=0;j<f.length;j++){const a=f[j],b=f[(j+1)%f.length],k=key(a,b);if(!edges.has(k))edges.set(k,{a:Math.min(a,b),b:Math.max(a,b),faces:[],corners:[]});const e=edges.get(k);e.faces.push(fi);e.corners.push(j);incident[a].push(fi);}});for(const e of edges.values())if(e.faces.length===2){const [a,b]=e.faces;adj[a].push(b);adj[b].push(a);}return {data,edges,incident,adj};}
  function audit(m){const t=topology(m),seen=new Set(),components=[];let volume=0;for(const f of m.faces)for(let i=1;i<f.length-1;i++)volume+=dot(m.vertices[f[0]],cross(m.vertices[f[i]],m.vertices[f[i+1]]))/6;
    for(let i=0;i<m.faces.length;i++)if(!seen.has(i)){const queue=[i],vs=new Set(),es=new Set();seen.add(i);let fs=0;for(let q=0;q<queue.length;q++){const fi=queue[q];fs++;const f=m.faces[fi];f.forEach((v,j)=>{vs.add(v);es.add(key(v,f[(j+1)%f.length]));});for(const j of t.adj[fi])if(!seen.has(j)){seen.add(j);queue.push(j);}}components.push({faces:fs,euler:vs.size-es.size+fs});}
    let nonmanifoldVertices=0;for(let vi=0;vi<t.incident.length;vi++){const incident=t.incident[vi];if(!incident.length)continue;const seen=new Set([incident[0]]),queue=[incident[0]],boundary=new Set();for(let q=0;q<queue.length;q++){const fi=queue[q],f=m.faces[fi],j=f.indexOf(vi);for(const other of [f[(j+1)%f.length],f[(j+f.length-1)%f.length]]){const k=key(vi,other),e=t.edges.get(k);if(e.faces.length===1)boundary.add(k);for(const next of e.faces)if(!seen.has(next)){seen.add(next);queue.push(next);}}}if(seen.size!==incident.length||boundary.size!==0&&boundary.size!==2)nonmanifoldVertices++;}
    let orientationConflicts=0;for(const e of t.edges.values())if(e.faces.length===2){const signs=e.faces.map(fi=>{const f=m.faces[fi],i=f.indexOf(e.a);return f[(i+1)%f.length]===e.b?1:-1;});if(signs[0]===signs[1])orientationConflicts++;}
    const openAdj=new Map();for(const e of t.edges.values())if(e.faces.length===1)for(const [a,b]of [[e.a,e.b],[e.b,e.a]]){if(!openAdj.has(a))openAdj.set(a,[]);openAdj.get(a).push(b);}let boundaryLoops=0;const openSeen=new Set();for(const root of openAdj.keys())if(!openSeen.has(root)){boundaryLoops++;const queue=[root];openSeen.add(root);for(let q=0;q<queue.length;q++)for(const v of openAdj.get(queue[q]))if(!openSeen.has(v)){openSeen.add(v);queue.push(v);}}
    const b=bounds(m),epsilon=b.diagonal*b.diagonal*1e-14,degenerate=t.data.filter(d=>d.area<=epsilon).length,nonmanifold=[...t.edges.values()].filter(e=>e.faces.length>2).length;
    return {vertices:m.vertices.length,faces:m.faces.length,triangles:m.faces.reduce((s,f)=>s+f.length-2,0),quads:m.faces.filter(f=>f.length===4).length,boundaryLoops,boundaryEdges:[...t.edges.values()].filter(e=>e.faces.length===1).length,nonmanifold,nonmanifoldVertices,degenerate,orientationConflicts,components:components.length,euler:components.map(c=>c.euler).sort((a,b)=>a-b),area:t.data.reduce((s,d)=>s+d.area,0),volume,diagonal:b.diagonal,finite:m.vertices.every(p=>p.every(Number.isFinite)),valid:!degenerate&&!nonmanifold&&!nonmanifoldVertices&&!orientationConflicts};
  }
  function validate(input){if(!input||!Array.isArray(input.vertices)||!Array.isArray(input.faces)||!input.vertices.length||!input.faces.length)throw Error('需要 vertices 与 faces 数组的非空网格。');if(input.vertices.length>2000000||input.faces.length>3500000)throw Error('本版上限200万顶点、350万面，请先按部件导出。');for(const p of input.vertices)if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))throw Error('顶点必须是三个有限数值。');for(const f of input.faces)if(!Array.isArray(f)||f.length<3||f.length>128||new Set(f).size!==f.length||f.some(i=>!Number.isInteger(i)||i<0||i>=input.vertices.length))throw Error('面索引无效、重复或超过128边。');const m=copy(input);if(bounds(m).diagonal<1e-12)throw Error('物体尺寸为零。');return m;}
  function orient(m){m=copy(m);const t=topology(m),flips=new Map();for(let start=0;start<m.faces.length;start++)if(!flips.has(start)){const queue=[start];flips.set(start,false);for(let q=0;q<queue.length;q++){const fi=queue[q],f=m.faces[fi];for(let j=0;j<f.length;j++){const a=f[j],b=f[(j+1)%f.length],e=t.edges.get(key(a,b));if(e.faces.length!==2)continue;const other=e.faces.find(x=>x!==fi),of=m.faces[other],k=of.indexOf(a),same=of[(k+1)%of.length]===b,want=flips.get(fi)!==same;if(flips.has(other)){if(flips.get(other)!==want)throw Error('网格不可定向。');}else{flips.set(other,want);queue.push(other);}}}const volume=queue.reduce((s,fi)=>{const f=flips.get(fi)?m.faces[fi].slice().reverse():m.faces[fi];for(let i=1;i<f.length-1;i++)s+=dot(m.vertices[f[0]],cross(m.vertices[f[i]],m.vertices[f[i+1]]))/6;return s;},0);const closed=queue.every(fi=>m.faces[fi].every((v,j)=>t.edges.get(key(v,m.faces[fi][(j+1)%m.faces[fi].length])).faces.length===2));for(const fi of queue)if(flips.get(fi)!==(closed&&volume<0))m.faces[fi].reverse();}return m;}
  function frame(m){const t=topology(m),total=t.data.reduce((s,d)=>s+d.area,0),center=t.data.reduce((s,d)=>add(s,mul(d.center,d.area/total)),[0,0,0]),cov=Array.from({length:3},()=>[0,0,0]),weights=m.vertices.map(()=>0);m.faces.forEach((f,i)=>f.forEach(v=>weights[v]+=t.data[i].area/f.length));m.vertices.forEach((p,i)=>{const d=sub(p,center);for(let a=0;a<3;a++)for(let b=0;b<3;b++)cov[a][b]+=weights[i]*d[a]*d[b]/total;});const v=[[1,0,0],[0,1,0],[0,0,1]];for(let n=0;n<32;n++){let a=0,b=1;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(cov[i][j])>Math.abs(cov[a][b])){a=i;b=j;}if(Math.abs(cov[a][b])<1e-14*total)break;const angle=.5*Math.atan2(2*cov[a][b],cov[b][b]-cov[a][a]),c=Math.cos(angle),s=Math.sin(angle);for(let k=0;k<3;k++){const x=cov[k][a],y=cov[k][b];cov[k][a]=c*x-s*y;cov[k][b]=s*x+c*y;}for(let k=0;k<3;k++){const x=cov[a][k],y=cov[b][k];cov[a][k]=c*x-s*y;cov[b][k]=s*x+c*y;const x2=v[k][a],y2=v[k][b];v[k][a]=c*x2-s*y2;v[k][b]=s*x2+c*y2;}}
    const order=[0,1,2].sort((a,b)=>cov[b][b]-cov[a][a]),axes=order.map(i=>v.map(row=>row[i]));for(let k=0;k<2;k++){let best=0,projection=0;for(const p of m.vertices){const q=dot(sub(p,center),axes[k]);if(Math.abs(q)>best){best=Math.abs(q);projection=q;}}if(projection<0)axes[k]=mul(axes[k],-1);}axes[2]=unit(cross(axes[0],axes[1]));const local=m.vertices.map(p=>axes.map(a=>dot(sub(p,center),a)));let scale=0;for(let k=0;k<3;k++){let mn=Infinity,mx=-Infinity;for(const p of local){if(p[k]<mn)mn=p[k];if(p[k]>mx)mx=p[k];}if(mx-mn>scale)scale=mx-mn;}return {center,axes,scale,local,weights,toWorld:p=>add(center,axes.reduce((s,a,i)=>add(s,mul(a,p[i])),[0,0,0]))};
  }
  function box(m,trim=.005){const f=frame(m),lo=[],hi=[];for(let k=0;k<3;k++){const values=f.local.map((p,i)=>[p[k],f.weights[i]]).sort((a,b)=>a[0]-b[0]),total=values.reduce((s,p)=>s+p[1],0),quantile=q=>{let sum=0;for(const [v,w]of values){sum+=w;if(sum>=q*total)return v;}return values.at(-1)[0];};lo[k]=quantile(trim);hi[k]=quantile(1-trim);}const vertices=Array.from({length:8},(_,i)=>f.toWorld([i&1?hi[0]:lo[0],i&2?hi[1]:lo[1],i&4?hi[2]:lo[2]])),faces=[[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]];return {...orient({vertices,faces}),method:'面积主方向包围长方体',trim};}
  function weightedMedian(items){items=items.slice().sort((a,b)=>a[0]-b[0]);const half=items.reduce((s,x)=>s+x[1],0)/2;let total=0;for(const [v,w]of items){total+=w;if(total>=half)return v;}return items.at(-1)?.[0]??0;}
  function detect(m,options={},progress=()=>{}){
    const t=topology(m),f=frame(m),scale=f.scale,ratio=options.areaRatio??1.8,change=options.curvatureDifference??.35,floor=options.curvatureFloor??.5,divisions=[1,4,16,64],faceCurvature=t.data.map(()=>0),faceWeight=t.data.map(()=>0),hinges=new Map();
    for(const [k,e]of t.edges)if(e.faces.length===2){const [a,b]=e.faces,angle=Math.acos(clamp(dot(t.data[a].normal,t.data[b].normal),-1,1)),width=dist(t.data[a].center,t.data[b].center),h=angle*scale/Math.max(width,scale*1e-8);hinges.set(k,h);for(const fi of e.faces){faceCurvature[fi]+=h*t.data[fi].area;faceWeight[fi]+=t.data[fi].area;}}
    faceCurvature.forEach((v,i)=>faceCurvature[i]=v/(faceWeight[i]||1));let candidates=[...t.edges.entries()].filter(([k,e])=>e.faces.length===2&&Math.max(...e.faces.map(i=>t.data[i].area))/Math.max(1e-30,Math.min(...e.faces.map(i=>t.data[i].area)))>=ratio);const denseSculptFilter=m.faces.length>12000&&candidates.length>4000;if(denseSculptFilter){candidates=candidates.filter(([,e])=>dot(t.data[e.faces[0]].normal,t.data[e.faces[1]].normal)<0.9397).sort(([,ea],[,eb])=>(Math.max(t.data[eb.faces[0]].area,t.data[eb.faces[1]].area)/Math.max(1e-30,Math.min(t.data[eb.faces[0]].area,t.data[eb.faces[1]].area)))-(Math.max(t.data[ea.faces[0]].area,t.data[ea.faces[1]].area)/Math.max(1e-30,Math.min(t.data[ea.faces[0]].area,t.data[ea.faces[1]].area)))).slice(0,2500);}const levels=[];let visits=0;
    const symmetry=options._symmetry,mirror=symmetry?.halfEligible?symmetry.mapping.vertices:null;let mirroredNeighborhoods=0;
    const localCenters=t.data.map(d=>f.axes.map(a=>dot(sub(d.center,f.center),a))),visitCap=m.faces.length>12000?2500000:4000000,gracefulDenseCap=m.faces.length>12000;
    for(const division of divisions){let accepted=[],unknown=[],metrics={},width=scale/division,evaluated=new Map();
      for(const [edgeKey,e]of candidates){if(gracefulDenseCap&&visits>=visitCap){unknown.push(edgeKey);continue;}const paired=mirror?key(mirror[e.a],mirror[e.b]):null;if(paired!==edgeKey&&evaluated.has(paired)){const prior=evaluated.get(paired);if(prior===null)unknown.push(edgeKey);else{metrics[edgeKey]={...structuredClone(prior.metrics),mirroredFrom:paired};if(prior.accepted)accepted.push(edgeKey);}evaluated.set(edgeKey,prior);mirroredNeighborhoods++;continue;}const origin=mul(add(m.vertices[e.a],m.vertices[e.b]),.5),normal=unit(add(...e.faces.map(i=>t.data[i].normal))),across=unit(cross(normal,sub(m.vertices[e.b],m.vertices[e.a]))),originLocal=f.axes.map(a=>dot(sub(origin,f.center),a)),cube=originLocal.map(x=>Math.floor(x/width)*width+width/2),sides=[];
        for(const seed of e.faces){const sign=Math.sign(dot(sub(t.data[seed].center,origin),across));if(!sign){sides.push(null);continue;}const queue=[seed],seen=new Set(queue),pool=[];let truncated=false;for(let q=0;q<queue.length;q++){if(pool.length>=256){truncated=true;break;}if(++visits>visitCap){if(gracefulDenseCap){truncated=true;break;}throw Error('边界邻域访问超过上限，请分部件或提高面积比阈值。');}const i=queue[q],d=t.data[i];if(i!==seed&&(dot(d.normal,t.data[seed].normal)<.5||dot(sub(d.center,origin),across)*sign<=0||division!==1&&localCenters[i].some((v,k)=>Math.abs(v-cube[k])>width*1.5)))continue;pool.push(i);for(const j of t.adj[i])if(!seen.has(j)&&dist(t.data[j].center,origin)<(division===1?scale*3:width*3)){seen.add(j);queue.push(j);}}
          const ids=new Set(pool),internal=[];for(const i of pool){const face=m.faces[i];for(let j=0;j<face.length;j++){const k=key(face[j],face[(j+1)%face.length]),edge=t.edges.get(k);if(k!==edgeKey&&edge.faces.length===2&&edge.faces.every(x=>ids.has(x))&&i===edge.faces[0])internal.push(k);}}
          if(truncated||pool.length<3||!internal.length){sides.push(null);continue;}const axis=unit(sub(m.vertices[m.faces[seed][1]],m.vertices[m.faces[seed][0]])),second=unit(cross(t.data[seed].normal,axis));let aa=0,ab=0,bb=0;const weights=pool.map(i=>{const delta=sub(t.data[i].center,t.data[seed].center),x=dot(delta,axis),y=dot(delta,second),w=t.data[i].area*Math.exp(-(dist(t.data[i].center,origin)**2)/(Math.max(width*.9,scale*.01)**2));aa+=w*x*x;ab+=w*x*y;bb+=w*y*y;return [i,w];});if(aa*bb-ab*ab<=1e-8*(aa+bb)**2){sides.push(null);continue;}const rep=weightedMedian(weights.map(([i,w])=>[t.data[i].area,w])),sum=internal.reduce((s,k)=>s+t.edges.get(k).faces.reduce((s,i)=>s+t.data[i].area,0),0),curvature=internal.reduce((s,k)=>s+hinges.get(k)*t.edges.get(k).faces.reduce((s,i)=>s+t.data[i].area,0),0)/(sum||1);sides.push({area:rep,curvature,faces:pool.length,hinges:internal.length});
        }
        if(sides.some(s=>!s)){unknown.push(edgeKey);evaluated.set(edgeKey,null);continue;}const areaRatio=Math.max(...sides.map(s=>s.area))/Math.max(1e-30,Math.min(...sides.map(s=>s.area))),hi=Math.max(...sides.map(s=>s.curvature)),lo=Math.min(...sides.map(s=>s.curvature)),difference=(hi-lo)/Math.max(hi,floor);metrics[edgeKey]={areaRatio,curvatureDifference:difference,sideCurvatures:sides.map(s=>s.curvature),sideFaces:sides.map(s=>s.faces)};const passed=areaRatio>=ratio&&difference>=change&&hi>=floor;if(passed)accepted.push(edgeKey);evaluated.set(edgeKey,{metrics:metrics[edgeKey],accepted:passed});
      }
      if(denseSculptFilter&&accepted.length){const filtered=structuralRuns(m,accepted,.08).keys;accepted=filtered.length>=8?filtered:[];}
      const groups=new Int32Array(m.faces.length).fill(-1),barrier=new Set(accepted);let count=0;for(let i=0;i<m.faces.length;i++)if(groups[i]<0){const queue=[i];groups[i]=count;for(let q=0;q<queue.length;q++){const fi=queue[q],face=m.faces[fi];for(let j=0;j<face.length;j++){const k=key(face[j],face[(j+1)%face.length]);if(barrier.has(k))continue;for(const other of t.edges.get(k).faces)if(groups[other]<0){groups[other]=count;queue.push(other);}}}count++;}
      levels.push({division,accepted,unknown,metrics,groups:Array.from(groups),groupCount:count});progress('边界窗口 '+division+' / 64');
    }
    return {levels,curvature:faceCurvature,sourceFingerprint:fingerprint(m),candidateCount:candidates.length,visits,symmetryReuse:{enabled:!!mirror,mirroredNeighborhoods,artificialSeam:false},patchFaceBudget:256,rule:'同一源网格：直接面积比 AND 邻域面积比 AND 曲率差；缺少双侧证据或邻域超过256面预算标未知'};
  }
  function triangulate(m){const faces=[],source=[];m.faces.forEach((f,fi)=>{if(f.length===3){faces.push(f.slice());source.push(fi);return;}const normal=faceData(m,f).normal,u=unit(sub(m.vertices[f[1]],m.vertices[f[0]])),v=unit(cross(normal,u)),coords=f.map(i=>{const p=sub(m.vertices[i],m.vertices[f[0]]);return [dot(p,u),dot(p,v)];}),signed=coords.reduce((s,p,i)=>s+p[0]*coords[(i+1)%f.length][1]-p[1]*coords[(i+1)%f.length][0],0),sign=Math.sign(signed),ids=f.map((_,i)=>i),turn=(a,b,c)=>(coords[b][0]-coords[a][0])*(coords[c][1]-coords[a][1])-(coords[b][1]-coords[a][1])*(coords[c][0]-coords[a][0]);if(f.length===4&&ids.every((v,i)=>turn(v,ids[(i+1)%4],ids[(i+2)%4])*sign>1e-16)){faces.push([f[0],f[1],f[2]],[f[0],f[2],f[3]]);source.push(fi,fi);return;}let guard=0;while(ids.length>3&&guard++<f.length*f.length){let found=false;for(let j=0;j<ids.length;j++){const a=ids[(j+ids.length-1)%ids.length],b=ids[j],c=ids[(j+1)%ids.length];if(turn(a,b,c)*sign<=1e-16)continue;if(ids.some(x=>x!==a&&x!==b&&x!==c&&turn(a,b,x)*sign>=-1e-16&&turn(b,c,x)*sign>=-1e-16&&turn(c,a,x)*sign>=-1e-16))continue;faces.push([f[a],f[b],f[c]]);source.push(fi);ids.splice(j,1);found=true;break;}if(!found)throw Error('无法三角化凹面，请在建模软件里检查自交或重复点。');}if(ids.length===3){faces.push(ids.map(i=>f[i]));source.push(fi);}});return {vertices:m.vertices.map(p=>p.slice()),faces,source};}
  class Heap{constructor(){this.a=[];}push(v){const a=this.a;a.push(v);let i=a.length-1;while(i){const j=(i-1)>>1;if(a[j].cost<=v.cost)break;a[i]=a[j];i=j;}a[i]=v;}pop(){const a=this.a;if(!a.length)return null;const v=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].cost<a[j].cost)j++;if(a[j].cost>=last.cost)break;a[i]=a[j];i=j;}a[i]=last;}return v;}}
  const qAdd=(a,b)=>a.map((v,i)=>v+b[i]),qValue=(q,p)=>{const v=[...p,1];return q.reduce((s,x,i)=>s+x*v[i>>2]*v[i%4],0);};
  function solve3(a,b){const m=a.map((r,i)=>[...r,b[i]]);for(let i=0;i<3;i++){let best=i;for(let j=i+1;j<3;j++)if(Math.abs(m[j][i])>Math.abs(m[best][i]))best=j;if(Math.abs(m[best][i])<1e-12)return null;[m[i],m[best]]=[m[best],m[i]];const v=m[i][i];for(let k=i;k<4;k++)m[i][k]/=v;for(let j=0;j<3;j++)if(j!==i){const x=m[j][i];for(let k=i;k<4;k++)m[j][k]-=x*m[i][k];}}return m.map(r=>r[3]);}
  // 清理原始雕刻高模：焊接零面积狭长面片最短边（避免破洞），去重与多余非流形边面
  function cleanSculptMesh(input,scale=bounds(input).diagonal){
    const verts=input.vertices,tris=[];
    for(const f of input.faces){if(f.length===3)tris.push(f);else for(let i=1;i<f.length-1;i++)tris.push([f[0],f[i],f[i+1]]);}
    const parent=Int32Array.from({length:verts.length},(_,i)=>i),find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
    const epsA2=(scale*scale*1e-13)**2,dist2=(a,b)=>{const u=verts[a],v=verts[b];return (u[0]-v[0])**2+(u[1]-v[1])**2+(u[2]-v[2])**2;};
    let weldedSlivers=0;
    for(let fi=0;fi<tris.length;fi++){
      const f=tris[fi],i0=find(f[0]),i1=find(f[1]),i2=find(f[2]);
      if(i0===i1||i1===i2||i2===i0)continue;
      const a=verts[i0],b=verts[i1],c=verts[i2];
      const nx=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),nz=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      if(nx*nx+ny*ny+nz*nz<=epsA2){
        weldedSlivers++;const d01=dist2(i0,i1),d12=dist2(i1,i2),d20=dist2(i2,i0);
        if(d01<=d12&&d01<=d20)parent[Math.max(i0,i1)]=Math.min(i0,i1);
        else if(d12<=d20)parent[Math.max(i1,i2)]=Math.min(i1,i2);
        else parent[Math.max(i2,i0)]=Math.min(i2,i0);
      }
    }
    const stride=Math.max(1,verts.length+1),eKey=(a,b)=>a<b?a*stride+b:b*stride+a;
    const fSet=new Set(),edgeMap=new Map(),tempF=[];
    for(let fi=0;fi<tris.length;fi++){
      const f=tris[fi],a=find(f[0]),b=find(f[1]),c=find(f[2]);
      if(a===b||b===c||c===a)continue;
      const m0=Math.min(a,b,c),m2=Math.max(a,b,c),m1=a+b+c-m0-m2,fk=`${m0}:${m1}:${m2}`;
      if(fSet.has(fk))continue;fSet.add(fk);const id=tempF.length;tempF.push([a,b,c]);
      for(const [u,v]of [[a,b],[b,c],[c,a]]){const k=eKey(u,v);let l=edgeMap.get(k);if(!l){l=[];edgeMap.set(k,l);}l.push(id);}
    }
    const drop=new Uint8Array(tempF.length);let droppedNonManifold=0;
    for(const l of edgeMap.values())if(l.length>2)for(let i=2;i<l.length;i++)if(!drop[l[i]]){drop[l[i]]=1;droppedNonManifold++;}
    const remap=new Int32Array(verts.length).fill(-1),outV=[],outF=[];
    for(let fi=0;fi<tempF.length;fi++){if(drop[fi])continue;const f=tempF[fi];outF.push(f.map(v=>{if(remap[v]<0){remap[v]=outV.length;outV.push(verts[v].slice());}return remap[v];}));}
    return {mesh:{vertices:outV,faces:outF},stats:{inputFaces:tris.length,cleanedFaces:outF.length,weldedSlivers,droppedNonManifold}};
  }
  // 高性能类型化数组 QEM 三角网格减面（适用于十万至百万级高模）
  function fastQEM(mesh,targetTris,scale=bounds(mesh).diagonal,options={}){
    const cosLimit=options.cosLimit??0.05,maxError=options.maxError??0.25,lockedKeys=options.lockedKeys||[];
    const areaPower=options.areaPower??1,regularization=options.positionRegularization??0;
    const tri=mesh.faces.every(f=>f.length===3)?mesh:triangulate(mesh);
    const V=tri.vertices.length,F=tri.faces.length,px=new Float64Array(V),py=new Float64Array(V),pz=new Float64Array(V);
    for(let i=0;i<V;i++){px[i]=tri.vertices[i][0];py[i]=tri.vertices[i][1];pz[i]=tri.vertices[i][2];}
    const q=new Float64Array(V*10),vVer=new Int32Array(V),vDead=new Uint8Array(V),vLocked=new Uint8Array(V),vFaces=Array.from({length:V},()=>[]);
    for(const k of lockedKeys){const [a,b]=k.split(':').map(Number);if(Number.isInteger(a)&&a>=0&&a<V)vLocked[a]=1;if(Number.isInteger(b)&&b>=0&&b<V)vLocked[b]=1;}
    const f0=new Int32Array(F),f1=new Int32Array(F),f2=new Int32Array(F),fDead=new Uint8Array(F);
    for(let fi=0;fi<F;fi++){
      const [a,b,c]=tri.faces[fi];f0[fi]=a;f1[fi]=b;f2[fi]=c;vFaces[a].push(fi);vFaces[b].push(fi);vFaces[c].push(fi);
      const ux=px[b]-px[a],uy=py[b]-py[a],uz=pz[b]-pz[a],vx=px[c]-px[a],vy=py[c]-py[a],vz=pz[c]-pz[a];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz);
      if(l<=1e-24){fDead[fi]=1;continue;}
      const area=(0.5*l)**areaPower,inv=1/l,Nx=nx*inv,Ny=ny*inv,Nz=nz*inv,D=-(Nx*px[a]+Ny*py[a]+Nz*pz[a]);
      const aa=area*Nx*Nx,ab=area*Nx*Ny,ac=area*Nx*Nz,ad=area*Nx*D,bb=area*Ny*Ny,bc=area*Ny*Nz,bd=area*Ny*D,cc=area*Nz*Nz,cd=area*Nz*D,dd=area*D*D;
      for(const vi of [a,b,c]){const o=vi*10;q[o]+=aa;q[o+1]+=ab;q[o+2]+=ac;q[o+3]+=ad;q[o+4]+=bb;q[o+5]+=bc;q[o+6]+=bd;q[o+7]+=cc;q[o+8]+=cd;q[o+9]+=dd;}
    }
    // 为小面积特征保留误差权重，并在局部位置附近约束收线，避免长尖面穿过轮廓。
    if(regularization>0)for(let i=0;i<V;i++){
      const o=i*10,w=(q[o]+q[o+4]+q[o+7])*regularization;
      q[o]+=w;q[o+4]+=w;q[o+7]+=w;
      q[o+3]-=w*px[i];q[o+6]-=w*py[i];q[o+8]-=w*pz[i];
      q[o+9]+=w*(px[i]**2+py[i]**2+pz[i]**2);
    }
    const stride=Math.max(1,V+1),eCount=new Map();
    for(let fi=0;fi<F;fi++){
      if(fDead[fi])continue;const vs=[f0[fi],f1[fi],f2[fi]];
      for(let j=0;j<3;j++){let a=vs[j],b=vs[(j+1)%3];if(a>b){const t=a;a=b;b=t;}const k=a*stride+b;eCount.set(k,(eCount.get(k)||0)+1);}
    }
    for(const [k,c]of eCount)if(c===1){vLocked[Math.floor(k/stride)]=1;vLocked[k%stride]=1;}
    let hLen=0,hCap=Math.max(64,F*3+16);
    let hA=new Int32Array(hCap),hB=new Int32Array(hCap),hAv=new Int32Array(hCap),hBv=new Int32Array(hCap);
    let hX=new Float64Array(hCap),hY=new Float64Array(hCap),hZ=new Float64Array(hCap),hCost=new Float64Array(hCap);
    const ensureHeap=()=>{if(hLen<hCap)return;hCap=Math.floor(hCap*1.5);const gi=a=>{const b=new Int32Array(hCap);b.set(a);return b;},gf=a=>{const b=new Float64Array(hCap);b.set(a);return b;};hA=gi(hA);hB=gi(hB);hAv=gi(hAv);hBv=gi(hBv);hX=gf(hX);hY=gf(hY);hZ=gf(hZ);hCost=gf(hCost);};
    const swap=(i,j)=>{let t=hA[i];hA[i]=hA[j];hA[j]=t;t=hB[i];hB[i]=hB[j];hB[j]=t;t=hAv[i];hAv[i]=hAv[j];hAv[j]=t;t=hBv[i];hBv[i]=hBv[j];hBv[j]=t;let tf=hX[i];hX[i]=hX[j];hX[j]=tf;tf=hY[i];hY[i]=hY[j];hY[j]=tf;tf=hZ[i];hZ[i]=hZ[j];hZ[j]=tf;tf=hCost[i];hCost[i]=hCost[j];hCost[j]=tf;};
    const push=(a,b,av,bv,x,y,z,cost)=>{ensureHeap();let i=hLen++;hA[i]=a;hB[i]=b;hAv[i]=av;hBv[i]=bv;hX[i]=x;hY[i]=y;hZ[i]=z;hCost[i]=cost;while(i>0){const p=(i-1)>>1;if(hCost[p]<=hCost[i])break;swap(p,i);i=p;}};
    const pop=()=>{const out=[hA[0],hB[0],hAv[0],hBv[0],hX[0],hY[0],hZ[0]];const last=--hLen;if(last>0){hA[0]=hA[last];hB[0]=hB[last];hAv[0]=hAv[last];hBv[0]=hBv[last];hX[0]=hX[last];hY[0]=hY[last];hZ[0]=hZ[last];hCost[0]=hCost[last];let i=0;while(i*2+1<hLen){let j=i*2+1;if(j+1<hLen&&hCost[j+1]<hCost[j])j++;if(hCost[i]<=hCost[j])break;swap(i,j);i=j;}}return out;};
    const evalQ=(o0,o1,x,y,z)=>{const aa=q[o0]+q[o1],ab=q[o0+1]+q[o1+1],ac=q[o0+2]+q[o1+2],ad=q[o0+3]+q[o1+3],bb=q[o0+4]+q[o1+4],bc=q[o0+5]+q[o1+5],bd=q[o0+6]+q[o1+6],cc=q[o0+7]+q[o1+7],cd=q[o0+8]+q[o1+8],dd=q[o0+9]+q[o1+9];return Math.max(0,aa*x*x+bb*y*y+cc*z*z+dd+2*(ab*x*y+ac*x*z+ad*x+bc*y*z+bd*y+cd*z));};
    const addCandidate=(a,b)=>{
      if(a>b){const t=a;a=b;b=t;}
      if(vDead[a]||vDead[b]||(vLocked[a]&&vLocked[b]))return;
      const o0=a*10,o1=b*10,mx=0.5*(px[a]+px[b]),my=0.5*(py[a]+py[b]),mz=0.5*(pz[a]+pz[b]);
      let bx,by,bz,bc;
      if(vLocked[a]){bx=px[a];by=py[a];bz=pz[a];bc=evalQ(o0,o1,bx,by,bz);}
      else if(vLocked[b]){bx=px[b];by=py[b];bz=pz[b];bc=evalQ(o0,o1,bx,by,bz);}
      else{
        bx=mx;by=my;bz=mz;bc=evalQ(o0,o1,mx,my,mz);
        const ca=evalQ(o0,o1,px[a],py[a],pz[a]);if(ca<bc){bc=ca;bx=px[a];by=py[a];bz=pz[a];}
        const cb=evalQ(o0,o1,px[b],py[b],pz[b]);if(cb<bc){bc=cb;bx=px[b];by=py[b];bz=pz[b];}
        const a00=q[o0]+q[o1],a01=q[o0+1]+q[o1+1],a02=q[o0+2]+q[o1+2],b0=-(q[o0+3]+q[o1+3]),a11=q[o0+4]+q[o1+4],a12=q[o0+5]+q[o1+5],b1=-(q[o0+6]+q[o1+6]),a22=q[o0+7]+q[o1+7],b2=-(q[o0+8]+q[o1+8]);
        const det=a00*(a11*a22-a12*a12)-a01*(a01*a22-a12*a02)+a02*(a01*a12-a11*a02);
        if(Math.abs(det)>1e-18*((a00+a11+a22)**3+1e-30)){
          const sx=(b0*(a11*a22-a12*a12)-a01*(b1*a22-a12*b2)+a02*(b1*a12-a11*b2))/det,sy=(a00*(b1*a22-a12*b2)-b0*(a01*a22-a12*a02)+a02*(a01*b2-b1*a02))/det,sz=(a00*(a11*b2-b1*a12)-a01*(a01*b2-b1*a02)+b0*(a01*a12-a11*a02))/det;
          const el=Math.hypot(px[b]-px[a],py[b]-py[a],pz[b]-pz[a]);
          if(Math.hypot(sx-mx,sy-my,sz-mz)<el*1.1){const cs=evalQ(o0,o1,sx,sy,sz);if(cs<bc){bc=cs;bx=sx;by=sy;bz=sz;}}
        }
      }
      push(a,b,vVer[a],vVer[b],bx,by,bz,bc);
    };
    for(const [k,c]of eCount)if(c===2)addCandidate(Math.floor(k/stride),k%stride);
    let liveTris=F;for(let i=0;i<F;i++)if(fDead[i])liveTris--;
    const epsArea2=(scale*scale*1e-14)**2,maxErr=scale*maxError,nbrA=new Set(),nbrB=new Set(),futureKeys=new Set();
    while(liveTris>targetTris&&hLen>0){
      const [a,b,av,bv,nx,ny,nz]=pop();
      if(vDead[a]||vDead[b]||vVer[a]!==av||vVer[b]!==bv)continue;
      if(Math.hypot(nx-px[a],ny-py[a],nz-pz[a])>maxErr||Math.hypot(nx-px[b],ny-py[b],nz-pz[b])>maxErr)continue;
      const fa=vFaces[a],fb=vFaces[b];nbrA.clear();nbrB.clear();let pairCount=0;
      for(let i=0;i<fa.length;i++){const fi=fa[i];if(fDead[fi])continue;const x=f0[fi],y=f1[fi],z=f2[fi];if(x===b||y===b||z===b)pairCount++;if(x!==a)nbrA.add(x);if(y!==a)nbrA.add(y);if(z!==a)nbrA.add(z);}
      for(let i=0;i<fb.length;i++){const fi=fb[i];if(fDead[fi])continue;const x=f0[fi],y=f1[fi],z=f2[fi];if(x!==b)nbrB.add(x);if(y!==b)nbrB.add(y);if(z!==b)nbrB.add(z);}
      let shared=0;for(const v of nbrA)if(nbrB.has(v))shared++;
      if(pairCount!==2||shared!==2)continue;
      let ok=true;futureKeys.clear();
      for(const list of [fa,fb]){
        for(let i=0;i<list.length;i++){
          const fi=list[i];if(fDead[fi])continue;const x=f0[fi],y=f1[fi],z=f2[fi];
          if((x===a||y===a||z===a)&&(x===b||y===b||z===b))continue;
          const rx=x===b?a:x,ry=y===b?a:y,rz=z===b?a:z,m0=Math.min(rx,ry,rz),m2=Math.max(rx,ry,rz),m1=rx+ry+rz-m0-m2,fk=`${m0}:${m1}:${m2}`;
          if(futureKeys.has(fk)){ok=false;break;}futureKeys.add(fk);
          const Ax=x===a||x===b?nx:px[x],Ay=x===a||x===b?ny:py[x],Az=x===a||x===b?nz:pz[x];
          const Bx=y===a||y===b?nx:px[y],By=y===a||y===b?ny:py[y],Bz=y===a||y===b?nz:pz[y];
          const Cx=z===a||z===b?nx:px[z],Cy=z===a||z===b?ny:py[z],Cz=z===a||z===b?nz:pz[z];
          const ux=Bx-Ax,uy=By-Ay,uz=Bz-Az,vx=Cx-Ax,vy=Cy-Ay,vz=Cz-Az,cnx=uy*vz-uz*vy,cny=uz*vx-ux*vz,cnz=ux*vy-uy*vx,cl=Math.hypot(cnx,cny,cnz);
          if(cl*cl<epsArea2){ok=false;break;}
          const ox1=px[y]-px[x],oy1=py[y]-py[x],oz1=pz[y]-pz[x],ox2=px[z]-px[x],oy2=py[z]-py[x],oz2=pz[z]-pz[x],onx=oy1*oz2-oz1*oy2,ony=oz1*ox2-ox1*oz2,onz=ox1*oy2-oy1*ox2,ol=Math.hypot(onx,ony,onz);
          if((cnx*onx+cny*ony+cnz*onz)/(cl*(ol||1))<cosLimit){ok=false;break;}
        }
        if(!ok)break;
      }
      if(!ok)continue;
      px[a]=nx;py[a]=ny;pz[a]=nz;if(vLocked[b])vLocked[a]=1;
      const o0=a*10,o1=b*10;for(let k=0;k<10;k++)q[o0+k]+=q[o1+k];vDead[b]=1;
      const nextFa=[];
      for(let i=0;i<fa.length;i++){const fi=fa[i];if(fDead[fi])continue;if(f0[fi]===b||f1[fi]===b||f2[fi]===b){fDead[fi]=1;liveTris--;}else nextFa.push(fi);}
      for(let i=0;i<fb.length;i++){const fi=fb[i];if(fDead[fi])continue;if(f0[fi]===a||f1[fi]===a||f2[fi]===a){fDead[fi]=1;liveTris--;}else{if(f0[fi]===b)f0[fi]=a;if(f1[fi]===b)f1[fi]=a;if(f2[fi]===b)f2[fi]=a;nextFa.push(fi);}}
      vFaces[a]=nextFa;vFaces[b]=[];vVer[a]++;
      for(const v of nbrA)if(!vDead[v])addCandidate(a,v);
      for(const v of nbrB)if(!vDead[v]&&!nbrA.has(v))addCandidate(a,v);
    }
    const map=new Int32Array(V).fill(-1),outV=[],outF=[];
    for(let fi=0;fi<F;fi++){if(fDead[fi])continue;outF.push([f0[fi],f1[fi],f2[fi]].map(v=>{if(map[v]<0){map[v]=outV.length;outV.push([px[v],py[v],pz[v]]);}return map[v];}));}
    return {vertices:outV,faces:outF,simplification:{target:targetTris,actual:outF.length,metTarget:outF.length<=targetTris}};
  }
  function prepareWorkingSource(original,progress=()=>{}){
    const rawTris=original.faces.reduce((s,f)=>s+f.length-2,0),diag=bounds(original).diagonal;
    if(original.vertices.length<=120000&&original.faces.length<=180000){
      try{
        const oriented=orient(original),h=audit(oriented);
        if(h.valid)return {source:oriented,health:h,analysisProxy:false,cleanStats:null,rawStats:{vertices:original.vertices.length,faces:original.faces.length,triangles:rawTris}};
      }catch(e){if(e?.message!=='网格不可定向')throw e;}
      progress('清理原网格零面积狭长面与非流形边');
      const cleaned=cleanSculptMesh(original,diag),source=orient(cleaned.mesh),h=audit(source);
      if(!h.valid)throw Error('源网格存在退化面、非流形边或定向冲突，请先清理；原件未改。');
      return {source,health:h,analysisProxy:true,cleanStats:cleaned.stats,rawStats:{vertices:original.vertices.length,faces:original.faces.length,triangles:rawTris}};
    }
    progress('清理高模退化片并构建工作分析副本');
    const cleaned=cleanSculptMesh(original,diag),oriented=orient(cleaned.mesh),targetProxy=30000;
    const proxy=cleaned.mesh.faces.length>targetProxy?orient(fastQEM(oriented,targetProxy,diag,{cosLimit:0.05,maxError:0.25})):oriented;
    const h=audit(proxy);
    if(!h.valid)throw Error('高模工作副本清理失败，请先在建模软件清理非流形结构。');
    return {source:proxy,health:h,analysisProxy:true,cleanStats:cleaned.stats,rawStats:{vertices:original.vertices.length,faces:original.faces.length,triangles:rawTris}};
  }
  function simplify(source,target,protectedKeys=[],options={}){
    const input=triangulate(source),vertices=input.vertices.map(p=>({p:p.slice(),q:Array(16).fill(0),faces:new Set(),alive:true,version:0,locked:false,source:new Set()})),faces=input.faces.map((v,i)=>({v,alive:true,source:input.source[i]})),scale=bounds(source).diagonal,protectedVertices=new Set(protectedKeys.flatMap(k=>k.split(':').map(Number))),heap=new Heap();let count=faces.length;
    const st=topology(source);for(const e of st.edges.values())if(e.faces.length===1){protectedVertices.add(e.a);protectedVertices.add(e.b);}for(const i of protectedVertices)vertices[i].locked=true;
    faces.forEach((f,i)=>{const data=faceData(input,f.v),v=[...data.normal,-dot(data.normal,input.vertices[f.v[0]])],q=v.flatMap(x=>v.map(y=>x*y*data.area));for(const id of f.v){vertices[id].faces.add(i);vertices[id].source.add(id);vertices[id].q=qAdd(vertices[id].q,q);}});
    const neighbors=i=>{const out=new Set();for(const fi of vertices[i].faces)if(faces[fi].alive)for(const v of faces[fi].v)if(v!==i)out.add(v);return out;};
    const groups=options.faceGroups;
    const membership=v=>new Set([...v.faces].map(i=>groups[faces[i].source]));
    function candidate(a,b){
      if(a>b)[a,b]=[b,a];
      const va=vertices[a],vb=vertices[b];
      if(!va.alive||!vb.alive||va.locked&&vb.locked)return;
      const pair=[...va.faces].filter(i=>faces[i].alive&&faces[i].v.includes(b));
      if(pair.length!==2)return;
      const q=qAdd(va.q,vb.q),mid=mul(add(va.p,vb.p),.5),sol=solve3([q.slice(0,3),q.slice(4,7),q.slice(8,11)],[-q[3],-q[7],-q[11]]);
      let choices=[va.p,vb.p,mid,...sol&&dist(sol,mid)<dist(va.p,vb.p)*1.2?[sol]:[]],seam=false;
      if(groups){
        const aGroups=membership(va),bGroups=membership(vb);
        if(aGroups.size>1&&bGroups.size>1){
          // 同一共享曲线的相邻站位才能一起收线，交汇点由调用端锁定。
          if(aGroups.size!==2||bGroups.size!==2||[...aGroups].some(g=>!bGroups.has(g))||groups[faces[pair[0]].source]===groups[faces[pair[1]].source])return;
          seam=true;
          choices=[va.p,vb.p];
        }else if(aGroups.size>1){
          if(vb.locked)return;
          choices=[va.p];
        }else if(bGroups.size>1){
          if(va.locked)return;
          choices=[vb.p];
        }
      }
      if(va.locked)choices=[va.p];
      if(vb.locked)choices=[vb.p];
      const p=choices.reduce((best,p)=>qValue(q,p)<qValue(q,best)?p:best,choices[0]);
      const cost=Math.max(0,qValue(q,p))*(seam?(options.seamWeight??1):1);
      heap.push({a,b,p:p.slice(),cost,av:va.version,bv:vb.version});
    }
    for(const f of faces)for(let i=0;i<3;i++)if(f.v[i]<f.v[(i+1)%3])candidate(f.v[i],f.v[(i+1)%3]);let collapsed=0,rejected=0;const maxDistance=scale*(options.maxError??.05),cosLimit=Math.cos((options.normalLimit??65)*Math.PI/180);
    while(count>target){const item=heap.pop();if(!item)break;const {a,b,p}=item,va=vertices[a],vb=vertices[b];if(!va.alive||!vb.alive||va.version!==item.av||vb.version!==item.bv)continue;const na=neighbors(a),nb=neighbors(b),shared=[...na].filter(x=>nb.has(x)),pair=[...va.faces].filter(i=>faces[i].alive&&faces[i].v.includes(b));if(pair.length!==2||shared.length!==2){rejected++;continue;}if(dist(p,va.p)>maxDistance||dist(p,vb.p)>maxDistance){rejected++;continue;}const affected=new Set([...va.faces,...vb.faces]);let valid=true;const future=new Set();for(const fi of affected){const f=faces[fi];if(!f.alive||pair.includes(fi))continue;const ids=f.v.map(i=>i===b?a:i),ps=ids.map(i=>i===a?p:vertices[i].p),n=cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),old=f.v.map(i=>vertices[i].p),on=unit(cross(sub(old[1],old[0]),sub(old[2],old[0]))),k=ids.slice().sort((a,b)=>a-b).join(':');if(len(n)<scale*scale*1e-12||dot(unit(n),on)<cosLimit||future.has(k)){valid=false;break;}future.add(k);}if(!valid){rejected++;continue;}
      va.p=p;va.q=qAdd(va.q,vb.q);va.locked||=vb.locked;for(const s of vb.source)va.source.add(s);vb.alive=false;for(const fi of affected){const f=faces[fi];if(!f.alive)continue;for(const id of f.v)vertices[id].faces.delete(fi);if(pair.includes(fi)){f.alive=false;count--;}else{f.v=f.v.map(i=>i===b?a:i);for(const id of f.v)vertices[id].faces.add(fi);}}const touched=new Set([a,...na,...nb]);for(const id of touched)vertices[id].version++;for(const id of touched)if(vertices[id].alive)for(const other of neighbors(id))candidate(id,other);collapsed++;
    }
    const active=new Set(faces.filter(f=>f.alive).flatMap(f=>f.v)),mapping=new Map([...active].map((v,i)=>[v,i])),out={vertices:[...active].map(i=>vertices[i].p.slice()),faces:faces.filter(f=>f.alive).map(f=>f.v.map(i=>mapping.get(i))),faceSources:faces.filter(f=>f.alive).map(f=>f.source),sourceMap:[...active].map(i=>[...vertices[i].source]),method:'拓扑约束QEM；边界与结构端点锁定',simplification:{target,actual:count,metTarget:count<=target,collapsed,rejected,locked:protectedVertices.size}};return out;
  }
  function pairQuads(m,angle=18){const t=topology(m),used=new Set(),pairs=[];for(const e of t.edges.values())if(e.faces.length===2){const [a,b]=e.faces;if(m.faces[a].length!==3||m.faces[b].length!==3||dot(t.data[a].normal,t.data[b].normal)<Math.cos(angle*Math.PI/180))continue;const fa=m.faces[a],fb=m.faces[b],ring=[];for(const f of [fa,fb])for(let i=0;i<3;i++)if(key(f[i],f[(i+1)%3])!==key(e.a,e.b))ring.push([f[i],f[(i+1)%3]]);const loop=[ring[0][0]];for(let i=0;i<3;i++){const edge=ring.find(p=>p[0]===loop.at(-1));if(!edge)break;loop.push(edge[1]);}if(loop.length!==4||new Set(loop).size!==4)continue;const first=loop.indexOf(e.a);loop.push(...loop.splice(0,first));const ps=loop.map(i=>m.vertices[i]),normal=unit(add(t.data[a].normal,t.data[b].normal));if(ps.some((p,i)=>dot(cross(sub(ps[(i+1)%4],p),sub(ps[(i+2)%4],ps[(i+1)%4])),normal)<=1e-12))continue;const lengths=ps.map((p,i)=>dist(p,ps[(i+1)%4]));if(Math.max(...lengths)>Math.min(...lengths)*5)continue;pairs.push({a,b,loop,cost:1-dot(t.data[a].normal,t.data[b].normal)+Math.max(...lengths)/Math.min(...lengths)*.01});}
    const faces=[],faceSources=[];for(const p of pairs.sort((a,b)=>a.cost-b.cost))if(!used.has(p.a)&&!used.has(p.b)){used.add(p.a);used.add(p.b);faces.push(p.loop);faceSources.push(m.faceSources?.[p.a]??p.a);}m.faces.forEach((f,i)=>{if(!used.has(i)){faces.push(f.slice());faceSources.push(m.faceSources?.[i]??i);}});return {...m,faces,faceSources};
  }
  // Edmonds 最大匹配凸四边合并：保持精确三角面总预算不变，优先保留近似矩形特征四边环
  function matchQuads(input,angle=38,maxAspect=4.5,canPair=()=>true){
    const m=input.faces.every(f=>f.length===3)?copy(input):triangulate(input),t=topology(m),n=m.faces.length;
    const graph=Array.from({length:n},()=>[]),loops=new Map(),minCos=Math.cos(angle*Math.PI/180);
    for(const e of t.edges.values())if(e.faces.length===2){
      const [a,b]=e.faces;if(!canPair(a,b)||m.faces[a].length!==3||m.faces[b].length!==3)continue;
      const cos=dot(t.data[a].normal,t.data[b].normal);if(cos<minCos)continue;
      const edges=[];for(const fi of [a,b]){const f=m.faces[fi];for(let j=0;j<3;j++)if(key(f[j],f[(j+1)%3])!==key(e.a,e.b))edges.push([f[j],f[(j+1)%3]]);}
      const loop=[edges[0][0]];while(loop.length<4){const next=edges.find(p=>p[0]===loop.at(-1));if(!next)break;loop.push(next[1]);}
      if(loop.length!==4||new Set(loop).size!==4)continue;
      const normal=unit(add(t.data[a].normal,t.data[b].normal)),ps=loop.map(i=>m.vertices[i]);
      if(ps.some((p,i)=>dot(cross(sub(ps[(i+1)%4],p),sub(ps[(i+2)%4],ps[(i+1)%4])),normal)<=1e-12))continue;
      const lens=ps.map((p,i)=>dist(p,ps[(i+1)%4]));if(Math.max(...lens)>Math.min(...lens)*maxAspect)continue;
      const at=loop.indexOf(e.a),ring=[...loop.slice(at),...loop.slice(0,at)];if(ring[2]!==e.b)continue;
      loops.set(key(a,b),ring);
      let cosSum=0;for(let i=0;i<4;i++){const u=unit(sub(ps[(i+1)%4],ps[i])),v=unit(sub(ps[(i+3)%4],ps[i]));cosSum+=Math.abs(dot(u,v));}
      const cost=(1-cos)+cosSum*0.25+(Math.max(...lens)/Math.min(...lens)-1)*0.05;
      graph[a].push({v:b,cost});graph[b].push({v:a,cost});
    }
    graph.forEach(a=>a.sort((x,y)=>x.cost-y.cost));
    const match=Array(n).fill(-1),parent=Array(n),base=Array(n),used=Array(n),blossom=Array(n);
    const lca=(a,b)=>{const path=new Set();while(true){a=base[a];path.add(a);if(match[a]===-1)break;a=parent[match[a]];}while(true){b=base[b];if(path.has(b))return b;b=parent[match[b]];}};
    const mark=(v,b,child)=>{while(base[v]!==b){blossom[base[v]]=blossom[base[match[v]]]=true;parent[v]=child;child=match[v];v=parent[match[v]];}};
    function augment(root){
      used.fill(false);parent.fill(-1);for(let i=0;i<n;i++)base[i]=i;
      const queue=[root];used[root]=true;
      for(let q=0;q<queue.length;q++){
        const v=queue[q];
        for(const item of graph[v]){
          const u=item.v;if(base[v]===base[u]||match[v]===u)continue;
          if(u===root||match[u]!==-1&&parent[match[u]]!==-1){const b=lca(v,u);blossom.fill(false);mark(v,b,u);mark(u,b,v);for(let i=0;i<n;i++)if(blossom[base[i]]){base[i]=b;if(!used[i]){used[i]=true;queue.push(i);}}}
          else if(parent[u]===-1){parent[u]=v;if(match[u]===-1){let cur=u;while(cur!==-1){const p=parent[cur],next=p===-1?-1:match[p];if(p!==-1){match[cur]=p;match[p]=cur;}cur=next;}return true;}const nx=match[u];used[nx]=true;queue.push(nx);}
        }
      }
      return false;
    }
    for(let i=0;i<n;i++)if(match[i]===-1)augment(i);
    const faces=[],faceSources=[];
    for(let i=0;i<n;i++){
      if(match[i]>i){faces.push(loops.get(key(i,match[i])));faceSources.push(m.faceSources?.[i]??i);}
      else if(match[i]===-1){faces.push(m.faces[i].slice());faceSources.push(m.faceSources?.[i]??i);}
    }
    return {...m,faces,faceSources};
  }
  function quadShell(input){
    const tr=triangulate(input),m={...input,vertices:tr.vertices,faces:tr.faces,faceSources:tr.source.map(i=>input.faceSources?.[i]??i)},t=topology(m),n=m.faces.length,graph=Array.from({length:n},()=>[]),loops=new Map();
    for(const e of t.edges.values())if(e.faces.length===2){const [a,b]=e.faces,normal=unit(add(t.data[a].normal,t.data[b].normal));if(dot(t.data[a].normal,t.data[b].normal)<-.35)continue;const edges=[];for(const fi of [a,b]){const f=m.faces[fi];for(let j=0;j<3;j++)if(key(f[j],f[(j+1)%3])!==key(e.a,e.b))edges.push([f[j],f[(j+1)%3]]);}const loop=[edges[0][0]];while(loop.length<4){const next=edges.find(pair=>pair[0]===loop.at(-1));if(!next)break;loop.push(next[1]);}if(loop.length!==4||new Set(loop).size!==4)continue;const ps=loop.map(i=>m.vertices[i]);if(ps.some((p,i)=>dot(cross(sub(ps[(i+1)%4],p),sub(ps[(i+2)%4],ps[(i+1)%4])),normal)<1e-12))continue;const at=loop.indexOf(e.a),ring=[...loop.slice(at),...loop.slice(0,at)];if(ring[2]!==e.b)continue;loops.set(key(a,b),ring);const cost=1-dot(t.data[a].normal,t.data[b].normal);graph[a].push({v:b,cost});graph[b].push({v:a,cost});}
    graph.forEach(a=>a.sort((x,y)=>x.cost-y.cost));const match=Array(n).fill(-1),parent=Array(n),base=Array(n),used=Array(n),blossom=Array(n);
    function lca(a,b){const path=new Set();while(true){a=base[a];path.add(a);if(match[a]===-1)break;a=parent[match[a]];}while(true){b=base[b];if(path.has(b))return b;b=parent[match[b]];}}
    function mark(v,b,child){while(base[v]!==b){blossom[base[v]]=blossom[base[match[v]]]=true;parent[v]=child;child=match[v];v=parent[match[v]];}}
    function augment(root){used.fill(false);parent.fill(-1);for(let i=0;i<n;i++)base[i]=i;const queue=[root];used[root]=true;for(let q=0;q<queue.length;q++){const v=queue[q];for(const item of graph[v]){let u=item.v;if(base[v]===base[u]||match[v]===u)continue;if(u===root||match[u]!==-1&&parent[match[u]]!==-1){const b=lca(v,u);blossom.fill(false);mark(v,b,u);mark(u,b,v);for(let i=0;i<n;i++)if(blossom[base[i]]){base[i]=b;if(!used[i]){used[i]=true;queue.push(i);}}}else if(parent[u]===-1){parent[u]=v;if(match[u]===-1){while(u!==-1){const p=parent[u],next=p===-1?-1:match[p];if(p!==-1){match[u]=p;match[p]=u;}u=next;}return true;}u=match[u];used[u]=true;queue.push(u);}}}return false;}
    for(let i=0;i<n;i++)if(match[i]===-1)augment(i);const faces=[],faceSources=[];for(let i=0;i<n;i++){if(match[i]>i){faces.push(loops.get(key(i,match[i])));faceSources.push(m.faceSources[i]);}else if(match[i]===-1){faces.push(m.faces[i]);faceSources.push(m.faceSources[i]);}}
    if(match.every(i=>i!==-1))return {...m,faces,faceSources,method:'结构约束QEM + 邻接最大匹配全四边面',quadMethod:'相邻三角面凸四边形配对；非方向场重拓扑'};
    // Conforming fallback: every face shares its edge midpoint with its neighbor.
    const p={...m,faces,faceSources},vertices=p.vertices.map(v=>v.slice()),out=[],sources=[],midpoints=new Map();p.faces.forEach((f,fi)=>{const center=vertices.length;vertices.push(faceData(p,f).center);const mid=f.map((v,j)=>{const w=f[(j+1)%f.length],k=key(v,w);if(!midpoints.has(k)){midpoints.set(k,vertices.length);vertices.push(mul(add(p.vertices[v],p.vertices[w]),.5));}return midpoints.get(k);});f.forEach((v,j)=>{out.push([v,mid[j],center,mid[(j+f.length-1)%f.length]]);sources.push(p.faceSources[fi]);});});return {...m,vertices,faces:out,faceSources:sources,sourceMap:undefined,method:'结构约束QEM + 共享边中点四边化',quadMethod:'局部匹配不完整，采用共享边一致细分；非方向场重拓扑'};
  }
  function supportEdges(m,sourceKeys){const sourceToCurrent=new Map();m.sourceMap?.forEach((ids,i)=>ids.forEach(id=>sourceToCurrent.set(id,i)));const t=topology(m),keys=[];for(const k of sourceKeys){const [a,b]=k.split(':').map(i=>sourceToCurrent.get(Number(i)));if(a!==undefined&&b!==undefined&&a!==b&&t.edges.get(key(a,b))?.faces.length===2)keys.push(key(a,b));}return [...new Set(keys)];}
  function bevel(m,keys,width){if(!keys.length||width<=0)return {...copy(m),supportKeys:[],supportReport:{requested:keys.length,beveled:0,reason:keys.length?'宽度为零':'当前严格边界未识别出可卡线边，可在原模上手动标记'}};const t=topology(m),selected=new Set(keys),corners=[],vertices=[],faces=[],faceSources=[],flags=[],scale=bounds(m).diagonal,w=scale*width;const addFace=(ids,source,kind)=>{ids=ids.filter((id,i)=>id!==ids[(i+ids.length-1)%ids.length]);if(new Set(ids).size<3)return;faces.push(ids);faceSources.push(source);flags.push(kind);};
    const touched=new Set(keys.flatMap(k=>k.split(':').map(Number)));
    m.faces.forEach((f,fi)=>{const center=t.data[fi].center,minimum=Math.min(...f.map((v,j)=>dist(m.vertices[v],m.vertices[f[(j+1)%f.length]]))),radius=Math.max(...f.map(v=>dist(m.vertices[v],center))),amount=Math.min(.18,w/(radius||1),minimum*.12/(radius||1));corners[fi]=f.map(vi=>{const p=m.vertices[vi],q=touched.has(vi)?add(p,mul(sub(center,p),amount)):p.slice(),id=vertices.length;vertices.push(q);return id;});addFace(corners[fi],m.faceSources?.[fi]??fi,'surface');});
    const rawSupport=[];for(const e of t.edges.values())if(e.faces.length===2){const [fa,fb]=e.faces,ia=m.faces[fa].indexOf(e.a),ib=m.faces[fa].indexOf(e.b),ja=m.faces[fb].indexOf(e.a),jb=m.faces[fb].indexOf(e.b),a=corners[fa][ia],b=corners[fa][ib],c=corners[fb][jb],d=corners[fb][ja],order=m.faces[fa][(ia+1)%m.faces[fa].length]===e.b?[b,a,d,c]:[a,b,c,d];addFace(order,m.faceSources?.[fa]??fa,'bevel');if(selected.has(key(e.a,e.b))){rawSupport.push([a,b],[c,d]);}}
    for(let vi=0;vi<m.vertices.length;vi++){const incident=t.incident[vi];if(!incident.length||incident.some(fi=>{const f=m.faces[fi],i=f.indexOf(vi);return t.edges.get(key(vi,f[(i+1)%f.length])).faces.length!==2||t.edges.get(key(vi,f[(i+f.length-1)%f.length])).faces.length!==2;}))continue;const loop=[],seen=new Set();let fi=incident[0];while(!seen.has(fi)){seen.add(fi);const f=m.faces[fi],i=f.indexOf(vi);loop.push(corners[fi][i]);const prev=f[(i+f.length-1)%f.length],e=t.edges.get(key(prev,vi));fi=e.faces.find(x=>x!==fi);if(fi===undefined)break;}addFace(loop,m.faceSources?.[incident[0]]??incident[0],'corner');}
    // Only copies of the exact same source vertex may weld; close shells never weld.
    const parent=vertices.map((_,i)=>i),weld=new Map();m.faces.forEach((f,fi)=>f.forEach((vi,j)=>{const id=corners[fi][j],p=vertices[id],k=vi+':'+p.map(v=>Math.round(v/(scale*1e-10))).join(':');if(weld.has(k))parent[id]=weld.get(k);else weld.set(k,id);}));const active=new Map(),outVertices=[],outFaces=[],sources=[],kinds=[];faces.forEach((f,i)=>{let ids=f.map(v=>parent[v]);ids=ids.filter((v,i)=>v!==ids[(i+ids.length-1)%ids.length]);if(new Set(ids).size<3)return;const mapped=ids.map(v=>{if(!active.has(v)){active.set(v,outVertices.length);outVertices.push(vertices[v]);}return active.get(v);});if(faceData({vertices:outVertices},mapped).area<=scale*scale*1e-14)return;outFaces.push(mapped);sources.push(faceSources[i]);kinds.push(flags[i]);});const out={...m,vertices:outVertices,faces:outFaces,faceSources:sources,faceKinds:kinds,sourceMap:undefined,supportKeys:rawSupport.map(([a,b])=>[active.get(parent[a]),active.get(parent[b])]).filter(p=>p.every(i=>i!==undefined)&&p[0]!==p[1]).map(p=>key(...p)),method:'结构约束QEM + 真实切角面带 / 双侧支撑边',supportReport:{requested:keys.length,beveled:keys.length,widthRelative:width,method:'局部面角内缩、共享边过渡面与顶点封口；保护源顶点身份',bevelFaces:kinds.filter(x=>x==='bevel').length}};const before=audit(m),after=audit(out);if(!after.valid||after.boundaryEdges!==before.boundaryEdges||JSON.stringify(after.euler)!==JSON.stringify(before.euler))return {...m,supportKeys:[],supportReport:{requested:keys.length,beveled:0,rejected:true,reason:'此处切角未通过拓扑检查，保留未切角候选',failedAudit:after}};return out;
  }
  // 倍率表示贴图每个方向的像素密度。缺项沿用美术比例，防止旧工程或局部配置丢失其余部位。
  function characterUVDensity(values={}){
    const weights={face:1.75,scalp:1.22,'torso-front':1.24,'torso-back':1.24,arm:1.31,leg:1.12,boot:1};
    for(const key of Object.keys(weights)){
      const value=values?.[key];
      if(value===undefined)continue;
      if(!Number.isFinite(value)||value<.25||value>4)throw Error('人物 UV 倍率须为 0.25 到 4 之间的数字。');
      weights[key]=value;
    }
    return weights;
  }
  function uvAtlas(m,options={}){
    const frame=m.headSideShading?.frame;
    const layout=frame?{maxStretch:8,...options,characterFrame:frame}:options;
    return (typeof createContourUVUnwrap==='function'?createContourUVUnwrap:require('./uv-unwrap.js'))(api).atlas(m,layout);}
  function rebuildUV(previous,progress=()=>{},density){
    const weights=characterUVDensity(density??previous.settings?.characterUVDensity);
    const levels=previous.levels.map(level=>{
      if(density!==undefined&&!level.mesh.headSideShading?.frame)return level;
      progress('展开 UV · '+level.label);
      const updated={...level,uv:uvAtlas(level.mesh,{density:weights})};
      delete updated.texture;
      return updated;
    });
    return {...previous,levels,settings:{...previous.settings,characterUVDensity:weights}};
  }
  function nearestDistance(m,points){
    const tr=triangulate(m),triangles=tr.faces.map(f=>{const p=f.map(i=>tr.vertices[i]);return {p,lo:[0,1,2].map(k=>Math.min(...p.map(v=>v[k]))),hi:[0,1,2].map(k=>Math.max(...p.map(v=>v[k])))};});
    function tree(items){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const t of items)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],t.lo[k]);hi[k]=Math.max(hi[k],t.hi[k]);}if(items.length<=8)return {lo,hi,items};const axis=[0,1,2].sort((a,b)=>(hi[b]-lo[b])-(hi[a]-lo[a]))[0];items.sort((a,b)=>a.lo[axis]+a.hi[axis]-b.lo[axis]-b.hi[axis]);const split=items.length>>1;return {lo,hi,left:tree(items.slice(0,split)),right:tree(items.slice(split))};}
    const root=tree(triangles),epsilon=bounds(m).diagonal**2*1e-24,boxDistance=(p,node)=>p.reduce((s,v,k)=>s+Math.max(node.lo[k]-v,0,v-node.hi[k])**2,0);
    function segment(p,a,b){const d=sub(b,a);return add(a,mul(d,clamp(dot(sub(p,a),d)/(dot(d,d)||1),0,1)));}
    function triangleDistance(p,[a,b,c]){const n=unit(cross(sub(b,a),sub(c,a))),q=sub(p,mul(n,dot(sub(p,a),n))),inside=[cross(sub(b,a),sub(q,a)),cross(sub(c,b),sub(q,b)),cross(sub(a,c),sub(q,c))].every(v=>dot(v,n)>=0);return inside?dist(p,q):Math.min(dist(p,segment(p,a,b)),dist(p,segment(p,b,c)),dist(p,segment(p,c,a)));}
    return points.map(p=>{let best=Infinity;const stack=[{node:root,distance:boxDistance(p,root)}];while(stack.length){const {node,distance}=stack.pop();if(distance>best*best+epsilon)continue;if(node.items){for(const item of node.items)best=Math.min(best,triangleDistance(p,item.p));}else{const a={node:node.left,distance:boxDistance(p,node.left)},b={node:node.right,distance:boxDistance(p,node.right)};if(a.distance<b.distance)stack.push(b,a);else stack.push(a,b);}}return best;});
  }
  function measure(source,candidate){const sample=(m,max=180)=>{const step=Math.max(1,Math.ceil(m.vertices.length/max));return m.vertices.filter((_,i)=>i%step===0);},a=nearestDistance(candidate,sample(source)),b=nearestDistance(source,sample(candidate)),scale=bounds(source).diagonal,sort=[...a,...b].sort((a,b)=>a-b);return {sampleCount:sort.length,maximum:sort.at(-1),maxRelative:sort.at(-1)/scale,p95Relative:sort[Math.floor(sort.length*.95)]/scale,method:'双向顶点抽样到真实三角面距离；非严格Hausdorff上界'};}
  function structuralRuns(m,keys,minimum=.035){const adjacency=new Map(),seen=new Set(),kept=[],runs=[],scale=bounds(m).diagonal;for(const k of keys){const [a,b]=k.split(':').map(Number);for(const [v,w]of [[a,b],[b,a]]){if(!adjacency.has(v))adjacency.set(v,[]);adjacency.get(v).push([w,k]);}}for(const root of adjacency.keys())if(!seen.has(root)){const queue=[root],edges=new Set();seen.add(root);for(let q=0;q<queue.length;q++)for(const [other,k]of adjacency.get(queue[q])){edges.add(k);if(!seen.has(other)){seen.add(other);queue.push(other);}}const length=[...edges].reduce((s,k)=>{const [a,b]=k.split(':').map(Number);return s+dist(m.vertices[a],m.vertices[b]);},0);if(length>=minimum*scale){kept.push(...edges);runs.push({edges:[...edges],lengthRelative:length/scale});}}return {keys:kept,runs,rejected:keys.length-kept.length};}
  function lowTriangleBudgetFor(settings){
    return settings?.lowTriangleBudget??(settings?.lowFaceBudget!==undefined?settings.lowFaceBudget*2:500);
  }
  function settingsFor(settings={}){
    const options={characterTemplate:false,areaRatio:1.8,curvatureDifference:.35,curvatureFloor:.5,lowSubdivisions:1,legacyLowSubdivisions:1,midSubdivisions:1,fitIterations:4,fitStrength:.85,turboIterations:1,turboLimitSurface:true,turboBoundary:'ALL',bevelWidth:.004,trim:.005,guideTolerance:.003,guideVectorTolerance:.006,guideCornerAngle:55,guideJoinGaps:true,guideJoinDistance:.02,guideRegularization:.01,guideFieldPartition:true,guideFieldStrength:1,guideSilhouetteMatch:true,guideSilhouetteTolerance:.012,surfaceSmoothing:.6,internalCSISmoothing:.5,symmetryMode:'auto',symmetryTolerance:.001,guideBoundaryLocalScale:true,guideCurveFairing:true,useCurvatureNetwork:true,curveNetworkLines:3,...settings};
    options.characterUVDensity=characterUVDensity(settings.characterUVDensity);
    options.lowTriangleBudget=lowTriangleBudgetFor(settings);delete options.lowFaceBudget;
    const integers=[['lowTriangleBudget',48,65536],['curveNetworkLines',1,7],['lowSubdivisions',1,3],['legacyLowSubdivisions',1,3],['midSubdivisions',1,2],['fitIterations',1,8],['turboIterations',1,3]];
    if(!['areaRatio','curvatureDifference','curvatureFloor','fitStrength','bevelWidth','trim'].every(k=>Number.isFinite(options[k]))||options.areaRatio<1.01||options.curvatureDifference<=0||options.curvatureDifference>1||options.curvatureFloor<=0||options.fitStrength<.1||options.fitStrength>1||options.bevelWidth<0||options.bevelWidth>.05||options.trim<0||options.trim>.05||integers.some(([k,min,max])=>!Number.isInteger(options[k])||options[k]<min||options[k]>max))throw Error('细分、拟合或边界参数超出范围。');
    if(!Number.isFinite(options.internalCSISmoothing)||options.internalCSISmoothing<0||options.internalCSISmoothing>1)throw Error('内部CSI平顺须为0～100%。');
    if(!['auto','off'].includes(options.symmetryMode)||!Number.isFinite(options.symmetryTolerance)||options.symmetryTolerance<.00001||options.symmetryTolerance>.01)throw Error('对称识别参数无效。');
    if(!Number.isFinite(options.surfaceSmoothing)||options.surfaceSmoothing<0||options.surfaceSmoothing>1)throw Error('高模细节过滤须为0～100%。');
    if(typeof options.characterTemplate!=='boolean'||typeof options.useCurvatureNetwork!=='boolean'||typeof options.guideBoundaryLocalScale!=='boolean'||typeof options.guideCurveFairing!=='boolean')throw Error('经纬控制网开关无效。');
    if(typeof options.guideSilhouetteMatch!=='boolean'||!Number.isFinite(options.guideSilhouetteTolerance)||options.guideSilhouetteTolerance<.004||options.guideSilhouetteTolerance>.03)throw Error('轮廓匹配容差须为0.4%～3%。');
    if(typeof options.turboLimitSurface!=='boolean'||!['ALL','PRESERVE_CORNERS'].includes(options.turboBoundary))throw Error('极限曲面或开放边规则无效。');delete options.lowRatio;delete options.midRatio;return options;
  }
  // 当CSI四边分区暂不支持（如闭合高亏格角色或多分支体）时，保留结构特征的QEM减面并结合Blossom匹配生成四边优先低模
  function buildCharacterCandidate(source,options,progress=()=>{}){
    const budget=options.lowTriangleBudget;
    if(budget<400)throw Error('人物模板需要为眉眼、鼻翼及身体预留站位，请提高三角面预算。');
    const template=(typeof createContourFaceTemplate==='function'?createContourFaceTemplate:require('./face-template.js'))(api);
    const planes=(typeof createContourFeaturePatches==='function'?createContourFeaturePatches:require('./feature-patches.js'))(api);
    const profiles=(typeof createContourProfileSurface==='function'?createContourProfileSurface:require('./profile-surface.js'))(api);
    const grid=(typeof createContourStructureGrid==='function'?createContourStructureGrid:require('./structure-grid.js'))(api);
    progress('根据头部可见深度定位脸部模板');
    const landmark=template.locate(source);
    if(!landmark)throw Error('未识别出有双侧支撑的鼻尖，请关闭人物模板后生成。');
    const features=planes.build(source,{triangleBudget:budget,patchCount:Math.max(8,Math.min(256,Math.round(budget/12)))},progress);
    const field=template.portraitField(landmark);
    const shaped=profiles.build(source,features,budget,landmark,options.manualEdges)||source,signature=fingerprint(source);
    const expected=audit(source),pinned=new Set((shaped.rails||[]).map(id=>key(id,id)));
    for(const edge of options.manualEdges||[]){
      const ids=edge.split(':').map(Number).map(id=>shaped.sourceToShape?shaped.sourceToShape[id]:id);
      for(const id of ids)if(Number.isInteger(id)&&id>=0)pinned.add(key(id,id));
    }
    const body=profiles.bodyBands(source,shaped,landmark,budget,[...pinned].map(k=>Number(k.split(':')[0])),grid);
    function fitCandidate(structure){
      const working=structure?.mesh||shaped;
      const locks=structure?new Set(structure.pins.map(id=>key(id,id))):new Set(pinned);
      const thinSurface=[];
      const ringPoints=new Set((structure?.bands||[]).flatMap(b=>b.rings.flat().map(p=>p.join(','))));
      const skipFace=p=>ringPoints.has(p.join(','))||thinSurface.some(q=>dist(p,q)<landmark.width*.115);
      let available=budget-182,best=null;
      for(let attempt=0;attempt<8;attempt++){
        const cage=fastQEM(working,available,bounds(source).diagonal,{lockedKeys:[...locks],areaPower:.5,positionRegularization:.12,cosLimit:.05,maxError:.08});
        const fitted=template.fit(cage,landmark,budget,skipFace);
        if(!fitted)break;
        template.applyPortrait(fitted,landmark,field,skipFace);
        const index=new Map(cage.vertices.map((p,id)=>[p.join(','),id]));
        const bands=(structure?.bands||[]).map(b=>({name:b.name,side:b.side,rings:b.rings.map(row=>row.map(p=>index.get(p.join(','))))}));
        if(bands.some(b=>b.rings.some(row=>row.some(id=>id===undefined))))break;
        const protectedEdges=new Set(fitted.featureEdges||[]);
        for(const band of bands)for(let r=0;r<band.rings.length;r++){
          const row=band.rings[r];
          for(let c=0;c<row.length;c++){
            protectedEdges.add(key(row[c],row[(c+1)%row.length]));
            if(r)protectedEdges.add(key(row[c],band.rings[r-1][c]));
          }
        }
        // Blossom 只能合并同一结构格中的三角形，避免再次配对时吞掉环边或纵列。
        const allowed=(a,b)=>{
          const shared=fitted.faces[a].filter(id=>fitted.faces[b].includes(id));
          return !protectedEdges.has(key(shared[0],shared[1]));
        };
        const mixed=matchQuads(fitted,38,4.5,allowed),a=audit(mixed),hits=new Set();
        grid.intersections(mixed,null,(i,j)=>{for(const fi of [i,j])for(const id of mixed.faces[fi])hits.add(id);});
        if(hits.size){
          // 把穿插邻域的源点作为下次收线约束，保持紧邻薄层之间的间距。
          // 若未贴合的笼已通过穿插检查，只撤回出问题的薄层邻域的面部投影与翻边。
          if(grid.intersections(cage)===0){
            const fresh=[...hits].map(id=>mixed.vertices[id]).filter(p=>!skipFace(p));
            if(fresh.length){thinSurface.push(...fresh);continue;}
          }
          const count=locks.size;
          for(const id of hits){
            let closest=-1,distance=Infinity;
            working.vertices.forEach((p,i)=>{const d=dist(p,mixed.vertices[id]);if(d<distance){distance=d;closest=i;}});
            locks.add(key(closest,closest));
          }
          if(locks.size===count)break;
          continue;
        }
        if(!a.valid||a.triangles>budget||a.components!==expected.components||a.boundaryLoops!==expected.boundaryLoops||String(a.euler)!==String(expected.euler))break;
        const actualEdges=topology(mixed).edges;
        if([...protectedEdges].some(edge=>!actualEdges.has(edge)))break;
        mixed.method='人物截面与高模脸部模板';
        mixed.csiReport={supported:true,fallback:true,fallbackMode:'character-profile-template',characterTemplate:{...fitted.templateReport,bands,featureEdges:fitted.featureEdges||[],profileRings:shaped.rings||0,pairedRailVertices:shaped.rails?.length||0},structureGrid:{version:5,mode:'character-profile-template'},budget:{unit:'triangles',requested:budget,used:a.triangles,withinBudget:true},intersectionAudit:{remainingNonadjacentTrianglePairs:0},sourceFingerprint:signature};
        best=mixed;
        if(a.triangles>=budget-1)break;
        available+=budget-a.triangles;
      }
      return best;
    }
    let best=fitCandidate(body);
    if(!best&&body)best=fitCandidate(null);
    if(!best)throw Error('人物模板候选未通过预算、拓扑或穿插检查。');
    best.faceTemplateShading=template.shading(best,landmark,field);
    best.profileShading=profiles.shading(best,shaped);
    best.headSideShading=template.headSideSampler(source,template.headFrame(landmark))(best);
    return best;
  }
  function buildMixedSimplifyFallback(source,guides,options,reason,progress){
    progress('混合拓扑 · 特征保留QEM与四边匹配');
    const targetTris=options.lowTriangleBudget,diag=bounds(source).diagonal;
    const manual=options.manualEdges||[],locked=manual.length*2<=targetTris*0.4?manual:[];
    let triMesh=fastQEM(source,targetTris,diag,{cosLimit:0.1,maxError:0.08,lockedKeys:locked,areaPower:.5,positionRegularization:.5});
    if(triMesh.faces.length>targetTris)triMesh=fastQEM(triMesh,targetTris,diag,{cosLimit:-0.25,maxError:0.5});
    const mixed=orient(matchQuads(triMesh,38,4.5)),a=audit(mixed);
    mixed.method='局部尺度保形减面 / 四边面配对';
    mixed.csiReport={
      supported:false,fallback:true,mixedTopology:true,
      fallbackMode:'feature-preserving-quad-dominant-simplify',reason,
      quality:{quadricAreaPower:.5,positionRegularization:.5},
      budget:{unit:'triangles',requested:targetTris,used:a.triangles,faces:a.faces,quads:a.quads,tris:a.faces-a.quads,withinBudget:a.triangles<=targetTris},
      structureGrid:{version:3,mode:'mixed-simplify-quad-dominant'}
    };
    return mixed;
  }
  function guardedTurboSmooth(basis,steps,settings,grid){
    const full=hierarchyAPI.turboSmooth(basis,steps,settings);
    const crossed=(mesh,vertices)=>grid.intersections(mesh,null,(a,b)=>{
      for(const id of [...mesh.faces[a],...mesh.faces[b]])vertices.add(id);
    });
    let affected=new Set();
    const initialPairs=crossed(full,affected);
    if(!initialPairs&&audit(full).valid)return full;
    let linear=basis;
    for(let i=0;i<steps;i++)linear=hierarchyAPI.subdivide(linear,false);
    const fitted=copy(full),factors=new Map(),neighbors=topology(full).incident;
    // 对发生接触的顶点限制圆角收缩，其他位置继续使用 Catmull–Clark 求值。
    for(let pass=0;pass<4&&affected.size;pass++){
      const neighborhood=new Set([...affected].flatMap(id=>neighbors[id].flatMap(fi=>full.faces[fi])));
      for(const id of neighborhood){
        const t=(factors.get(id)??1)*.5;
        factors.set(id,t);
        fitted.vertices[id]=add(mul(linear.vertices[id],1-t),mul(full.vertices[id],t));
      }
      affected=new Set();
      if(!crossed(fitted,affected)&&audit(fitted).valid){
        fitted.turboReport={...full.turboReport,geometryGuard:{initialPairs,adjustedVertices:factors.size}};
        return fitted;
      }
    }
    // 极窄的相邻面片可能容不下半步圆角，在冲突邻域逐步恢复原细分点。
    const pinned=new Set();
    for(let pass=0;pass<8&&affected.size;pass++){
      const neighborhood=new Set([...affected].flatMap(id=>neighbors[id].flatMap(fi=>full.faces[fi])));
      const before=pinned.size;
      for(const id of neighborhood){pinned.add(id);fitted.vertices[id]=linear.vertices[id];}
      if(pinned.size===before)break;
      affected=new Set();
      if(!crossed(fitted,affected)&&audit(fitted).valid){
        fitted.turboReport={...full.turboReport,geometryGuard:{initialPairs,adjustedVertices:new Set([...factors.keys(),...pinned]).size,pinnedVertices:pinned.size}};
        return fitted;
      }
    }
    for(const fraction of [.75,.5,.25,.125,.0625,.03125]){
      fitted.vertices=full.vertices.map((p,id)=>add(mul(linear.vertices[id],1-fraction),mul(p,fraction)));
      if(grid.intersections(fitted)||!audit(fitted).valid)continue;
      fitted.turboReport={...full.turboReport,geometryGuard:{initialPairs,smoothingFraction:fraction}};
      return fitted;
    }
    if(!grid.intersections(linear)&&audit(linear).valid){
      linear.method='中模线性细分';
      linear.turboReport={...full.turboReport,method:'linear',geometryGuard:{initialPairs,usedLinearSubdivision:true}};
      return linear;
    }
    return null;
  }
  function deriveNearLevels(source,low,guides,options,progress){
    const grid=(typeof createContourStructureGrid==='function'?createContourStructureGrid:require('./structure-grid.js'))(api);
    const mid=hierarchyAPI.refineCSI(source,low,guides,options,grid,progress);
    const fallbackDerived=low.csiReport.fallback===true;
    mid.hierarchy.fallbackDerived=fallbackDerived;
    if(low.csiReport.characterTemplate)mid.hierarchy.characterTemplate=true;
    guides.layers.policy.midGenerationIntegrated=Boolean(mid.hierarchy.fitReport?.fittedVertices||mid.supportReport?.bands?.length);
    guides.layers.detail.generationIntegrated=false;
    guides.layers.detail.generatedCuts=0;
    low.csiReport.boundaryLayerUse={...low.csiReport.boundaryLayerUse,midDetailGenerationIntegrated:false};
    let ultra={vertices:mid.vertices,faces:mid.faces},steps=options.turboIterations;
    if(audit(mid).triangles*4<=hierarchyAPI.MAX_TRIANGLES){
      const basis=hierarchyAPI.quadify(ultra);
      while(steps>0&&basis.faces.length*2*4**steps>hierarchyAPI.MAX_TRIANGLES)steps--;
      if(steps>0){
        const settings={limitSurface:options.turboLimitSurface,boundaryRule:options.turboBoundary,progress};
        const smoothed=mid.supportReport?.bands?.length?guardedTurboSmooth(basis,steps,settings,grid):hierarchyAPI.turboSmooth(basis,steps,settings);
        if(smoothed)ultra=smoothed;
        else steps=0;
      }
    }else steps=0;
    if(!steps)ultra=copy(ultra);
    ultra.hierarchy={parentLevel:'mid',parentFingerprint:fingerprint(mid),turboIterations:steps,fallbackDerived};
    if(mid.hierarchy.characterTemplate)ultra.hierarchy.characterTemplate=true;
    if(ultra.turboReport)ultra.turboReport.parentFingerprint=fingerprint(mid);
    if(low.headSideShading){
      const factory=typeof createContourFaceTemplate==='function'?createContourFaceTemplate:require('./face-template.js');
      const sample=factory(api).headSideSampler(source,low.headSideShading.frame);
      mid.headSideShading=sample(mid);
      ultra.headSideShading=sample(ultra);
    }
    return [low,mid,ultra];
  }
  const levelIds=['far','far-mid','low','mid','ultra'],levelLabels=['远 · 长方体','中远 · 解析体大形','中 · 低模','近 · 带卡线中模','超近 · 涡轮平滑'];
  function describeLevel(mesh,i,source,health,parent,progress,density){
    const label=levelLabels[i];progress('校验 '+label);
    if(i<2)hierarchyAPI.requireQuads(mesh);
    applyAutoSmooth(mesh,i===4?180:60);
    const a=audit(mesh),contact=mesh.csiReport?.structureGrid?.contactTopology,physical=contact||a;
    const same=(x,y)=>x.valid&&x.components===y.components&&JSON.stringify(x.euler)===JSON.stringify(y.euler)&&x.boundaryLoops===y.boundaryLoops;
    const preserved=same(physical,health);
    return {id:levelIds[i],label,mesh,audit:a,allQuads:a.quads===a.faces,parentTopologyPreserved:i<2?undefined:i===2?preserved:same(physical,parent),topologyPreserved:preserved,error:mesh.csiReport?.csiOnly?mesh.csiReport.boundaryError:measure(source,mesh),uv:uvAtlas(mesh,{density}),candidate:true};
  }
  function buildLevels(source,guides,options,far,progress,original){
    if(!primitiveAPI||!hierarchyAPI)throw Error('解析体或四边细分模块未加载。');
    progress('构建解析体四边基础');
    const farMid=hierarchyAPI.quadify(primitiveAPI.fit(source,options,progress,original)),low=csiLow(source,guides,options,progress);
    const models=[far,farMid,...deriveNearLevels(source,low,guides,options,progress)],health=audit(source);
    return models.map((mesh,i)=>describeLevel(mesh,i,source,health,i>2?(models[i-1].csiReport?.structureGrid?.contactTopology||audit(models[i-1])):null,progress,options.characterUVDensity));
  }
  function restoreGeneratedShading(source,levels,progress){
    if(!source.sourceNormals)return;
    const transfer=(typeof createContourTextureTransfer==='function'?createContourTextureTransfer:require('./texture-transfer.js'))(api);
    transfer.restoreLevels(source,levels.slice(2),progress);
  }
  function process(raw,settings={},progress=()=>{}){
    const original=validate(raw),signature=fingerprint(original),options=settingsFor(settings);
    const work=prepareWorkingSource(original,progress),source=work.source,health=work.health;
    progress('分析同一高模的四档邻域');const boundary=detect(source,options,progress);
    options.manualEdges=(options.manualEdges||[]).filter(k=>topology(source).edges.has(k));
    const guideSource=work.analysisProxy?source:original;
    const guides=analyzeBoundaryGuides(guideSource,boundary,options,progress),levels=buildLevels(source,guides,options,box(source,options.trim),progress,original);
    restoreGeneratedShading(original,levels,progress);
    if(fingerprint(raw)!==signature)throw Error('原始输入意外改变，停止输出。');
    return {version:2,processingModel:'csi-low-curvature-network-v3',name:raw.name||'导入模型',source:original,sourceFingerprint:signature,sourceAudit:health,analysisSource:work.analysisProxy?source:undefined,analysisProxy:work.analysisProxy?{enabled:true,raw:work.rawStats,clean:work.cleanStats,working:{vertices:health.vertices,faces:health.faces,triangles:health.triangles}}:undefined,sourceWindingRepaired:work.analysisProxy?false:fingerprint(source)!==signature,symmetry:guides.symmetry,boundary,guides,settings:options,levels,notice:'中档在固定CSI边界内，以过滤高模的主曲率引导三维经纬控制网，按控制网构面并独立采样布线；原包边剖面保留；复杂封闭高模自动清理并切换混合特征保留减面与Blossom四边匹配（总上限严格按三角面计）。原高模独立只读。候选仍需形体复核，基础UV图集未调用Directional或BFF。'};
  }
  function rebuildHierarchy(previous,settings={},progress=()=>{}){
    const original=validate(previous.source),signature=fingerprint(original),workingRaw=previous.analysisSource||previous.source,source=orient(validate(workingRaw));
    if(signature!==previous.sourceFingerprint||previous.boundary.sourceFingerprint!==fingerprint(source))throw Error('源模型与缓存边界签名不一致，请重新生成五档。');
    const previousOptions=settingsFor(previous.settings),options=settingsFor({...previous.settings,...settings});
    for(const k of ['characterTemplate','areaRatio','curvatureDifference','curvatureFloor','trim','lowTriangleBudget','lowSubdivisions','midSubdivisions','fitIterations','fitStrength','turboIterations','turboLimitSurface','turboBoundary','bevelWidth'])if(options[k]!==previousOptions[k])throw Error('几何或边界参数已改动，请重新生成五档。');
    for(const k of ['manualEdges','excludedEdges'])if(JSON.stringify(options[k])!==JSON.stringify(previousOptions[k]))throw Error('手动边已改动，请重新生成五档。');
    const guides=structuredClone(previous.guides),levels=buildLevels(source,guides,options,copy(previous.levels[0].mesh),progress,original);
    restoreGeneratedShading(original,levels,progress);
    if(fingerprint(previous.source)!==signature)throw Error('源模型意外改变。');
    return {...previous,version:2,processingModel:'csi-low-curvature-network-v3',settings:options,guides,symmetry:guides.symmetry,levels};
  }
  function csiLow(source,guides,options,progress){
    const checked=mesh=>{
      // 最终交付统一按实际面三角化计数，混合减面回退也须满足上限。
      const triangles=mesh.faces.reduce((sum,face)=>sum+face.length-2,0);
      if(triangles>options.lowTriangleBudget)throw Error(`低模需要 ${triangles} 个三角面，超过上限 ${options.lowTriangleBudget}。请提高上限或调整分区。`);
      return mesh;
    };
    if(!guides.layers)guides.layers=guideAPI.boundaryLayers(source,guides,{excludedEdges:options.excludedEdges||[]});
    if(options.characterTemplate)return checked(buildCharacterCandidate(source,options,progress));
    if(guides.layers.policy.low.includes('detail'))throw Error('细小面边界不能作为低模分区输入。');
    if(!csiSurfaceAPI)throw Error('CSI四边补面模块未加载。');const baseProposal={...guides?.scales[2]?.proposal};delete baseProposal.surfaceMatching;delete baseProposal.surfaceFitting;delete baseProposal.structureGrid;delete baseProposal.curvatureNetwork;baseProposal.surfaceLayout={...baseProposal.surfaceLayout,rimSamplingVersion:2};guides.scales[2].proposal=baseProposal;progress('中档CSI拟合后 · 结构对称识别');guides.symmetry=symmetryAPI().detectCSI(source,baseProposal,{mode:options.symmetryMode,tolerance:options.symmetryTolerance});
    const structureGrid=(typeof createContourStructureGrid==='function'?createContourStructureGrid:require('./structure-grid.js'))(api);
    let result;
    try{result=csiSurfaceAPI.generate(source,baseProposal,options,progress);}
    catch(error){
      if(error.code!=='CSI_STRIP_BUDGET')throw error;
      progress('低预算 CSI · 优先保留主体截面与轮廓');
      const interfaces=guideAPI.budgetInterfaces(source,baseProposal,options.lowTriangleBudget),mesh=structureGrid.adaptiveSurface(source,baseProposal,interfaces,options);
      if(!mesh)throw error;
      mesh.csiReport.boundaryLayerUse={topology:['surface'],shape:['outline'],detailConsumed:false,midDetailGenerationIntegrated:false};
      mesh.csiReport.guideSignature=csiSurfaceAPI.guideSignature(baseProposal);
      return checked(mesh);
    }
    if(!result.supported)return checked(buildMixedSimplifyFallback(source,guides,options,result.reason,progress));
    progress(options.useCurvatureNetwork?'过滤高模细节 · 保留包边剖面':'匹配同分区高模面形 · 保持真实CSI边界');const fitter=(typeof createContourSurfaceFit==='function'?createContourSurfaceFit:require('./surface-fit.js'))(api),surfaceFit=fitter.fit(source,result.mesh,baseProposal,{smoothing:options.surfaceSmoothing,fitBroad:!options.useCurvatureNetwork});guides.scales[2].proposal={...baseProposal,surfaceFitting:surfaceFit.definition};result=csiSurfaceAPI.generate(source,guides.scales[2].proposal,options,progress);
    if(options.guideSilhouetteMatch!==false&&!options.useCurvatureNetwork){progress('最终轮廓匹配 · 保持结构分区与共享CSI');const matcher=(typeof createContourSilhouetteMatch==='function'?createContourSilhouetteMatch:require('./silhouette-match.js'))(api),fit=matcher.fitFinal(surfaceFit.target,result.mesh,{scale:guides.scale,tolerance:options.guideSilhouetteTolerance??.012});if(options.surfaceSmoothing>0){fit.report.detailSmoothing=surfaceFit.report.detailSmoothing;fit.report.geometrySource='detail-filtered same-region proxy silhouettes; original high unchanged';}guides.scales[2].proposal={...guides.scales[2].proposal,surfaceMatching:fit.definition};result=csiSurfaceAPI.generate(source,guides.scales[2].proposal,options,progress);}
    if(options.useCurvatureNetwork){progress('高模主曲率 → 三维经纬CSI控制网');const network=(typeof createContourCurvatureNetwork==='function'?createContourCurvatureNetwork:require('./curvature-network.js'))(api),definition=network.build(surfaceFit.target,result.mesh,baseProposal,{internalLines:options.curveNetworkLines,fairingTolerance:bounds(source).diagonal*options.guideVectorTolerance*(1+options.internalCSISmoothing),internalSmoothing:options.internalCSISmoothing,symmetry:guides.symmetry});definition.originalSourceFingerprint=fingerprint(source);guides.scales[2].proposal={...guides.scales[2].proposal,curvatureNetwork:definition};result.mesh.csiCurveNetwork=structuredClone(definition);result.mesh.csiReport.curvatureNetwork=definition.report;result.mesh=network.applyStripNetworks(result.mesh,definition);}
    progress('经纬曲面采样 · 独立分区局部收线');guides.scales[2].proposal={...guides.scales[2].proposal,structureGrid:options.useCurvatureNetwork?{version:3,mode:'curvature-curve-network'}:{version:2,mode:'independent-structure-mixed'}};result.mesh=structureGrid.generate(result.mesh,guides.scales[2].proposal.structureGrid,options);result.mesh.csiReport.guideSignature=csiSurfaceAPI.guideSignature(guides.scales[2].proposal);if(options.useCurvatureNetwork)result.mesh.csiReport.filteredSurfaceError=measure(surfaceFit.target,result.mesh);
    guides.layers.outline.matchingEnabled=options.guideSilhouetteMatch!==false&&!options.useCurvatureNetwork;guides.layers.outline.curveNetworkFixedBoundary=options.useCurvatureNetwork;guides.layers.outline.target=options.surfaceSmoothing>0?'detail-filtered-source':'original-source';guides.layers.outline.measuredViews=guides.scales[2].proposal.surfaceMatching?.report?.after?.length??0;
    result.mesh.csiReport.boundaryLayerUse={topology:['surface'],shape:options.guideSilhouetteMatch!==false?['outline']:[],detailConsumed:false,midDetailGenerationIntegrated:false};
    return checked(result.mesh);
  }
  function refitInternalCSI(source,boundary,previousGuides,options,progress){
    const guides=structuredClone(previousGuides),p=guides.scales[2].proposal,network={keys:p.rawKeys,groups:p.patchGroups,patches:p.patches,nodes:p.nodes,report:p.report,chains:p.chains.map(c=>({...c,points:c.vertices.map(id=>source.vertices[id]),supportedEdges:0}))};
    progress('复用结构分区与四向场 · 只更新内部CSI平顺');
    const proposal=guideAPI.fitNetwork(source,topology(source),network,{scale:guides.scale,tolerance:guides.scale*options.guideVectorTolerance,cornerAngle:options.guideCornerAngle,regularization:options.guideRegularization,field:options.guideFieldPartition!==false?guides.scales[2].field:null,fieldStrength:options.guideFieldStrength,cornerMergeDistance:options.guideCornerMergeDistance??.02,manualEdges:options.manualEdges||[],localScaleFitting:options.guideBoundaryLocalScale,curveFairing:options.guideCurveFairing,internalSmoothing:options.internalCSISmoothing});
    if(JSON.stringify(proposal.sourceCorners.map(c=>c.nodes))!==JSON.stringify(p.sourceCorners.map(c=>c.nodes)))return analyzeBoundaryGuides(source,boundary,options,progress);
    guides.scales[2].proposal=proposal;guides.internalRefit={reusedSourceEvidence:true,reusedFourWayField:true,sourceCornersPreserved:true};return guides;
  }
  function rebuildCSILow(previous,settings={},progress=()=>{}){
    const original=validate(previous.source),signature=fingerprint(original),workingRaw=previous.analysisSource||previous.source,source=orient(validate(workingRaw));if(signature!==previous.sourceFingerprint||previous.boundary.sourceFingerprint!==fingerprint(source))throw Error('源模型与边界缓存不一致，请重新生成五档。');const previousOptions=settingsFor(previous.settings),options=settingsFor({...previous.settings,...settings});for(const k of ['characterTemplate','areaRatio','curvatureDifference','curvatureFloor','trim','lowTriangleBudget','lowSubdivisions','midSubdivisions','fitIterations','fitStrength','turboIterations','turboLimitSurface','turboBoundary','bevelWidth','manualEdges','excludedEdges'])if(JSON.stringify(options[k])!==JSON.stringify(previousOptions[k]))throw Error('几何或边界参数已改动，请重新生成五档。');
    const guideKeys=['guideTolerance','guideVectorTolerance','guideCornerAngle','guideJoinGaps','guideJoinDistance','guideRegularization','guideFieldPartition','guideFieldStrength','guideBoundaryLocalScale','guideCurveFairing'],reuse=guideKeys.every(k=>JSON.stringify(options[k])===JSON.stringify(previous.settings[k]??previousOptions[k]));
    const guides=reuse?(options.internalCSISmoothing!==(previous.settings.internalCSISmoothing??0)?refitInternalCSI(source,previous.boundary,previous.guides,options,progress):structuredClone(previous.guides)):analyzeBoundaryGuides(workingRaw,previous.boundary,options,progress);
    const low=csiLow(source,guides,options,progress),meshes=deriveNearLevels(source,low,guides,options,progress),health=audit(source);
    const levels=[...previous.levels.slice(0,2),...meshes.map((mesh,i)=>{
      const parent=meshes[i-1];
      return describeLevel(mesh,i+2,source,health,parent?(parent.csiReport?.structureGrid?.contactTopology||audit(parent)):null,progress,options.characterUVDensity);
    })];
    restoreGeneratedShading(original,levels,progress);
    if(fingerprint(previous.source)!==signature)throw Error('源模型意外改变。');return {...previous,processingModel:'csi-low-curvature-network-v3',settings:options,symmetry:guides.symmetry,guides,levels};
  }
  function analyzeBoundaryGuides(raw,boundary,options={},progress=()=>{}){if(!guideAPI)throw Error('边界导线模块未加载。');const original=validate(raw);return {...guideAPI.build(orient(original),boundary,options,progress),originalSourceFingerprint:fingerprint(original)};}
  function autoSmooth(m,options={}){
    const angle=options.angle??60;if(!Number.isFinite(angle)||angle<0||angle>180)throw Error('平滑角度应为0～180度。');
    const partitions=options.partitionGroups??m.csiPatchGroups??null;
    if(partitions!==null&&(partitions.length!==m.faces.length||Array.from(partitions).some(g=>!Number.isInteger(g)||g<0)))throw Error('CSI结构分区必须逐面提供有效标签。');
    const saved=m.surfaceNormals&&m.surfaceNormals.signature===fingerprint(m)?m.surfaceNormals.sharpEdges:null;
    const t=options.topology||topology(m),forced=new Set(options.hardEdges||saved||[]),sharpEdges=[],structureBoundaryEdges=[],adj=m.faces.map(()=>[]),cosine=Math.cos(angle*Math.PI/180);
    const head=m.headSideShading&&m.headSideShading.signature===fingerprint(m)?m.headSideShading:null;
    if(head)for(const key of head.hardEdges)forced.add(key);
    for(const [k,e]of t.edges){if(e.faces.length!==2){sharpEdges.push(k);continue;}const [a,b]=e.faces,separated=partitions&&partitions[a]!==partitions[b];if(separated)structureBoundaryEdges.push(k);if(separated&&!m.csiSurfaceCharts||forced.has(k)||dot(t.data[a].normal,t.data[b].normal)<cosine-1e-10)sharpEdges.push(k);else{adj[a].push(b);adj[b].push(a);}}
    const groups=Array(m.faces.length).fill(0);let groupCount=0;for(let fi=0;fi<m.faces.length;fi++)if(!groups[fi]){const queue=[fi];groups[fi]=++groupCount;for(let q=0;q<queue.length;q++)for(const j of adj[queue[q]])if(!groups[j]){groups[j]=groupCount;queue.push(j);}}
    return {groups,sharpEdges,angle,groupCount,headSideEdges:head?.hardEdges.length||0,partitionSource:saved?'source-normals':m.csiSurfaceCharts?'feature-charts':partitions?'csi-structure':'geometry-angle',partitionCount:partitions?new Set(partitions).size:0,structureBoundaryEdges,method:saved?'source-normal continuity and current-mesh creases; explicit projected corner normals':partitions?'CSI structural partitions and local geometric creases; shared interfaces block corner-normal averaging':'current-mesh geometric crease angle; connected face regions; corner fans split across sharp edges'};
  }
  function applyAutoSmooth(m,angle=60){const s=autoSmooth(m,{angle});m.smoothingGroups=s.groups;m.sharpEdges=s.sharpEdges;m.smoothingAngle=s.angle;m.smoothingReport={method:s.method,angle:s.angle,groups:s.groupCount,sharpEdges:s.sharpEdges.length,partitionSource:s.partitionSource,partitionCount:s.partitionCount,structureBoundaryEdges:s.structureBoundaryEdges.length,weighting:s.headSideEdges?'corner angle, area-weighted ear fans and fitted sheet normals':'corner angle',headSideEdges:s.headSideEdges};return m;}
  function cornerNormals(m,groups=m.smoothingGroups,options={}){
    if(m.surfaceNormals&&m.surfaceNormals.signature===fingerprint(m)&&m.surfaceNormals.values.length===m.faces.length)return m.surfaceNormals.values;
    if(m.sourceNormals&&m.sourceNormals.signature===fingerprint(m))return m.sourceNormals.indices.map(face=>face.map(i=>m.sourceNormals.vectors[i]));
    const t=options.topology||topology(m),shading=groups?null:autoSmooth(m,{...options,topology:t});groups=groups||shading.groups;
    const sharp=new Set(options.sharpEdges??m.sharpEdges??shading?.sharpEdges??[]),offsets=[];let count=0;m.faces.forEach(f=>{offsets.push(count);count+=f.length;});
    const parent=Int32Array.from({length:count},(_,i)=>i),rank=new Uint8Array(count),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},join=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++;};
    // Only adjacent corners around the same vertex can share a normal. A face
    // region can reconnect elsewhere without smoothing across a local crease.
    for(const [k,e]of t.edges)if(e.faces.length===2&&!sharp.has(k)){const [a,b]=e.faces;if((groups[a]??1)!==0&&(groups[a]??1)===(groups[b]??1))for(const vi of [e.a,e.b])join(offsets[a]+m.faces[a].indexOf(vi),offsets[b]+m.faces[b].indexOf(vi));}
    const head=!options.sampleNormals&&m.headSideShading&&m.headSideShading.signature===fingerprint(m)?m.headSideShading:null;
    const sums=new Map(),areaSums=new Map();
    m.faces.forEach((face,fi)=>face.forEach((vi,j)=>{
      const p=m.vertices[vi],a=unit(sub(m.vertices[face[(j+face.length-1)%face.length]],p));
      const b=unit(sub(m.vertices[face[(j+1)%face.length]],p)),data=t.data[fi];
      let n=options.sampleNormals?.[fi]?.[j]||data.normal;
      const panel=head?.sheetCorners[fi]?.[j];
      if(panel)n=unit(add(mul(n,1-panel.weight),mul(panel.normal,panel.weight)));
      let weight=Math.atan2(len(cross(a,b)),clamp(dot(a,b),-1,1));
      if(dot(cross(b,a),data.normal)<-1e-12)weight=2*Math.PI-weight;
      const root=find(offsets[fi]+j);
      sums.set(root,add(sums.get(root)||[0,0,0],mul(n,weight)));
      if(head?.weights[vi])areaSums.set(root,add(areaSums.get(root)||[0,0,0],mul(n,weight*data.area)));
    }));
    const normals=new Map([...sums].map(([root,n])=>[root,len(n)>1e-12?unit(n):null]));
    return m.faces.map((face,fi)=>face.map((vi,j)=>{
      if((groups[fi]??1)===0)return t.data[fi].normal;
      const root=find(offsets[fi]+j),normal=normals.get(root)||t.data[fi].normal,weighted=areaSums.get(root);
      if(!weighted||!len(weighted))return normal;
      // 在现有光滑扇区内过渡，狭长侧壁不会压过耳廓大面的法线。
      const blend=head.weights[vi];
      return unit(add(mul(normal,1-blend),mul(unit(weighted),blend)));
    }));
  }
  function obj(level){const raw=level.mesh||level,m=raw.csiPatchGroups?applyAutoSmooth(copy(raw),raw.smoothingAngle??60):raw.smoothingGroups?raw:applyAutoSmooth(copy(raw)),uv=level.uv||raw.sourceUV,normals=cornerNormals(m),lines=['# Contour Lab 3D - candidate geometry','o '+(level.id||'mesh')];for(const p of m.vertices)lines.push('v '+p.join(' '));if(uv)for(const p of uv.uv)lines.push('vt '+p.join(' '));for(const f of normals)for(const n of f)lines.push('vn '+n.join(' '));let last='',lastSmooth=null,normalIndex=1;m.faces.forEach((f,i)=>{const group=m.faceKinds?.[i]||'surface',smooth=m.smoothingGroups?.[i]??1;if(group!==last){lines.push('g '+group);last=group;}if(smooth!==lastSmooth){lines.push('s '+(smooth||'off'));lastSmooth=smooth;}lines.push('f '+f.map((v,j)=>(v+1)+'/'+(uv?uv.indices[i][j]+1:'')+'/'+normalIndex++).join(' '));});return lines.join('\n')+'\n';}
  function parseOBJ(text){
    const vertices=[],faces=[],uv=[],uvIndices=[],normalVectors=[],normalIndices=[],sourceSmoothingGroups=[],faceMaterials=[],materialLibraries=[];let pos=0,length=text.length,material='',smoothingGroup=0;
    // 使用索引逐行扫描替代整文本 split，降低百兆高模导入内存峰值
    while(pos<length){
      let nl=text.indexOf('\n',pos);if(nl<0)nl=length;
      const raw=text.slice(pos,nl);pos=nl+1;const comment=raw.indexOf('#'),line=(comment>=0?raw.slice(0,comment):raw).trim();
      if(!line)continue;
      if(line[0]==='v'&&line[1]===' '){const parts=line.slice(2).trim().split(/\s+/);vertices.push([Number(parts[0]),Number(parts[1]),Number(parts[2])]);}
      else if(line.startsWith('vt ')){
        const values=line.slice(3).trim().split(/\s+/).slice(0,2).map(Number);
        if(values.length!==2||values.some(v=>!Number.isFinite(v)))throw Error('OBJ UV 坐标无效。');
        uv.push(values);
      }
      else if(line.startsWith('vn ')){
        const values=line.slice(3).trim().split(/\s+/).slice(0,3).map(Number);
        if(values.length!==3||values.some(v=>!Number.isFinite(v)))throw Error('OBJ 法线无效。');
        normalVectors.push(unit(values));
      }
      else if(line.startsWith('usemtl '))material=line.slice(7).trim();
      else if(line.startsWith('mtllib '))materialLibraries.push(line.slice(7).trim());
      else if(line.startsWith('s ')){
        const value=line.slice(2).trim();smoothingGroup=value==='off'?0:Number(value);
        if(!Number.isInteger(smoothingGroup)||smoothingGroup<0)throw Error('OBJ 平滑组无效。');
      }
      else if(line[0]==='f'&&line[1]===' '){
        const parts=line.slice(2).trim().split(/\s+/),cleaned=[],tex=[],normals=[];
        for(const part of parts){
          const [v,t,nr]=part.split('/'),n=Number(v),id=n<0?vertices.length+n:n-1;
          if(cleaned.at(-1)===id)continue;
          cleaned.push(id);
          const k=Number(t),uvId=t?(k<0?uv.length+k:k-1):null;
          if(uvId!==null&&(!Number.isInteger(uvId)||uvId<0||uvId>=uv.length))throw Error('OBJ UV 索引无效。');
          tex.push(uvId);
          const kNormal=Number(nr),normalId=nr?(kNormal<0?normalVectors.length+kNormal:kNormal-1):null;
          if(normalId!==null&&(!Number.isInteger(normalId)||!normalVectors[normalId]))throw Error('OBJ 法线索引无效。');
          normals.push(normalId);
        }
        if(cleaned.length>1&&cleaned[0]===cleaned.at(-1)){cleaned.pop();tex.pop();normals.pop();}
        if(cleaned.length>=3&&new Set(cleaned).size===cleaned.length){faces.push(cleaned);uvIndices.push(tex);normalIndices.push(normals);faceMaterials.push(material);sourceSmoothingGroups.push(smoothingGroup);}
      }
    }
    const mesh=validate({vertices,faces,faceMaterials,materialLibraries,sourceSmoothingGroups});
    if(sourceSmoothingGroups.some(g=>g!==0))mesh.smoothingGroups=sourceSmoothingGroups.slice();
    if(uv.length&&uvIndices.every(f=>f.every(i=>i!==null)))mesh.sourceUV={uv,indices:uvIndices};
    if(normalVectors.length&&normalIndices.every(f=>f.every(i=>i!==null)))mesh.sourceNormals={vectors:normalVectors,indices:normalIndices,signature:fingerprint(mesh)};
    return mesh;
  }
  function parseSTL(buffer){const view=new DataView(buffer),vertices=[],faces=[],weld=new Map();const vertex=p=>{const k=p.map(v=>Object.is(v,-0)?0:v).join(':');if(!weld.has(k)){weld.set(k,vertices.length);vertices.push(p);}return weld.get(k);};if(buffer.byteLength>=84&&84+view.getUint32(80,true)*50===buffer.byteLength){const count=view.getUint32(80,true);for(let i=0;i<count;i++){const offset=84+i*50+12;faces.push([0,1,2].map(j=>vertex([0,1,2].map(k=>view.getFloat32(offset+j*12+k*4,true)))));}}else{const text=new TextDecoder().decode(buffer),points=[...text.matchAll(/vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/g)].map(m=>m.slice(1).map(Number));for(let i=0;i<points.length;i+=3)faces.push(points.slice(i,i+3).map(vertex));}return validate({vertices,faces});}
  function cube(){return {name:'硬体方盒 · 手动卡线参考',vertices:[[-1,-.6,-.8],[1,-.6,-.8],[1,.6,-.8],[-1,.6,-.8],[-1,-.6,.8],[1,-.6,.8],[1,.6,.8],[-1,.6,.8]],faces:[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]};}
  function torus(){const vertices=[],faces=[],n=40,k=12;for(let i=0;i<n;i++)for(let j=0;j<k;j++){const a=i*2*Math.PI/n,b=j*2*Math.PI/k,r=1+.3*Math.cos(b);vertices.push([r*Math.cos(a),.3*Math.sin(b),r*Math.sin(a)]);}for(let i=0;i<n;i++)for(let j=0;j<k;j++)faces.push([i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k]);return orient({name:'带孔圆环',vertices,faces});}
  const symmetryAPI=()=> (typeof createContourSymmetry==='function'?createContourSymmetry:require('./symmetry.js'))(api);
  const api={buildCharacterCandidate,add,sub,mul,dot,cross,len,unit,dist,clamp,key,copy,bounds,faceData,topology,audit,validate,orient,frame,box,detect,triangulate,cleanSculptMesh,fastQEM,simplify,pairQuads,matchQuads,supportEdges,bevel,uvAtlas,rebuildUV,measure,settingsFor,process,rebuildHierarchy,rebuildCSILow,analyzeBoundaryGuides,lowTriangleBudgetFor,obj,parseOBJ,parseSTL,cube,torus,fingerprint,structuralRuns,autoSmooth,applyAutoSmooth,cornerNormals,quadShell,characterUVDensity,primitiveTypes:()=>primitiveAPI?.types||{},primitiveLevel(source,options={}){if(!primitiveAPI)throw Error('解析体模块未加载。');const mesh=hierarchyAPI.quadify(primitiveAPI.fit(orient(validate(source)),options));applyAutoSmooth(mesh);const a=audit(mesh),health=audit(source);return {id:'far-mid',label:'中远 · 解析体大形',mesh,audit:a,topologyPreserved:a.components===health.components&&JSON.stringify(a.euler)===JSON.stringify(health.euler)&&a.boundaryLoops===health.boundaryLoops,error:mesh.csiReport?.csiOnly?mesh.csiReport.boundaryError:measure(source,mesh),uv:uvAtlas(mesh),candidate:true};}};
  if(typeof createContourPrimitives==='function')primitiveAPI=createContourPrimitives(api);else if(typeof require==='function')primitiveAPI=require('./primitives.js')(api);if(typeof createContourHierarchy==='function')hierarchyAPI=createContourHierarchy(api);else if(typeof require==='function')hierarchyAPI=require('./hierarchy.js')(api);if(typeof createContourBoundaryGuides==='function')guideAPI=createContourBoundaryGuides(api);else if(typeof require==='function')guideAPI=require('./boundary-guides.js')(api);if(typeof createContourCSISurface==='function')csiSurfaceAPI=createContourCSISurface(api,hierarchyAPI);else if(typeof require==='function')csiSurfaceAPI=require('./csi-surface.js')(api,hierarchyAPI);return api;
}
if(typeof module!=='undefined')module.exports=createContour3D;
if(typeof window!=='undefined')window.createContour3D=createContour3D;

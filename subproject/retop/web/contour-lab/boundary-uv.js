/* Periodic C0 junction UV; normalized edge UV is retained separately. */
function makeBoundaryUV(E){
 'use strict';
 const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a[0]*b[0]+a[1]*b[1],len=p=>Math.hypot(...p),unit=p=>mul(p,1/Math.max(1e-30,len(p))),clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
function fit(mesh,level,F,spanFactor=3,frameScale=1){
 const edges=new Map(mesh.edges.map(e=>[e.id,e])),src=F.edges(level).filter(e=>edges.has(e.id)),eMap=new Map(src.map(e=>[e.id,e])),centers=new Map(),nodes=new Map(),pointKey=p=>p.map(v=>Math.round(v/(mesh.diagonal*1e-8))).join(':');
 const mean=mesh.vertices.reduce(add,[0,0]).map(v=>v/mesh.vertices.length);let xx=0,xy=0,yy=0;for(const p of mesh.vertices){const d=sub(p,mean);xx+=d[0]**2;xy+=d[0]*d[1];yy+=d[1]**2;}const theta=.5*Math.atan2(2*xy,xx-yy),global=[Math.cos(theta),Math.sin(theta)];
 for(const e of src)for(const [end,p]of [[0,e.p0],[1,e.p3]]){const k=pointKey(p);if(!nodes.has(k))nodes.set(k,{p,arms:[]});nodes.get(k).arms.push({edge:e.id,end,d:unit(sub(E.bez(e,end?.99:.01),p))});}
 for(const j of mesh.junctions){const n=nodes.get(pointKey(j.position));let best=-Infinity,pair;for(let a=0;a<n.arms.length;a++)for(let b=a+1;b<n.arms.length;b++){const ea=eMap.get(n.arms[a].edge),eb=eMap.get(n.arms[b].edge),boundary=ea.role&&ea.role===eb.role&&ea.role!=='internal'&&(ea.sourceLoop===undefined||eb.sourceLoop===undefined||ea.sourceLoop===eb.sourceLoop),sameCurve=ea.curveId!==undefined&&ea.curveId===eb.curveId,score=(boundary?4:0)+(sameCurve?2:0)-dot(n.arms[a].d,n.arms[b].d);if(score>best){best=score;pair=[n.arms[a],n.arms[b]];}}let axis=unit(sub(pair[0].d,pair[1].d));if(dot(axis,global)<0)axis=mul(axis,-1);n.pair=pair;n.axis=axis;n.half=j.width;n.trim=j.trim;n.ref=n.arms.reduce((v,a)=>v+edges.get(a.edge).length,0)/n.arms.length;}
 const connections=new Map();for(const n of nodes.values())if(n.pair){const [a,b]=n.pair;connections.set(a.edge+':'+a.end,b);connections.set(b.edge+':'+b.end,a);}
 const paths=[],flips=new Map();for(const seed of src){if(flips.has(seed.id))continue;let start={edge:seed.id,end:connections.has(seed.id+':0')&&!connections.has(seed.id+':1')?1:0},walk=start;
  // First find the end of an open chain, rather than starting halfway along it.
  const scanned=new Set();while(connections.has(walk.edge+':'+walk.end)&&!scanned.has(walk.edge)){scanned.add(walk.edge);const prev=connections.get(walk.edge+':'+walk.end);walk={edge:prev.edge,end:1-prev.end};}if(!scanned.has(walk.edge))start=walk;
  const path=[];walk=start;while(!flips.has(walk.edge)){flips.set(walk.edge,walk.end===1);path.push({edge:walk.edge,reversed:walk.end===1});const next=connections.get(walk.edge+':'+(1-walk.end));if(!next)break;walk=next;}if(path.length)paths.push({id:paths.length,edges:path});
 }
 for(const n of nodes.values())if(n.pair){const dirs=n.pair.map(a=>{const e=eMap.get(a.edge),d=a.end?unit(sub(e.p3,E.bez(e,.99))):unit(sub(E.bez(e,.01),e.p0));return mul(d,flips.get(a.edge)?-1:1)});n.axis=unit(add(dirs[0],dirs[1]));}const local=mesh.uv.map(p=>p.slice()),next=[],groups=[],offsets=[],pinned=[],targets=[];const vertexNode=new Map();for(const t of mesh.triangles)if(t.region==='junction'){const n=nodes.get(pointKey(mesh.vertices[t.v[0]]));for(const v of t.v)vertexNode.set(v,n);}
 for(const t of mesh.triangles){const target={body:[],weights:[0,0],nodes:null};const e=eMap.get(t.edge),edge=edges.get(t.edge),ns=[nodes.get(pointKey(e.p0)),nodes.get(pointKey(e.p3))],flip=flips.get(t.edge);
  for(let i=0;i<3;i++){
   const v=t.v[i],p=mesh.vertices[v],base=local[t.uv[i]],body=flip?base.map(v=>1-v):base.slice(),u=base[0],shifts=ns.map((n,end)=>{if(!n.axis)return 0;const q=E.bez(e,end?1-n.trim/edge.length:n.trim/edge.length),d=sub(q,n.p);return Math.round(dot(d,[-n.axis[1],n.axis[0]])/n.half*frameScale)});body[1]+=(1-u)*shifts[0]+u*shifts[1];let out=body.slice(),influence=0;target.body.push(body);target.nodes=ns;
   for(let end=0;end<2;end++){const n=ns[end];if(!n.axis)continue;const phase=flip?1-end:end,d=sub(p,n.p),canonical=[phase+dot(d,n.axis)/n.ref,dot(d,[-n.axis[1],n.axis[0]])/n.half*frameScale+.5];
    let w;if(t.region==='junction')w=(u<.5?0:1)===end?1:0;else{const distance=(end?1-u:u)*edge.length,span=Math.min(edge.length*.24,mesh.effectiveWidth*spanFactor);w=1-smooth((distance-n.trim)/span);}influence+=w;target.weights[end]+=w/3;out=out.map((a,k)=>a*(1-w)+canonical[k]*w);
   }
   const node=vertexNode.get(v),end=node?(ns[0]===node?0:1):null,phase=node?(flip?1-end:end):0;groups.push(node?'node:'+pointKey(node.p)+':'+v:'edge:'+t.edge+':'+v);offsets.push(phase);pinned.push(!node&&influence<1e-8);t.uv[i]=next.length;next.push(out);
  }
  targets.push(target);
 }
 mesh.uv=next;const correction=untangle(mesh,groups,offsets,pinned,local,targets,frameScale);let flipsArea=0,total=0,collapse=0;for(const t of mesh.triangles){const area=Math.abs(E.area(t.v.map(i=>mesh.vertices[i]))),uvArea=E.area(t.uv.map(i=>mesh.uv[i]));total+=area;if(uvArea<0)flipsArea+=area;if(Math.abs(uvArea)<1e-14)collapse++;}const continuity=seams(mesh);mesh.uvLocal01=local;mesh.version=2;mesh.uvLayout='continuous junctions / periodic per-edge charts';mesh.uvPaths=paths;mesh.uvEdges=[...flips].map(([edge,reversed])=>({edge,reversed}));mesh.uvJunctions=[...nodes.values()].filter(n=>n.pair).map(n=>({position:n.p,mainEdges:n.pair.map(a=>a.edge),axis:n.axis}));mesh.audit.edgeLocalUVRanges=mesh.audit.edgeUVRanges;const ranges=new Map(mesh.edges.map(e=>[e.id,{edge:e.id,minU:Infinity,maxU:-Infinity,minV:Infinity,maxV:-Infinity}]));for(const t of mesh.triangles)for(const i of t.uv){const p=mesh.uv[i],r=ranges.get(t.edge);r.minU=Math.min(r.minU,p[0]);r.maxU=Math.max(r.maxU,p[0]);r.minV=Math.min(r.minV,p[1]);r.maxV=Math.max(r.maxV,p[1]);}mesh.audit.edgeUVRanges=[...ranges.values()];mesh.audit.uvPolicy='continuous periodic junctions; local 0–1 in uvLocal01';for(const e of mesh.edges){const r=ranges.get(e.id);e.localUVRange=e.uvRange;e.uvRange=[[r.minU,r.minV],[r.maxU,r.maxV]];}mesh.uvAudit={valid:!collapse&&flipsArea/total<1e-9&&continuity.maximumPeriodicJump<1e-7,flippedAreaFraction:flipsArea/total,collapsed:collapse,...continuity,...correction,method:'paired stroke paths / shared junction coordinates / finite-element gradient fit',unitPeriod:[1,1],localNormalization:'uvLocal01 retains per-source-edge 0–1; actual connection UV may extend outside',uvReuseIntentional:true};return mesh;
}
function untangle(mesh,groups,offsets,pins,original,targets,frameScale){
 const variables=[],lookup=new Map(),indices=groups.map((key,i)=>{if(!lookup.has(key)){lookup.set(key,variables.length);variables.push({uv:[mesh.uv[i][0]-offsets[i],mesh.uv[i][1]],pin:pins[i]});}return lookup.get(key)});
 const triangles=mesh.triangles.map(t=>({indices:t.uv.map(i=>indices[i]),offsets:t.uv.map(i=>offsets[i]),floor:Math.max(1e-11,Math.abs(E.area(t.uv.map(i=>original[i])))*1e-3)}));
 const rows=variables.map(()=>new Map()),rhs=variables.map(()=>[0,0]);
 for(let index=0;index<mesh.triangles.length;index++){
  const t=mesh.triangles[index],p=t.v.map(i=>mesh.vertices[i]),a=E.area(p),den=2*a,basis=[[p[1][1]-p[2][1],p[2][0]-p[1][0]],[p[2][1]-p[0][1],p[0][0]-p[2][0]],[p[0][1]-p[1][1],p[1][0]-p[0][0]]].map(g=>mul(g,1/den)),target=targets[index],gradient=[0,1].map(k=>basis.reduce((sum,g,j)=>add(sum,mul(g,target.body[j][k])),[0,0]));
  for(let end=0;end<2;end++){const n=target.nodes[end],w=target.weights[end];if(!n?.axis||!w)continue;const canonical=[mul(n.axis,1/n.ref),mul([-n.axis[1],n.axis[0]],frameScale/n.half)];for(let k=0;k<2;k++)gradient[k]=add(mul(gradient[k],1-w),mul(canonical[k],w));}
  const variablesOf=t.uv.map(i=>indices[i]),off=t.uv.map(i=>offsets[i]),gradOff=basis.reduce((sum,g,j)=>add(sum,mul(g,off[j])),[0,0]);gradient[0]=sub(gradient[0],gradOff);
  for(let i=0;i<3;i++){const v=variablesOf[i];for(let j=0;j<3;j++){const w=a*dot(basis[i],basis[j]),n=variablesOf[j];rows[v].set(n,(rows[v].get(n)||0)+w);}for(let k=0;k<2;k++)rhs[v][k]+=a*dot(basis[i],gradient[k]);}
 }
 const free=variables.map((v,i)=>v.pin?-1:i).filter(i=>i>=0),map=new Map(free.map((id,i)=>[id,i])),matrix=free.map(id=>[...rows[id]].filter(([j])=>map.has(j)).map(([j,w])=>[map.get(j),w])),diag=free.map(id=>rows[id].get(id)),product=x=>matrix.map(row=>row.reduce((sum,[j,w])=>sum+w*x[j],0)),inner=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
 for(let k=0;k<2;k++){
  const b=free.map(id=>rhs[id][k]-[...rows[id]].reduce((sum,[j,w])=>sum+(variables[j].pin?w*variables[j].uv[k]:0),0));let x=free.map(id=>variables[id].uv[k]),ax=product(x),r=b.map((v,i)=>v-ax[i]);let z=r.map((v,i)=>v/diag[i]),d=z.slice(),rz=inner(r,z),normB=Math.max(1,inner(b,b));
  for(let it=0;it<600&&inner(r,r)>normB*1e-16;it++){const ad=product(d),den=inner(d,ad);if(den<1e-30)break;const alpha=rz/den;x=x.map((v,i)=>v+alpha*d[i]);r=r.map((v,i)=>v-alpha*ad[i]);z=r.map((v,i)=>v/diag[i]);const next=inner(r,z),beta=next/Math.max(rz,1e-30);d=z.map((v,i)=>v+beta*d[i]);rz=next;}free.forEach((id,i)=>variables[id].uv[k]=x[i]);
 }
 let bad=0,iterations=0;
 for(;iterations<600;iterations++){
  bad=0;for(const t of triangles){const p=t.indices.map((v,i)=>[variables[v].uv[0]+t.offsets[i],variables[v].uv[1]]),area=E.area(p);if(area>=t.floor)continue;bad++;const grads=[[p[1][1]-p[2][1],p[2][0]-p[1][0]],[p[2][1]-p[0][1],p[0][0]-p[2][0]],[p[0][1]-p[1][1],p[1][0]-p[0][0]]].map(g=>mul(g,.5));let norm=0;for(let j=0;j<3;j++)if(!variables[t.indices[j]].pin)norm+=dot(grads[j],grads[j]);if(norm<1e-30)continue;const alpha=(t.floor-area)/norm*.95;for(let j=0;j<3;j++){const v=variables[t.indices[j]];if(!v.pin)v.uv=add(v.uv,mul(grads[j],alpha));}}
  if(!bad)break;
 }
 mesh.uv=mesh.uv.map((p,i)=>[variables[indices[i]].uv[0]+offsets[i],variables[indices[i]].uv[1]]);return {areaFloorResiduals:bad,orientationIterations:iterations};
}

 function seams(mesh){
  const owners=new Map();let maximumPeriodicJump=0,maximumRawJump=0,sharedEdges=0;
  for(const t of mesh.triangles)for(let i=0;i<3;i++){
   const a=t.v[i],b=t.v[(i+1)%3],key=a<b?a+':'+b:b+':'+a,points=new Map([[a,mesh.uv[t.uv[i]]],[b,mesh.uv[t.uv[(i+1)%3]]]]);
   if(!owners.has(key)){owners.set(key,points);continue;}const other=owners.get(key),d=[a,b].map(v=>sub(points.get(v),other.get(v)));sharedEdges++;
   for(let k=0;k<2;k++){const whole=Math.round(d[0][k]);maximumPeriodicJump=Math.max(maximumPeriodicJump,Math.abs(d[0][k]-whole),Math.abs(d[1][k]-whole));maximumRawJump=Math.max(maximumRawJump,Math.abs(d[0][k]),Math.abs(d[1][k]));}
  }
  return {sharedEdges,maximumPeriodicJump,maximumRawJump};
 }
 return {fit,seams};
}
if(typeof module!=='undefined')module.exports=makeBoundaryUV;
if(typeof window!=='undefined')window.makeBoundaryUV=makeBoundaryUV;

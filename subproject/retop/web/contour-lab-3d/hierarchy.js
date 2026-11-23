/* Progressive quad cage fitting and actual Catmull-Clark subdivision. */
function createContourHierarchy(E){
  'use strict';
  const {add,sub,mul,dot,cross,unit,len,dist,clamp,key}=E,MAX_TRIANGLES=65536;
  const mean=points=>mul(points.reduce((s,p)=>add(s,p),[0,0,0]),1/points.length);
  // 统一按三角化面数（四边面计2个三角面、三角面计1个）统计预算
  const triangleCount=m=>m.faces.reduce((s,f)=>s+f.length-2,0);
  const midTriangleLimit=options=>Math.min(MAX_TRIANGLES,options.lowTriangleBudget*6*4**(options.midSubdivisions-1));
  function requireQuads(m){if(!m.faces.length||m.faces.some(f=>f.length!==4||new Set(f).size!==4))throw Error('此路径要求真实、非退化四边面。');const a=E.audit(m);if(!a.valid)throw Error('四边网格基础检查失败。');return a;}
  function compatible(a,b){return a.components===b.components&&JSON.stringify(a.euler)===JSON.stringify(b.euler)&&a.boundaryLoops===b.boundaryLoops;}
  function propagateMetadata(m,out,parents){for(const name of ['faceSources','faceKinds','primitiveGroups','smoothingGroups'])if(m[name])out[name]=parents.map(i=>m[name][i]);out.faceParents=parents;return out;}
  function splitSupports(m,out,edgeIds){if(m.supportKeys)out.supportKeys=m.supportKeys.flatMap(k=>edgeIds.has(k)?(()=>{const [a,b]=k.split(':').map(Number),v=edgeIds.get(k);return [key(a,v),key(v,b)];})():[k]);}
  function quadify(input){const before=E.audit(input);if(!before.valid)throw Error('四边化输入存在退化或非流形。');if(input.faces.every(f=>f.length===4)){const m=E.copy(input);m.quadConversion={method:'already quads',beforeFaces:input.faces.length,afterFaces:input.faces.length,splitEdges:0};return m;}
    const t=E.topology(input),marked=new Set(),queue=[];function mark(k){if(!marked.has(k)){marked.add(k);queue.push(k);}}input.faces.forEach(f=>{if(f.length!==4)f.forEach((v,i)=>mark(key(v,f[(i+1)%f.length])));});for(let q=0;q<queue.length;q++){const e=t.edges.get(queue[q]);for(const fi of e.faces){const f=input.faces[fi];if(f.length===4){const j=f.findIndex((v,i)=>key(v,f[(i+1)%4])===queue[q]);mark(key(f[(j+2)%4],f[(j+3)%4]));}}}
    const vertices=input.vertices.map(p=>p.slice()),edges=new Map(),faces=[],parents=[];for(const k of marked){const e=t.edges.get(k);edges.set(k,vertices.length);vertices.push(mul(add(input.vertices[e.a],input.vertices[e.b]),.5));}
    input.faces.forEach((f,fi)=>{const split=f.map((v,i)=>edges.get(key(v,f[(i+1)%f.length]))),count=split.filter(v=>v!==undefined).length,emit=face=>{faces.push(face);parents.push(fi);};if(!count){emit(f.slice());return;}if(f.length===4&&count===2){const j=split.findIndex(v=>v!==undefined),v=Array.from({length:4},(_,i)=>f[(j+i)%4]),a=split[j],b=split[(j+2)%4];emit([v[0],a,b,v[3]]);emit([a,v[1],v[2],b]);}else{if(count!==f.length)throw Error('四边过渡出现不一致的边细分。');const c=vertices.length;vertices.push(mean(f.map(i=>input.vertices[i])));f.forEach((v,i)=>emit([v,split[i],c,split[(i+f.length-1)%f.length]]));}});
    const out=propagateMetadata(input,{...input,vertices,faces},parents);delete out.sourceMap;splitSupports(input,out,edges);out.quadConversion={method:'non-quad caps split into quads; opposite-edge propagation through neighboring quads',beforeFaces:input.faces.length,afterFaces:faces.length,splitEdges:marked.size};if(out.primitive)out.primitive={...out.primitive,proxy:{...out.primitive.proxy,triangles:faces.length*2,quads:faces.length},quadConversion:out.quadConversion};const after=requireQuads(out);if(!compatible(before,after))throw Error('四边过渡改变了壳体、孔洞或开放边。');return out;
  }
  function subdivide(input,smooth=false,options={}){requireQuads(input);if(triangleCount(input)*4>MAX_TRIANGLES)throw Error('细分将超过65536个三角面预算，请降低细分或涡轮级数。');const m=input,t=E.topology(m),fp=m.faces.map(f=>mean(f.map(i=>m.vertices[i]))),vertexEdges=m.vertices.map(()=>[]);for(const e of t.edges.values()){vertexEdges[e.a].push(e);vertexEdges[e.b].push(e);}const vertices=m.vertices.map((p,i)=>{if(!smooth)return p.slice();const incident=t.incident[i],edges=vertexEdges[i],boundary=edges.filter(e=>e.faces.length===1);if(!incident.length||options.boundary==='PRESERVE_CORNERS'&&incident.length===1)return p.slice();if(boundary.length===2)return add(mul(p,.75),mul(add(m.vertices[boundary[0].a===i?boundary[0].b:boundary[0].a],m.vertices[boundary[1].a===i?boundary[1].b:boundary[1].a]),.125));if(boundary.length)return p.slice();const n=edges.length,F=mean(incident.map(fi=>fp[fi])),R=mean(edges.map(e=>mul(add(m.vertices[e.a],m.vertices[e.b]),.5)));return mul(add(add(F,mul(R,2)),mul(p,n-3)),1/n);}),edgeIds=new Map(),faceIds=[];
    for(const [k,e]of t.edges){edgeIds.set(k,vertices.length);vertices.push(smooth&&e.faces.length===2?mul(add(add(m.vertices[e.a],m.vertices[e.b]),add(fp[e.faces[0]],fp[e.faces[1]])),.25):mul(add(m.vertices[e.a],m.vertices[e.b]),.5));}fp.forEach(p=>{faceIds.push(vertices.length);vertices.push(p);});const faces=[],parents=[];m.faces.forEach((f,fi)=>f.forEach((v,j)=>{faces.push([v,edgeIds.get(key(v,f[(j+1)%4])),faceIds[fi],edgeIds.get(key(f[(j+3)%4],v))]);parents.push(fi);}));const out=propagateMetadata(m,{vertices,faces},parents);splitSupports(m,out,edgeIds);out.subdivision={method:smooth?'Catmull-Clark':'linear quad refinement',parentFingerprint:E.fingerprint(m),parentFaces:m.faces.length,childFaces:faces.length,edgePointIndices:Object.fromEntries(edgeIds),facePointIndices:faceIds};requireQuads(out);return out;
  }
  function surface(source){const tr=E.triangulate(source),topology=E.topology(source),components=new Int32Array(source.faces.length).fill(-1);let count=0;for(let fi=0;fi<source.faces.length;fi++)if(components[fi]<0){const q=[fi];components[fi]=count;for(let i=0;i<q.length;i++)for(const j of topology.adj[q[i]])if(components[j]<0){components[j]=count;q.push(j);}count++;}
    const triangles=tr.faces.map((f,i)=>{const points=f.map(j=>tr.vertices[j]),lo=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));return {points,lo,hi,normal:unit(cross(sub(points[1],points[0]),sub(points[2],points[0]))),face:tr.source[i],component:components[tr.source[i]]};});
    function tree(items){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const t of items)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],t.lo[k]);hi[k]=Math.max(hi[k],t.hi[k]);}if(items.length<=8)return {lo,hi,items};const axis=[0,1,2].sort((a,b)=>hi[b]-lo[b]-hi[a]+lo[a])[0];items.sort((a,b)=>a.lo[axis]+a.hi[axis]-b.lo[axis]-b.hi[axis]);const half=items.length>>1;return {lo,hi,left:tree(items.slice(0,half)),right:tree(items.slice(half))};}const root=tree(triangles),box=(p,n)=>p.reduce((s,x,k)=>s+Math.max(n.lo[k]-x,0,x-n.hi[k])**2,0);
    function closestTriangle(p,a,b,c){const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return a;const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return add(a,mul(ab,d1/(d1-d3)));const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return add(a,mul(ac,d2/(d2-d6)));const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,mul(sub(c,b),(d4-d3)/(d4-d3+d5-d6)));const denominator=1/(va+vb+vc);return add(a,add(mul(ab,vb*denominator),mul(ac,vc*denominator)));}
    function closest(p,normal=null,component=null,allowFace=null){let best=Infinity,hit=null;const stack=[{n:root,d:box(p,root)}];while(stack.length){const {n,d}=stack.pop();if(d>best)continue;if(n.items){for(const t of n.items){if(component!==null&&t.component!==component||normal&&dot(t.normal,normal)<.12||allowFace&&!allowFace(t.face))continue;const point=closestTriangle(p,...t.points),delta=sub(point,p),distance=dot(delta,delta);if(distance<best){best=distance;hit={point,face:t.face,component:t.component,distance:Math.sqrt(distance),normal:t.normal};}}}else{const a={n:n.left,d:box(p,n.left)},b={n:n.right,d:box(p,n.right)};a.d<b.d?stack.push(b,a):stack.push(a,b);}}return hit;}
    return {closest,components,count,topology,source,scale:E.bounds(source).diagonal};
  }
  function featureData(s,keys){const adjacency=new Map(),segments=[];for(const k of [...new Set(keys)]){const e=s.topology.edges.get(k);if(!e)continue;const segment={key:k,a:s.source.vertices[e.a],b:s.source.vertices[e.b],component:s.components[e.faces[0]],normals:e.faces.map(fi=>s.topology.data[fi].normal)};segments.push(segment);for(const vi of [e.a,e.b]){if(!adjacency.has(vi))adjacency.set(vi,[]);adjacency.get(vi).push(segment);}}const nodes=[];for(const [vi,edges]of adjacency)if(edges.length!==2)nodes.push({point:s.source.vertices[vi],segments:edges,id:vi});return {segments,nodes};}
  function onSegment(p,a,b){const d=sub(b,a);return add(a,mul(d,clamp(dot(sub(p,a),d)/(dot(d,d)||1),0,1)));}
  function featureTarget(p,normal,component,features,radius){let best=null;const accepts=s=>s.component===component&&s.normals.some(n=>dot(n,normal)>.12);for(const node of features.nodes){if(!node.segments.some(accepts))continue;const d=dist(p,node.point);if(d<=radius&&(!best||d<best.distance))best={point:node.point,distance:d,node:node.id,key:node.segments[0].key};}if(best)return best;for(const segment of features.segments){if(!accepts(segment))continue;const point=onSegment(p,segment.a,segment.b),d=dist(p,point);if(d<=radius&&(!best||d<best.distance))best={point,distance:d,key:segment.key};}return best;}
  function fit(input,s,features,options={}){let m=E.copy(input);delete m.primitive;delete m.primitiveGroups;delete m.sourceMap;const fingerprint=E.fingerprint(input),passes=options.fitIterations??4,strength=options.fitStrength??.85,scale=s.scale,t=E.topology(m),vertexEdges=m.vertices.map(()=>new Set());for(const e of t.edges.values()){vertexEdges[e.a].add(e.b);vertexEdges[e.b].add(e.a);}const assignments=[],seen=new Set();for(let start=0;start<m.vertices.length;start++)if(!seen.has(start)){const q=[start],votes=new Map();seen.add(start);for(let i=0;i<q.length;i++){const vi=q[i],hit=s.closest(m.vertices[vi]);if(hit)votes.set(hit.component,(votes.get(hit.component)||0)+1);for(const v of vertexEdges[vi])if(!seen.has(v)){seen.add(v);q.push(v);}}const component=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0]??0;for(const vi of q)assignments[vi]=component;}
    const iterations=[],keyNodes=new Set(),snapped=new Set();let rejected=0,unmatched=0;
    for(let iteration=0;iteration<passes;iteration++){const snapshot=m.vertices.map(p=>p.slice()),data=m.faces.map(f=>E.faceData(m,f)),normals=m.vertices.map((p,i)=>unit(t.incident[i].reduce((n,fi)=>add(n,mul(data[fi].normal,data[fi].area)),[0,0,0]))),oldTriangles=m.faces.map(f=>[[f[0],f[1],f[2]],[f[0],f[2],f[3]]].map(ids=>unit(cross(sub(snapshot[ids[1]],snapshot[ids[0]]),sub(snapshot[ids[2]],snapshot[ids[0]])))));let moved=0,maxMove=0;
      for(let vi=0;vi<m.vertices.length;vi++){const p=snapshot[vi],normal=normals[vi],neighbors=[...vertexEdges[vi]],query=p,hit=s.closest(query,normal,assignments[vi]);if(!hit){unmatched++;continue;}const localSize=neighbors.reduce((n,v)=>n+dist(p,snapshot[v]),0)/neighbors.length,capture=Math.min(scale*.025,localSize*.28),feature=featureTarget(p,normal,assignments[vi],features,capture);const useFeature=feature&&feature.distance<=hit.distance+Math.min(scale*.004,localSize*.1);let target=useFeature?feature.point:hit.point;if(!useFeature){const near=featureTarget(hit.point,normal,assignments[vi],features,capture*.6);if(near&&near.distance<=Math.min(scale*.004,localSize*.1)){target=near.point;snapped.add(near.key);if(near.node!==undefined)keyNodes.add(near.node);}}else{snapped.add(feature.key);if(feature.node!==undefined)keyNodes.add(feature.node);}let delta=sub(target,p),length=len(delta);if(length<scale*1e-10)continue;delta=mul(delta,Math.min(strength,scale*.08/length));let accepted=false;
        for(let factor=1;factor>=1/128;factor*=.5){const candidate=add(p,mul(delta,factor));m.vertices[vi]=candidate;let valid=true;for(const fi of t.incident[vi]){const f=m.faces[fi],ps=f.map(i=>m.vertices[i]);if(ps.some((q,j)=>dist(q,ps[(j+1)%4])<scale*1e-5)){valid=false;break;}const fn=add(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),cross(sub(ps[2],ps[0]),sub(ps[3],ps[0]))),quadNormal=unit(fn);if(ps.some((p,j)=>dot(cross(sub(ps[(j+1)%4],p),sub(ps[(j+2)%4],ps[(j+1)%4])),quadNormal)<=scale*scale*1e-12)){valid=false;break;}for(const [j,ids]of [[0,[0,1,2]],[1,[0,2,3]]]){const n=cross(sub(ps[ids[1]],ps[ids[0]]),sub(ps[ids[2]],ps[ids[0]]));if(len(n)<scale*scale*1e-12||dot(unit(n),oldTriangles[fi][j])<.08){valid=false;break;}}if(!valid)break;}if(valid){const d=dist(candidate,p);maxMove=Math.max(maxMove,d);if(d>scale*1e-9)moved++;accepted=true;break;}}
        if(!accepted){m.vertices[vi]=p.slice();rejected++;}
      }
      iterations.push({iteration:iteration+1,moved,maxMoveRelative:maxMove/scale});
    }
    m.faceSources=m.faces.map(f=>{const d=E.faceData(m,f);return s.closest(d.center,d.normal,assignments[f[0]])?.face??s.closest(d.center)?.face??0;});m.fitReport={method:'normal-compatible closest-surface fitting with component locking, source feature attraction and local orientation line search',parentFingerprint:fingerprint,iterations,matchedFeatureEdges:snapped.size,matchedKeyNodes:keyNodes.size,rejectedMoves:rejected,unmatchedQueries:unmatched,sourceComponents:s.count,usedSourceComponents:[...new Set(assignments)],sourceUnrepresentedComponents:s.count-new Set(assignments).size};m.method='继承规则体的四边细分 + 转折/关键节点拟合';requireQuads(m);if(E.fingerprint(input)!==fingerprint)throw Error('拟合修改了父级网格。');return m;
  }
  function mapFeatures(m,s,features){const topology=E.topology(m),scale=s.scale,keys=[],mapping=[];for(const [k,e]of topology.edges){if(e.faces.length!==2)continue;const a=m.vertices[e.a],b=m.vertices[e.b],mid=mul(add(a,b),.5),direction=unit(sub(b,a)),radius=Math.min(scale*.025,dist(a,b)*.65);let best=null;const component=s.components[m.faceSources?.[e.faces[0]]]??s.closest(mid)?.component;for(const segment of features.segments){if(segment.component!==component||!segment.normals.some(n=>e.faces.some(fi=>dot(n,topology.data[fi].normal)>.12)))continue;const point=onSegment(mid,segment.a,segment.b),distance=dist(mid,point);if(distance>radius||Math.abs(dot(direction,unit(sub(segment.b,segment.a))))<.65)continue;const score=distance/scale+(1-Math.abs(dot(direction,unit(sub(segment.b,segment.a)))))*.02;if(!best||score<best.score)best={source:segment.key,score};}if(best){keys.push(k);mapping.push({cage:k,source:best.source});}}return {keys,mapping};}
  function supportPlan(input,t,selected){const cuts=new Map(),queue=[];
    function mark(a,b,fromStart){const k=key(a,b),side=(a<b?fromStart:!fromStart)?0:1;if(!cuts.has(k))cuts.set(k,new Set());if(!cuts.get(k).has(side)){cuts.get(k).add(side);queue.push([k,side]);}}
    input.faces.forEach(f=>f.forEach((a,j)=>{const b=f[(j+1)%4];if(selected.has(key(a,b))){mark(a,f[(j+3)%4],true);mark(b,f[(j+2)%4],true);}}));
    for(let q=0;q<queue.length;q++){const [k,side]=queue[q];for(const fi of t.edges.get(k).faces){const f=input.faces[fi],j=f.findIndex((v,i)=>key(v,f[(i+1)%4])===k),local=f[j]<f[(j+1)%4]?side:1-side;mark(f[(j+3)%4],f[(j+2)%4],local===0);}}
    const triangleTotal=input.faces.reduce((s,f)=>s+((cuts.get(key(f[0],f[1]))?.size||0)+1)*((cuts.get(key(f[0],f[3]))?.size||0)+1)*2,0);return {cuts,triangleCount:triangleTotal};
  }
  function supportBands(input,selectedKeys,width,budget=MAX_TRIANGLES,mandatory=0){
    requireQuads(input);const t=E.topology(input),keys=[...new Set(selectedKeys)].filter(k=>t.edges.get(k)?.faces.length===2),requested=keys.length;let selected=new Set(keys);if(!selected.size||width<=0)return {...E.copy(input),supportKeys:[],supportReport:{requested:selected.size,beveled:0,reason:width<=0?'宽度为零':'没有匹配到可插入卡线的结构边'}};
    let plan=supportPlan(input,t,selected);if(plan.triangleCount>budget){let lo=0,hi=keys.length;while(lo<hi){const mid=Math.ceil((lo+hi)/2),probe=supportPlan(input,t,new Set(keys.slice(0,mid)));if(probe.triangleCount<=budget)lo=mid;else hi=mid-1;}selected=new Set(keys.slice(0,lo));plan=supportPlan(input,t,selected);}
    const cuts=plan.cuts,scale=E.bounds(input).diagonal,average=[...t.edges.values()].reduce((s,e)=>s+dist(input.vertices[e.a],input.vertices[e.b]),0)/t.edges.size,fraction=clamp(width*scale/average,.025,.18);
    const vertices=input.vertices.map(p=>p.slice()),edgePoints=new Map(),faces=[],parents=[],kinds=[],supportKeys=[];
    for(const [k,sides]of cuts){const e=t.edges.get(k);for(const side of sides){const f=side===0?fraction:1-fraction;edgePoints.set(k+'/'+side,vertices.length);vertices.push(add(mul(input.vertices[e.a],1-f),mul(input.vertices[e.b],f)));}}
    function atEdge(a,b,f){if(f===0)return a;if(f===1)return b;const side=(f<.5?0:1)^(a>b?1:0);return edgePoints.get(key(a,b)+'/'+side);}
    function values(a,b){return [0,...[...(cuts.get(key(a,b))||[])].map(s=>a<b?s:1-s).sort().map(s=>s===0?fraction:1-fraction),1];}
    input.faces.forEach((f,fi)=>{const us=values(f[0],f[1]),vs=values(f[0],f[3]),grid=vs.map((v,j)=>us.map((u,i)=>{if(j===0)return atEdge(f[0],f[1],u);if(j===vs.length-1)return atEdge(f[3],f[2],u);if(i===0)return atEdge(f[0],f[3],v);if(i===us.length-1)return atEdge(f[1],f[2],v);const id=vertices.length;vertices.push(add(add(mul(input.vertices[f[0]],(1-u)*(1-v)),mul(input.vertices[f[1]],u*(1-v))),add(mul(input.vertices[f[2]],u*v),mul(input.vertices[f[3]],(1-u)*v))));return id;}));
      const edges=f.map((a,j)=>selected.has(key(a,f[(j+1)%4])));for(let j=0;j<vs.length-1;j++)for(let i=0;i<us.length-1;i++){faces.push([grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]]);parents.push(fi);kinds.push((edges[0]&&j===0||edges[1]&&i===us.length-2||edges[2]&&j===vs.length-2||edges[3]&&i===0)?'bevel':'surface');}
      if(edges[0])for(let i=0;i<us.length-1;i++)supportKeys.push(key(grid[1][i],grid[1][i+1]));if(edges[2])for(let i=0;i<us.length-1;i++)supportKeys.push(key(grid.at(-2)[i],grid.at(-2)[i+1]));if(edges[3])for(let j=0;j<vs.length-1;j++)supportKeys.push(key(grid[j][1],grid[j+1][1]));if(edges[1])for(let j=0;j<vs.length-1;j++)supportKeys.push(key(grid[j].at(-2),grid[j+1].at(-2)));
    });
    if(faces.length*2>MAX_TRIANGLES)throw Error('卡线支撑带超过65536个三角面预算，请降低细分级数。');const out=propagateMetadata(input,{vertices,faces},parents);out.faceKinds=kinds;out.supportKeys=[...new Set(supportKeys)];out.supportReport={requested,beveled:selected.size,deferredForBudget:requested-selected.size,deferredManualCandidates:Math.max(0,mandatory-selected.size),targetTriangles:budget,method:'沿结构边两侧插入四边支撑带；对边传播确保共享连接，无独立多边形封口',widthRelative:width,actualEdgeFraction:fraction,bevelFaces:kinds.filter(k=>k==='bevel').length,geometricChamfer:false};requireQuads(out);return out;
  }
  function limitSurface(input,{boundary='ALL'}={}){
    requireQuads(input);const t=E.topology(input),neighbors=input.vertices.map(()=>[]),boundaryNeighbors=input.vertices.map(()=>[]);
    for(const e of t.edges.values())for(const [a,b]of [[e.a,e.b],[e.b,e.a]]){neighbors[a].push(b);if(e.faces.length===1)boundaryNeighbors[a].push(b);}
    const vertices=input.vertices.map((p,i)=>{const incident=t.incident[i],border=boundaryNeighbors[i];if(!incident.length||boundary==='PRESERVE_CORNERS'&&incident.length===1)return p.slice();if(border.length===2)return add(mul(p,2/3),mul(add(input.vertices[border[0]],input.vertices[border[1]]),1/6));if(border.length)return p.slice();const n=neighbors[i].length,opposite=incident.map(fi=>{const f=input.faces[fi];return input.vertices[f[(f.indexOf(i)+2)%4]];});return mul(add(add(mul(p,n*n),mul(neighbors[i].reduce((s,j)=>add(s,input.vertices[j]),[0,0,0]),4)),opposite.reduce((s,q)=>add(s,q),[0,0,0])),1/(n*(n+5)));});
    return {...input,vertices};
  }
  function turboSmooth(input,iterations=1,options={}){requireQuads(input);if(!Number.isInteger(iterations)||iterations<1||iterations>3)throw Error('涡轮平滑级数为1～3。');const parent=E.fingerprint(input),limit=options.limitSurface!==false,boundary=options.boundary??'ALL';if(!['ALL','PRESERVE_CORNERS'].includes(boundary))throw Error('未知的细分边界规则。');let mesh=E.copy(input);for(let i=0;i<iterations;i++)mesh=subdivide(mesh,true,{boundary});if(limit)mesh=limitSurface(mesh,{boundary});mesh.method='涡轮平滑 · Catmull–Clark '+iterations+'级'+(limit?' / 极限曲面':' / 有限级细分');mesh.smoothingGroups=mesh.faces.map(()=>1);mesh.turboReport={method:'Catmull-Clark',iterations,limitSurface:limit,boundarySmooth:boundary,parentFingerprint:parent,parentFaces:input.faces.length,childFaces:mesh.faces.length,projectedToHigh:false};if(E.fingerprint(input)!==parent)throw Error('平滑修改了中模父级。');return mesh;}
  function creaseChains(cage,topology,groups,shape,proposal,options,sourceRegions,detailKeys){
    const manual=new Set(options.manualEdges||[]),excluded=new Set(options.excludedEdges||[]),geo=shape.topology;
    const regions=(proposal.patchGroups||[]).map(g=>sourceRegions.get(g)??g),pairKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
    const byPair=new Map(),explicit=[];
    for(const k of new Set([...(proposal.rawKeys||[]),...detailKeys,...manual])){
      const edge=geo.edges.get(k);
      if(!edge||edge.faces.length!==2||excluded.has(k))continue;
      const [a,b]=edge.faces,angle=dot(geo.data[a].normal,geo.data[b].normal);
      const segment={a:shape.source.vertices[edge.a],b:shape.source.vertices[edge.b],angle,manual:manual.has(k)};
      if(segment.manual)explicit.push(segment);
      const pair=pairKey(regions[a],regions[b]);
      if(!byPair.has(pair))byPair.set(pair,[]);
      byPair.get(pair).push(segment);
    }
    const choices=new Map(),hard=Math.cos(32*Math.PI/180);
    for(const [k,e]of topology.edges){
      if(e.faces.length!==2)continue;
      const [i,j]=e.faces,a=cage.vertices[e.a],b=cage.vertices[e.b],center=mul(add(a,b),.5),length=dist(a,b);
      const angle=dot(topology.data[i].normal,topology.data[j].normal),pair=pairKey(groups[i],groups[j]),direction=unit(sub(b,a));
      const around=(byPair.get(pair)||[]).concat(explicit),radius=Math.min(shape.scale*.025,length*.7);
      const matching=around.filter(s=>Math.abs(dot(direction,unit(sub(s.b,s.a))))>.68&&dist(center,onSegment(center,s.a,s.b))<=radius);
      const strong=matching.some(s=>s.manual),sourceAngle=matching.reduce((v,s)=>Math.min(v,s.angle),1);
      const doubleEvidence=angle<hard&&sourceAngle<Math.cos(23*Math.PI/180);
      const mappedHard=angle<Math.cos(18*Math.PI/180)&&sourceAngle<Math.cos(46*Math.PI/180);
      if(!strong&&!doubleEvidence&&!mappedHard)continue;
      choices.set(k,{key:k,a:e.a,b:e.b,pair,manual:strong,score:length*(1-angle)*(1+.5*(1-sourceAngle))});
    }
    const nearby=new Map();
    for(const e of choices.values())for(const id of [e.a,e.b]){
      const k=`${e.pair}/${id}`;
      if(!nearby.has(k))nearby.set(k,[]);
      nearby.get(k).push(e);
    }
    const chains=[],used=new Set();
    for(const start of choices.values()){
      if(used.has(start.key))continue;
      const edges=[start];used.add(start.key);
      for(let i=0;i<edges.length;i++)for(const id of [edges[i].a,edges[i].b]){
        const list=nearby.get(`${edges[i].pair}/${id}`);
        if(list.length!==2)continue;
        for(const e of list)if(!used.has(e.key)){edges.push(e);used.add(e.key);}
      }
      const manual=edges.some(e=>e.manual),[a,b]=topology.edges.get(start.key).faces;
      // 同一大面上的自动硬折边需要连续证据，单条手动边仍能独立生成卡线。
      if(edges.length===1&&!manual&&groups[a]===groups[b])continue;
      chains.push({edges:edges.map(e=>e.key),manual,score:edges.reduce((sum,e)=>sum+e.score,0)});
    }
    return chains.sort((a,b)=>Number(b.manual)-Number(a.manual)||b.score-a.score);
  }

  function midCage(cage,topology,bands,regular,width,grid){
    const vertices=cage.vertices.map(p=>p.slice()),faces=[],faceParents=[],faceKinds=[],samples=new Map(),cuts=new Map();
    const lerp=(a,b,t)=>add(mul(a,1-t),mul(b,t));
    function sample(a,b,t){
      const k=key(a,b),station=a<b?t:1-t;
      if(!samples.has(k))samples.set(k,new Map());
      const list=samples.get(k),tag=Math.round(station*1e9);
      if(!list.has(tag)){list.set(tag,{station,id:vertices.length});vertices.push(lerp(cage.vertices[a],cage.vertices[b],t));}
      return list.get(tag).id;
    }
    const inset=(a,b)=>clamp(width/dist(cage.vertices[a],cage.vertices[b]),.022,.24);
    const byCrease=new Map();
    for(const band of bands)for(const crease of band.edges){
      const sides=[];byCrease.set(crease,sides);
      for(const fi of topology.edges.get(crease).faces){
        const f=cage.faces[fi],n=f.length,j=f.findIndex((a,i)=>key(a,f[(i+1)%n])===crease);
        const a=f[j],b=f[(j+1)%n],left=f[(j+n-1)%n],right=f[(j+2)%n];
        const lt=inset(a,left),rt=inset(b,right);
        const p=sample(a,left,lt),q=sample(b,right,rt),side=[];
        if(!cuts.has(fi))cuts.set(fi,[]);
        cuts.get(fi).push({p,q,side,corner:a});sides.push(side);
      }
    }
    for(const k of regular){const e=topology.edges.get(k);sample(e.a,e.b,.5);}
    const seamPaths=new Map();
    for(const [k,list]of samples){const [a,b]=k.split(':').map(Number);seamPaths.set(k,[a,...[...list.values()].sort((x,y)=>x.station-y.station).map(s=>s.id),b]);}
    const square=[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],triangle=[[0,0,0],[1,0,0],[0,1,0]];
    const signed=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    const eps=1e-9;
    cage.faces.forEach((f,fi)=>{
      const n=f.length,parameters=n===4?square:triangle,uv=new Map(),border=[],lines=(cuts.get(fi)||[]).slice(),midpoints=[];
      f.forEach((a,j)=>{
        const b=f[(j+1)%n],k=key(a,b),origin=parameters[j],destination=parameters[(j+1)%n];
        uv.set(a,origin);border.push(a);
        const ordered=[...(samples.get(k)?.values()||[])].sort((x,y)=>(x.station-y.station)*(a<b?1:-1));
        for(const s of ordered){uv.set(s.id,lerp(origin,destination,a<b?s.station:1-s.station));border.push(s.id);}
        midpoints[j]=samples.get(k)?.get(5e8)?.id;
      });
      const vertexAt=p=>{
        for(const [id,q]of uv)if(Math.abs(p[0]-q[0])<eps&&Math.abs(p[1]-q[1])<eps)return id;
        const [u,v]=p,points=f.map(id=>cage.vertices[id]),id=vertices.length;
        // 以低模的原三角面作为拟合起点，避免较扭的四边面在新采样处改变凹凸方向。
        const first=n===3||u>=v;
        const alongU=sub(points[first?1:2],points[first?0:3]),alongV=sub(points[n===3||first?2:3],points[n===3||!first?0:1]);
        vertices.push(add(points[0],add(mul(alongU,u),mul(alongV,v))));
        uv.set(id,p);return id;
      };
      const emit=(face,kind)=>{faces.push(face);faceParents.push(cage.faceParents[fi]);faceKinds.push(cage.faceKinds?.[fi]==='bevel'?'bevel':kind);};
      if(n===3&&border.length===6&&!lines.length&&midpoints.every(id=>id!==undefined)){
        const center=vertexAt([1/3,1/3,0]);
        for(let j=0;j<3;j++)emit([f[j],midpoints[j],center,midpoints[(j+2)%3]],'surface');
        return;
      }
      if(n===4)for(let j=0;j<2;j++)if(midpoints[j]!==undefined&&midpoints[j+2]!==undefined)lines.push({p:midpoints[j],q:midpoints[j+2]});
      let cells=[border];
      // 每条卡线切开当前面域，遇到相交线时共用交点。相邻面共用边缘站位，转角和收线不会产生悬挂点。
      for(const {p,q}of lines){
        const a=uv.get(p),b=uv.get(q);
        cells=cells.flatMap(cell=>{
          const ds=cell.map(id=>signed(a,b,uv.get(id)));
          if(!ds.some(d=>d>eps)||!ds.some(d=>d< -eps))return [cell];
          const left=[],right=[];
          cell.forEach((id,i)=>{
            const j=(i+1)%cell.length,d=ds[i],next=ds[j];
            if(d>=-eps)left.push(id);
            if(d<=eps)right.push(id);
            if(d>eps&&next< -eps||d< -eps&&next>eps){
              const meet=vertexAt(lerp(uv.get(id),uv.get(cell[j]),d/(d-next)));
              left.push(meet);right.push(meet);
            }
          });
          return [left,right];
        });
      }
      for(const cell of cells){
        let kind='surface';
        for(const {p,q,side,corner}of lines){
          if(!side)continue;
          const a=uv.get(p),b=uv.get(q);
          cell.forEach((x,j)=>{
            const y=cell[(j+1)%cell.length],k=key(x,y);
            if(Math.abs(signed(a,b,uv.get(x)))<eps&&Math.abs(signed(a,b,uv.get(y)))<eps&&!side.includes(k))side.push(k);
          });
          const mid=mean(cell.map(id=>uv.get(id))),sgn=signed(a,b,uv.get(corner));
          if(signed(a,b,mid)*sgn>eps)kind='bevel';
        }
        const coords=cell.map(id=>uv.get(id));
        if(cell.length<=4&&coords.every((a,i)=>signed(a,coords[(i+1)%cell.length],coords[(i+2)%cell.length])>eps)){emit(cell,kind);continue;}
        const positions=new Map(coords.map((p,i)=>[p,vertices[cell[i]]]));
        let tiles;
        try{tiles=grid.tilePolygon(coords,{contact:()=>null,lift:p=>positions.get(p)});}
        catch(error){
          if(error.message!=='无法分解裁切多边形。')throw error;
          tiles=E.triangulate({vertices:coords,faces:[coords.map((_,i)=>i)]}).faces;
        }
        for(const tile of tiles)emit(tile.map(i=>cell[i]),kind);
      }
    });
    const outputBands=bands.map(b=>({...b,creases:b.edges.map(k=>({edge:k,sides:byCrease.get(k)}))}));
    return {vertices,faces,faceParents,faceKinds,seamPaths,outputBands,supportKeys:[...new Set([...byCrease.values()].flat(2))]};
  }
  function splitCSIEdges(current,candidates,limit,blocked){
    const vertices=current.vertices.map(p=>p.slice()),inserted=new Map(),targets=[];
    let count=current.faces.length;
    for(const c of candidates){
      if(count+c.e.faces.length>limit||c.e.faces.some(i=>blocked.has(i)))continue;
      inserted.set(c.k,vertices.length);
      targets.push({id:vertices.length,point:c.point,target:c.target});
      vertices.push(c.point);
      count+=c.e.faces.length;
    }
    if(!inserted.size)return null;
    const faces=[],faceParents=[],previousFaces=[];
    current.faces.forEach((face,fi)=>{
      const ids=face.map((v,j)=>inserted.get(key(v,face[(j+1)%3]))),n=ids.filter(v=>v!==undefined).length;
      const emit=f=>{faces.push(f);faceParents.push(current.faceParents[fi]);previousFaces.push(fi);};
      if(n===0){emit(face);return;}
      const start=ids.findIndex((v,i)=>v!==undefined&&(n!==2||ids[(i+1)%3]!==undefined));
      const [a,b,c]=[0,1,2].map(i=>face[(start+i)%3]),[ab,bc,ca]=[0,1,2].map(i=>ids[(start+i)%3]);
      if(n===1){emit([a,ab,c]);emit([ab,b,c]);return;}
      if(n===2){emit([a,ab,c]);emit([ab,bc,c]);emit([ab,b,bc]);return;}
      emit([a,ab,ca]);emit([ab,b,bc]);emit([ca,bc,c]);emit([ab,bc,ca]);
    });
    return {baseline:{vertices,faces,faceParents},targets,inserted,previousFaces};
  }
  function refineTriangularFallback(source,low,guides,options,grid,progress){
    const limit=midTriangleLimit(options),parentFingerprint=E.fingerprint(low);
    const triangles=low.csiContactSources?grid.contactMesh(low):E.triangulate(low);
    const seed={vertices:triangles.vertices,faces:triangles.faces,faceParents:triangles.faceParents||triangles.source};
    if(seed.faces.length>limit)throw Error(`中模共享接边需要 ${seed.faces.length} 个三角面，超过上限 ${limit}。`);
    const inheritedCrossings=low.csiReport?.fallback?grid.intersections(seed):0;
    const shape=surface(source),lowGroups=low.csiPatchGroups||low.faces.map(()=>0);
    const originalAudit=E.audit(seed),positions=E.topology(seed),parts=seed.faceParents.map(i=>lowGroups[i]),edgeFlags=new Set(low.csiBoundaryKeys||[]);
    const sourceRegions=new Map(low.csiReport?.structureGrid?.sourceRegions||[]),sourceGroups=guides.scales[2].proposal.patchGroups;
    const sourcePatch=sourceGroups.map(g=>sourceRegions.get(g)??g);
    const retainedEdges=new Set([...positions.edges].flatMap(([k,e])=>{
      const [a,b]=e.faces,hard=b!==undefined&&dot(positions.data[a].normal,positions.data[b].normal)<.5;
      return e.faces.length===1||parts[a]!==parts[b]||hard||(!triangles.vertexMap&&edgeFlags.has(k))?[k]:[];
    }));
    const parentSeams=new Map([...retainedEdges].map(k=>[k,k.split(':').map(Number)]));
    let current=seed;
    progress('中模：沿实际低模分区细化');
    for(let round=0;round<options.midSubdivisions&&current.faces.length<limit;round++){
      const topology=E.topology(current),minimumArea=E.bounds(current).diagonal**2*5e-14;
      // 在混合网格中原先合格的窄三角面可能经切分后退化，保留这类三角面的边。
      const candidates=[...topology.edges].filter(([,e])=>e.faces.every(i=>topology.data[i].area>minimumArea)).map(([k,e])=>{
        const a=current.vertices[e.a],b=current.vertices[e.b],point=mul(add(a,b),.5),normal=unit(e.faces.reduce((n,fi)=>add(n,topology.data[fi].normal),[0,0,0]));
        const fixed=retainedEdges.has(k),parent=lowGroups[current.faceParents[e.faces[0]]];
        const allow=low.csiPatchGroups?fi=>sourcePatch[fi]===parent:null;
        const hit=fixed||inheritedCrossings?null:shape.closest(point,normal,null,allow);
        const length=dist(a,b),error=hit?.distance||0;
        const target=error>Math.min(.04*shape.scale,.22*length)?point:hit?.point||point;
        return {k,e,point,target,score:error+length*.075};
      }).sort((a,b)=>b.score-a.score);
      const blocked=new Set();
      let next=null,inserted;
      for(let attempt=0;attempt<3&&!next;attempt++){
        const trial=splitCSIEdges(current,candidates,limit,blocked);
        if(!trial)break;
        const {baseline,targets,previousFaces}=trial;
        inserted=trial.inserted;
        // 只沿原边加接缝站位。分区内部尝试回贴；如果失败，复查不移动原曲面的线性细分。
        if(!inheritedCrossings){
          const moved=E.copy(baseline),before=E.topology(baseline);
          for(const {id,point,target}of targets){
            moved.vertices[id]=target;
            if(before.incident[id].some(i=>dot(E.faceData(moved,moved.faces[i]).normal,before.data[i].normal)<.7))moved.vertices[id]=point;
          }
          if(E.audit(moved).valid&&!grid.intersections(moved)){next=moved;break;}
        }
        if(!E.audit(baseline).valid)break;
        // 相近面片只撤回发生冲突的站位，其他区域仍可细分。
        const crosses=inheritedCrossings?0:grid.intersections(baseline,null,(a,b)=>{
          blocked.add(previousFaces[a]);blocked.add(previousFaces[b]);
        });
        if(!crosses)next=baseline;
      }
      if(!next)break;
      current=next;
      for(const [original,path]of parentSeams){
        const expanded=path.flatMap((id,i)=>{const v=i?inserted.get(key(path[i-1],id)):undefined;return v===undefined?[id]:[v,id];});
        parentSeams.set(original,expanded);
      }
      retainedEdges.clear();
      for(const path of parentSeams.values())for(let i=1;i<path.length;i++)retainedEdges.add(key(path[i-1],path[i]));
    }
    const parentPatches=current.faceParents.map(i=>lowGroups[i]);
    const src={...current,faceSources:current.faces.map((_,i)=>i)};
    const paired=E.matchQuads(src,38,5,(a,b)=>current.faceParents[a]===current.faceParents[b]);
    const mid=E.audit(paired).valid&&(inheritedCrossings||!grid.intersections(paired))?paired:src;
    const owners=mid.faceSources.slice();
    mid.faceParents=owners.map(i=>current.faceParents[i]);
    mid.faceSources=mid.faceParents.map(i=>low.faceSources?.[i]??i);
    mid.csiPatchGroups=owners.map(i=>parentPatches[i]);
    mid.csiBoundaryKeys=[...retainedEdges];
    mid.method='低模分区内细化 / 保留共享结构线';
    const midAudit=E.audit(mid),midCrossings=grid.intersections(mid);
    mid.hierarchy={parentLevel:'low',parentFingerprint,parentPatches:mid.faceParents.map(i=>lowGroups[i]),retainedSeams:Object.fromEntries(parentSeams),detailCuts:[],triangleBudget:limit,
      intersectionAudit:{inheritedPairs:inheritedCrossings,remainingPairs:midCrossings,linearForInheritedCrossings:inheritedCrossings>0}};
    // 已有穿插的混合低模仅沿原三角面线性细分，保持父曲面并如实记录穿插。
    if(!midAudit.valid||!compatible(originalAudit,midAudit)||triangleCount(mid)>limit||(!inheritedCrossings&&midCrossings))throw Error('中模派生未通过低模拓扑、预算或穿插检查。');
    return mid;
  }
  function refineCSI(source,low,guides,options,grid,progress){
    if(!low.csiPatchGroups)return refineTriangularFallback(source,low,guides,options,grid,progress);
    const limit=midTriangleLimit(options);
    const parentFingerprint=E.fingerprint(low),proposal=guides.scales[2].proposal;
    const cage=low.csiContactSources?grid.contactMesh(low,true):{vertices:low.vertices,faces:low.faces,faceParents:low.faces.map((_,i)=>i)};
    const topology=E.topology(cage),originalAudit=E.audit(cage),shape=surface(source),groups=cage.faceParents.map(i=>low.csiPatchGroups[i]);
    const sourceRegions=new Map(low.csiReport?.structureGrid?.sourceRegions||[]),sourceGroups=proposal.patchGroups.map(g=>sourceRegions.get(g)??g);
    const locked=new Set([...topology.edges].filter(([,e])=>e.faces.length===1||groups[e.faces[0]]!==groups[e.faces[1]]).map(([k])=>k));
    const width=options.bevelWidth*shape.scale;
    const chains=width>0?creaseChains(cage,topology,groups,shape,proposal,options,sourceRegions,guides.layers?.detail?.edgeKeys||[]):[];
    const bands=[],creaseKeys=new Set();
    const compatibleCage=mesh=>{const a=E.audit(mesh);return a.valid&&compatible(a,originalAudit)&&triangleCount(mesh)<=limit&&!grid.intersections(mesh);};
    const build=(input,inputTopology,accepted,regular=[])=>{
      let mesh;
      try{mesh=midCage(input,inputTopology,accepted,regular,width,grid);}catch(error){
        if(!String(error.message).includes('无法三角化凹面'))throw error;
        return null;
      }
      return mesh.outputBands.every(b=>b.creases.every(c=>c.sides.every(side=>side.length)))&&compatibleCage(mesh)?mesh:null;
    };
    progress('中模：沿低模硬折边预留双侧卡线');
    let best=build(cage,topology,bands);
    const supportBudget=triangleCount(cage)+Math.floor((limit-triangleCount(cage))*.4);
    for(const chain of chains){
      const trial=build(cage,topology,[...bands,chain]);
      if(!trial||triangleCount(trial)>supportBudget)continue;
      bands.push(chain);best=trial;
      for(const k of chain.edges){creaseKeys.add(k);locked.add(k);}
    }
    function regularCage(input,inputTopology,keptBands){
      const candidates=input.faces.map((face,i)=>({area:inputTopology.data[i].area,keys:face.map((a,j)=>key(a,face[(j+1)%face.length]))})).sort((a,b)=>b.area-a.area);
      let next=null,lo=1,hi=candidates.length;
      while(lo<=hi){
        const count=Math.floor((lo+hi)/2),selected=new Set(candidates.slice(0,count).flatMap(f=>f.keys)),trial=build(input,inputTopology,keptBands,selected);
        if(trial){next=trial;lo=count+1;}else hi=count-1;
      }
      return next;
    }
    best=regularCage(cage,topology,bands)||best;
    if(!best)return refineTriangularFallback(source,low,guides,options,grid,progress);
    const retainedSeams=Object.fromEntries([...locked].map(k=>[k,best.seamPaths.get(k)||k.split(':').map(Number)]));
    for(let round=0;round<options.midSubdivisions&&triangleCount(best)+2<=limit;round++){
      const next=regularCage(best,E.topology(best),[]);
      if(!next||triangleCount(next)<=triangleCount(best))break;
      const expand=path=>path.flatMap((id,i)=>{
        if(!i)return [id];
        const segment=next.seamPaths.get(key(path[i-1],id));
        return segment?[...segment.slice(1,-1),id]:[id];
      });
      for(const [k,path]of Object.entries(retainedSeams))retainedSeams[k]=expand(path);
      next.outputBands=best.outputBands.map(b=>({...b,creases:b.creases.map(c=>({...c,sides:c.sides.map(side=>side.flatMap(k=>{
        const path=expand(k.split(':').map(Number));
        return path.slice(1).map((v,i)=>key(path[i],v));
      }))}))}));
      next.supportKeys=[...new Set(next.outputBands.flatMap(b=>b.creases.flatMap(c=>c.sides.flat())))];
      best=next;
    }
    const protectedVertices=new Set([...Object.values(retainedSeams).flat(),...best.supportKeys.flatMap(k=>k.split(':').map(Number))]);
    progress('中模：同区 CSI 曲面拟合');
    const network=(typeof createContourCurvatureNetwork==='function'?createContourCurvatureNetwork:require('./curvature-network.js'))(E);
    const evaluators=new Map((low.csiCurveNetwork?.patches||[]).map(p=>[p.patch,{patch:p,evaluate:network.evaluator(p)}]));
    const resultTopology=E.topology(best),offsets=new Map();
    for(let id=cage.vertices.length;id<best.vertices.length;id++){
      if(protectedVertices.has(id)||!resultTopology.incident[id].length)continue;
      const point=best.vertices[id],incident=resultTopology.incident[id],group=low.csiPatchGroups[best.faceParents[incident[0]]];
      const normal=unit(incident.reduce((n,i)=>add(n,resultTopology.data[i].normal),[0,0,0]));
      const field=evaluators.get(group),uv=field&&network.parameter(field.patch,point);
      const localStep=Math.sqrt(Math.min(...incident.map(i=>resultTopology.data[i].area))),maximum=Math.min(shape.scale*.008,localStep*.35);
      let fitted=null;
      if(uv&&uv.every((u,i)=>u>=0&&u<=field.patch.span[i]))try{fitted=field.evaluate(...uv);}
      catch(error){if(error.message!=='CSI边界残差延拓退化。')throw error;}
      const target=fitted&&dist(point,fitted)<=maximum?fitted:shape.closest(point,normal,null,i=>sourceGroups[i]===group)?.point;
      if(target&&dist(point,target)<=maximum)offsets.set(id,sub(target,point));
    }
    let mid=best,fittedVertices=0;
    const trial=E.copy(best),moved=new Set();
    for(const [id,delta]of offsets)for(const fraction of [.7,.28]){
      trial.vertices[id]=add(best.vertices[id],mul(delta,fraction));
      const safe=resultTopology.incident[id].every(i=>dot(E.faceData(trial,trial.faces[i]).normal,resultTopology.data[i].normal)>.7);
      if(safe){moved.add(id);break;}
      trial.vertices[id]=best.vertices[id];
    }
    for(let i=0;i<3&&moved.size;i++){
      const blocked=new Set(),hits=grid.intersections(trial,null,(a,b)=>{
        for(const id of [...trial.faces[a],...trial.faces[b]])if(moved.has(id))blocked.add(id);
      });
      if(!hits&&E.audit(trial).valid){mid=trial;fittedVertices=moved.size;break;}
      if(!blocked.size)break;
      for(const id of blocked){trial.vertices[id]=best.vertices[id];moved.delete(id);}
    }
    mid.csiPatchGroups=mid.faceParents.map(i=>low.csiPatchGroups[i]);
    mid.faceSources=mid.faceParents.map(i=>low.faceSources?.[i]??i);
    mid.csiBoundaryKeys=[...new Set(Object.values(retainedSeams).flatMap(path=>path.slice(1).map((v,i)=>key(path[i],v))))];
    mid.method='低模 CSI 拟合 / 硬转折双侧支撑带';
    mid.supportReport={requested:chains.length,beveled:creaseKeys.size,bands:mid.outputBands,widthRelative:options.bevelWidth,deferredForBudget:chains.length-bands.length};
    mid.hierarchy={parentLevel:'low',parentFingerprint,parentPatches:mid.csiPatchGroups.slice(),retainedSeams,detailCuts:[],triangleBudget:limit,
      fitReport:{fittedVertices,csiSurfaceRegions:evaluators.size},intersectionAudit:{inheritedPairs:0,remainingPairs:0,linearForInheritedCrossings:false}};
    delete mid.seamPaths;delete mid.outputBands;
    return mid;
  }
  function derive(source,basis,boundary,options={},progress=()=>{}){requireQuads(basis);const s=surface(source),excluded=new Set(options.excludedEdges||[]),manual=options.manualEdges||[],lowKeys=[...new Set([...E.structuralRuns(source,boundary.levels[2].accepted,options.minRun??.035).keys,...manual])].filter(k=>!excluded.has(k)),midKeys=[...new Set([...lowKeys,...E.structuralRuns(source,boundary.levels[3].accepted,options.minRun??.035).keys])].filter(k=>!excluded.has(k)),lowFeatures=featureData(s,lowKeys),midFeatures=featureData(s,midKeys);let low=E.copy(basis);for(let i=0;i<(options.lowSubdivisions??1);i++){progress('低模：继承规则体细分并拟合 '+(i+1));low=fit(subdivide(low,false),s,lowFeatures,options);}low.hierarchy={parentLevel:'far-mid',parentFingerprint:E.fingerprint(basis),refinements:options.lowSubdivisions??1,allQuads:true};let cage=E.copy(low);for(let i=0;i<(options.midSubdivisions??1);i++){progress('中模：继承低模细分并拟合边界 '+(i+1));cage=fit(subdivide(cage,false),s,midFeatures,options);}const mapped=mapFeatures(cage,s,midFeatures),ct=E.topology(cage),manualSet=new Set(manual),supportCandidates=mapped.keys.length,allowed=new Set(mapped.mapping.filter(({cage:k,source})=>{const e=ct.edges.get(k);return manualSet.has(source)||dot(ct.data[e.faces[0]].normal,ct.data[e.faces[1]].normal)<Math.cos(35*Math.PI/180);}).map(p=>p.cage));mapped.keys=mapped.keys.filter(k=>allowed.has(k));mapped.mapping=mapped.mapping.filter(p=>allowed.has(p.cage));progress('中模：生成真实卡线与四边过渡');const supportOrder=mapped.mapping.slice().sort((a,b)=>{const ma=manualSet.has(a.source),mb=manualSet.has(b.source);if(ma!==mb)return mb-ma;const ea=ct.edges.get(a.cage),eb=ct.edges.get(b.cage);return dot(ct.data[ea.faces[0]].normal,ct.data[ea.faces[1]].normal)-dot(ct.data[eb.faces[0]].normal,ct.data[eb.faces[1]].normal);}),mandatory=supportOrder.filter(p=>manualSet.has(p.source)).length,supportBudget=Math.min(Math.floor(MAX_TRIANGLES/4**(options.turboIterations??1)),Math.max(triangleCount(cage)*2,Math.round(E.audit(source).triangles*.9)));let mid=supportBands(cage,supportOrder.map(p=>p.cage),options.bevelWidth??.004,Math.floor(supportBudget),mandatory);mid.supportReport={...mid.supportReport,candidateEdges:supportCandidates,automaticTurnThreshold:35};mid.quadConversion={method:'native conforming quad support bands',beforeFaces:cage.faces.length,afterFaces:mid.faces.length};mid.method='低模派生细分 / 边界拟合 / 四边支撑带卡线';mid.hierarchy={parentLevel:'low',parentFingerprint:E.fingerprint(low),refinements:options.midSubdivisions??1,allQuads:true,featureMapping:mapped.mapping,fitReport:cage.fitReport,quadTransition:mid.quadConversion};progress('超近：从卡线中模进行涡轮平滑');const ultra=turboSmooth(mid,options.turboIterations??1,{limitSurface:options.turboLimitSurface,boundary:options.turboBoundary});ultra.hierarchy={parentLevel:'mid',parentFingerprint:E.fingerprint(mid),allQuads:true,refinements:options.turboIterations??1};return {low,mid,ultra};}
  return {quadify,subdivide,supportBands,turboSmooth,limitSurface,derive,refineCSI,surface,fit,featureData,mapFeatures,requireQuads,MAX_TRIANGLES};
}
if(typeof module!=='undefined')module.exports=createContourHierarchy;
if(typeof window!=='undefined')window.createContourHierarchy=createContourHierarchy;

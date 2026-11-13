/* Group-first UV charts. Geometry and shading are read-only. No native dependency. */
function createContourUVUnwrap(E){
  'use strict';
  const {sub,dot,cross,len,unit,dist,key}=E;
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const median=a=>a.length?a.sort((x,y)=>x-y)[a.length>>1]:1;
  function dsu(n){const p=Int32Array.from({length:n},(_,i)=>i);const find=i=>{while(p[i]!==i){p[i]=p[p[i]];i=p[i];}return i;};return {find,join(a,b){a=find(a);b=find(b);if(a!==b)p[b]=a;}};}
  function intersectArea(a,b){let poly=a;const sign=Math.sign(turn(...b));for(let j=0;j<3&&poly.length;j++){const x=b[j],y=b[(j+1)%3],out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=turn(x,y,p)*sign,dq=turn(x,y,q)*sign;if(dp>=0)out.push(p);if((dp<0)!==(dq<0)){const t=dp/(dp-dq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}poly=out;}let area=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];area+=p[0]*q[1]-p[1]*q[0];}return Math.abs(area)/2;}
  function inspect(coords,triangles){
    if(coords.some(p=>!p||p.length!==2||!p.every(Number.isFinite)))return {valid:false,reason:'missing coordinates'};
    const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];for(const p of coords)for(let k=0;k<2;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
    const span=Math.max(hi[0]-lo[0],hi[1]-lo[1]);if(!(span>0))return {valid:false,reason:'zero span'};
    // Normalized predicates keep overlap/degeneracy checks independent of object units.
    const ps=coords.map(p=>p.map((v,k)=>(v-lo[k])/span)),rows=[];let sign=0,area=0;
    for(const ids of triangles){const p=ids.map(i=>ps[i]),a=turn(...p);if(Math.abs(a)<1e-15)return {valid:false,reason:'degenerate triangle'};if(sign&&a*sign<0)return {valid:false,reason:'flipped triangle'};sign=Math.sign(a);area+=Math.abs(a)/2;rows.push({p,lo:[0,1].map(k=>Math.min(...p.map(q=>q[k]))),hi:[0,1].map(k=>Math.max(...p.map(q=>q[k]))),area:Math.abs(a)/2});}
    rows.sort((a,b)=>a.lo[0]-b.lo[0]);let active=[];
    for(const a of rows){active=active.filter(b=>b.hi[0]>a.lo[0]+1e-13);for(const b of active)if(a.lo[1]<b.hi[1]-1e-13&&a.hi[1]>b.lo[1]+1e-13){const overlap=intersectArea(a.p,b.p);if(overlap>Math.max(1e-14,Math.min(a.area,b.area)*1e-8))return {valid:false,reason:'overlapping triangles'};}active.push(a);}
    return {valid:true,area:area*span*span,lo,hi,sign};
  }
  function atlas(mesh){
    const t=E.topology(mesh),labels=mesh.smoothingGroups?.length===mesh.faces.length?mesh.smoothingGroups:E.autoSmooth(mesh,{topology:t}).groups;
    const label=i=>labels[i]===0?'flat-'+i:labels[i],seen=new Set(),regions=[];
    for(let fi=0;fi<mesh.faces.length;fi++)if(!seen.has(fi)){const faces=[fi];seen.add(fi);for(let q=0;q<faces.length;q++)for(const other of t.adj[faces[q]])if(!seen.has(other)&&label(other)===label(fi)){seen.add(other);faces.push(other);}regions.push({group:label(fi),faces});}
    const tr=E.triangulate(mesh),byFace=mesh.faces.map(()=>[]);tr.faces.forEach((f,i)=>byFace[tr.source[i]].push(f));
    const charts=[],reports=[];
    function local(region,cuts=new Set()){
      const offsets=new Map();let n=0;for(const fi of region.faces){offsets.set(fi,n);n+=mesh.faces[fi].length;}const ds=dsu(n);
      for(const [k,e]of t.edges)if(e.faces.length===2&&!cuts.has(k)&&e.faces.every(fi=>offsets.has(fi)))for(const v of [e.a,e.b])ds.join(offsets.get(e.faces[0])+mesh.faces[e.faces[0]].indexOf(v),offsets.get(e.faces[1])+mesh.faces[e.faces[1]].indexOf(v));
      const ids=new Map(),vertices=[],faces=[],triangles=[],corners=[];for(const fi of region.faces){const f=mesh.faces[fi],row=f.map((vi,j)=>{const r=ds.find(offsets.get(fi)+j);if(!ids.has(r)){ids.set(r,vertices.length);vertices.push(vi);}return ids.get(r);});faces.push(row);corners.push(f.map((_,j)=>offsets.get(fi)+j));for(const tri of byFace[fi])triangles.push(tri.map(vi=>row[f.indexOf(vi)]));}
      const edges=new Map();for(const f of faces)f.forEach((a,j)=>{const b=f[(j+1)%f.length],k=key(a,b);if(!edges.has(k))edges.set(k,{a,b,count:0});edges.get(k).count++;});
      const boundary=[...edges.values()].filter(e=>e.count===1),next=new Map();let regular=true;for(const e of boundary){if(next.has(e.a))regular=false;next.set(e.a,e.b);}const loops=[],used=new Set();for(const root of next.keys())if(!used.has(root)){const loop=[];let v=root;while(!used.has(v)&&next.has(v)){used.add(v);loop.push(v);v=next.get(v);}if(v!==root)regular=false;loops.push(loop);}
      return {vertices,faces,triangles,edges,boundary,loops,disk:regular&&loops.length===1&&loops[0].length>=3&&vertices.length-edges.size+faces.length===1};
    }
    function projection(l){let normal=[0,0,0];for(const ids of l.triangles){const p=ids.map(i=>mesh.vertices[l.vertices[i]]),n=cross(sub(p[1],p[0]),sub(p[2],p[0]));normal=E.add(normal,n);}normal=unit(normal);if(len(normal)<.5)return null;let u=null,best=0;for(const e of l.edges.values()){const d=sub(mesh.vertices[l.vertices[e.b]],mesh.vertices[l.vertices[e.a]]),p=sub(d,E.mul(normal,dot(d,normal)));if(len(p)>best){best=len(p);u=unit(p);}}if(!u)return null;const v=cross(normal,u),origin=mesh.vertices[l.vertices[0]];return l.vertices.map(vi=>{const p=sub(mesh.vertices[vi],origin);return [dot(p,u),dot(p,v)];});}
    function csi(region,l){
      const patch=mesh.csiPatchGroups?.[region.faces[0]],c=mesh.csiCharts?.find(c=>c.patch===patch);if(!c||region.faces.some(fi=>mesh.csiPatchGroups[fi]!==patch))return null;
      const map=new Map(),coords=Array(l.vertices.length);if(c.structureLattice)c.latticeVertices.forEach((id,i)=>map.set(id,[c.latticeCoordinates[i]]));
      else for(let y=0;y<c.grid.length;y++)for(let x=0;x<c.grid[y].length;x++){const id=c.grid[y][x],p=c.parameters?.[y]?.[x]||[x/c.U,y/c.V];if(!map.has(id))map.set(id,[]);map.get(id).push(p);}
      const patchFaces=mesh.faces.map((_,i)=>i).filter(i=>mesh.csiPatchGroups[i]===patch),faceIndex=new Map(patchFaces.map((fi,i)=>[fi,i]));
      for(let i=0;i<region.faces.length;i++){const fi=region.faces[i],f=mesh.faces[fi],saved=c.faceParameters?.[faceIndex.get(fi)];let ps=saved;if(!ps){const first=map.get(f[0])?.[0];if(!first)return null;ps=f.map(vi=>map.get(vi)?.slice().sort((a,b)=>dist(a,first)-dist(b,first))[0]);}if(!ps||ps.length!==f.length||ps.some(p=>!p))return null;for(let j=0;j<f.length;j++){const id=l.faces[i][j];if(coords[id]&&dist(coords[id],ps[j])>1e-8)return null;coords[id]=ps[j].slice();}}
      if(!c.structureLattice){const ratios=[[],[]];for(const e of l.edges.values()){const a=coords[e.a],b=coords[e.b];if(!a||!b)return null;const d=a.map((x,k)=>Math.abs(x-b[k])),length=dist(mesh.vertices[l.vertices[e.a]],mesh.vertices[l.vertices[e.b]]);for(let k=0;k<2;k++)if(d[k]>1e-10&&d[1-k]<d[k]*.05)ratios[k].push(length/d[k]);}const scale=ratios.map(median);return coords.map(p=>p.map((v,k)=>v*scale[k]));}return coords;
    }
    function cutGraph(region){
      const fs=new Set(region.faces),edges=[...t.edges.entries()].filter(([,e])=>e.faces.some(i=>fs.has(i))),graph=new Map();for(const [k,e]of edges)for(const [a,b]of [[e.a,e.b],[e.b,e.a]]){if(!graph.has(a))graph.set(a,[]);graph.get(a).push({v:b,k,w:dist(mesh.vertices[a],mesh.vertices[b])});}
      // Tree-cotree cut graph: retain the dual tree plus contractible loops,
      // and prune unnecessary primal branches instead of cutting every face.
      const root=edges.find(([,e])=>e.faces.filter(i=>fs.has(i)).length===1)?.[1].a??graph.keys().next().value;
      const distances=new Map([[root,0]]),parent=new Map(),done=new Set();let queue=[root];
      // Binary min heap, to avoid quadratic searches on subdivided smooth meshes.
      const heap=[];function push(v,d){let i=heap.length;heap.push({v,d});while(i){const p=(i-1)>>1;if(heap[p].d<=d)break;heap[i]=heap[p];i=p;}heap[i]={v,d};}function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(2*i+1<heap.length){let j=2*i+1;if(j+1<heap.length&&heap[j+1].d<heap[j].d)j++;if(heap[j].d>=last.d)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;}push(root,0);
      while(heap.length){const {v,d}=pop();if(done.has(v))continue;done.add(v);for(const e of graph.get(v)){const nd=d+e.w;if(nd<(distances.get(e.v)??Infinity)){distances.set(e.v,nd);parent.set(e.v,{v,k:e.k});push(e.v,nd);}}}
      const primal=new Set([...parent.values()].map(p=>p.k)),dual=new Set(),faceSeen=new Set([region.faces[0]]);queue=[region.faces[0]];
      for(let q=0;q<queue.length;q++){const fi=queue[q],f=mesh.faces[fi];for(let j=0;j<f.length;j++){const k=key(f[j],f[(j+1)%f.length]),e=t.edges.get(k);if(primal.has(k)||e.faces.length!==2)continue;const other=e.faces.find(i=>i!==fi);if(fs.has(other)&&!faceSeen.has(other)){faceSeen.add(other);queue.push(other);dual.add(k);}}}
      const cuts=new Set(edges.filter(([k,e])=>e.faces.length===2&&e.faces.every(i=>fs.has(i))&&!dual.has(k)).map(([k])=>k));
      const boundary=new Set(edges.filter(([,e])=>e.faces.filter(i=>fs.has(i)).length===1).flatMap(([,e])=>[e.a,e.b])),cutAdj=new Map();for(const k of cuts){const e=t.edges.get(k);for(const v of [e.a,e.b]){if(!cutAdj.has(v))cutAdj.set(v,new Set());cutAdj.get(v).add(k);}}
      queue=[...cutAdj.keys()].filter(v=>cutAdj.get(v).size===1&&!boundary.has(v));for(let q=0;q<queue.length;q++){const v=queue[q],a=cutAdj.get(v);if(a.size!==1||boundary.has(v))continue;const k=[...a][0],e=t.edges.get(k),other=e.a===v?e.b:e.a;cuts.delete(k);a.delete(k);cutAdj.get(other).delete(k);if(cutAdj.get(other).size===1)queue.push(other);}
      if(!boundary.size&&!cuts.size){const far=[...distances].sort((a,b)=>b[1]-a[1])[0][0];let v=far;while(parent.has(v)){const p=parent.get(v);cuts.add(p.k);v=p.v;}if(cuts.size<2){const edge=graph.get(root).find(e=>!cuts.has(e.k));if(edge)cuts.add(edge.k);}}
      return cuts;
    }
    function harmonic(l){
      if(!l.disk)return null;const coords=l.vertices.map(()=>[0,0]),fixed=new Set(l.loops[0]),loop=l.loops[0],lengths=loop.map((v,i)=>dist(mesh.vertices[l.vertices[v]],mesh.vertices[l.vertices[loop[(i+1)%loop.length]]])),perimeter=lengths.reduce((s,x)=>s+x,0);let offset=0;
      loop.forEach((v,i)=>{const angle=2*Math.PI*offset/perimeter;coords[v]=[Math.cos(angle),Math.sin(angle)];offset+=lengths[i];});
      const adj=l.vertices.map(()=>new Set());for(const f of l.triangles)for(let j=0;j<3;j++){const a=f[j],b=f[(j+1)%3];adj[a].add(b);adj[b].add(a);}
      const unknown=l.vertices.map((_,i)=>i).filter(i=>!fixed.has(i)),index=new Map(unknown.map((v,i)=>[v,i]));if(!unknown.length)return coords;
      const links=unknown.map(v=>[...adj[v]].filter(w=>!fixed.has(w)).map(w=>index.get(w))),degree=unknown.map(v=>adj[v].size),N=unknown.length;
      const apply=x=>Float64Array.from(x,(v,i)=>degree[i]*v-links[i].reduce((s,j)=>s+x[j],0)),inner=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
      for(let axis=0;axis<2;axis++){const b=Float64Array.from(unknown,v=>[...adj[v]].filter(w=>fixed.has(w)).reduce((s,w)=>s+coords[w][axis],0)),x=new Float64Array(N),r=b.slice(),z=Float64Array.from(r,(v,i)=>v/degree[i]);let p=z.slice(),rz=inner(r,z);const target=Math.max(1e-24,inner(b,b)*1e-20);
        for(let n=0;n<Math.min(2500,Math.max(100,N*2))&&inner(r,r)>target;n++){const ap=apply(p),den=inner(p,ap);if(!(den>0))break;const alpha=rz/den;for(let i=0;i<N;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];z[i]=r[i]/degree[i];}const next=inner(r,z),beta=next/rz;for(let i=0;i<N;i++)p[i]=z[i]+beta*p[i];rz=next;}unknown.forEach((v,i)=>coords[v][axis]=x[i]);}
      return coords;
    }
    function openSmallBoundary(l){
      // A nearly closed group with a tiny opening would squeeze most of the
      // surface into the circle centre. Extend that opening with one slit.
      const boundary=new Set(l.loops[0]),distance=l.vertices.map(()=>Infinity),parent=new Map(),queue=[];for(const v of boundary){distance[v]=0;queue.push(v);}
      const adj=l.vertices.map(()=>[]);for(const e of l.edges.values()){const w=dist(mesh.vertices[l.vertices[e.a]],mesh.vertices[l.vertices[e.b]]);adj[e.a].push([e.b,w]);adj[e.b].push([e.a,w]);}
      const inQueue=new Set(queue);for(let q=0;q<queue.length;q++){const v=queue[q];inQueue.delete(v);for(const [other,w]of adj[v])if(distance[v]+w<distance[other]){distance[other]=distance[v]+w;parent.set(other,v);if(!inQueue.has(other)){inQueue.add(other);queue.push(other);}}}
      let v=distance.reduce((best,d,i)=>d>distance[best]?i:best,0);const cuts=new Set();while(parent.has(v)){const other=parent.get(v);cuts.add(key(l.vertices[v],l.vertices[other]));v=other;}return cuts;
    }
    function conformal(l,coords){
      // Least-squares Cauchy-Riemann energy with two fixed UV vertices.
      // Free boundaries may fold on difficult charts; validation below gates acceptance.
      const a=l.loops[0]?.[0]??0,b=coords.reduce((best,p,i)=>dist(p,coords[a])>dist(coords[best],coords[a])?i:best,a),pins=new Set([a,b]),index=new Int32Array(coords.length*2).fill(-1);let N=0;
      for(let v=0;v<coords.length;v++)if(!pins.has(v))for(let k=0;k<2;k++)index[2*v+k]=N++;
      if(!N)return null;const rows=[],rhs=new Float64Array(N),diag=new Float64Array(N);
      for(const f of l.triangles){const p=f.map(i=>mesh.vertices[l.vertices[i]]),ab=sub(p[1],p[0]),ac=sub(p[2],p[0]),length=len(ab),x=dot(ac,ab)/length,h=len(cross(ab,ac))/length,weight=Math.sqrt(length*h/2),dx=[-1/length,1/length,0],dy=[(x-length)/(length*h),-x/(length*h),1/h];
        for(let row=0;row<2;row++){const ids=[],values=[];let constant=0;for(let j=0;j<3;j++)for(let k=0;k<2;k++){const c=weight*(row===0?(k===0?dx[j]:-dy[j]):(k===0?dy[j]:dx[j])),i=index[2*f[j]+k];if(i<0)constant+=c*coords[f[j]][k];else{ids.push(i);values.push(c);diag[i]+=c*c;}}
          ids.forEach((v,i)=>rhs[v]-=values[i]*constant);rows.push({ids,values});}
      }
      const apply=x=>{const out=new Float64Array(N);for(const {ids,values}of rows){let sum=0;for(let j=0;j<ids.length;j++)sum+=values[j]*x[ids[j]];for(let j=0;j<ids.length;j++)out[ids[j]]+=values[j]*sum;}return out;},inner=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),x=new Float64Array(N);
      coords.forEach((p,v)=>p.forEach((q,k)=>{const i=index[v*2+k];if(i>=0)x[i]=q;}));const ax=apply(x),r=Float64Array.from(rhs,(v,i)=>v-ax[i]),z=Float64Array.from(r,(v,i)=>v/(diag[i]||1));let direction=z.slice(),rz=inner(r,z);const target=Math.max(1e-25,inner(rhs,rhs)*1e-17);
      for(let it=0;it<Math.min(1200,Math.max(100,N*2))&&inner(r,r)>target;it++){const ad=apply(direction),den=inner(direction,ad);if(!(den>0))break;const alpha=rz/den;for(let i=0;i<N;i++){x[i]+=alpha*direction[i];r[i]-=alpha*ad[i];z[i]=r[i]/(diag[i]||1);}const next=inner(r,z),beta=next/rz;for(let i=0;i<N;i++)direction[i]=z[i]+beta*direction[i];rz=next;}
      return coords.map((p,v)=>p.map((q,k)=>index[v*2+k]<0?q:x[index[v*2+k]]));
    }
    function deformation(l,coords){
      let area3D=0,score=0;const stretch=[];
      for(const f of l.triangles){const p=f.map(i=>mesh.vertices[l.vertices[i]]),ab=sub(p[1],p[0]),ac=sub(p[2],p[0]),a=len(cross(ab,ac))/2;area3D+=a;const length=len(ab),x=dot(ac,ab)/length,y=2*a/length,q=f.map(i=>coords[i]),u=sub(q[1],q[0]).map(v=>v/length),v=sub(sub(q[2],q[0]),E.mul(u,x)).map(v=>v/y),trace=dot(u,u)+dot(v,v),det=u[0]*v[1]-u[1]*v[0],high=(trace+Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2,ratio=high/Math.abs(det);stretch.push({ratio,area:a});score+=a*Math.log(ratio);}
      stretch.sort((a,b)=>a.ratio-b.ratio);const quantile=q=>{let sum=0;for(const x of stretch){sum+=x.area;if(sum>=area3D*q)return x.ratio;}return stretch.at(-1).ratio;};return {area3D,score:score/area3D,stretch:{areaWeightedMedian:quantile(.5),areaWeightedP90:quantile(.9),maximum:stretch.at(-1).ratio}};
    }
    function addChart(region,l,coords,method,cuts){
      let check=inspect(coords,l.triangles);if(!check.valid)return false;let quality=deformation(l,coords);const before=quality.stretch;let relaxation=false;
      if(!method.startsWith('CSI')&&quality.score>.005){const candidate=conformal(l,coords);if(candidate)for(const weight of [1,.5,.25,.125]){const ps=coords.map((p,i)=>p.map((v,k)=>v+(candidate[i][k]-v)*weight)),test=inspect(ps,l.triangles);if(!test.valid)continue;const next=deformation(l,ps);if(next.score<quality.score-1e-6&&next.stretch.areaWeightedP90<=quality.stretch.areaWeightedP90*1.02&&next.stretch.maximum<=quality.stretch.maximum*1.02){coords=ps;check=test;quality=next;relaxation=true;break;}}}
      const area3D=quality.area3D,scale=Math.sqrt(area3D/check.area),ps=coords.map(p=>p.map((v,k)=>(v-check.lo[k])*scale)),chart={region,l,ps,w:(check.hi[0]-check.lo[0])*scale,h:(check.hi[1]-check.lo[1])*scale};charts.push(chart);
      reports.push({group:region.group,faces:region.faces.length,method:method+(relaxation?'＋共形松弛':''),necessaryCuts:[...cuts],surfaceArea:area3D,overlapChecked:true,relaxationAccepted:relaxation,stretchBeforeRelaxation:before,stretch:quality.stretch});return true;
    }
    for(const region of regions){
      const faceSet=new Set(region.faces),patch=mesh.csiPatchGroups?.[region.faces[0]],saved=mesh.csiCharts?.find(c=>c.patch===patch)?.faceParameters;
      let cuts=new Set();if(saved){const all=mesh.faces.map((_,i)=>i).filter(i=>mesh.csiPatchGroups[i]===patch),order=new Map(all.map((fi,i)=>[fi,i]));for(const [k,e]of t.edges)if(e.faces.length===2&&e.faces.every(i=>faceSet.has(i))&&[e.a,e.b].some(v=>{const [a,b]=e.faces,pa=saved[order.get(a)]?.[mesh.faces[a].indexOf(v)],pb=saved[order.get(b)]?.[mesh.faces[b].indexOf(v)];return pa&&pb&&dist(pa,pb)>1e-8;}))cuts.add(k);}
      let l=local(region,cuts),coords=csi(region,l);
      if(coords&&addChart(region,l,coords,'CSI经纬参数',cuts))continue;
      coords=projection(l);if(coords&&addChart(region,l,coords,'平滑组平面投影',cuts))continue;
      if(l.disk&&!cuts.size){const perimeter=l.loops[0].reduce((s,v,i,a)=>s+dist(mesh.vertices[l.vertices[v]],mesh.vertices[l.vertices[a[(i+1)%a.length]]]),0),area=region.faces.reduce((s,i)=>s+t.data[i].area,0);if(perimeter<Math.sqrt(area)*2){cuts=openSmallBoundary(l);l=local(region,cuts);}}
      if(!l.disk){cuts=new Set([...cuts,...cutGraph(region)]);l=local(region,cuts);}
      coords=harmonic(l);if(coords&&addChart(region,l,coords,'平滑组圆盘调和展开',cuts))continue;
      // A face-dual tree is a last-resort disk cut, still one connected island.
      const fs=new Set(region.faces),dual=new Set(),visited=new Set([region.faces[0]]),queue=[region.faces[0]];for(let q=0;q<queue.length;q++){const f=mesh.faces[queue[q]];f.forEach((v,j)=>{const k=key(v,f[(j+1)%f.length]),e=t.edges.get(k);if(e.faces.length!==2)return;const other=e.faces.find(fi=>fi!==queue[q]);if(fs.has(other)&&!visited.has(other)){visited.add(other);queue.push(other);dual.add(k);}});}
      cuts=new Set([...t.edges].filter(([k,e])=>e.faces.length===2&&e.faces.every(fi=>fs.has(fi))&&!dual.has(k)).map(([k])=>k));l=local(region,cuts);coords=harmonic(l);
      if(coords&&addChart(region,l,coords,'平滑组保守圆盘切割',cuts))continue;
      throw Error('平滑组 '+region.group+' 的UV未通过无翻转/重叠检查；保留此前结果。 '+JSON.stringify({disk:l.disk,loops:l.loops.map(l=>l.length),euler:l.vertices.length-l.edges.size+l.faces.length,check:coords?inspect(coords,l.triangles):null}));
    }
    const rectangleArea=charts.reduce((s,c)=>s+c.w*c.h,0),size=Math.sqrt(rectangleArea)*1.4,pad=Math.sqrt(rectangleArea)*.006;
    let x=pad,y=pad,row=0,maxX=0;const uv=[],indices=mesh.faces.map(()=>[]);
    for(const c of charts.sort((a,b)=>b.h-a.h)){if(x+c.w+pad>size&&x>pad){x=pad;y+=row+pad;row=0;}const offset=uv.length;for(const p of c.ps)uv.push([p[0]+x,p[1]+y]);c.region.faces.forEach((fi,i)=>indices[fi]=c.l.faces[i].map(v=>offset+v));x+=c.w+pad;row=Math.max(row,c.h);maxX=Math.max(maxX,x);}
    const extent=Math.max(maxX,y+row+pad);return {version:2,uv:uv.map(p=>p.map(v=>v/extent)),indices,charts:charts.length,groupCount:new Set(labels).size,method:'按平滑组展开；CSI经纬 / 平面 / 正权重调和圆盘；统一面积密度',seamless:false,report:{islands:charts.length,smoothGroups:new Set(labels).size,singleFaceIslands:reports.filter(r=>r.faces===1).length,charts:reports,nonOverlapping:true,finite:true,geometryUnchanged:true,packingUtilization:reports.reduce((s,c)=>s+c.surfaceArea,0)/(extent*extent)}};
  }
  return {atlas,inspect};
}
if(typeof module!=='undefined')module.exports=createContourUVUnwrap;

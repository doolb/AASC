/* Independent structure-aligned section grids. Consumes the captured CSI surface,
 * never a viewport or model-specific axis. Original/high geometry is read-only. */
function createContourStructureGrid(E){
  'use strict';
  const {add,sub,mul,dot,cross,unit,dist}=E;
  const lerp=(a,b,t)=>add(mul(a,1-t),mul(b,t));
  // Choose independent chart corners around the unchanged CSI perimeter. Opposite
  // side counts still match within a patch; neighboring patches impose no counts.
  function planChart(mesh,chart,all=false){
    const {grid,U,V,patch}=chart;if(U<4||V<4)return all?[chart]:chart;
    const loop=[...grid[0],...grid.slice(1).map(r=>r[U]),...grid[V].slice(0,-1).reverse(),...grid.slice(1,-1).reverse().map(r=>r[0])],N=loop.length,half=N/2,ids=mesh.faces.map((_,i)=>mesh.csiPatchGroups[i]===patch?i:-1).filter(i=>i>=0),normal=unit(ids.reduce((s,i)=>{const d=E.faceData(mesh,mesh.faces[i]);return add(s,mul(d.normal,d.area));},[0,0,0])),D=E.bounds(mesh).diagonal;
    let best=null;const plans=[],stride=Math.max(1,Math.ceil((half-7)/24)),counts=[...new Set([U,V,...Array.from({length:Math.ceil((half-7)/stride)},(_,i)=>4+i*stride),half-4])].filter(u=>u>=4&&u<=half-4).sort((a,b)=>a-b),starts=N<=64?Array.from({length:N},(_,i)=>i):[...new Set([0,U,U+V,2*U+V,...Array.from({length:64},(_,i)=>Math.floor(i*N/64))])];
    for(const u of counts){const v=half-u;if(u*v>U*V)continue;for(const start of starts){
      if([start,start+u,start+u+v,start+2*u+v].some(i=>{const a=mesh.vertices[loop[(i+N-1)%N]],b=mesh.vertices[loop[i%N]],c=mesh.vertices[loop[(i+1)%N]];return dot(cross(sub(b,a),sub(c,b)),normal)<=D*D*1e-10;}))continue;
      const g=Array.from({length:v+1},()=>Array(u+1).fill(null));for(let i=0;i<=u;i++){g[0][i]=loop[(start+i)%N];g[v][i]=loop[(start+2*u+v-i)%N];}for(let j=0;j<=v;j++){g[j][0]=loop[(start+N-j)%N];g[j][u]=loop[(start+u+j)%N];}
      const origin=mesh.vertices[g[0][0]],row=g.reduce((s,r)=>add(s,sub(mesh.vertices[r[u]],mesh.vertices[r[0]])),[0,0,0]),x=unit(sub(row,mul(normal,dot(row,normal))));let y=unit(cross(normal,x));if(dot(y,sub(mesh.vertices[g[v][0]],origin))<0)y=mul(y,-1);
      const at=id=>{const p=sub(mesh.vertices[id],origin);return [dot(p,x),dot(p,y)];},top=g[0].map(at),bottom=g[v].map(at),left=g.map(r=>at(r[0])),right=g.map(r=>at(r[u])),lo=Math.max(...top.map(p=>p[1])),hi=Math.min(...bottom.map(p=>p[1]));if(hi-lo<D*.015)continue;
      const slice=(rail,q)=>{const hits=[];for(let j=1;j<rail.length;j++){const a=rail[j-1],b=rail[j];if(q<Math.min(a[1],b[1])||q>Math.max(a[1],b[1])||Math.abs(b[1]-a[1])<D*1e-10)continue;hits.push(a[0]+(b[0]-a[0])*(q-a[1])/(b[1]-a[1]));}return hits.length===1?hits[0]:null;};
      const spans=Array.from({length:9},(_,i)=>{const q=lo+(hi-lo)*(i+.5)/9;return [slice(left,q),slice(right,q)];});if(spans.some(p=>p.some(x=>x===null)||p[1]<=p[0]))continue;const width=Math.min(...spans.map(p=>p[1]))-Math.max(...spans.map(p=>p[0]));if(width<=D*.015)continue;
      const ratio=(width/(u-2))/((hi-lo)/(v-2)),score=width*(hi-lo)/(D*D)*Math.exp(-.15*Math.log(ratio)**2);const plan={...chart,U:u,V:v,grid:g,score,corners:[g[0][0],g[0][u],g[v][u],g[v][0]],originalGrid:[U,V],rank:plans.length};plans.push(plan);if(!best||score>best.score+1e-10)best=plan;
    }}if(!all)return best||chart;const seen=new Set(),choices=[];for(const p of plans.sort((a,b)=>Math.abs(b.score-a.score)>1e-10?b.score-a.score:a.rank-b.rank)){const k=p.corners.slice().sort((a,b)=>a-b).join(':');if(seen.has(k))continue;seen.add(k);choices.push(p);if(choices.length===32)break;}return [...choices,chart];
  }
  function sectionPatch(mesh,originalChart){let last=null,best=null,tried=0,bestScore=-Infinity;for(const chart of planChart(mesh,originalChart,true)){const out=buildSection(mesh,originalChart,chart);tried++;if(out.supported){const ratios=out.faces.map(f=>{const d=f.map((v,j)=>dist(out.vertices[v],out.vertices[f[(j+1)%4]]));return Math.max(...d)/Math.min(...d);}).sort((a,b)=>a-b),mean=ratios.reduce((s,x)=>s+x,0)/ratios.length,score=out.report.coreAreaRelative/(1+(mean-1)**2);out.report.regularity={meanEdgeRatio:mean,p90EdgeRatio:ratios[Math.floor(ratios.length*.9)],maximumEdgeRatio:ratios.at(-1)};if(score>bestScore+1e-10){bestScore=score;best=out;}}else last=out;}if(best){best.report.planningCandidatesTried=tried;best.report.planningObjective='large straight core balanced against actual quad edge ratios';return best;}return last;}
  function buildSection(mesh,originalChart,chart){
    const {grid,U,V,patch}=chart;if(U<4||V<4)return {supported:false,reason:'分区采样过少，保留原结构网格'};
    const faceIds=mesh.faces.map((_,i)=>mesh.csiPatchGroups[i]===patch?i:-1).filter(i=>i>=0),origin=mesh.vertices[grid[0][0]],normal=unit(faceIds.reduce((s,i)=>{const d=E.faceData(mesh,mesh.faces[i]);return add(s,mul(d.normal,d.area));},[0,0,0]));
    if(E.len(normal)<.5)return {supported:false,reason:'分区平均法线退化'};
    const row=grid.reduce((s,r)=>add(s,sub(mesh.vertices[r[U]],mesh.vertices[r[0]])),[0,0,0]),x=unit(sub(row,mul(normal,dot(row,normal))));
    if(E.len(x)<.5)return {supported:false,reason:'分区主方向退化'};
    let y=unit(cross(normal,x));const travel=sub(mesh.vertices[grid[V][0]],origin);if(dot(y,travel)<0)y=mul(y,-1);
    const local=p=>{const d=sub(p,origin);return [dot(d,x),dot(d,y),dot(d,normal)];},world=p=>add(origin,add(mul(x,p[0]),add(mul(y,p[1]),mul(normal,p[2])))),top=grid[0].map(i=>local(mesh.vertices[i])),bottom=grid[V].map(i=>local(mesh.vertices[i])),left=grid.map(r=>local(mesh.vertices[r[0]])),right=grid.map(r=>local(mesh.vertices[r[U]])),D=E.bounds(mesh).diagonal,eps=D*1e-9;
    const lo=Math.max(...top.map(p=>p[1])),hi=Math.min(...bottom.map(p=>p[1]));
    if(hi-lo<D*.015)return {supported:false,reason:'端部投影重叠，需要分块方向'};
    const slice=(rail,v)=>{const hits=[];for(let i=1;i<rail.length;i++){const a=rail[i-1],b=rail[i];if(v<Math.min(a[1],b[1])-eps||v>Math.max(a[1],b[1])+eps||Math.abs(b[1]-a[1])<eps)continue;const t=(v-a[1])/(b[1]-a[1]);const p=lerp(a,b,t);if(!hits.some(q=>dist(q,p)<eps*10))hits.push(p);}return hits.length===1?hits[0]:null;};
    const triangles=faceIds.flatMap(fi=>{const f=mesh.faces[fi];return [[f[0],f[1],f[2]],[f[0],f[2],f[3]]].map(f=>{const p=f.map(id=>local(mesh.vertices[id])),den=(p[1][1]-p[2][1])*(p[0][0]-p[2][0])+(p[2][0]-p[1][0])*(p[0][1]-p[2][1]);return {p,den};});});
    if(triangles.some(t=>Math.abs(t.den)<D*D*1e-10)||new Set(triangles.map(t=>Math.sign(t.den))).size!==1)return {supported:false,reason:'曲面投影折叠，需要局部分块'};
    const lift=(a,b)=>{let best=null,error=Infinity;for(const t of triangles){const p=t.p,u=((p[1][1]-p[2][1])*(a-p[2][0])+(p[2][0]-p[1][0])*(b-p[2][1]))/t.den,v=((p[2][1]-p[0][1])*(a-p[2][0])+(p[0][0]-p[2][0])*(b-p[2][1]))/t.den,w=1-u-v,e=Math.max(-u,-v,-w,0);if(e<error){error=e;best=[a,b,u*p[0][2]+v*p[1][2]+w*p[2][2]];if(e<1e-10)break;}}return error<1e-6?best:null;};
    const stations=[];for(let j=1;j<V;j++){const v=lo+(hi-lo)*j/V,a=slice(left,v),b=slice(right,v);if(!a||!b||b[0]-a[0]<D*1e-5)return {supported:false,reason:'截线存在多个区间或次序反转'};stations.push({v,a,b});}
    // A shared straight core gives both row and column families a stable direction.
    // Only outer columns and end rows transition to the independently sampled CSI.
    const coreLo=Math.max(...stations.map(s=>s.a[0])),coreHi=Math.min(...stations.map(s=>s.b[0])),width=stations.reduce((sum,s)=>sum+s.b[0]-s.a[0],0)/stations.length,useCore=coreHi-coreLo>width*.5;if(!useCore)return {supported:false,reason:'可用直向核心过窄，需要进一步分区'};
    const coreX=i=>coreLo+(coreHi-coreLo)*i/U,frontDistance=top.reduce((sum,p,i)=>sum+Math.hypot(p[0]-coreX(i),p[1]-lo),0)/top.length,backDistance=bottom.reduce((sum,p,i)=>sum+Math.hypot(p[0]-coreX(i),p[1]-hi),0)/bottom.length,totalSpan=frontDistance+hi-lo+backDistance,frontRows=Math.max(1,Math.min(V-3,Math.round(V*frontDistance/totalSpan))),backRows=Math.max(1,Math.min(V-frontRows-2,Math.round(V*backDistance/totalSpan)));
    const vertices=[],outGrid=[];for(let j=0;j<=V;j++){const ids=[];for(let i=0;i<=U;i++){let p;if(!j)p=top[i];else if(j===V)p=bottom[i];else if(!i)p=left[j];else if(i===U)p=right[j];else{let xy;if(j<frontRows){const t=j/frontRows;xy=[top[i][0]*(1-t)+coreX(i)*t,top[i][1]*(1-t)+lo*t];}else if(j>V-backRows){const t=(j-(V-backRows))/backRows;xy=[coreX(i)*(1-t)+bottom[i][0]*t,hi*(1-t)+bottom[i][1]*t];}else xy=[coreX(i),lo+(hi-lo)*(j-frontRows)/(V-backRows-frontRows)];p=lift(...xy);if(!p){const center=[(coreLo+coreHi)/2,(lo+hi)/2];for(const f of [.99,.95,.9,.8,.6,.4,.2]){p=lift(center[0]+(xy[0]-center[0])*f,center[1]+(xy[1]-center[1])*f);if(p)break;}}if(!p)return {supported:false,reason:'端部结构过渡超出CSI曲面域'};}ids.push(vertices.length);vertices.push(!j||j===V||!i||i===U?mesh.vertices[grid[j][i]].slice():world(p));}outGrid.push(ids);}
    const faces=[];for(let j=0;j<V;j++)for(let i=0;i<U;i++)faces.push([outGrid[j][i],outGrid[j][i+1],outGrid[j+1][i+1],outGrid[j+1][i]]);
    if(dot(E.faceData({vertices},faces[0]).normal,E.faceData(mesh,mesh.faces[faceIds[0]]).normal)<0)faces.forEach(f=>f.reverse());
    const incident=vertices.map(()=>[]);faces.forEach((f,fi)=>f.forEach(id=>incident[id].push(fi)));
    const cornerQuality=f=>{const n=E.faceData({vertices},f).normal,ps=f.map(id=>vertices[id]);return Math.min(...ps.map((p,i)=>dot(unit(cross(sub(ps[(i+1)%4],p),sub(ps[(i+3)%4],p))),n)),dot(unit(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),unit(cross(sub(ps[2],ps[0]),sub(ps[3],ps[0])))));},energy=fs=>fs.reduce((sum,fi)=>sum+Math.min(0,cornerQuality(faces[fi])-.04)**2,0);let repairMoves=0;
    for(let sweep=0;sweep<48;sweep++){const bad=faces.map((f,i)=>cornerQuality(f)<.02?i:-1).filter(i=>i>=0);if(!bad.length)break;let changed=false;for(const id of new Set(bad.flatMap(fi=>faces[fi]))){const j=Math.floor(id/(U+1)),i=id%(U+1);if(!i||!j||i===U||j===V||j>=frontRows&&j<=V-backRows&&i>1&&i<U-1)continue;const old=vertices[id],q=local(old),ns=[outGrid[j][i-1],outGrid[j][i+1],outGrid[j-1][i],outGrid[j+1][i]],mean=local(mul(ns.reduce((a,k)=>add(a,vertices[k]),[0,0,0]),.25)),original=grid[j][i]===null?q:local(mesh.vertices[grid[j][i]]),step=Math.min(...ns.map(k=>dist(old,vertices[k])))*.35,targets=[mean,original,...[[1,0],[-1,0],[0,1],[0,-1]].map(d=>[q[0]+d[0]*step,q[1]+d[1]*step])],oldEnergy=energy(incident[id]);let best=null;for(const target of targets)for(const f of [1,.5,.25]){const xy=[q[0]+(target[0]-q[0])*f,q[1]+(target[1]-q[1])*f],p=lift(...xy);if(!p)continue;vertices[id]=world(p);const e=energy(incident[id]);if(e<oldEnergy-1e-12&&(!best||e<best.energy))best={point:vertices[id],energy:e};}vertices[id]=best?best.point:old;if(best){changed=true;repairMoves++;}}if(!changed)break;}
    const valid=faces.every(f=>{const n=E.faceData({vertices},f).normal,ps=f.map(id=>vertices[id]);return ps.every((p,i)=>dot(unit(cross(sub(ps[(i+1)%4],p),sub(ps[(i+3)%4],p))),n)>.005)&&dot(unit(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]))),unit(cross(sub(ps[2],ps[0]),sub(ps[3],ps[0]))))>.005;});
    if(!valid)return {supported:false,reason:'端部收边产生凹折，需要局部分块'};
    return {supported:true,vertices,faces,baseVertices:grid.flat(),grid:outGrid,U,V,frame:{origin,x,y,normal},report:{patch,mode:'independent structure-plane sections',grid:[U,V],originalGrid:[originalChart.U,originalChart.V],chartCorners:chart.corners||[grid[0][0],grid[0][U],grid[V][U],grid[V][0]],coreAreaRelative:(coreHi-coreLo)*(hi-lo)/(D*D),repairMoves,straightRows:V-backRows-frontRows+1,straightCoreColumns:U-3,coreFirstColumn:2,coreLastColumn:U-2,frontRows,backRows,coreFirstRow:frontRows,coreLastRow:V-backRows,faces:faces.length,reference:'captured same-region CSI surface',highSurfaceQueries:0,coreWidthRatio:(coreHi-coreLo)/width}};
  }
  function generateSections(base,definition={version:1,mode:'independent-structure-sections'},options={}){
    if(definition.version!==1||definition.mode!=='independent-structure-sections')throw Error('独立结构布线参数无效。');
    const vertices=[],faces=[],faceSources=[],groups=[],charts=[],reports=[],registry=new Map(),boundaryEdges=[],baseVertices=[];
    for(const chart of base.csiCharts||[]){const patch=chart.patch,indices=base.faces.map((_,i)=>base.csiPatchGroups[i]===patch?i:-1).filter(i=>i>=0),out=!chart.rim?sectionPatch(base,chart):{supported:false,reason:'保留包边结构剖面'},local=new Map(),v=(id,p,original=id)=>{const k=patch+':'+id;if(registry.has(k))return registry.get(k);const j=vertices.length;vertices.push(p.slice());baseVertices.push(original===null?-(j+1):original);registry.set(k,j);return j;};
      if(out.supported){for(let i=0;i<out.vertices.length;i++)local.set(i,v(i,out.vertices[i],out.baseVertices[i]));for(const f of out.faces){faces.push(f.map(i=>local.get(i)));groups.push(patch);faceSources.push(base.faceSources?.[indices[0]]??0);}charts.push({...chart,U:out.U,V:out.V,grid:out.grid.map(row=>row.map(i=>local.get(i))),parameters:null,structureFrame:out.frame,structureSections:true});reports.push(out.report);}
      else{for(const fi of indices){faces.push(base.faces[fi].map(i=>v(i,base.vertices[i])));groups.push(patch);faceSources.push(base.faceSources?.[fi]??0);}charts.push({...chart,grid:chart.grid.map(row=>row.map(i=>v(i,base.vertices[i])))});reports.push({patch,mode:'independent original CSI grid',faces:indices.length,grid:[chart.U,chart.V],reason:out.reason});}
    }
    const mesh={...structuredClone(base),vertices,faces,faceSources,csiPatchGroups:groups,csiCharts:charts,csiBaseVertices:baseVertices};delete mesh.smoothingGroups;delete mesh.sharpEdges;delete mesh.smoothingReport;
    const t=E.topology(mesh);for(const [key,e]of t.edges)if(e.faces.length===1)boundaryEdges.push({id:'section-border:'+key,virtual:false,vertices:[e.a,e.b],types:['CSI'],sampling:'independent patch boundary'});
    const limit=options.lowTriangleBudget??(options.lowFaceBudget!==undefined?options.lowFaceBudget*2:1000);
    mesh.csiEdges=boundaryEdges;mesh.csiBoundaryKeys=boundaryEdges.map(e=>E.key(...e.vertices));mesh.csiReport={...mesh.csiReport,structureGrid:{version:1,mode:definition.mode,patches:reports,independentPatches:true,sharedVertexConstraint:false,wholeSurfaceWatertight:false,highSurfaceQueries:0},referencePatches:mesh.csiReport.patches,patches:reports,centeredRimVertices:[],sharedBoundaryEdges:0,budget:{...mesh.csiReport.budget,limit,used:faces.length*2,unit:'triangles',polygonFaces:faces.length}};mesh.method='CSI结构方向 / 独立分区四边面';
    const contact=contactMesh(mesh),pairs=intersections(contact);mesh.csiReport.intersectionAudit={initialFacePairs:pairs,remainingNonadjacentTrianglePairs:pairs,checkedOnBase:false,method:'new independent patches; coincident copies of the same captured CSI node identified for contact checking; shared-vertex and coplanar contacts excluded'};if(pairs)throw Error('独立结构网格存在'+pairs+'处穿插，保留旧结果。');mesh.csiReport.structureGrid.contactTopology=E.audit(contact);
    const health=E.audit(mesh);if(!health.valid||faces.some(f=>f.length!==4)||faces.length*2>limit)throw Error('独立结构布线未通过四边面或三角面预算检查。');return mesh;
  }
  function contactMeshSections(mesh){
    const vertices=[],faces=[],registry=new Map(),map=[],D=E.bounds(mesh).diagonal;for(let i=0;i<mesh.vertices.length;i++){const source=mesh.csiBaseVertices?.[i]??i,p=mesh.vertices[i];if(!registry.has(source)){registry.set(source,vertices.length);vertices.push(p.slice());}const id=registry.get(source);if(dist(vertices[id],p)>D*1e-8)throw Error('同一CSI接触节点发生分离。');map[i]=id;}for(const f of mesh.faces)faces.push(f.map(v=>map[v]));return {vertices,faces};
  }
  function intersections(mesh,changedFaces=null,onPair=null){
    const tr=E.triangulate(mesh),D=E.bounds(mesh).diagonal,eps=D*1e-8,triangles=tr.faces.map((f,i)=>{const p=f.map(i=>tr.vertices[i]),face=tr.source[i];return {f,p,face,changed:changedFaces?.has(face),lo:[0,1,2].map(k=>Math.min(...p.map(v=>v[k]))),hi:[0,1,2].map(k=>Math.max(...p.map(v=>v[k])))};}).sort((a,b)=>a.lo[0]-b.lo[0]);
    const segment=(p,q,a,b,c)=>{const x=sub(b,a),y=sub(c,a),n=cross(x,y),d=sub(q,p),den=dot(n,d);if(Math.abs(den)<D**3*1e-12)return false;const t=dot(n,sub(a,p))/den;if(t<=1e-7||t>=1-1e-7)return false;const v=sub(add(p,mul(d,t)),a),xx=dot(x,x),xy=dot(x,y),yy=dot(y,y),vx=dot(v,x),vy=dot(v,y),det=xx*yy-xy*xy;if(det<D**4*1e-20)return false;const s=(vx*yy-vy*xy)/det,u=(vy*xx-vx*xy)/det;return s>=-1e-7&&u>=-1e-7&&s+u<=1+1e-7;};let count=0;
    for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length&&triangles[j].lo[0]<=triangles[i].hi[0]+eps;j++){const a=triangles[i],b=triangles[j];if(changedFaces&&!a.changed&&!b.changed||a.f.some(v=>b.f.includes(v))||a.lo.some((v,k)=>v>b.hi[k]+eps||b.lo[k]>a.hi[k]+eps))continue;if(a.p.some((p,k)=>segment(p,a.p[(k+1)%3],...b.p))||b.p.some((p,k)=>segment(p,b.p[(k+1)%3],...a.p))){count++;onPair?.(a.face,b.face);}}return count;
  }

  // A trimmed lattice has no four-sided chart constraint. Only boundary cells
  // use mixed faces, allowing an edge family to terminate instead of forming a fan.
  const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0)/2;
  function reference(mesh,chart){
    const faceIds=mesh.faces.map((_,i)=>mesh.csiPatchGroups[i]===chart.patch?i:-1).filter(i=>i>=0),origin=mesh.vertices[chart.grid[0][0]],normal=unit(faceIds.reduce((s,i)=>{const d=E.faceData(mesh,mesh.faces[i]);return add(s,mul(d.normal,d.area));},[0,0,0])),row=chart.grid.reduce((s,r)=>add(s,sub(mesh.vertices[r.at(-1)],mesh.vertices[r[0]])),[0,0,0]),x=unit(sub(row,mul(normal,dot(row,normal)))),y=unit(cross(normal,x)),D=E.bounds(mesh).diagonal;
    if(E.len(normal)<.5||E.len(x)<.5)return {supported:false,reason:'结构方向退化'};
    const local=p=>{const d=sub(p,origin);return [dot(d,x),dot(d,y),dot(d,normal)];},world=p=>add(origin,add(mul(x,p[0]),add(mul(y,p[1]),mul(normal,p[2])))),triangles=faceIds.flatMap(fi=>{const f=mesh.faces[fi];return [[f[0],f[1],f[2]],[f[0],f[2],f[3]]].map(ids=>{const p=ids.map(i=>local(mesh.vertices[i]));return {p,den:cross2(...p)};});});
    if(triangles.some(t=>t.den<D*D*1e-10))return {supported:false,reason:'分区无法单值投影，保留原CSI分区网格'};
    const patchFaces=new Set(faceIds),border=[...E.topology(mesh).edges.values()].filter(e=>e.faces.filter(fi=>patchFaces.has(fi)).length===1).map(e=>({a:e.a,b:e.b,pa:local(mesh.vertices[e.a]),pb:local(mesh.vertices[e.b])})),borderNodes=[...new Set(border.flatMap(e=>[e.a,e.b]))],eps=D*1e-9;
    const contact=p=>{for(const id of borderNodes){const q=local(mesh.vertices[id]);if(Math.hypot(q[0]-p[0],q[1]-p[1])<eps*8)return {vertex:id};}for(const e of border){const dx=e.pb[0]-e.pa[0],dy=e.pb[1]-e.pa[1],t=((p[0]-e.pa[0])*dx+(p[1]-e.pa[1])*dy)/(dx*dx+dy*dy);if(t>=-1e-8&&t<=1+1e-8&&Math.hypot(p[0]-e.pa[0]-dx*t,p[1]-e.pa[1]-dy*t)<eps*8)return {edge:[e.a,e.b],t:E.clamp(t,0,1)};}return null;};
    const points=triangles.flatMap(t=>t.p),lo=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...points.map(p=>p[k]))),projectedArea=triangles.reduce((s,t)=>s+t.den/2,0),lift=p=>{let best=null,error=Infinity;for(const t of triangles){const u=cross2(t.p[1],t.p[2],p)/t.den,v=cross2(t.p[2],t.p[0],p)/t.den,w=1-u-v,e=Math.max(-u,-v,-w,0);if(e<error){error=e;best=world([p[0],p[1],u*t.p[0][2]+v*t.p[1][2]+w*t.p[2][2]]);if(e<1e-10)break;}}if(error>1e-6)throw Error('结构网格点超出CSI曲面域。');return best;};
    return {supported:true,patch:chart.patch,border,borderNodes,borderPoint:p=>borderNodes.some(id=>{const q=local(mesh.vertices[id]);return Math.hypot(q[0]-p[0],q[1]-p[1])<eps*8;}),contact,position:s=>s.vertex!==undefined?mesh.vertices[s.vertex].slice():add(mul(mesh.vertices[s.edge[0]],1-s.t),mul(mesh.vertices[s.edge[1]],s.t)),triangles,lo,hi,projectedArea,lift,D,frame:{origin,x,y,normal},sourceFace:mesh.faceSources?.[faceIds[0]]??0};
  }
  function clipped(poly,axis,value,sign,eps){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a[axis]-value)*sign,db=(b[axis]-value)*sign,inside=da>=-eps,next=db>=-eps;if(inside)out.push(a);if(inside!==next){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return out;}
  function cellPolygons(ref,box){
    const eps=ref.D*1e-9,points=new Map(),edges=new Map(),key=p=>p.map(v=>Math.round(v/eps)).join(':'),at=p=>{const k=key(p);if(!points.has(k))points.set(k,p.slice(0,2));return k;};
    for(const t of ref.triangles){let p=t.p.map(v=>v.slice(0,2));for(const [axis,value,sign]of [[0,box[0],1],[0,box[2],-1],[1,box[1],1],[1,box[3],-1]]){p=clipped(p,axis,value,sign,eps);if(p.length<3)break;}if(p.length<3||area(p)<eps*eps)continue;
      const ids=p.map(at).filter((v,i,a)=>v!==a[(i+a.length-1)%a.length]);for(let i=0;i<ids.length;i++){const a=ids[i],b=ids[(i+1)%ids.length];if(a===b)continue;const forward=a+'|'+b,reverse=b+'|'+a;if(edges.has(reverse))edges.delete(reverse);else edges.set(forward,[a,b]);}}
    const next=new Map();for(const [a,b]of edges.values()){if(!next.has(a))next.set(a,[]);next.get(a).push(b);}const remaining=new Set(edges.keys()),loops=[];
    while(remaining.size){const start=edges.get(remaining.values().next().value)[0],ids=[start];let a=start,previous=null;for(let guard=0;guard<=edges.size;guard++){const ns=(next.get(a)||[]).filter(b=>remaining.has(a+'|'+b));if(!ns.length)throw Error('结构网格裁切边界未闭合。');let b=ns[0];if(ns.length>1&&previous!==null){const p=points.get(previous),q=points.get(a),angle=v=>Math.atan2(cross2(p,q,points.get(v)),(q[0]-p[0])*(points.get(v)[0]-q[0])+(q[1]-p[1])*(points.get(v)[1]-q[1]));b=ns.slice().sort((x,y)=>angle(x)-angle(y))[0];}remaining.delete(a+'|'+b);previous=a;a=b;if(a===start)break;ids.push(a);}if(a!==start)throw Error('结构网格裁切出现未闭合支路。');
      let p=ids.map(i=>points.get(i)),changed=true;while(changed&&p.length>3){changed=false;for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],span=Math.hypot(c[0]-a[0],c[1]-a[1]);if(!ref.borderPoint(b)&&Math.abs(cross2(a,b,c))<eps*Math.max(eps,span)*4&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])>=0){p.splice(i,1);changed=true;break;}}}if(p.length>=3&&area(p)>eps*eps)loops.push(p);
    }return loops;
  }
  function tilePolygon(points,ref){
    if(points.length>64)throw Error('单个结构裁切面超过64点，请提高总面数上限或简化CSI边界。');
    const n=points.length,eps=1e-10*Math.max(...[0,1].map(k=>Math.max(...points.map(p=>p[k]))-Math.min(...points.map(p=>p[k])))),cache=new Map(),valid=new Map(),inside=p=>{let v=false;for(let i=0,j=n-1;i<n;j=i++)if((points[i][1]>p[1])!==(points[j][1]>p[1])&&p[0]<(points[j][0]-points[i][0])*(p[1]-points[i][1])/(points[j][1]-points[i][1])+points[i][0])v=!v;return v;};
    const diagonal=(i,j)=>{if(i===j||Math.abs(i-j)===1||Math.abs(i-j)===n-1)return true;const key=i+':'+j;if(valid.has(key))return valid.get(key);const a=points[i],b=points[j];let okay=inside([(a[0]+b[0])/2,(a[1]+b[1])/2]);for(let k=0;okay&&k<n;k++){const l=(k+1)%n;if([i,j].includes(k)||[i,j].includes(l))continue;const c=points[k],d=points[l],s1=cross2(a,b,c),s2=cross2(a,b,d),s3=cross2(c,d,a),s4=cross2(c,d,b);if(s1*s2<=0&&s3*s4<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))+eps&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))+eps)okay=false;}valid.set(key,okay);return okay;};
    const cost=ids=>{const p=ids.map(i=>points[i]),spatial=p.map(p=>{const s=ref.contact(p);return s?ref.position(s):ref.lift(p);}),spans=spatial.map((a,i)=>dist(a,spatial[(i+1)%spatial.length]));if(p.length===4&&Math.max(...spans)/Math.min(...spans)>4)return Infinity;const length=p.map((a,i)=>Math.hypot(a[0]-p[(i+1)%p.length][0],a[1]-p[(i+1)%p.length][1]));let q=Infinity;for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],sin=cross2(a,b,c)/(length[(i+p.length-1)%p.length]*length[i]);if(sin<=1e-9||p.length===4&&sin<.12)return Infinity;q=Math.min(q,sin);}return (p.length===4?1:1.6)+.06*Math.log(Math.max(...spans)/Math.min(...spans))**2+.03/q;};
    const solve=(i,j)=>{if(j-i<2)return {cost:0,faces:[]};const key=i+':'+j;if(cache.has(key))return cache.get(key);let best={cost:Infinity};const consider=ids=>{const c=cost(ids);if(!Number.isFinite(c))return;const parts=[];let total=c;for(let k=0;k<ids.length-1;k++){if(!diagonal(ids[k],ids[k+1]))return;const part=solve(ids[k],ids[k+1]);if(!Number.isFinite(part.cost))return;parts.push(part);total+=part.cost;}if(total<best.cost)best={cost:total,faces:[ids,...parts.flatMap(p=>p.faces)]};};for(let k=i+1;k<j;k++){consider([i,k,j]);for(let l=k+1;l<j;l++)consider([i,k,l,j]);}cache.set(key,best);return best;};
    const result=solve(0,n-1);if(!Number.isFinite(result.cost))throw Error('无法分解裁切多边形。');return result.faces;
  }
  function collapseSlivers(mesh,uv,sources,kinds,pitch,ref){
    let faces=mesh.faces,collapsed=0;const originalNodes=new Set(sources.filter(s=>s?.vertex!==undefined).map(s=>s.vertex)),maxLength=pitch*.16;
    for(let pass=0;pass<3;pass++){
      const candidates=[...E.topology({...mesh,faces}).edges.values()].map(e=>({...e,length:dist(mesh.vertices[e.a],mesh.vertices[e.b])})).filter(e=>e.length<maxLength).sort((a,b)=>a.length-b.length);let changed=false;
      for(const edge of candidates){
        if(!faces.some(f=>f.includes(edge.a)&&f.includes(edge.b)))continue;
        const a=sources[edge.a],b=sources[edge.b];let from,to;
        if(a?.vertex!==undefined&&b?.edge&&b.edge.includes(a.vertex)){from=edge.b;to=edge.a;}
        else if(b?.vertex!==undefined&&a?.edge&&a.edge.includes(b.vertex)){from=edge.a;to=edge.b;}
        else if(a?.edge&&b?.edge&&E.key(...a.edge)===E.key(...b.edge)){from=edge.b;to=edge.a;}
        else if(!a&&b){from=edge.a;to=edge.b;}
        else if(!b&&a){from=edge.b;to=edge.a;}
        else continue;
        // Bend correspondence is a construction constraint, including its
        // trimmed boundary endpoints. Sliver cleanup must not erase that line.
        if(ref.refinementCoordinates?.some(c=>Math.abs(uv[from][c.axis]-c.value)<ref.D*1e-8&&Math.abs(uv[to][c.axis]-c.value)>ref.D*1e-8))continue;
        const next=[],nextKinds=[];let valid=true;
        for(let fi=0;fi<faces.length;fi++){
          const old=faces[fi],mapped=old.map(v=>v===from?to:v),f=mapped.filter((v,i)=>v!==mapped[(i+mapped.length-1)%mapped.length]);
          if(f.length<3)continue;
          if(new Set(f).size!==f.length){valid=false;break;}
          if(old.includes(from)){
            const p=f.map(id=>uv[id]);if(area(p)<=ref.D**2*1e-14||p.some((v,i)=>cross2(p[(i+p.length-1)%p.length],v,p[(i+1)%p.length])<=ref.D**2*1e-14)){valid=false;break;}
            if(f.length===4){const lengths=f.map((id,i)=>dist(mesh.vertices[id],mesh.vertices[f[(i+1)%4]]));if(Math.max(...lengths)/Math.min(...lengths)>4){valid=false;break;}}
          }
          next.push(f);nextKinds.push(old.includes(from)?'boundary-transition':kinds[fi]);
        }
        if(!valid)continue;
        const used=new Set(next.flat()),present=new Set([...used].flatMap(i=>sources[i]?.vertex===undefined?[]:[sources[i].vertex]));
        if([...originalNodes].some(id=>!present.has(id)))continue;
        const health=E.audit({...mesh,faces:next});if(!health.valid||health.components!==1||health.boundaryLoops!==1||health.euler[0]!==1)continue;
        faces=next;kinds.splice(0,kinds.length,...nextKinds);changed=true;collapsed++;
      }
      if(!changed)break;
    }
    mesh.faces=faces;return collapsed;
  }
  function lattice(ref,pitch,phase=[.1732050807568877,.3819660112501051]){
    const vertices=[],uv=[],sources=[],kinds=[],registry=new Map(),eps=ref.D*1e-9,vertex=(p,position)=>{const k=p.map(v=>Math.round(v/eps)).join(':');if(!registry.has(k)){registry.set(k,vertices.length);const source=ref.contact(p);sources.push(source);vertices.push(source?ref.position(source):ref.lift(p));uv.push(p.slice());}return registry.get(k);},start=ref.lo.map((v,i)=>v-pitch*phase[i]),stop=ref.hi;let faces=[];
    const axes=ref.refinementCoordinates?.length?[0,1].map(axis=>{let xs=[];for(let t=start[axis];t<stop[axis]+pitch;t+=pitch)xs.push(t);for(const cut of ref.refinementCoordinates.filter(c=>c.axis===axis)){const i=xs.reduce((best,x,i)=>Math.abs(x-cut.value)<Math.abs(xs[best]-cut.value)?i:best,0);if(i>0&&i<xs.length-1&&Math.abs(xs[i]-cut.value)<pitch*.45&&!ref.refinementCoordinates.some(c=>c.axis===axis&&Math.abs(xs[i]-c.value)<eps))xs[i]=cut.value;else xs.push(cut.value);}return xs.sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>eps);}):null;
    let cells=0,trimmed=0;for(let iy=0,y=start[1];y<stop[1];iy++,y=axes?axes[1][iy]:y+pitch)for(let ix=0,x=start[0];x<stop[0];ix++,x=axes?axes[0][ix]:x+pitch){const dx=axes?axes[0][ix+1]-x:pitch,dy=axes?axes[1][iy+1]-y:pitch,loops=cellPolygons(ref,[x,y,x+dx,y+dy]);for(const loop of loops){cells++;const full=loop.length===4&&Math.abs(area(loop)-dx*dy)<dx*dy*1e-7;trimmed+=!full;for(const ids of full?[[0,1,2,3]]:tilePolygon(loop,ref)){faces.push(ids.map(i=>vertex(loop[i])));kinds.push(full?'straight-core':'boundary-transition');}}}
    const mesh={vertices,faces},sliversCollapsed=collapseSlivers(mesh,uv,sources,kinds,pitch,ref);faces=mesh.faces;const used=[...new Set(faces.flat())].sort((a,b)=>a-b),remap=new Map(used.map((id,i)=>[id,i])),nextVertices=used.map(id=>vertices[id]),nextUV=used.map(id=>uv[id]),nextSources=used.map(id=>sources[id]);vertices.splice(0,vertices.length,...nextVertices);uv.splice(0,uv.length,...nextUV);sources.splice(0,sources.length,...nextSources);faces=faces.map(f=>f.map(id=>remap.get(id)));mesh.faces=faces;const health=E.audit(mesh);if(!health.valid){const error=Error('裁切产生无效面。');error.diagnostics={mesh,health,refPatch:ref.patch};throw error;}return {vertices,faces,uv,sources,kinds,report:{patch:ref.patch,mode:'trimmed straight structure lattice',pitch,sliversCollapsed,coreQuads:kinds.filter(k=>k==='straight-core').length,boundaryQuads:faces.filter((f,i)=>f.length===4&&kinds[i]!=='straight-core').length,boundaryTriangles:faces.filter(f=>f.length===3).length,cells,trimmed,frame:ref.frame,highSurfaceQueries:0}};
  }
  function generateMixed(base,definition,options={}){
    if(!(definition.version===2&&definition.mode==='independent-structure-mixed'||definition.version===3&&definition.mode==='curvature-curve-network'))throw Error('混合结构布线参数无效。');
    // 统一以渲染三角面（四边面计2、三角面计1）统计并限制预算；旧参数 lowFaceBudget 兼容折算为 2× 三角面
    const countTriangles=fs=>fs.reduce((s,f)=>s+f.length-2,0),limit=options.lowTriangleBudget??(options.lowFaceBudget!==undefined?options.lowFaceBudget*2:1000);
    if(!Number.isInteger(limit)||limit<1)throw Error('低模三角面预算无效。');
    const refs=new Map(),patches=base.csiCharts||[],deferred=[];
    for(const chart of patches){
      if(chart.rim||chart.U<4||chart.V<4){deferred.push({patch:chart.patch,reason:chart.rim?'保留包边结构剖面':'简单小分区保留原网格，不为用满预算加密'});continue;}
      const r=definition.version===3?(typeof createContourCurvatureNetwork==='function'?createContourCurvatureNetwork:require('./curvature-network.js'))(E).reference(base,chart,base.csiCurveNetwork)||reference(base,chart):reference(base,chart);if(r.supported)refs.set(chart.patch,r);else deferred.push({patch:chart.patch,reason:r.reason});
    }
    const reserved=countTriangles(base.faces.filter((_,i)=>!refs.has(base.csiPatchGroups[i]))),available=limit-reserved,projectedArea=[...refs.values()].reduce((s,r)=>s+r.projectedArea,0);
    if(available<[...refs.values()].reduce((sum,r)=>sum+(r.borderNodes.length-2),0))throw Error('三角面预算不足以保留CSI结构分区。');
    let pitch=refs.size?Math.sqrt(projectedArea*2/available):0,out=new Map(),attempts=0;
    if(refs.size)for(;attempts<32;attempts++){
      out=new Map([...refs].map(([id,r])=>[id,lattice(r,pitch)]));
      if(reserved+[...out.values()].reduce((s,r)=>s+countTriangles(r.faces),0)<=limit)break;
      pitch*=1.10;
    }
    if(attempts===32)throw Error('三角面预算不足以保留CSI边界并局部收线。');
    // Phase selection avoids cutting an existing boundary knot into a tiny sliver.
    // It changes only the lattice origin within its own intrinsic structure plane.
    const quality=outputs=>[...outputs.values()].reduce((sum,r)=>{const t=E.topology(r),crease=[...t.edges.values()].filter(e=>e.faces.length===2&&dot(t.data[e.faces[0]].normal,t.data[e.faces[1]].normal)<.5).length;return sum+crease*100+r.faces.reduce((s,f)=>{const lengths=f.map((id,i)=>dist(r.vertices[id],r.vertices[f[(i+1)%f.length]])),ratio=Math.max(...lengths)/Math.min(...lengths);return s+Math.log(Math.max(1,ratio))**2;},0);},0);
    let best=quality(out),phase=[.1732050807568877,.3819660112501051];
    if(refs.size)for(const candidate of [[.37,.61],[.61,.17],[.83,.43],[.43,.83],[.61,.61]]){
      const next=new Map([...refs].map(([id,r])=>[id,lattice(r,pitch,candidate)]));
      if(reserved+[...next.values()].reduce((s,r)=>s+countTriangles(r.faces),0)>limit)continue;
      const score=quality(next);if(score<best-1e-8){out=next;best=score;phase=candidate;}
    }
    const vertices=[],faces=[],faceSources=[],groups=[],charts=[],kinds=[],reports=[],registry=new Map(),sources=[],baseVertices=[];
    const vertex=(patch,id,p,source)=>{const k=patch+':'+id;if(!registry.has(k)){const j=vertices.length;registry.set(k,j);vertices.push(p.slice());sources.push(source);baseVertices.push(source?.vertex??-(j+1));}return registry.get(k);};
    for(const c of patches){
      const r=out.get(c.patch),indices=base.faces.map((_,i)=>base.csiPatchGroups[i]===c.patch?i:-1).filter(i=>i>=0);
      if(r){
        const map=r.vertices.map((p,id)=>vertex(c.patch,id,p,r.sources[id]));
        for(let i=0;i<r.faces.length;i++){faces.push(r.faces[i].map(id=>map[id]));groups.push(c.patch);faceSources.push(base.faceSources?.[indices[0]]??0);kinds.push(r.kinds[i]);}
        charts.push({patch:c.patch,U:0,V:0,grid:[],rim:false,structureFrame:refs.get(c.patch).frame,latticeCoordinates:r.uv,latticeVertices:map,structureLattice:true});reports.push(r.report);
      }else{
        for(const fi of indices){faces.push(base.faces[fi].map(id=>vertex(c.patch,id,base.vertices[id],{vertex:id})));groups.push(c.patch);faceSources.push(base.faceSources?.[fi]??0);kinds.push('retained-structure');}
        charts.push({...c,grid:c.grid.map(row=>row.map(id=>vertex(c.patch,id,base.vertices[id],{vertex:id})))});reports.push({patch:c.patch,mode:'independent retained CSI grid',faces:indices.length,reason:deferred.find(d=>d.patch===c.patch)?.reason});
      }
    }
    const baseTopology=E.topology(base),referenceEdges=[...baseTopology.edges].filter(([,e])=>e.faces.length===1||new Set(e.faces.map(fi=>base.csiPatchGroups[fi])).size>1).map(([key])=>key);
    const mesh={...structuredClone(base),vertices,faces,faceSources,hierarchy:{...base.hierarchy,allQuads:faces.every(f=>f.length===4)},csiPatchGroups:groups,csiCharts:charts,structureFaceKinds:kinds,csiBaseVertices:baseVertices,csiContactSources:sources,csiContactReference:{vertices:base.vertices.map(p=>p.slice()),edges:referenceEdges}};
    for(const k of ['smoothingGroups','sharpEdges','smoothingReport'])delete mesh[k];
    const t=E.topology(mesh),borders=[...t.edges].filter(([,e])=>e.faces.length===1);
    mesh.csiBoundaryKeys=borders.map(([key])=>key);mesh.csiEdges=borders.map(([key,e])=>({id:'mixed-border:'+key,virtual:false,vertices:[e.a,e.b],types:['CSI'],sampling:'independent patch border'}));
    const structureGrid={version:definition.version,mode:definition.mode,patches:reports,pitch,phase,planningAttempts:attempts+1,independentPatches:true,sharedVertexConstraint:false,wholeSurfaceWatertight:false,highSurfaceQueries:0,quads:faces.filter(f=>f.length===4).length,triangleFaces:faces.filter(f=>f.length===3).length,budgetCounts:'triangulated faces'};
    mesh.csiReport={...mesh.csiReport,structured:false,mixedTopology:faces.some(f=>f.length===3),structureGrid,referencePatches:mesh.csiReport.referencePatches||mesh.csiReport.patches,centeredRimVertices:[],sharedBoundaryEdges:0,budget:{...mesh.csiReport.budget,used:countTriangles(faces),limit,unit:'triangles',polygonFaces:faces.length},patches:reports};
    if(definition.version===3){mesh.csiReport.csiOnly=false;mesh.csiReport.geometrySource='saved principal-curvature CSI network with boundary collar';}mesh.method=definition.version===3?'三维经纬CSI曲面 / 独立分区混合布线':'CSI结构直向网格 / 四边面为主、局部三角面收线';
    const health=E.audit(mesh);if(!health.valid||faces.some(f=>f.length!==3&&f.length!==4)||countTriangles(faces)>limit)throw Error('混合结构布线未通过网格或三角面预算检查。');
    const contact=contactMeshMixed(mesh),audit=E.audit(contact),before=E.audit(base);
    if(!audit.valid||audit.components!==before.components||audit.boundaryLoops!==before.boundaryLoops||JSON.stringify(audit.euler)!==JSON.stringify(before.euler))throw Error('独立分区的CSI接触拓扑不一致。');
    const pairs=intersections(contact);mesh.csiReport.intersectionAudit={initialFacePairs:pairs,remainingNonadjacentTrianglePairs:pairs,checkedOnBase:false,method:'new mixed patches; only verified copies on the same captured CSI node/edge identified and split for contact audit; shared-vertex and coplanar contacts excluded'};
    if(pairs)throw Error('混合结构网格存在'+pairs+'处穿插，保留旧结果。');
    structureGrid.contactTopology=audit;if(definition.version===3)(typeof createContourCurvatureNetwork==='function'?createContourCurvatureNetwork:require('./curvature-network.js'))(E).anchorDisplay(mesh);return mesh;
  }
  function contactMeshMixed(mesh,keepFaces=false){
    const reference=mesh.csiContactReference,edgeSet=new Set(reference.edges),D=E.bounds(mesh).diagonal,eps=D*1e-8,vertices=[],map=[],registry=new Map(),cuts=new Map(),parameters=[];
    const register=(key,p)=>{if(registry.has(key)){const id=registry.get(key);if(dist(vertices[id],p)>eps)throw Error('同一CSI接触点发生分离。');return id;}const id=vertices.length;vertices.push(p.slice());registry.set(key,id);return id;};
    for(let i=0;i<mesh.vertices.length;i++){
      const s=mesh.csiContactSources[i],p=mesh.vertices[i];let key='interior:'+i,q=p,param=null;
      if(s?.vertex!==undefined){q=reference.vertices[s.vertex];if(!q)throw Error('CSI接触节点缺失。');key='v:'+s.vertex;param={vertex:s.vertex};}
      else if(s?.edge){const [a,b]=s.edge,t=s.t,k=E.key(a,b);if(!edgeSet.has(k)||!Number.isFinite(t)||t<0||t>1)throw Error('CSI接触边参数无效。');q=lerp(reference.vertices[a],reference.vertices[b],t);key='e:'+k+':'+Math.round(t*1e10);param={edge:k,t};}
      if(dist(q,p)>eps)throw Error('CSI接触点偏离原边界。');
      const id=register(key,p);map[i]=id;parameters[i]=param;
      if(param?.edge){if(!cuts.has(param.edge))cuts.set(param.edge,[]);cuts.get(param.edge).push({t:param.t,id});}
    }
    const segment=(a,b)=>{
      const x=parameters[a],y=parameters[b];if(!x||!y)return null;
      let edge=x.edge||y.edge;if(!edge){edge=E.key(x.vertex,y.vertex);if(!edgeSet.has(edge))return null;}
      const [lo,hi]=edge.split(':').map(Number),at=s=>s.edge===edge?s.t:s.vertex===lo?0:s.vertex===hi?1:null,from=at(x),to=at(y);
      return from===null||to===null?null:{edge,from,to};
    };
    // Only the audit mesh receives extra collinear boundary vertices. Exported
    // patches remain independent, so neighboring groups need not share density.
    const expand=face=>{const out=[];for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length],s=segment(a,b);out.push(map[a]);if(!s)continue;const candidates=(cuts.get(s.edge)||[]).filter(c=>c.t>Math.min(s.from,s.to)+1e-9&&c.t<Math.max(s.from,s.to)-1e-9).sort((a,b)=>(a.t-b.t)*Math.sign(s.to-s.from)),used=new Set();for(const c of candidates)if(!used.has(c.id)){out.push(c.id);used.add(c.id);}}return out;};
    const triangles=E.triangulate(mesh),polygons=triangles.faces.map(expand);
    // Subdivide actual rendering triangles, not warped quads: changing a quad's
    // diagonal during contact normalization would change the surface being tested.
    const faces=[],faceParents=[],kept=new Set();
    if(keepFaces)mesh.faces.forEach((face,i)=>{
      const welded=expand(face);
      if(welded.length!==face.length)return;
      kept.add(i);faces.push(welded);faceParents.push(i);
    });
    for(const [i,polygon] of polygons.entries()){
      if(kept.has(triangles.source[i]))continue;
      const emit=f=>{faces.push(f);faceParents.push(triangles.source[i]);};
      if(polygon.length===3){emit(polygon);continue;}
      const center=vertices.length;vertices.push(polygon.reduce((sum,id)=>add(sum,mul(vertices[id],1/polygon.length)),[0,0,0]));
      for(let j=0;j<polygon.length;j++)emit([polygon[j],polygon[(j+1)%polygon.length],center]);
    }
    return {vertices,faces,faceParents,vertexMap:map};
  }
  function adaptiveSurface(source,proposal,interfaces,options){
    const limit=options.lowTriangleBudget,groups=proposal.patchGroups,sourceAudit=E.audit(source),scale=E.bounds(source).diagonal;
    const checker=(typeof createContourCheck==='function'?createContourCheck:require('./contour-check.js'))(E);
    const matcher=(typeof createContourSilhouetteMatch==='function'?createContourSilhouetteMatch:require('./silhouette-match.js'))(E);
    const views=matcher.views(source,scale),sourceTopology=E.topology(source),protectedGroups=new Set(proposal.surfaceFrames.filter(f=>f.annular).map(f=>f.patch));
    const internal=new Set(proposal.fittingReport.internalInterfaceIds),manual=new Set(options.manualEdges||[]);
    const removable=interfaces.filter(c=>internal.has(c.id)&&!c.closed&&c.regionPair.length===2&&c.regionPair.every(g=>!protectedGroups.has(g))&&c.edges.every(k=>{
      const e=sourceTopology.edges.get(k);
      return !manual.has(k)&&e?.faces.length===2&&dot(sourceTopology.data[e.faces[0]].normal,sourceTopology.data[e.faces[1]].normal)>.94;
    }));
    const regionMap=new Map(proposal.patches.map(p=>[p.id,p.id])),root=id=>{
      while(regionMap.get(id)!==id)id=regionMap.get(id);
      return id;
    };
    let best=null;
    // 先尝试全部结构曲线。预算吃紧时，可合并经过法线及包边检查的弱分界。
    for(const mergeWeak of removable.length?[false,true]:[false]){
      if(mergeWeak)for(const c of removable)regionMap.set(root(c.regionPair[1]),root(c.regionPair[0]));
      const currentGroups=groups.map(root),active=interfaces.filter(c=>new Set(c.regionPair.map(root)).size>1||c.regionPair.length===1);
      const anchors=new Set(active.flatMap(c=>c.anchors));
      const protectedKeys=[...manual,...[...anchors].map(id=>E.key(id,id))];
      for(const seamWeight of [1,4,8]){
        const seed=E.simplify(source,limit,protectedKeys,{faceGroups:currentGroups,seamWeight,normalLimit:70,maxError:.18});
        if(!seed.simplification.metTarget)continue;
        const out=E.matchQuads(seed,38,5,(a,b)=>currentGroups[seed.faceSources[a]]===currentGroups[seed.faceSources[b]]);
        out.csiPatchGroups=out.faceSources.map(i=>currentGroups[i]);
        const audit=E.audit(out);
        if(!audit.valid||audit.components!==sourceAudit.components||audit.boundaryLoops!==sourceAudit.boundaryLoops||String(audit.euler)!==String(sourceAudit.euler)||intersections(out))continue;
        const topology=E.topology(out),seams=[...topology.edges].filter(([,e])=>e.faces.length===1||out.csiPatchGroups[e.faces[0]]!==out.csiPatchGroups[e.faces[1]]);
        const curvePoints=new Map(),bySource=new Map();
        for(const c of active){
          const points=c.curves.flatMap((span,i)=>i?span.samples.slice(1):span.samples);
          curvePoints.set(c.id,points);
          for(const id of c.vertices){if(!bySource.has(id))bySource.set(id,new Set());bySource.get(id).add(c);}
        }
        const fitted=E.copy(out),seamVertices=new Set(seams.flatMap(([,e])=>[e.a,e.b]));
        for(const id of seamVertices){
          const origins=out.sourceMap[id];
          if(origins.some(v=>anchors.has(v)))continue;
          const ns=topology.incident[id],incident=new Set(ns.map(i=>out.csiPatchGroups[i]));
          const c=origins.flatMap(v=>[...(bySource.get(v)||[])]).find(c=>c.regionPair.length===incident.size&&c.regionPair.every(g=>incident.has(root(g))));
          if(!c)continue;
          const p=out.vertices[id],points=curvePoints.get(c.id);
          let target=p,distance=Math.min(c.tolerance,scale*.0025);
          for(let i=1;i<points.length;i++){
            const a=points[i-1],b=points[i],d=sub(b,a),t=E.clamp(dot(sub(p,a),d)/(dot(d,d)||1),0,1),q=add(a,mul(d,t)),error=dist(p,q);
            if(error<distance){distance=error;target=q;}
          }
          fitted.vertices[id]=target;
        }
        // 低模保形检查使用实际面，通过整个投影和内部深度筛选，避免只看导线或平均点误差。
        const validFit=E.audit(fitted).valid&&!intersections(fitted)&&fitted.faces.every((f,i)=>dot(E.faceData(fitted,f).normal,topology.data[i].normal)>.7);
        for(const mesh of validFit?[fitted,out]:[out]){
          let score=0,inwardDepth=0,worstContour=0;
          for(const view of views){
            const a=checker.analyze(source,mesh,[],view.project,{resolution:128});
            if(!a.report.available){score+=1;continue;}
            const depths=[];
            for(let i=0;i<a.source.depth.length;i++){
              const s=a.source.depth[i],m=a.candidate.depth[i];
              if(Number.isFinite(s)&&Number.isFinite(m))depths.push(Math.min(.1,Math.max(0,m-s)));
            }
            depths.sort((a,b)=>a-b);
            const inward=depths[Math.floor(depths.length*.9)]||0;
            score+=1-a.report.iou+2*a.report.p95Relative+3*inward;
            inwardDepth=Math.max(inwardDepth,inward);
            worstContour=Math.max(worstContour,a.report.p95Relative);
          }
          const before=best?.score??Infinity;
          if(score<before-1e-8)best={mesh,score,inwardDepth,worstContour,seams,active,merged:interfaces.length-active.length,regions:[...regionMap].map(([id])=>[id,root(id)])};
        }
      }
    }
    if(!best)return null;
    const {mesh,seams,active}=best;
    mesh.csiBoundaryKeys=seams.map(([k])=>k);
    mesh.csiEdges=seams.map(([k,e])=>({id:'budget:'+k,vertices:[e.a,e.b],virtual:false,types:['CSI']}));
    mesh.method='CSI 预算分区 / 主体保形混合布线';
    mesh.hierarchy={parentLevel:'middle-csi',sourceFingerprint:E.fingerprint(source)};
    mesh.csiReport={fallback:false,csiOnly:false,mixedTopology:true,sourceGeometryUsed:true,
      budget:{unit:'triangles',limit,used:E.audit(mesh).triangles,polygonFaces:mesh.faces.length},
      structureGrid:{version:4,mode:'budgeted-csi-surface',mergedWeakInterfaces:best.merged,sourceRegions:best.regions},
      shape:{worstViewContourP95:best.worstContour,maximumViewInwardDepthP90:best.inwardDepth,views:views.length},
      curves:{originalSpans:active.reduce((s,c)=>s+c.originalSpans,0),fittedSpans:active.reduce((s,c)=>s+c.curves.length,0)},
      intersectionAudit:{remainingNonadjacentTrianglePairs:0}};
    return mesh;
  }
  function generateFeatures(source,features,network,options={},progress=()=>{}){
    const limit=options.lowTriangleBudget??1000,signature=E.fingerprint(source);
    if(network.sourceFingerprint!==signature||features.sourceFingerprint!==signature)throw Error('结构构面与源网格指纹不一致。');
    const input=E.triangulate(source),labels=input.source.map(i=>features.patchGroups[i]),topology=E.topology(input),scale=E.bounds(source).diagonal,sourceHealth=E.audit(source);
    const graphs=features.patches.map(()=>new Map()),anchors=new Set(network.anchors),V=input.vertices.length;
    const link=(graph,a,b,length)=>{if(!graph.has(a))graph.set(a,new Map());graph.get(a).set(b,length);};
    for(const edge of topology.edges.values()){
      const length=dist(input.vertices[edge.a],input.vertices[edge.b]);
      for(const g of new Set(edge.faces.map(i=>labels[i]))){link(graphs[g],edge.a,edge.b,length);link(graphs[g],edge.b,edge.a,length);}
    }
    // 平滑曲面上的近似平面不等同于硬表面；比较边界与内部的源曲率来识别真实转折。
    const innerCurvatures=new Float64Array(features.patches.length),pairCurvatures=new Map(),meshSpacing=Math.sqrt(topology.data.reduce((sum,f)=>sum+f.area,0)/limit);
    const median=list=>{if(!list.length)return 0;const sorted=list.slice().sort((a,b)=>a.value-b.value),total=sorted.reduce((sum,v)=>sum+v.weight,0);let sum=0;for(const v of sorted){sum+=v.weight;if(sum>=total/2)return v.value;}return sorted.at(-1).value;};
    for(const edge of topology.edges.values())if(edge.faces.length===2){
      const [a,b]=edge.faces,A=labels[a],B=labels[b],angle=Math.acos(E.clamp(dot(topology.data[a].normal,topology.data[b].normal),-1,1)),weight=dist(input.vertices[edge.a],input.vertices[edge.b]),curvature=angle/Math.max(dist(topology.data[a].center,topology.data[b].center),scale*1e-9);
      if(A===B){innerCurvatures[A]+=angle*weight;continue;}
      const key=A<B?A+':'+B:B+':'+A;if(!pairCurvatures.has(key))pairCurvatures.set(key,{a:A,b:B,curvatures:[],angles:[]});
      pairCurvatures.get(key).curvatures.push({value:curvature,weight});pairCurvatures.get(key).angles.push({value:angle,weight});
    }
    // 转角积分除以区域面积，避免四边面三角化的零转角对角线把曲率中值压成零。
    const innerDensity=Array.from(innerCurvatures,(sum,i)=>sum/features.patches[i].area),hardNeighbors=features.patches.map(()=>new Set()),hardPairs=[];
    for(const [key,pair]of pairCurvatures){
      if(dot(features.patches[pair.a].normal,features.patches[pair.b].normal)>Math.cos(25*Math.PI/180))continue;
      const direct=median(pair.angles)>Math.PI/4,concentrated=median(pair.curvatures)>Math.max(Math.PI/6/(meshSpacing*.6),Math.max(innerDensity[pair.a],innerDensity[pair.b])*2.5);
      if(direct||concentrated){hardNeighbors[pair.a].add(pair.b);hardNeighbors[pair.b].add(pair.a);hardPairs.push(key);}
    }
    const rigidGroups=new Set(features.patches.filter(p=>p.fixedPlane&&hardNeighbors[p.id].size>=2).map(p=>p.id));
    class DistanceQueue{
      constructor(){this.a=[];}
      less(a,b){return Math.abs(a.distance-b.distance)>scale*1e-12?a.distance<b.distance:a.anchor!==b.anchor?a.anchor<b.anchor:a.vertex<b.vertex;}
      push(item){const a=this.a;let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(!this.less(a[i],a[p]))break;[a[i],a[p]]=[a[p],a[i]];i=p;}}
      pop(){const a=this.a,out=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&this.less(a[j+1],a[j]))j++;if(!this.less(a[j],a[i]))break;[a[i],a[j]]=[a[j],a[i]];i=j;}}return out;}
    }
    function boundaryOwners(){
      const owners=new Int32Array(V).fill(-1);
      for(const edge of network.logicalEdges){
        const ids=edge.vertices,arc=[0];for(let i=1;i<ids.length;i++)arc.push(arc.at(-1)+dist(input.vertices[ids[i-1]],input.vertices[ids[i]]));
        const knots=ids.map((v,i)=>anchors.has(v)?i:-1).filter(i=>i>=0);
        for(let j=1;j<knots.length;j++){
          const a=knots[j-1],b=knots[j],middle=(arc[a]+arc[b])/2;
          for(let i=a;i<=b;i++)owners[ids[i]]=arc[i]<middle-scale*1e-12?ids[a]:arc[i]>middle+scale*1e-12?ids[b]:Math.min(ids[a],ids[b]);
        }
      }
      for(const v of anchors)owners[v]=v;return owners;
    }
    function color(){
      const owners=new Int32Array(V).fill(-1);
      for(let g=0;g<graphs.length;g++){
        const graph=graphs[g],queue=new DistanceQueue(),best=new Map();
        for(const v of graph.keys())if(anchors.has(v))queue.push({vertex:v,anchor:v,distance:0});
        if(!queue.a.length)throw Error('结构分区 '+(g+1)+' 缺少构面锚点。');
        while(queue.a.length){const item=queue.pop(),prior=best.get(item.vertex);if(prior)continue;best.set(item.vertex,item);owners[item.vertex]=item.anchor;
          for(const [vertex,length]of graph.get(item.vertex))if(!best.has(vertex))queue.push({vertex,anchor:item.anchor,distance:item.distance+length});
        }
      }
      const boundary=boundaryOwners();for(let i=0;i<V;i++)if(boundary[i]>=0)owners[i]=boundary[i];return owners;
    }
    function budgetError(required){const error=Error('CSI 主块面及拓扑修复至少需要 '+required+' 个三角面，超过预算 '+limit+'。');error.code='FEATURE_BUDGET';error.requiredTriangles=required;return error;}
    function addVertices(vertices){let added=0;for(const v of vertices)if(!anchors.has(v)){anchors.add(v);added++;}return added;}
    function cellRepairs(owners){
      const cells=new Map();
      for(let v=0;v<V;v++)if(owners[v]>=0){const a=owners[v];if(!cells.has(a))cells.set(a,{vertices:[],euler:0});const c=cells.get(a);c.vertices.push(v);c.euler++;}
      for(const edge of topology.edges.values())if(owners[edge.a]===owners[edge.b])cells.get(owners[edge.a]).euler--;
      for(const f of input.faces)if(owners[f[0]]===owners[f[1]]&&owners[f[0]]===owners[f[2]])cells.get(owners[f[0]]).euler++;
      const repair=[];
      for(const [anchor,c]of cells)if(c.euler!==1){
        let best=-1,distance=-1;for(const v of c.vertices)if(!anchors.has(v)){const value=dist(input.vertices[v],input.vertices[anchor]);if(value>distance){best=v;distance=value;}}
        if(best>=0)repair.push(best);
      }
      return repair;
    }
    function extract(owners){
      const used=[...new Set(owners)].filter(v=>v>=0).sort((a,b)=>a-b),mapping=new Map(used.map((v,i)=>[v,i])),vertices=used.map(v=>input.vertices[v].slice()),faces=[],regions=[],origins=[],unique=new Map(),repair=new Set();
      for(let fi=0;fi<input.faces.length;fi++){
        const f=input.faces[fi],ids=f.map(v=>mapping.get(owners[v]));if(new Set(ids).size!==3)continue;
        const key=ids.slice().sort((a,b)=>a-b).join(':');
        if(unique.has(key)){const previous=unique.get(key);if(regions[previous]!==labels[fi]){f.forEach(v=>repair.add(v));input.faces[origins[previous]].forEach(v=>repair.add(v));}continue;}
        if(E.faceData({vertices},ids).area<scale*scale*1e-12){f.forEach(v=>repair.add(v));continue;}
        unique.set(key,faces.length);faces.push(ids);regions.push(labels[fi]);origins.push(fi);
      }
      return {mesh:{vertices,faces},regions,origins,used,mapping,repair};
    }
    const sameTopology=health=>health.valid&&health.components===sourceHealth.components&&health.boundaryLoops===sourceHealth.boundaryLoops&&JSON.stringify(health.euler.slice().sort((a,b)=>a-b))===JSON.stringify(sourceHealth.euler.slice().sort((a,b)=>a-b));
    function topologyRepairs(state,owners){
      const mt=E.topology(state.mesh),repair=state.repair,expectedBorders=new Set(),expectedInterfaces=new Set();
      for(const edge of topology.edges.values()){
        const a=state.mapping.get(owners[edge.a]),b=state.mapping.get(owners[edge.b]);if(a===b)continue;const key=E.key(a,b);
        if(edge.faces.length===1)expectedBorders.add(key);
        if(edge.faces.length===1||labels[edge.faces[0]]!==labels[edge.faces[1]])expectedInterfaces.add(key);
      }
      const mark=fi=>input.faces[state.origins[fi]].forEach(v=>repair.add(v));
      for(const [key,edge]of mt.edges){
        if(edge.faces.length>2||edge.faces.length===1&&!expectedBorders.has(key)){edge.faces.forEach(mark);continue;}
        if(edge.faces.length===2){const [a,b]=edge.faces,fa=state.mesh.faces[a],fb=state.mesh.faces[b],forward=f=>f.some((v,i)=>v===edge.a&&f[(i+1)%f.length]===edge.b);if(forward(fa)===forward(fb))edge.faces.forEach(mark);}
      }
      for(const key of expectedInterfaces)if(!mt.edges.has(key)){
        const [a,b]=key.split(':').map(Number);repair.add(state.used[a]);repair.add(state.used[b]);
        for(const v of [state.used[a],state.used[b]])for(const fi of topology.incident[v])input.faces[fi].forEach(w=>repair.add(w));
      }
      if(!sameTopology(E.audit(state.mesh))&&!repair.size){
        // 在拓扑尚未充分表达的区域增加内部锚点，避免把孔洞或分支直接压成面。
        for(const p of features.patches.slice().sort((a,b)=>b.error-a.error).slice(0,12)){
          const candidates=p.faces.flatMap(fi=>source.faces[fi]).filter(v=>!anchors.has(v));
          if(candidates.length)repair.add(candidates.reduce((best,v)=>dist(source.vertices[v],p.center)>dist(source.vertices[best],p.center)?v:best,candidates[0]));
        }
      }
      return repair;
    }
    let state=null,owners=null,repairs=0,repairRounds=0,completed=false;
    function construct(){
    completed=false;
    for(let pass=0;pass<32;pass++){
      progress('CSI 补片离散构面 '+(pass+1));owners=color();
      const cells=cellRepairs(owners);if(cells.length){const added=addVertices(cells);repairs+=added;repairRounds++;if(added)continue;}
      state=extract(owners);const needed=topologyRepairs(state,owners),added=addVertices(needed);
      if(added){repairs+=added;repairRounds++;continue;}
      if(!sameTopology(E.audit(state.mesh)))throw Error('CSI 离散构面未能保持源模型的孔洞、边界或流形拓扑。');
      if(state.mesh.faces.length>limit)throw budgetError(state.mesh.faces.length);
      let crossings=0;intersections(state.mesh,null,(a,b)=>{crossings++;for(const fi of [a,b])input.faces[state.origins[fi]].forEach(v=>needed.add(v));});
      if(crossings){const count=addVertices(needed);if(count){repairs+=count;repairRounds++;continue;}throw Error('CSI 补片构面仍有 '+crossings+' 处穿插。');}
      completed=true;break;
    }
    if(!completed||!state||!sameTopology(E.audit(state.mesh)))throw Error('CSI 主块面构面修复超过迭代上限。');
    if(state.mesh.faces.length>limit)throw budgetError(state.mesh.faces.length);
    }
    construct();
    let fidelityAnchors=0,fidelityRounds=0;
    if(options.refineSurface!==false){
      const H=(typeof createContourHierarchy==='function'?createContourHierarchy:require('./hierarchy.js'))(E),rigidVertices=new Set();
      for(let v=0;v<V;v++)if(topology.incident[v].some(i=>rigidGroups.has(labels[i])))rigidVertices.add(v);
      for(let round=0;round<16&&state.mesh.faces.length+2<=limit;round++){
        const shape=H.surface(state.mesh),candidates=new Map();
        for(let g=0;g<graphs.length;g++){
          if(rigidGroups.has(g))continue;let best=null;
          for(const vertex of graphs[g].keys()){
            if(anchors.has(vertex)||rigidVertices.has(vertex))continue;
            const hit=shape.closest(input.vertices[vertex],null,null,fi=>state.regions[fi]===g);
            if(!hit||hit.distance<meshSpacing*.18)continue;
            if(!best||hit.distance>best.error+scale*1e-12)best={vertex,error:hit.distance};
          }
          if(best)candidates.set(best.vertex,best);
        }
        const ranked=[...candidates.values()].sort((a,b)=>b.error-a.error||a.vertex-b.vertex);if(!ranked.length)break;
        const snapshot={state,owners,anchors:[...anchors],repairs,repairRounds},count=Math.min(4,Math.max(1,Math.floor((limit-state.mesh.faces.length)/4)),ranked.length);
        let accepted=false;
        for(const amount of [...new Set([count,1])]){
          anchors.clear();snapshot.anchors.forEach(v=>anchors.add(v));repairs=snapshot.repairs;repairRounds=snapshot.repairRounds;
          addVertices(ranked.slice(0,amount).map(c=>c.vertex));
          try{construct();accepted=true;fidelityAnchors+=amount;fidelityRounds++;break;}
          catch(error){if(!error.code&&!String(error.message).startsWith('CSI '))throw error;}
        }
        if(!accepted){state=snapshot.state;owners=snapshot.owners;anchors.clear();snapshot.anchors.forEach(v=>anchors.add(v));repairs=snapshot.repairs;repairRounds=snapshot.repairRounds;break;}
      }
    }
    const base=state.mesh,trial=E.copy(base),baseTopology=E.topology(base),spacing=Math.sqrt(topology.data.reduce((sum,f)=>sum+f.area,0)/limit);let projected=0;
    function solve(matrix,rhs){
      const rows=matrix.map((r,i)=>[...r,rhs[i]]);
      for(let c=0;c<3;c++){let pivot=c;for(let i=c+1;i<3;i++)if(Math.abs(rows[i][c])>Math.abs(rows[pivot][c]))pivot=i;
        if(Math.abs(rows[pivot][c])<1e-15)return null;[rows[c],rows[pivot]]=[rows[pivot],rows[c]];
        const denominator=rows[c][c];for(let k=c;k<4;k++)rows[c][k]/=denominator;
        for(let i=0;i<3;i++)if(i!==c){const factor=rows[i][c];for(let k=c;k<4;k++)rows[i][k]-=factor*rows[c][k];}
      }
      return rows.map(r=>r[3]);
    }
    if(options.projectPlanes!==false)for(let id=0;id<trial.vertices.length;id++){
      const point=base.vertices[id],regionIds=new Set(baseTopology.incident[id].map(i=>state.regions[i]).filter(g=>rigidGroups.has(g))),matrix=Array.from({length:3},()=>[0,0,0]),rhs=[0,0,0];let total=0;
      if(!regionIds.size)continue;
      for(const g of regionIds){const p=features.patches[g],n=p.normal,w=p.fixedPlane?4:1/(1+((p.planarity||0)/.05)**2),d=dot(n,p.center);total+=w;
        for(let a=0;a<3;a++){rhs[a]+=w*n[a]*d;for(let b=0;b<3;b++)matrix[a][b]+=w*n[a]*n[b];}
      }
      for(let a=0;a<3;a++){matrix[a][a]+=total*.03;rhs[a]+=total*.03*point[a];}
      const solved=solve(matrix,rhs);if(!solved)continue;let delta=sub(solved,point),length=E.len(delta);if(length>spacing*.75)delta=mul(delta,spacing*.75/length);
      for(const fraction of [1,.5,.25,.125]){
        trial.vertices[id]=add(point,mul(delta,fraction));
        const safe=baseTopology.incident[id].every(fi=>{const q=E.faceData(trial,trial.faces[fi]);return q.area>baseTopology.data[fi].area*.1&&dot(q.normal,baseTopology.data[fi].normal)>.5;});
        if(safe){projected++;break;}trial.vertices[id]=point;
      }
    }
    const factors=new Float64Array(base.vertices.length).fill(1),deltas=trial.vertices.map((p,i)=>sub(p,base.vertices[i]));
    let fitted=trial,backoffs=0;
    for(let round=0;round<16;round++){
      const blocked=new Set();
      intersections(fitted,null,(a,b)=>{for(const v of [...fitted.faces[a],...fitted.faces[b]])if(E.len(deltas[v])*factors[v]>scale*1e-12)blocked.add(v);});
      fitted.faces.forEach((f,i)=>{const q=E.faceData(fitted,f);if(q.area<baseTopology.data[i].area*.02||dot(q.normal,baseTopology.data[i].normal)<.05)for(const v of f)if(E.len(deltas[v])*factors[v]>scale*1e-12)blocked.add(v);});
      if(!blocked.size)break;
      for(const v of blocked){factors[v]=round<10?factors[v]/2:0;fitted.vertices[v]=add(base.vertices[v],mul(deltas[v],factors[v]));backoffs++;}
    }
    if(intersections(fitted))throw Error('主平面贴合的局部穿插回退未收敛。');
    fitted.faceSources=fitted.faces.map((_,i)=>i);
    const mesh=E.matchQuads(fitted,38,4.5,(a,b)=>state.regions[a]===state.regions[b]);
    mesh.csiPatchGroups=mesh.faceSources.map(i=>state.regions[i]);mesh.faceSources=mesh.csiPatchGroups.map(g=>features.patches[g].faces[0]);
    mesh.csiFeatureAnchorSources=state.used.slice();mesh.csiSurfaceCharts=true;
    mesh.csiFeatureAnchorNormals=state.used.map(v=>unit(topology.incident[v].reduce((sum,i)=>add(sum,mul(topology.data[i].normal,topology.data[i].area)),[0,0,0])));
    mesh.csiHardSurfaceGroups=[...rigidGroups];
    const mt=E.topology(mesh),seams=[...mt.edges].filter(([,e])=>e.faces.length===1||mesh.csiPatchGroups[e.faces[0]]!==mesh.csiPatchGroups[e.faces[1]]);
    mesh.csiBoundaryKeys=seams.map(([key])=>key);
    mesh.csiEdges=network.logicalEdges.map(edge=>{const path=[];for(const v of edge.vertices){const id=state.mapping.get(owners[v]);if(path.at(-1)!==id)path.push(id);}return {id:edge.id,interfaceId:edge.interfaceId,vertices:path,curves:edge.curves,types:edge.curves.map(id=>network.curves.find(c=>c.id===id).type),virtual:false};});
    mesh.hierarchy={parentLevel:'middle-csi',sourceFingerprint:signature,featurePatches:true};mesh.method='CSI 主块面 / 共享边界离散构面';
    const health=E.audit(mesh);
    mesh.csiReport={fallback:false,featurePatches:true,csiOnly:false,sourceGeometryUsed:true,mixedTopology:true,sourceFingerprint:signature,
      budget:{unit:'triangles',limit,used:health.triangles,polygonFaces:mesh.faces.length,withinBudget:health.triangles<=limit},
      patches:features.patches.map(p=>({id:p.id,faces:mesh.csiPatchGroups.filter(g=>g===p.id).length,layout:'source-graph constrained patch',planarity:p.planarity})),
      structureGrid:{version:5,mode:'feature-patch-discrete',sourceRegions:features.patches.map(p=>[p.id,p.id]),independentPatches:false},
      features:{...features.report,anchors:state.used.length,topologyRepairs:repairs,repairRounds,fidelityAnchors,fidelityRounds,projectedAnchors:projected,hardSurfacePatches:rigidGroups.size,sourceHardPairs:hardPairs.length,projectionFraction:Math.min(...factors),localProjectionBackoffs:backoffs},
      intersectionAudit:{remainingNonadjacentTrianglePairs:intersections(mesh)},sourceUnmodified:E.fingerprint(source)===signature};
    if(!sameTopology(health)||health.triangles>limit||mesh.csiReport.intersectionAudit.remainingNonadjacentTrianglePairs||!mesh.csiReport.sourceUnmodified)throw Error('CSI 主块面最终网格未通过拓扑、预算或穿插检查。');
    return mesh;
  }
  function generate(base,definition={version:1,mode:'independent-structure-sections'},options={}){
    return [2,3].includes(definition?.version)?generateMixed(base,definition,options):generateSections(base,definition,options);
  }
  function contactMesh(mesh,keepFaces=false){return mesh.csiContactSources?contactMeshMixed(mesh,keepFaces):contactMeshSections(mesh);}
  return {generate,generateFeatures,adaptiveSurface,sectionPatch,contactMesh,planChart,intersections,tilePolygon};
}
if(typeof module!=='undefined')module.exports=createContourStructureGrid;
if(typeof window!=='undefined')window.createContourStructureGrid=createContourStructureGrid;

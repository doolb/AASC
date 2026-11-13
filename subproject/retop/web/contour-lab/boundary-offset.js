/* Full-distance offsets: trim self-intersections, stitch rings, cap vanished holes. */
function makeBoundaryOffset(E,UV){
 'use strict';
 const add=(a,b)=>a.map((v,k)=>v+b[k]),sub=(a,b)=>a.map((v,k)=>v-b[k]),mul=(a,k)=>a.map(v=>v*k),cross=(a,b)=>a[0]*b[1]-a[1]*b[0],len=a=>Math.hypot(...a),mix=(a,b,t)=>add(a,mul(sub(b,a),t));
 function contours(source,raw,width,D,growing=false,variable=false){
  const epsilon=D*1e-9,swept=[],segmentKeys=new Set();let segments=[];
  const segment=(a,b)=>{const keys=[a,b].map(p=>p.map(v=>Math.round(v/epsilon)).join(':')).sort(),key=keys.join('|');if(keys[0]!==keys[1]&&!segmentKeys.has(key)){segmentKeys.add(key);segments.push([a,b]);}};
  if(variable){for(let i=0;i<raw.length;i++){const j=(i+1)%raw.length;for(const points of [[source[i],source[j],raw[j]],[source[i],raw[j],raw[i]]]){const area=cross(sub(points[1],points[0]),sub(points[2],points[0]));if(Math.abs(area)>D*D*1e-14){swept.push({points,sign:Math.sign(area),box:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]});for(let k=0;k<3;k++)segment(points[k],points[(k+1)%3]);}}}}
  else for(let i=0;i<raw.length;i++)segments.push([raw[i],raw[(i+1)%raw.length]]);
  const triangleContains=(p,t,strict=false)=>{if(p[0]<t.box[0]||p[0]>t.box[2]||p[1]<t.box[1]||p[1]>t.box[3])return false;for(let k=0;k<3;k++){const a=t.points[k],b=t.points[(k+1)%3],d=((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))*t.sign;if(strict?d<=D*D*1e-12:d<0)return false;}return true;};
  // Remove intervals lying strictly inside any swept triangle before the
  // arrangement. This also avoids quadratic intersection work on hidden spokes
  // when an inward ribbon fills an entire hole.
  if(variable){const exposed=[];for(const [a,b]of segments){const intervals=[];for(const t of swept){if(Math.max(a[0],b[0])<t.box[0]||Math.min(a[0],b[0])>t.box[2]||Math.max(a[1],b[1])<t.box[1]||Math.min(a[1],b[1])>t.box[3])continue;let lo=0,hi=1;for(let k=0;k<3&&lo<hi;k++){const p=t.points[k],q=t.points[(k+1)%3],dx=q[0]-p[0],dy=q[1]-p[1],v=((a[0]-p[0])*(-dy)+(a[1]-p[1])*dx)*t.sign,w=((b[0]-a[0])*(-dy)+(b[1]-a[1])*dx)*t.sign;if(Math.abs(w)<D*D*1e-16){if(v<=D*D*1e-14){hi=lo;break;}}else if(w>0)lo=Math.max(lo,-v/w);else hi=Math.min(hi,-v/w);}if(hi>lo&&triangleContains(mix(a,b,(lo+hi)/2),t,true))intervals.push([lo,hi]);}intervals.sort((a,b)=>a[0]-b[0]);let cursor=0;const span=len(sub(b,a)),push=(lo,hi)=>{if((hi-lo)*span>epsilon)exposed.push([mix(a,b,lo),mix(a,b,hi)]);};for(const [lo,hi]of intervals){if(lo>cursor)push(cursor,lo);cursor=Math.max(cursor,hi);}if(cursor<1)push(cursor,1);}segments=exposed;}
  const n=segments.length,cuts=segments.map(()=>[0,1]);let intersections=0;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
   if(!variable&&(j===i+1||i===0&&j===n-1))continue;
   const [a,b]=segments[i],[c,d]=segments[j];if(Math.max(a[0],b[0])+epsilon<Math.min(c[0],d[0])||Math.max(c[0],d[0])+epsilon<Math.min(a[0],b[0])||Math.max(a[1],b[1])+epsilon<Math.min(c[1],d[1])||Math.max(c[1],d[1])+epsilon<Math.min(a[1],b[1]))continue;
   const u=sub(b,a),v=sub(d,c),den=cross(u,v);if(Math.abs(den)<D*D*1e-14){const u2=u[0]**2+u[1]**2,v2=v[0]**2+v[1]**2;if(u2>epsilon**2&&v2>epsilon**2&&Math.abs(cross(sub(c,a),u))<epsilon*Math.sqrt(u2)){for(const p of [c,d]){const q=sub(p,a),t=(q[0]*u[0]+q[1]*u[1])/u2;if(t>=0&&t<=1)cuts[i].push(t);}for(const p of [a,b]){const q=sub(p,c),t=(q[0]*v[0]+q[1]*v[1])/v2;if(t>=0&&t<=1)cuts[j].push(t);}if(!variable||Math.min(1,Math.max(...[c,d].map(p=>{const q=sub(p,a);return (q[0]*u[0]+q[1]*u[1])/u2})))-Math.max(0,Math.min(...[c,d].map(p=>{const q=sub(p,a);return (q[0]*u[0]+q[1]*u[1])/u2})))>1e-8)intersections++;}continue;}const t=cross(sub(c,a),v)/den,s=cross(sub(c,a),u)/den;
   if(t>=-1e-9&&t<=1+1e-9&&s>=-1e-9&&s<=1+1e-9){cuts[i].push(Math.max(0,Math.min(1,t)));cuts[j].push(Math.max(0,Math.min(1,s)));if(!variable||t>1e-8&&t<1-1e-8&&s>1e-8&&s<1-1e-8)intersections++;}
  }
  const winding=(p,poly)=>{let value=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],side=cross(sub(b,a),sub(p,a));if(a[1]<=p[1]&&b[1]>p[1]&&side>0)value++;if(a[1]>p[1]&&b[1]<=p[1]&&side<0)value--;}return value;},orientation=Math.sign(E.area(source)),distanceToSource=p=>{let d=Infinity;for(let j=0;j<source.length;j++)d=Math.min(d,E.pointSegment(p,source[j],source[(j+1)%source.length]));return d;};
  // A varying width has no single distance threshold. Classify the union of
  // swept strip triangles; folded/overlapping strips fill once, never shrink.
  const inSwept=p=>swept.some(t=>triangleContains(p,t)),inside=p=>variable?(growing?(winding(p,source)!==0||inSwept(p)):(winding(p,source)!==0&&!inSwept(p))):growing?(winding(p,raw)*orientation>0||winding(p,source)!==0||distanceToSource(p)<=width):(winding(p,source)!==0&&distanceToSource(p)>=width);
  const nodes=[],cells=new Map(),arcs=[],arcKeys=new Set(),point=p=>{const x=Math.floor(p[0]/epsilon),y=Math.floor(p[1]/epsilon);for(let j=y-1;j<=y+1;j++)for(let i=x-1;i<=x+1;i++)for(const id of cells.get(i+':'+j)||[])if(len(sub(p,nodes[id].p))<epsilon)return id;const key=x+':'+y,id=nodes.length;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);nodes.push({p,out:[]});return id;};let discarded=0;
  for(let i=0;i<n;i++){
   const ts=[...new Set(cuts[i])].sort((a,b)=>a-b);
   for(let k=1;k<ts.length;k++){
    const a=mix(...segments[i],ts[k-1]),b=mix(...segments[i],ts[k]),v=sub(b,a),length=len(v);if(length<epsilon)continue;const p=mix(a,b,.5),distance=variable?Infinity:distanceToSource(p);
    if(!variable&&distance<width-D*1e-7){discarded++;continue;}const normal=mul([-v[1],v[0]],D*1e-7/length),left=inside(add(p,normal)),right=inside(sub(p,normal));if(left===right){discarded++;continue;}const reverse=(left?1:-1)!==orientation,x=point(reverse?b:a),y=point(reverse?a:b),key=x+':'+y;if(arcKeys.has(key)){discarded++;continue;}arcKeys.add(key);nodes[x].out.push(arcs.length);arcs.push({a:x,b:y});
   }
  }
  // Tolerance at a nearly tangent intersection can retain a tiny dead-end arc.
  // A closed offset boundary cannot contain a dangling fragment; prune it before
  // following cycles instead of treating the branch as a reason to shrink.
  const incoming=nodes.map(()=>[]),outCount=nodes.map(n=>n.out.length),inCount=nodes.map(()=>0),alive=new Set(arcs.map((_,i)=>i));for(const [i,e]of arcs.entries()){incoming[e.b].push(i);inCount[e.b]++;}
  const queue=nodes.map((_,i)=>i).filter(i=>!inCount[i]||!outCount[i]);for(let k=0;k<queue.length;k++){const node=queue[k];if(inCount[node]&&outCount[node])continue;for(const i of [...incoming[node],...nodes[node].out])if(alive.delete(i)){const e=arcs[i];outCount[e.a]--;inCount[e.b]--;discarded++;if(!outCount[e.a]||!inCount[e.a])queue.push(e.a);if(!outCount[e.b]||!inCount[e.b])queue.push(e.b);}}
  const loops=[],used=new Set();
  for(let i=0;i<arcs.length;i++){
   if(!alive.has(i)||used.has(i))continue;const loop=[];let j=i;
   while(!used.has(j)){
    used.add(j);const e=arcs[j];loop.push(nodes[e.a].p);if(e.b===arcs[i].a)break;
    const choices=nodes[e.b].out.filter(k=>alive.has(k)&&!used.has(k));if(choices.length!==1)throw Error('全宽偏移的裁交连接不唯一，请降低宽度或检查原轮廓。');j=choices[0];
   }
   if(loop.length>=3&&Math.abs(E.area(loop))>D*D*1e-10)loops.push(loop);
  }
  return {loops,intersections,discarded};
 }
 function stitch(source,loop,side,D){
  const n=source.length,m=loop.length,size=(n+1)*(m+1);if(size>6000000)return null;let start=0;for(let j=1;j<m;j++)if(len(sub(source[0],loop[j]))<len(sub(source[0],loop[start])))start=j;const offset=[...loop.slice(start),...loop.slice(0,start)],cost=new Float64Array(size).fill(Infinity),back=new Uint8Array(size),epsilon=D*D*1e-12;cost[0]=0;
  for(let i=0;i<=n;i++)for(let j=0;j<=m;j++){
   const id=i*(m+1)+j;if(!Number.isFinite(cost[id]))continue;const a=source[i%n],b=offset[j%m];
   if(i<n&&cross(sub(source[(i+1)%n],a),sub(b,a))*side>epsilon){const k=(i+1)*(m+1)+j,d=len(sub(source[(i+1)%n],b)),value=cost[id]+d*d;if(value<cost[k]){cost[k]=value;back[k]=1;}}
   if(j<m&&cross(sub(offset[(j+1)%m],a),sub(b,a))*side>epsilon){const k=id+1,d=len(sub(a,offset[(j+1)%m])),value=cost[id]+d*d;if(value<cost[k]){cost[k]=value;back[k]=2;}}
  }
  if(!Number.isFinite(cost[size-1]))return null;const steps=[];let i=n,j=m;
  while(i||j){const code=back[i*(m+1)+j];steps.push({i,j,code});if(code===1)i--;else if(code===2)j--;else return null;}steps.reverse();return {offset,steps};
 }
 function build({rings,width,D,referenceViewBox,edges,level,excludedInternalEdges,audit,initialConflicts=null}){
  const mesh={schema:'contour-lab/boundary-surface',version:3,level:level.id,boundaryScope:'outer-and-holes',alignment:'outside',referenceViewBox,excludedInternalEdges,requestedWidth:width,effectiveWidth:width,minimumWidth:width,diagonal:D,vertices:[],uv:[],uvLocal01:[],triangles:[],edges:edges.map(e=>({id:e.id,kind:e.kind,role:e.role,faces:e.faces,length:e.total})),junctions:[],uvPaths:rings.map((r,id)=>({id,edges:r.path})),uvEdges:rings.flatMap(r=>r.path),uvJunctions:[],rings:[]};
  const widths=rings.flatMap(r=>r.stations.map(s=>2*s.half)),minimumWidth=Math.min(...widths),maximumWidth=Math.max(...widths),variable=maximumWidth-minimumWidth>1e-8;mesh.minimumWidth=minimumWidth;mesh.effectiveWidth=maximumWidth;
  let intersections=0,discarded=0,filledHoles=0,planarRegions=0;const epsilon=D*1e-9,pointMap=new Map();
  const vertex=p=>{const key=p.map(x=>Math.round(x/epsilon)).join(':');if(!pointMap.has(key)){pointMap.set(key,mesh.vertices.length);mesh.vertices.push(p.slice());}return pointMap.get(key);};
  const triangle=(v,uv,edge,local=uv)=>{if(E.area(v.map(i=>mesh.vertices[i]))<0){v=[v[0],v[2],v[1]];uv=[uv[0],uv[2],uv[1]];local=[local[0],local[2],local[1]];}const indices=uv.map((p,i)=>{mesh.uv.push(p);mesh.uvLocal01.push(local[i].map(x=>Math.max(0,Math.min(1,x))));return mesh.uv.length-1;});mesh.triangles.push({v,uv:indices,edge,region:'offset'});};
  for(const [ringIndex,r]of rings.entries()){
   const source=r.stations.map(s=>s.p),side=-r.filledSide,growing=side*Math.sign(E.area(source))<0,raw=r.stations.map(s=>add(s.p,mul(s.offset,2*s.half*side))),result=contours(source,raw,r.stations[0].half*2,D,growing,variable);intersections+=result.intersections;discarded+=result.discarded;
   const fixed=source.map(vertex),record={id:ringIndex,edges:r.path,fixedSide:side>0?0:1,filledSide:r.filledSide,stations:r.stations.map((s,i)=>({center:s.p,halfWidth:s.half,incoming:s.incoming,outgoing:s.outgoing,fixedVertex:fixed[i],movingVertex:null,sourceParameter:{edge:r.segments[i].edge,u:r.segments[i].reversed?1-r.segments[i].u0:r.segments[i].u0}})),offsetLoops:[],filled:false};mesh.rings.push(record);
   const edgePhases=new Map(r.path.map((p,i)=>[p.edge,i])),sourceU=r.segments.map(s=>edgePhases.get(s.edge)+s.u0),period=r.path.length,parameter=i=>i===source.length?period:sourceU[i],path=result.loops.length===1?stitch(source,result.loops[0],side,D):null;
   if(path){
    const moving=path.offset.map(vertex),m=moving.length,n=source.length,minimum=new Float64Array(m+1).fill(Infinity),maximum=new Float64Array(m+1).fill(-Infinity);minimum[0]=maximum[0]=0;
    for(const p of path.steps){const u=parameter(p.i);minimum[p.j]=Math.min(minimum[p.j],u);maximum[p.j]=Math.max(maximum[p.j],u);}const walk=[0];for(let j=1;j<=m;j++)walk.push(walk.at(-1)+len(sub(path.offset[j%m],path.offset[j-1])));
    const movingU=minimum.map((v,j)=>j===0?0:j===m?period:.95*(v+maximum[j])/2+.05*period*walk[j]/walk[m]),fixedV=side>0?0:1,movingV=1-fixedV;
    for(const p of path.steps){
     const i=p.code===1?p.i-1:p.i,j=p.code===2?p.j-1:p.j,segment=r.segments[i%n],phase=edgePhases.get(segment.edge),nodes=p.code===1?[[fixed[i%n],parameter(i),fixedV],[fixed[(i+1)%n],parameter(i+1),fixedV],[moving[j%m],movingU[j],movingV]]:[[fixed[i%n],parameter(i),fixedV],[moving[(j+1)%m],movingU[j+1],movingV],[moving[j%m],movingU[j],movingV]],uv=nodes.map(p=>[p[1]-phase,p[2]]);
     triangle(nodes.map(p=>p[0]),uv,segment.edge,uv.map(p=>segment.reversed?p.map(x=>1-x):p));
    }
    record.offsetLoops=[moving];continue;
   }
   // A vanishing inset has no second loop: the whole original hole is filled.
   // Such a disk cannot retain an annular UV winding; use one planar cap chart.
   if(growing&&result.loops.length===0)throw Error('全宽外扩没有形成有效边界。');
   if(variable&&!growing&&!result.loops.length&&source.every((p,i)=>cross(sub(source[(i+1)%source.length],p),sub(source[(i+2)%source.length],source[(i+1)%source.length]))*Math.sign(E.area(source))>=-D*D*1e-12)){
    const center=source.reduce(add,[0,0]).map(v=>v/source.length),hub=vertex(center),scale=Math.max(...r.stations.map(s=>2*s.half));
    for(let i=0;i<source.length;i++){const j=(i+1)%source.length;triangle([fixed[i],fixed[j],hub],[source[i],source[j],center].map(p=>sub(p,center).map(v=>v/scale)),r.segments[i].edge);}
    record.planarUV=true;record.filled=true;planarRegions++;filledHoles++;continue;
   }
   let polygons;if(growing){const outer=result.loops.filter(p=>Math.sign(E.area(p))===Math.sign(E.area(source))).sort((a,b)=>Math.abs(E.area(b))-Math.abs(E.area(a)));if(outer.length!==1)throw Error('外扩生成多个外圈，暂不能保持原轮廓。');polygons=[outer[0],source,...result.loops.filter(p=>p!==outer[0])];}
   else polygons=[source,...result.loops];
   polygons=polygons.map((p,i)=>Math.sign(E.area(p))===(i? -1:1)?p:p.slice().reverse());const data=E.triangulateRings(polygons);if(!data)throw Error('全宽偏移分区无法三角化。');
   const ids=data.points.map(vertex),center=source.reduce(add,[0,0]).map(v=>v/source.length);for(const t of data.triangles){const p=t.map(i=>data.points[i]),centroid=p.reduce(add,[0,0]).map(v=>v/3);let owner=0,best=Infinity;for(let i=0;i<source.length;i++){const d=E.pointSegment(centroid,source[i],source[(i+1)%source.length]);if(d<best){best=d;owner=i;}}triangle(t.map(i=>ids[i]),p.map(p=>sub(p,center).map(v=>v/width)),r.segments[owner].edge);}
   record.offsetLoops=result.loops.map(p=>p.map(vertex));record.planarUV=true;planarRegions++;if(!result.loops.length){record.filled=true;filledHoles++;}
  }
  mesh.audit=audit(mesh);const seams=UV.seams(mesh);let flipped=0,collapsed=0;for(const t of mesh.triangles){const a=E.area(t.uv.map(i=>mesh.uv[i]));if(a<0)flipped++;if(Math.abs(a)<1e-14)collapsed++;}
  mesh.audit.widthReduced=false;mesh.audit.widthAttempts=1;mesh.audit.edgeLocalUVRanges=mesh.edges.map(e=>({edge:e.id,minU:0,maxU:1,minV:0,maxV:1}));mesh.audit.uvPolicy='periodic stitched offset rings; vanished-hole caps use a planar chart';
  mesh.widthPolicy=(variable?'variable-width swept offset':'full-distance offset')+' / self-intersection trimming / no local narrowing';mesh.widthAudit={alignment:'outside',variableWidth:variable,requested:width,minimum:minimumWidth,maximum:maximumWidth,initialConflicts:initialConflicts??intersections,repairPasses:0,narrowedStations:0,stations:rings.reduce((n,r)=>n+r.stations.length,0),trimmedIntersections:intersections,discardedFragments:discarded,filledHoles,planarRegions};
  mesh.uvLayout='periodic offset-ring strips / planar caps';mesh.uvAudit={valid:!flipped&&!collapsed&&seams.maximumPeriodicJump<1e-7,...seams,flippedTriangles:flipped,flippedAreaFraction:flipped?1:0,collapsed,areaFloorResiduals:0,method:'monotone annulus triangulation / periodic source-edge phases / planar caps',unitPeriod:[1,1],uvReuseIntentional:true,planarRegions};
  if(!mesh.audit.valid||!mesh.uvAudit.valid)throw Error('全宽偏移网格或UV未通过检查。');return mesh;
 }
 return {build,contours};
}
if(typeof module!=='undefined')module.exports=makeBoundaryOffset;
if(typeof window!=='undefined')window.makeBoundaryOffset=makeBoundaryOffset;

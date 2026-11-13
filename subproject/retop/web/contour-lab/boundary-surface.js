/* Planar contour rings with equal normal width and periodic edge UV. */
function makeBoundarySurface(E,F){
  'use strict';
  const UV=typeof makeBoundaryUV!=='undefined'?makeBoundaryUV(E):require('./boundary-uv.js')(E);
  const Offset=(typeof makeBoundaryOffset!=='undefined'?makeBoundaryOffset:require('./boundary-offset.js'))(E,UV);
  const Physics=(typeof makeBoundaryPhysics!=='undefined'?makeBoundaryPhysics:require('./boundary-physics.js'))();
  const MAX_WIDTH=64;
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],mul=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a[0]*b[0]+a[1]*b[1],cross=(a,b)=>a[0]*b[1]-a[1]*b[0],length=a=>Math.hypot(...a),unit=a=>mul(a,1/Math.max(1e-30,length(a))),normal=a=>[-a[1],a[0]],clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const key=(a,b)=>a<b?a+':'+b:b+':'+a;
  function sample(edge,physical=false){
    const control=length(sub(edge.p1,edge.p0))+length(sub(edge.p2,edge.p1))+length(sub(edge.p3,edge.p2)),n=edge.kind==='I'&&!physical?1:Math.max(8,Math.min(512,Math.ceil(control/3))),points=Array.from({length:n+1},(_,i)=>E.bez(edge,i/n)),walk=[0];
    for(let i=1;i<points.length;i++)walk.push(walk.at(-1)+length(sub(points[i],points[i-1])));
    return {curve:edge,points,walk,total:walk.at(-1)};
  }
  function parameter(edge,s){s=clamp(s,0,edge.total);let i=1;while(i<edge.walk.length-1&&edge.walk[i]<s)i++;const d=edge.walk[i]-edge.walk[i-1];return (i-1+(d?(s-edge.walk[i-1])/d:0))/(edge.walk.length-1);}
  function at(edge,s){return E.bez(edge.curve,parameter(edge,s));}
  function tangent(edge,s){const t=parameter(edge,s),q=1-t,c=edge.curve,d=add(add(mul(sub(c.p1,c.p0),q*q),mul(sub(c.p2,c.p1),2*q*t)),mul(sub(c.p3,c.p2),t*t));return length(d)>1e-12?unit(d):unit(sub(at(edge,Math.min(edge.total,s+edge.total*.001)),at(edge,Math.max(0,s-edge.total*.001))));}
  function intersectionArea(a,b){
    let p=a.slice();const sign=Math.sign(E.area(b));
    for(let i=0;i<3&&p.length;i++){const x=b[i],d=sub(b[(i+1)%3],x),input=p;p=[];for(let j=0;j<input.length;j++){const u=input[j],v=input[(j+1)%input.length],f=sign*cross(d,sub(u,x)),g=sign*cross(d,sub(v,x)),inside=f>=0,next=g>=0;if(inside)p.push(u);if(inside!==next)p.push(add(u,mul(sub(v,u),f/(f-g))));}}
    return p.length>2?Math.abs(E.area(p)):0;
  }
  function audit(mesh,{details=false}={}){
    const owners=new Map(),neighbours=mesh.vertices.map(()=>new Set()),boxes=[],eps=mesh.diagonal**2*1e-12,conflicts=new Set();let collapsed=0,uvCollapsed=0,area=0;
    for(const [id,t]of mesh.triangles.entries()){
      const p=t.v.map(i=>mesh.vertices[i]),a=E.area(p);area+=a;if(a<=eps){collapsed++;if(details)t.v.forEach(v=>conflicts.add(v));}if(Math.abs(E.area(t.uv.map(i=>mesh.uv[i])))<1e-14)uvCollapsed++;
      t.v.forEach((v,i)=>{const b=t.v[(i+1)%3],k=key(v,b);if(!owners.has(k))owners.set(k,[]);owners.get(k).push([v,b]);neighbours[v].add(b);neighbours[b].add(v);});
      boxes.push({id,p,minX:Math.min(...p.map(q=>q[0])),maxX:Math.max(...p.map(q=>q[0])),minY:Math.min(...p.map(q=>q[1])),maxY:Math.max(...p.map(q=>q[1]))});
    }
    boxes.sort((a,b)=>a.minX-b.minX);let overlaps=0;
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length&&boxes[j].minX<boxes[i].maxX;j++){const a=boxes[i],b=boxes[j];if(a.maxY<=b.minY||b.maxY<=a.minY)continue;if(intersectionArea(a.p,b.p)>eps){overlaps++;if(details)for(const id of [a.id,b.id])mesh.triangles[id].v.forEach(v=>conflicts.add(v));}}
    let components=0;const seen=new Set();for(let i=0;i<neighbours.length;i++){if(!neighbours[i].size||seen.has(i))continue;components++;const queue=[i];seen.add(i);for(let j=0;j<queue.length;j++)for(const n of neighbours[queue[j]])if(!seen.has(n)){seen.add(n);queue.push(n);}}
    const nonManifold=[...owners.values()].filter(a=>a.length>2).length,inconsistent=[...owners.values()].filter(a=>a.length===2&&a[0][0]===a[1][0]).length;
    const boundaryDegree=new Map();for(const items of owners.values())if(items.length===1)for(const v of items[0])boundaryDegree.set(v,(boundaryDegree.get(v)||0)+1);const boundaryJunctions=[...boundaryDegree.values()].filter(n=>n!==2).length;
    const ranges=mesh.edges.map(e=>{const uv=mesh.triangles.filter(t=>t.edge===e.id).flatMap(t=>t.uv.map(i=>mesh.uv[i]));if(!uv.length)return {edge:e.id,minU:null,maxU:null,minV:null,maxV:null,noOwnedFaces:true};return {edge:e.id,minU:Math.min(...uv.map(p=>p[0])),maxU:Math.max(...uv.map(p=>p[0])),minV:Math.min(...uv.map(p=>p[1])),maxV:Math.max(...uv.map(p=>p[1]))};});
    return {valid:!collapsed&&!overlaps&&!nonManifold&&!inconsistent&&!uvCollapsed&&!boundaryJunctions,boundaryJunctions,collapsed,uvCollapsed,overlaps,nonManifold,inconsistent,components,vertices:seen.size,triangles:mesh.triangles.length,boundaryEdges:[...owners.values()].filter(a=>a.length===1).length,area,edgeUVRanges:ranges,uvPolicy:'independent 0–1 per original edge; seams at junctions; intentional chart reuse',uvOverlapIntentional:true,...(details?{conflictVertices:[...conflicts]}:{})};
  }
  function ringSurface(level,width,edges,nodes,D,excludedInternalEdges,continuousUV,alignment,physics){
    const rings=[],visited=new Set();
    for(const seed of edges){
      if(visited.has(seed.id))continue;
      const ring={stations:[],segments:[],path:[]};let edge=seed,end=0;
      while(!visited.has(edge.id)){
        visited.add(edge.id);ring.path.push({edge:edge.id,reversed:end===1});
        const points=end?edge.points.slice().reverse():edge.points,walk=end?edge.walk.slice().reverse().map(s=>edge.total-s):edge.walk;
        for(let i=0;i<points.length-1;i++){
          ring.stations.push({p:points[i].slice(),half:width/2});
          ring.segments.push({edge:edge.id,reversed:end===1,u0:walk[i]/edge.total,u1:walk[i+1]/edge.total});
        }
        const node=nodes[edge.nodes[1-end]],next=node.arms.find(a=>a.edge!==edge);edge=next.edge;end=next.end;
      }
      if(edge!==seed)throw Error('外圈或孔圈没有形成独立闭环。');
      ring.filledSide=(seed.role==='hole'?-1:1)*Math.sign(E.area(ring.stations.map(s=>s.p)));
      for(let i=0;i<ring.stations.length;i++){
        const row=ring.stations[i],before=ring.stations[(i+ring.stations.length-1)%ring.stations.length].p,after=ring.stations[(i+1)%ring.stations.length].p;
        row.incoming=unit(sub(row.p,before));row.outgoing=unit(sub(after,row.p));
        const n0=normal(row.incoming),n1=normal(row.outgoing),bisector=add(n0,n1),den=dot(bisector,n1);
        if(den<1e-10)throw Error('轮廓含折返尖点，无法生成有效等宽面带。');
        row.offset=mul(bisector,1/den);
      }
      // Collinear source endpoints are attributes, not geometric corners. Spread
      // the endpoint miters across the complete straight span so adding a short
      // source edge cannot fold the inner strip or change its normal width.
      const corners=ring.stations.map((s,i)=>Math.abs(cross(s.incoming,s.outgoing))>1e-8||dot(s.incoming,s.outgoing)<0?i:-1).filter(i=>i>=0),count=ring.stations.length;
      for(let k=0;k<corners.length;k++){
        const a=corners[k],b=corners[(k+1)%corners.length],span=[];let distance=0;
        for(let i=a;i!==b;){const j=(i+1)%count;distance+=length(sub(ring.stations[j].p,ring.stations[i].p));if(j!==b)span.push([j,distance]);i=j;}
        for(const [i,s]of span){const t=s/distance;ring.stations[i].offset=add(mul(ring.stations[a].offset,1-t),mul(ring.stations[b].offset,t));}
      }
      rings.push(ring);
    }
    const model=physics?Physics.apply(rings,width,physics):null,stations=rings.flatMap(r=>r.stations),finish=mesh=>model?Physics.finish(mesh,model,rings):mesh,envelope=stations.flatMap(s=>[sub(s.p,mul(s.offset,MAX_WIDTH)),add(s.p,mul(s.offset,MAX_WIDTH))]),xs=envelope.map(p=>p[0]),ys=envelope.map(p=>p[1]),x0=Math.min(...xs)-3,y0=Math.min(...ys)-3,referenceViewBox=[x0,y0,Math.max(...xs)+3-x0,Math.max(...ys)+3-y0];let initialConflicts=0,mesh;
    for(let pass=0;pass<32;pass++){
      mesh={schema:'contour-lab/boundary-surface',version:continuousUV?2:1,level:level.id,boundaryScope:'outer-and-holes',alignment,referenceViewBox,excludedInternalEdges,requestedWidth:width,diagonal:D,vertices:[],uv:[],uvLocal01:[],triangles:[],edges:edges.map(e=>({id:e.id,kind:e.kind,role:e.role,faces:e.faces,length:e.total,uvRange:[[0,0],[1,1]],localUVRange:[[0,0],[1,1]]})),junctions:[],uvPaths:rings.map((r,id)=>({id,edges:r.path})),uvEdges:rings.flatMap(r=>r.path),uvJunctions:[]};
      for(const ring of rings){
        const start=mesh.vertices.length;
        for(const row of ring.stations){
          if(alignment!=='center'){const side=alignment==='outside'?-ring.filledSide:ring.filledSide,offset=add(row.p,mul(row.offset,2*row.half*side));mesh.vertices.push(...(side>0?[row.p.slice(),offset]:[offset,row.p.slice()]));}
          else{const offset=mul(row.offset,row.half);mesh.vertices.push(sub(row.p,offset),add(row.p,offset));}
        }
        for(let i=0;i<ring.stations.length;i++){
          const j=(i+1)%ring.stations.length,s=ring.segments[i],a=start+2*i,b=a+1,c=start+2*j,d=c+1;
          const tri=(v,uv)=>{const local=uv.map(p=>s.reversed?p.map(x=>1-x):p.slice()),ids=uv.map((p,k)=>{mesh.uv.push(continuousUV?p:local[k]);mesh.uvLocal01.push(local[k]);return mesh.uv.length-1;});mesh.triangles.push({v,uv:ids,edge:s.edge,region:'strip'});};
          tri([a,c,d],[[s.u0,0],[s.u1,0],[s.u1,1]]);tri([a,d,b],[[s.u0,0],[s.u1,1],[s.u0,1]]);
        }
      }
      const a=audit(mesh,{details:true});if(!pass)initialConflicts=a.overlaps+a.collapsed;
      if(!pass&&!a.valid&&alignment==='outside')return finish(Offset.build({rings,width,D,referenceViewBox,edges,level,excludedInternalEdges,audit,initialConflicts}));
      if(a.valid){
        delete a.conflictVertices;mesh.audit=a;mesh.effectiveWidth=2*Math.max(...stations.map(r=>r.half));mesh.minimumWidth=2*Math.min(...stations.map(r=>r.half));
        a.widthReduced=model?stations.some(s=>s.half*2<s.physical.modelWidth-1e-7):mesh.minimumWidth<width*.999;a.widthAttempts=pass+1;a.edgeLocalUVRanges=a.edgeUVRanges.map(r=>({...r}));a.uvPolicy=continuousUV?'closed-ring periodic edge charts; normalized source coordinates in uvLocal01':a.uvPolicy;
        mesh.widthPolicy=alignment!=='center'?'fixed source boundary / one-sided '+alignment+' offset / collision repair on moving side only':'constant normal offsets around closed rings; collision-driven local reduction only';mesh.widthAudit={alignment,requested:width,minimum:mesh.minimumWidth,maximum:mesh.effectiveWidth,initialConflicts,repairPasses:pass,narrowedStations:stations.filter(r=>r.half*2<(model?r.physical.modelWidth:width)-1e-7).length,stations:stations.length};
        mesh.rings=rings.map((r,id)=>({id,edges:r.path,fixedSide:alignment!=='center'?((alignment==='outside'?-r.filledSide:r.filledSide)>0?0:1):null,filledSide:r.filledSide,stations:r.stations.map((s,i)=>({center:s.p,halfWidth:s.half,incoming:s.incoming,outgoing:s.outgoing,fixedVertex:alignment==='center'?null:2*(rings.slice(0,id).reduce((n,r)=>n+r.stations.length,0)+i)+((alignment==='outside'?-r.filledSide:r.filledSide)>0?0:1)}))}));
        mesh.uvLayout='closed-ring periodic per-edge charts';const seams=UV.seams(mesh);mesh.uvAudit={valid:!a.uvCollapsed&&seams.maximumPeriodicJump<1e-7,...seams,flippedAreaFraction:0,collapsed:a.uvCollapsed,areaFloorResiduals:0,method:'oriented closed-ring strips / shared cross-sections / integer edge phases',unitPeriod:[1,1],uvReuseIntentional:true};
        if(!continuousUV){delete mesh.uvAudit;delete mesh.uvLocal01;}return finish(mesh);
      }
      if(!a.conflictVertices.length)break;
      const affected=new Set(a.conflictVertices.map(v=>Math.floor(v/2)));let index=0;
      for(const ring of rings){
        for(let i=0;i<ring.stations.length;i++,index++)if(affected.has(index))ring.stations[i].half*=.75;
        // Limit changes along arc length, including across original edge endpoints.
        for(let sweep=0;sweep<2;sweep++)for(let k=0;k<2*ring.stations.length;k++){
          const i=sweep?k%ring.stations.length:(ring.stations.length-k%ring.stations.length)%ring.stations.length,j=(i+1)%ring.stations.length,a=ring.stations[i],b=ring.stations[j],limit=length(sub(a.p,b.p))*.35;
          a.half=Math.min(a.half,b.half+limit);b.half=Math.min(b.half,a.half+limit);
        }
      }
    }
    throw Error('轮廓空间不足，等宽偏移及局部收窄均未通过检查，请减小宽度。');
  }
  function build(level,width=4,{continuousUV=true,includeInternal=false,alignment='outside',physics=null}={}){
    width=Number(width);if(!Number.isFinite(width)||width<=0||width>MAX_WIDTH)throw Error('轮廓带宽度应大于0且不超过64。');
    if(!['outside','inside','center'].includes(alignment))throw Error('轮廓带位置无效。');
    const candidates=F.edges(level),source=candidates.filter(e=>includeInternal||e.role!=='internal'&&(!e.faces||e.faces.length<=1)),all=source.flatMap(e=>[e.p0,e.p3]);if(!all.length)throw Error('没有可生成的外圈或孔圈边界。');
    const bounds=[Math.min(...all.map(p=>p[0])),Math.min(...all.map(p=>p[1])),Math.max(...all.map(p=>p[0])),Math.max(...all.map(p=>p[1]))],D=Math.hypot(bounds[2]-bounds[0],bounds[3]-bounds[1])||1,epsilon=D*1e-8;
    const nodes=[],nodeMap=new Map(),nodeAt=p=>{const k=p.map(v=>Math.round(v/epsilon)).join(':');if(!nodeMap.has(k)){nodeMap.set(k,nodes.length);nodes.push({p:p.slice(),arms:[]});}return nodeMap.get(k);};
    const edges=source.map((e,id)=>{const data=sample(e,!!physics);if(data.total<D*1e-10)throw Error('边界含零长边。');const item={...data,id:e.id??id,kind:e.kind,role:e.role,faces:e.faces?.slice()||[],nodes:[nodeAt(e.p0),nodeAt(e.p3)]};item.nodes.forEach((n,end)=>nodes[n].arms.push({edge:item,end}));return item;});
    if(!includeInternal&&nodes.every(n=>n.arms.length===2))return ringSurface(level,width,edges,nodes,D,candidates.length-source.length,continuousUV,alignment,physics);
    if(physics)throw Error('物理宽度需要闭合的外圈或孔圈。');
    const segmentBins=new Map(),binSize=D/32;
    for(const e of edges)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],item={edge:e.id,a,b};for(let y=Math.floor((Math.min(a[1],b[1])-width)/binSize);y<=Math.floor((Math.max(a[1],b[1])+width)/binSize);y++)for(let x=Math.floor((Math.min(a[0],b[0])-width)/binSize);x<=Math.floor((Math.max(a[0],b[0])+width)/binSize);x++){const k=x+':'+y;if(!segmentBins.has(k))segmentBins.set(k,[]);segmentBins.get(k).push(item);}}
    function clearance(p,excluded){let distance=Infinity;for(const s of segmentBins.get(Math.floor(p[0]/binSize)+':'+Math.floor(p[1]/binSize))||[]){if(excluded.has(s.edge))continue;const d=sub(s.b,s.a),t=clamp(dot(sub(p,s.a),d)/Math.max(1e-30,dot(d,d)),0,1);distance=Math.min(distance,length(sub(p,add(s.a,mul(d,t)))));}return distance;}
    function attempt(scale){
      const mesh={schema:'contour-lab/boundary-surface',version:1,level:level.id,boundaryScope:includeInternal?'all-partition-edges':'outer-and-holes',excludedInternalEdges:candidates.length-source.length,requestedWidth:width,effectiveWidth:width*scale,diagonal:D,vertices:[],uv:[],triangles:[],edges:edges.map(e=>({id:e.id,kind:e.kind,role:e.role,faces:e.faces,length:e.total,uvRange:[[0,0],[1,1]]})),junctions:[]},pointMap=new Map();
      const vertex=p=>{const k=p.map(v=>Math.round(v/(D*1e-10))).join(':');if(!pointMap.has(k)){pointMap.set(k,mesh.vertices.length);mesh.vertices.push(p.slice());}return pointMap.get(k);};
      const triangle=(v,uv,edge,region)=>{if(E.area(v.map(i=>mesh.vertices[i]))<0){v=[v[0],v[2],v[1]];uv=[uv[0],uv[2],uv[1]];}if(Math.abs(E.area(v.map(i=>mesh.vertices[i])))<D*D*1e-15)return;const ids=uv.map(p=>{mesh.uv.push(p.map(x=>clamp(x,0,1)));return mesh.uv.length-1;});mesh.triangles.push({v,uv:ids,edge,region});};
      const h=width*scale/2,ends=new Map(),nominalWidths=[];
      for(const [nodeId,node]of nodes.entries()){
        const arms=node.arms.map(a=>{const e=a.edge,d=unit(sub(at(e,a.end?e.total-Math.min(e.total*.01,D*.001):Math.min(e.total*.01,D*.001)),node.p));return {...a,d,angle:Math.atan2(d[1],d[0])};}).sort((a,b)=>a.angle-b.angle);
        if(arms.length===1){const a=arms[0],half=Math.min(h,.4*clearance(node.p,new Set([a.edge.id]))),n=normal(a.d),row=[vertex(sub(node.p,mul(n,half))),vertex(add(node.p,mul(n,half)))];nominalWidths.push(half);ends.set(a.edge.id+':'+a.end,{s:0,h:half,row,d:a.d});continue;}
        let minAngle=Math.PI;for(let i=0;i<arms.length;i++)minAngle=Math.min(minAngle,(arms[(i+1)%arms.length].angle-arms[i].angle+2*Math.PI)%(2*Math.PI));
        if(minAngle<1e-6)throw Error('交汇处存在重合方向，无法生成无重叠的轮廓带。');
        const reach=Math.min(...arms.map(a=>a.edge.total))*.22,half=Math.min(h,reach*Math.tan(minAngle/2)/1.4,reach/1.4,.35*clearance(node.p,new Set(arms.map(a=>a.edge.id)))),trim=Math.min(reach,Math.max(half*1.4,half/Math.tan(minAngle/2)*1.4));
        nominalWidths.push(half);
        for(const a of arms){const s=a.end?a.edge.total-trim:trim,p=at(a.edge,s),d=unit(sub(p,node.p)),n=normal(mul(tangent(a.edge,s),a.end?-1:1));a.row=[vertex(sub(p,mul(n,half))),vertex(add(p,mul(n,half)))];a.s=trim;a.h=half;a.d=d;ends.set(a.edge.id+':'+a.end,a);}
        // Each arm owns one sector. Gap midpoints are shared by both sectors;
        // the resulting triangles form one welded patch instead of stacked strips.
        const center=vertex(node.p),midpoints=arms.map((a,i)=>{const next=arms[(i+1)%arms.length],gap=(next.angle-a.angle+2*Math.PI)%(2*Math.PI),mid=mul(add(mesh.vertices[a.row[1]],mesh.vertices[next.row[0]]),.5);return vertex(gap>Math.PI+1e-8?add(node.p,mul([Math.cos(a.angle+gap/2),Math.sin(a.angle+gap/2)],Math.max(half,length(sub(mid,node.p))))):mid);});
        for(let i=0;i<arms.length;i++){
          const a=arms[i],before=midpoints[(i+arms.length-1)%arms.length],after=midpoints[i],end=a.end?1:0,u=a.end?1-trim/a.edge.total:trim/a.edge.total,sequence=[before,...a.row,after],vs=a.end?[1,1,0,0]:[0,0,1,1];
          for(let j=0;j<3;j++){const us=j===0?[end,u]:j===1?[u,u]:[u,end];triangle([center,sequence[j],sequence[j+1]],[[end,.5],[us[0],vs[j]],[us[1],vs[j+1]]],a.edge.id,'junction');}
        }
        mesh.junctions.push({node:nodeId,degree:arms.length,position:node.p.slice(),width:2*half,trim});
      }
      for(const e of edges){
        const start=ends.get(e.id+':0'),end=ends.get(e.id+':1'),lo=start.s,hi=e.total-end.s,interior=[...e.walk.slice(1,-1),lo+Math.min(h*2,(hi-lo)/3),hi-Math.min(h*2,(hi-lo)/3)],walk=[lo,...interior.filter(v=>v>lo+epsilon&&v<hi-epsilon).sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>epsilon),hi],rows=[start.row.slice()];
        for(let i=1;i<walk.length-1;i++){
          const s=walk[i],p=at(e,s),n=normal(tangent(e,s)),half=Math.min(h,.42*clearance(p,new Set([e.id])),start.h+(h-start.h)*Math.min(1,(s-lo)/Math.max(h*2,epsilon)),end.h+(h-end.h)*Math.min(1,(hi-s)/Math.max(h*2,epsilon))),offset=mul(n,half);
          nominalWidths.push(half);rows.push([vertex(sub(p,offset)),vertex(add(p,offset))]);
        }
        rows.push(end.row.slice().reverse());
        for(let i=0;i<rows.length-1;i++){const u0=walk[i]/e.total,u1=walk[i+1]/e.total,[a,b]=rows[i],[c,d]=rows[i+1];triangle([a,c,d],[[u0,0],[u1,0],[u1,1]],e.id,'strip');triangle([a,d,b],[[u0,0],[u1,1],[u0,1]],e.id,'strip');}
      }
      mesh.effectiveWidth=2*nominalWidths.reduce((a,b)=>Math.max(a,b),0);mesh.minimumWidth=2*nominalWidths.reduce((a,b)=>Math.min(a,b),Infinity);mesh.audit=audit(mesh);return mesh;
    }
    let mesh;for(let pass=0;pass<8;pass++){mesh=attempt(2**-pass);if(mesh.audit.valid){mesh.audit.widthReduced=pass>0||mesh.minimumWidth<mesh.requestedWidth*.999;mesh.audit.widthAttempts=pass+1;if(continuousUV){const original=structuredClone(mesh);UV.fit(mesh,level,F);if(!mesh.uvAudit.valid){UV.fit(original,level,F,1,.5);if(original.uvAudit.valid||original.uvAudit.flippedAreaFraction<mesh.uvAudit.flippedAreaFraction){original.uvAudit.recovery={spanFactor:1,transverseScale:.5,previousFlippedArea:mesh.uvAudit.flippedAreaFraction};mesh=original;}}if(!mesh.uvAudit.valid)mesh.uvAudit.warning='连接UV连续，但局部方向或退化仍需检查。';}return mesh;}}
    throw Error('当前边界间距或交汇方向无法生成有效轮廓带，请减小宽度。');
  }
  function obj(mesh){const lines=['# Contour Lab: welded boundary ribbons; normalized local edge UV / continuous periodic junction UV','o boundary_surface'];for(const p of mesh.vertices)lines.push('v '+p[0]+' '+(-p[1])+' 0');for(const p of mesh.uv)lines.push('vt '+p.join(' '));let last;for(const t of mesh.triangles){if(t.edge!==last){last=t.edge;lines.push('g edge_'+String(last+1).padStart(3,'0'));}lines.push('f '+[2,1,0].map(i=>(t.v[i]+1)+'/'+(t.uv[i]+1)).join(' '));}return lines.join('\n')+'\n';}
  function svg(mesh,{uv=false,wire=true,target=false}={}){
    const points=uv?mesh.uv:mesh.vertices,x=points.map(p=>p[0]),y=points.map(p=>p[1]),pad=uv?.04:mesh.requestedWidth+3,box=!uv&&mesh.referenceViewBox?mesh.referenceViewBox:[Math.min(...x)-pad,Math.min(...y)-pad,Math.max(...x)-Math.min(...x)+2*pad,Math.max(...y)-Math.min(...y)+2*pad],fmt=x=>Number(x.toFixed(6)),pieces=[];
    for(const [i,t]of mesh.triangles.entries()){
      const p=t.v.map(id=>mesh.vertices[id]),q=t.uv.map(id=>mesh.uv[id]),target=uv?q:p,d='M '+target.map(a=>a.map(fmt).join(' ')).join(' L ')+' Z',a=sub(q[1],q[0]),b=sub(q[2],q[0]),den=cross(a,b),r=sub(p[1],p[0]),s=sub(p[2],p[0]),matrix=[(r[0]*b[1]-s[0]*a[1])/den,(r[1]*b[1]-s[1]*a[1])/den,(s[0]*a[0]-r[0]*b[0])/den,(s[1]*a[0]-r[1]*b[0])/den];matrix.push(p[0][0]-matrix[0]*q[0][0]-matrix[2]*q[0][1],p[0][1]-matrix[1]*q[0][0]-matrix[3]*q[0][1]);
      pieces.push('<path d="'+d+'" fill="url(#boundary-check-'+(uv?'uv':i)+')"'+(wire?' stroke="#315f5680" stroke-width="'+(uv?.001:.25)+'" stroke-linejoin="round"':'')+' data-boundary-edge="'+t.edge+'"/>');
      if(!uv)pieces.push('<pattern id="boundary-check-'+i+'" href="#boundary-check-uv" patternTransform="matrix('+matrix.map(fmt).join(' ')+')"/>');
    }
    if(target&&!uv&&mesh.physicalWidth)for(const ring of mesh.physicalWidth.rings)for(const p of ring.targetOutlines)pieces.push('<path data-target-width="'+ring.id+'" d="M '+p.map(p=>p.map(fmt).join(' ')).join(' L ')+' Z" fill="none" stroke="#d18638" stroke-width="1.2" stroke-dasharray="4 2.5" pointer-events="none"/>');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+box.map(fmt).join(' ')+'" data-boundary-surface="'+(uv?'uv':'mesh')+'"><defs><pattern id="boundary-check-uv" width=".25" height=".25" patternUnits="userSpaceOnUse"><rect width=".25" height=".25" fill="#e5eee5"/><path d="M 0 0 H .125 V .125 H 0 Z M .125 .125 H .25 V .25 H .125 Z" fill="#6c9e91"/></pattern></defs>'+pieces.join('')+'</svg>';
  }
  return {build,audit,obj,svg};
}
if(typeof module!=='undefined')module.exports=makeBoundarySurface;
if(typeof window!=='undefined')window.makeBoundarySurface=makeBoundarySurface;

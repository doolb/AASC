const assert=require('node:assert/strict'),fs=require('node:fs');
const E=require('../engine.js'),F=require('../flow.js')(E),B=require('../boundary-surface.js')(E,F),U=require('../flow-uv.js')(E),report=[];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0],sub=(a,b)=>a.map((v,k)=>v-b[k]);
function inside(p,loop){let hit=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++)if((loop[i][1]>p[1])!==(loop[j][1]>p[1])&&p[0]<(loop[j][0]-loop[i][0])*(p[1]-loop[i][1])/(loop[j][1]-loop[i][1])+loop[i][0])hit=!hit;return hit;}
function check(name,level,base,physics){
 const saved=JSON.stringify(level),m=B.build(level,base,{physics});assert.equal(JSON.stringify(level),saved);assert(m.audit.valid&&m.uvAudit.valid);assert.equal(m.widthAudit.narrowedStations,0);assert.equal(m.physicalWidth.geometryLimitedStations,0);assert(!m.audit.widthReduced);
 const independent=U.auditTriangles(m.triangles.map(t=>t.v.map(i=>m.vertices[i])),m.diagonal**2*1e-12);assert.equal(independent.overlaps,0);assert.equal(independent.collapsed,0);
 const owners=new Map();for(const t of m.triangles)for(let i=0;i<3;i++){const key=[t.v[i],t.v[(i+1)%3]].sort((a,b)=>a-b).join(':');owners.set(key,(owners.get(key)||0)+1);}
 const triangles=m.triangles.map(t=>t.v.map(i=>m.vertices[i])),contains=p=>triangles.some(t=>t.every((a,i)=>cross(sub(t[(i+1)%3],a),sub(p,a))>=-(m.diagonal**2)*1e-12));let probes=0,sourcePoints=0;
 for(const r of m.rings){const ring=m.physicalWidth.rings[r.id],byStation=new Map(ring.points.map(p=>[p.station,p])),loop=r.stations.map(s=>s.center),side=-r.filledSide,growing=side*Math.sign(E.area(loop))<0;
  for(const p of ring.points){assert.equal(p.actualWidth,p.modelWidth);assert.equal(p.actualWidth,r.stations[p.station].halfWidth*2);}const rawValues=ring.points.map(p=>p.rawActualWidth);assert(Math.min(...ring.points.map(p=>p.modelWidth))>=Math.min(...rawValues)-1e-9,'closure cannot create an extra narrow waist');
  for(let i=0;i<r.stations.length;i++){const s=r.stations[i],j=(i+1)%r.stations.length,next=r.stations[j];assert.deepEqual(m.vertices[s.fixedVertex],s.center);assert.equal(owners.get([s.fixedVertex,next.fixedVertex].sort((a,b)=>a-b).join(':')),1);sourcePoints++;
   // On curved spans, reconstruct the mathematical miter independently and
   // check interior witnesses of the requested swept surface against real faces.
   if(Math.abs(cross(s.incoming,s.outgoing))<1e-8||Math.abs(cross(next.incoming,next.outgoing))<1e-8)continue;
   const offset=(row,index)=>{const n=[-row.incoming[1]-row.outgoing[1],row.incoming[0]+row.outgoing[0]],den=n[0]*(-row.outgoing[1])+n[1]*row.outgoing[0],w=byStation.get(index).modelWidth*side;return row.center.map((v,k)=>v+n[k]*w/den);},a=offset(s,i),b=offset(next,j);
   for(const t of [[s.center,next.center,b],[s.center,b,a]])for(const weights of [[1/3,1/3,1/3],[.1,.1,.8],[.1,.8,.1]]){const p=[0,1].map(k=>t.reduce((sum,q,index)=>sum+q[k]*weights[index],0));if(growing?inside(p,loop):!inside(p,loop))continue;assert(contains(p),'requested swept area was lost at '+name+' '+JSON.stringify(p));probes++;}
  }
 }
 assert(m.uv.flat().every(Number.isFinite));assert(m.uvAudit.maximumPeriodicJump<1e-9);assert.equal((B.obj(m).match(/^f /gm)||[]).length,m.triangles.length);
 const facts={name,initialConflicts:m.widthAudit.initialConflicts,narrowedStations:0,geometryLimited:0,minimum:m.minimumWidth,maximum:m.effectiveWidth,independentOverlapCheck:true,requestedAreaWitnesses:probes,sourceBoundaryPoints:sourcePoints,planarRegions:m.uvAudit.planarRegions??0,filledHoles:m.widthAudit.filledHoles??0};report.push(facts);console.log('PASS variable width',JSON.stringify(facts));return m;
}
const ref=JSON.parse(fs.readFileSync('artifacts/contour-lab/current-reference8-vectors.json')),level=ref.levels[4];
check('example8 former 22 narrowed stations',level,12,{initialActual:4,minTarget:6,maxTarget:18,angleAcceleration:-1,distanceAcceleration:.5,interpolationFactor:.2});
check('example8 former 74 narrowed stations',level,12,{initialActual:30,minTarget:12,maxTarget:64,angleAcceleration:3,distanceAcceleration:1,interpolationFactor:.2});
check('frozen width differs from initial target',level,12,{initialActual:64,minTarget:6,maxTarget:18,angleAcceleration:-1,distanceAcceleration:.5,interpolationFactor:0});
check('example8 direct target',level,32,{initialActual:30,minTarget:20,maxTarget:64,angleAcceleration:1,distanceAcceleration:.5,interpolationFactor:1,reverse:true});
const transform=p=>[40+.8*(p[0]*Math.cos(.61)-p[1]*Math.sin(.61)),70+.8*(p[0]*Math.sin(.61)+p[1]*Math.cos(.61))];
check('rotated translated scaled example8', {...level,partitionEdges:level.partitionEdges.map(e=>({...e,...Object.fromEntries(['p0','p1','p2','p3'].map(k=>[k,transform(e[k])]))}))},24,{initialActual:24,minTarget:8,maxTarget:48,angleAcceleration:-.6,distanceAcceleration:.3,interpolationFactor:.15});
const line=(p,q,id,role='outer')=>({id,kind:'I',role,faces:[0],p0:p,p1:p.map((v,k)=>v+(q[k]-v)/3),p2:p.map((v,k)=>v+2*(q[k]-v)/3),p3:q}),points=[[0,0],[200,0],[200,200],[130,200],[130,60],[70,60],[70,200],[0,200]];
check('deep concave notch', {id:'notch',partitionEdges:points.map((p,i)=>line(p,points[(i+1)%points.length],i))},40,{initialActual:40,minTarget:20,maxTarget:60,angleAcceleration:.5,distanceAcceleration:.3,interpolationFactor:.2});
const circle=Array.from({length:24},(_,i)=>[30*Math.cos(i*Math.PI/12),30*Math.sin(i*Math.PI/12)]);for(const p of [circle,circle.slice().reverse()])check('varying saturated hole '+Math.sign(E.area(p)),{id:'circle-hole',partitionEdges:p.map((v,i)=>line(v,p[(i+1)%p.length],i,'hole'))},40,{initialActual:40,minTarget:35,maxTarget:60,angleAcceleration:.1,distanceAcceleration:.1,interpolationFactor:.2});
fs.writeFileSync('artifacts/contour-lab/boundary-variable-width-report.json',JSON.stringify({report,notes:'Requested variable swept areas are merged and trimmed without collision-driven width reduction. Width profiles are source control widths; after trimming/capping a source point need not own a unique exposed offset point.'},null,2)+'\n');

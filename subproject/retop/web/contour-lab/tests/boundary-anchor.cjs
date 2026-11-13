const assert=require('node:assert/strict'),fs=require('node:fs');
const E=require('../engine.js'),F=require('../flow.js')(E),B=require('../boundary-surface.js')(E,F),U=require('../flow-uv.js')(E),report=[];
const line=(p,q,id,role='outer')=>({id,kind:'I',role,faces:[0],p0:p,p1:p.map((v,k)=>v+(q[k]-v)/3),p2:p.map((v,k)=>v+2*(q[k]-v)/3),p3:q});
const polygon=(p,id,role='outer',base=0)=>p.map((v,i)=>line(v,p[(i+1)%p.length],base+i,role));
function check(name,l,width,alignment='outside'){
 const original=JSON.stringify(l),small=B.build(l,4,{alignment}),m=B.build(l,width,{alignment});assert.equal(JSON.stringify(l),original);assert(m.audit.valid);assert(m.uvAudit.valid);assert.equal(m.alignment,alignment);assert(m.uvAudit.maximumPeriodicJump<1e-10);assert.deepEqual(m.referenceViewBox,small.referenceViewBox);assert.equal(B.svg(m).match(/viewBox="([^"]+)"/)[1],B.svg(small).match(/viewBox="([^"]+)"/)[1]);const [x,y,w,h]=m.referenceViewBox;assert(m.vertices.every(p=>p[0]>=x&&p[0]<=x+w&&p[1]>=y&&p[1]<=y+h),'stable viewport must include the whole ribbon');
 const coverage=U.auditTriangles(m.triangles.map(t=>t.v.map(i=>m.vertices[i])),m.diagonal**2*1e-12);assert.equal(coverage.overlaps,0);assert.equal(coverage.collapsed,0);
 const owners=new Map();for(const t of m.triangles)for(let i=0;i<3;i++){const k=[t.v[i],t.v[(i+1)%3]].sort((a,b)=>a-b).join(':');owners.set(k,(owners.get(k)||0)+1);}
 let index=0,maxDrift=0;for(const [r,ring]of m.rings.entries()){
  assert.deepEqual(ring.stations.map(s=>s.center),small.rings[r].stations.map(s=>s.center));const base=index;
  for(let i=0;i<ring.stations.length;i++,index++){
   const s=ring.stations[i],fixed=s.fixedVertex??(2*index+ring.fixedSide),moving=2*index+1-ring.fixedSide,p=m.vertices[fixed];assert.deepEqual(p,s.center);assert.deepEqual(p,small.rings[r].stations[i].center);maxDrift=Math.max(maxDrift,Math.hypot(...p.map((v,k)=>v-s.center[k])));
   const next=ring.stations[(i+1)%ring.stations.length].fixedVertex??(2*(base+(i+1)%ring.stations.length)+ring.fixedSide),k=[fixed,next].sort((a,b)=>a-b).join(':');assert.equal(owners.get(k),1,'the preserved original line must be an actual mesh boundary');
   if(m.version===3)continue;const side=alignment==='outside'?-ring.filledSide:ring.filledSide;for(const d of [s.incoming,s.outgoing]){const q=m.vertices[moving],distance=(q[0]-p[0])*(-d[1])+(q[1]-p[1])*d[0];assert(Math.abs(distance-side*2*s.halfWidth)<1e-7);}
  }
 }
 const obj=B.obj(m),v=obj.split('\n').filter(s=>s.startsWith('v ')).map(s=>s.split(' ').slice(1).map(Number));assert.deepEqual(v,m.vertices.map(p=>[p[0],(-p[1])||0,0]));
 report.push({name,width,alignment,fixedBoundaryDrift:maxDrift,fixedEdgesAreMeshBoundary:true,sourceUnchanged:true,stableSVGViewport:true,independentOverlapCheck:true,uvValid:true,...m.widthAudit});console.log('PASS anchored boundary',name,alignment,width,'drift',maxDrift);return m;
}
const rect=[[0,0],[200,0],[200,160],[0,160]];check('outer rectangle',{id:'rect',partitionEdges:polygon(rect)},36.6);
check('reverse input',{id:'reverse',partitionEdges:polygon(rect.slice().reverse())},36.6);
const holed={id:'hole',partitionEdges:[...polygon(rect),...polygon([[70,50],[70,110],[130,110],[130,50]],'h','hole',4)]};check('outer and hole expand away from fill',holed,36.6);check('optional inward offset',holed,16,'inside');
const map=([x,y])=>[40+.7*(x*Math.cos(.64)-y*Math.sin(.64)),80+.7*(x*Math.sin(.64)+y*Math.cos(.64))];check('rotation and scale',{id:'transform',partitionEdges:polygon(rect.map(map))},25.62);
const ref=JSON.parse(fs.readFileSync('artifacts/contour-lab/current-reference8-vectors.json'));for(const l of ref.levels)check('reference8 '+l.id,l,36.6);
const m=check('reference8 ultra maximum width',ref.levels[4],64);fs.writeFileSync('artifacts/contour-lab/boundary-anchor-report.json',JSON.stringify({report,note:'Fixed vertices and boundary edges are checked against the original samples at 4px and larger widths, not just a display overlay.'},null,2)+'\n');

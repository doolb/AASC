const assert=require('node:assert/strict'),fs=require('node:fs');
const E=require('../engine.js'),F=require('../flow.js')(E),B=require('../boundary-surface.js')(E,F),U=require('../flow-uv.js')(E),report=[];
const line=(p,q,id)=>({id,kind:'I',role:'outer',faces:[0],p0:p,p1:p.map((v,k)=>v+(q[k]-v)/3),p2:p.map((v,k)=>v+2*(q[k]-v)/3),p3:q});
const polygon=(points,id)=>({id,partitionEdges:points.map((p,i)=>line(p,points[(i+1)%points.length],i))});
function check(name,level,width,uniform=true){
 const saved=JSON.stringify(level),m=B.build(level,width,{alignment:'center'});assert.equal(JSON.stringify(level),saved);assert(m.audit.valid);assert(m.uvAudit.valid);assert(m.rings?.length);
 assert(m.uvAudit.maximumPeriodicJump<1e-10);const independent=U.auditTriangles(m.triangles.map(t=>t.v.map(i=>m.vertices[i])),m.diagonal**2*1e-12);assert.equal(independent.overlaps,0);assert.equal(independent.collapsed,0);
 let rowIndex=0;for(const ring of m.rings)for(const row of ring.stations){const left=m.vertices[2*rowIndex],right=m.vertices[2*rowIndex+1];rowIndex++;
  for(const tangent of [row.incoming,row.outgoing]){const n=[-tangent[1],tangent[0]],distance=p=>(p[0]-row.center[0])*n[0]+(p[1]-row.center[1])*n[1];assert(Math.abs(distance(right)-row.halfWidth)<1e-7);assert(Math.abs(distance(left)+row.halfWidth)<1e-7);}
 }
 if(uniform){assert.equal(m.minimumWidth,width);assert.equal(m.effectiveWidth,width);assert.equal(m.widthAudit.initialConflicts,0);assert.equal(m.widthAudit.narrowedStations,0);}else{assert(m.widthAudit.initialConflicts>0);assert(m.minimumWidth<width);assert(m.widthAudit.narrowedStations<m.widthAudit.stations,'distant regions must retain requested width');assert.equal(m.effectiveWidth,width);}
 report.push({name,sourceUnchanged:true,independentOverlapCheck:true,normalOffsetsChecked:true,...m.widthAudit,periodicJump:m.uvAudit.maximumPeriodicJump});console.log('PASS normal width',name,m.minimumWidth,m.effectiveWidth);return m;
}
const rectangle=[[0,0],[200,0],[200,140],[0,140]],a=check('rectangle',polygon(rectangle,'rectangle'),30);
const split=check('1px collinear source edges next to corners',polygon([[0,0],[1,0],[200,0],[200,139],[200,140],[0,140],[0,1]],'split'),30);assert(Math.abs(a.audit.area-split.audit.area)<1e-7);
const transform=([x,y])=>[40+.7*(x*Math.cos(.63)-y*Math.sin(.63)),80+.7*(x*Math.sin(.63)+y*Math.cos(.63))];check('rotated and scaled short edges',polygon([[0,0],[1,0],[200,0],[200,139],[200,140],[0,140],[0,1]].map(transform),'transformed'),21);
check('clockwise input',polygon(rectangle.slice().reverse(),'reversed'),30);
check('curved ring',polygon(Array.from({length:64},(_,i)=>[100*Math.cos(i*Math.PI/32),100*Math.sin(i*Math.PI/32)]),'circle'),30);
check('real narrow notch retains distant width',polygon([[0,0],[200,0],[200,200],[110,200],[110,50],[90,50],[90,200],[0,200]],'notch'),30,false);
const ref=JSON.parse(fs.readFileSync('artifacts/contour-lab/current-reference8-vectors.json'));
for(const l of ref.levels)check('reference8 '+l.id+' width4',l,4);
check('reference8 middle width30',ref.levels[2],30);
check('reference8 ultra width24',ref.levels[4],24,false);
fs.writeFileSync('artifacts/contour-lab/boundary-width-report.json',JSON.stringify({report,limits:'Offsets use the sampled polyline. Genuine collision/folding repairs may locally reduce width; texture continuity is periodic, not a packed atlas.'},null,2)+'\n');

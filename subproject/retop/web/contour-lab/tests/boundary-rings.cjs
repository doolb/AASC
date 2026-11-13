const assert=require('node:assert/strict'),fs=require('node:fs');
const E=require('../engine.js'),F=require('../flow.js')(E),B=require('../boundary-surface.js')(E,F),report=[];
function check(name,level){
 const before=JSON.stringify(level),all=F.edges(level),expected=all.filter(e=>e.role!=='internal'&&e.faces.length===1),m=B.build(level,30);
 assert.equal(JSON.stringify(level),before);assert.deepEqual(m.edges.map(e=>e.id),expected.map(e=>e.id));assert.equal(m.boundaryScope,'outer-and-holes');assert.equal(m.excludedInternalEdges,all.length-expected.length);
 const ids=new Set(expected.map(e=>e.id));assert(m.triangles.every(t=>ids.has(t.edge)));assert(m.audit.valid);assert(m.uvAudit.valid);assert.equal(m.audit.components,1+(level.holeCount||0));
 const graph=new Map(),point=p=>p.map(v=>Math.round(v*1e7)).join(':');for(const e of expected)for(const p of [e.p0,e.p3]){const k=point(p);graph.set(k,(graph.get(k)||0)+1);}assert([...graph.values()].every(v=>v===2),'source contour rings must close without branches');
 const segments=new Set();for(const t of m.triangles)for(let i=0;i<3;i++)segments.add([t.v[i],t.v[(i+1)%3]].sort((a,b)=>a-b).join(':'));assert.equal(m.vertices.length-segments.size+m.triangles.length,0,'each ribbon ring must retain annulus topology');
 const groups=[...B.obj(m).matchAll(/^g edge_(\d+)/gm)].map(x=>Number(x[1])-1);assert.deepEqual([...new Set(groups)].sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));
 report.push({name,edges:expected.length,excludedInternalEdges:m.excludedInternalEdges,rings:m.audit.components,annulusEuler:0,sourceUnchanged:true,uvValid:true,periodicJump:m.uvAudit.maximumPeriodicJump});console.log('PASS outline rings',name,expected.length,'edges',m.audit.components,'rings');
}
for(const l of JSON.parse(fs.readFileSync('artifacts/contour-lab/current-reference8-vectors.json')).levels)check('reference8 '+l.id,l);
check('300 partitions',JSON.parse(fs.readFileSync('artifacts/contour-lab/square-middle300.json')).levels[4]);
fs.writeFileSync('artifacts/contour-lab/boundary-rings-report.json',JSON.stringify({report},null,2)+'\n');

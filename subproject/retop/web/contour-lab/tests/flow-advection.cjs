const fs=require('node:fs'),assert=require('node:assert/strict');
const E=require('../engine.js'),F=require('../flow.js')(E),S=require('../flow-surface.js')(E,F),A=require('../flow-advection.js')(E,F);
const model=JSON.parse(fs.readFileSync('artifacts/contour-lab/inlet-uv-8.json')),m=model.surface,a=model.analysis,saved=JSON.stringify(m),layout=S.layout(m),flow=A.create(m,a,layout,{resolution:56}),domain=a.river.domain;
const clearance=p=>Math.min(...domain.flatMap(r=>r.map((v,i)=>E.pointSegment(p,v,r[(i+1)%r.length]))));
const points=a.river.sites.filter(s=>s.usable&&clearance(s.p)>a.river.step*.3).map(s=>s.p).filter((_,i)=>i%7===0).slice(0,80);
for(const p of points)for(const direction of [-1,1]){const trace=flow.backtrace(p,direction*a.river.step);assert(F.inside(trace.point,domain,1e-5),'transport must remain in the material, including around holes');}
flow.advance(.35);const frame=flow.render('geometry',null,256);
for(const hole of domain.slice(1)){const center=hole.reduce((p,q)=>p.map((v,k)=>v+q[k]/hole.length),[0,0]),screen=layout.map(center),x=Math.floor(screen[0]/2),y=Math.floor(screen[1]/2);assert.equal(frame.pixels[(y*256+x)*4+3],0,'real holes remain transparent');}
assert.equal(JSON.stringify(m),saved);assert.equal(m.uvAudit.overlaps,0);
fs.writeFileSync('artifacts/contour-lab/flow-advection-report.json',JSON.stringify({source:'verified reference8 geometry and current UV; actual material advection',pathChecks:points.length*2,holes:domain.length-1,holeCentersTransparent:true,geometryAndUVUnchanged:true},null,2)+'\n');
console.log('PASS positive/reverse transport stays inside the domain, real holes remain clear, base UV unchanged');

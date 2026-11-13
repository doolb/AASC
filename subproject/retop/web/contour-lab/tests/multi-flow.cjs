const fs=require('node:fs'),assert=require('node:assert/strict');
const E=require('../engine.js'),F=require('../flow.js')(E),S=require('../flow-surface.js')(E,F),A=require('../flow-advection.js')(E,F),report=[];
const line=(a,b)=>({p0:a,p1:a.map((v,k)=>v+(b[k]-v)/3),p2:a.map((v,k)=>v+2*(b[k]-v)/3),p3:b});
const corners=[[0,0],[100,0],[100,80],[0,80]],level={id:'test',segments:corners.map((p,i)=>line(p,corners[(i+1)%4]))};
const port=(edge,role)=>({edge,role});
const cases=[{name:'merge',ports:[port(3,'inlet'),port(1,'inlet'),port(0,'outlet')]},{name:'split',ports:[port(0,'inlet'),port(1,'outlet'),port(3,'outlet')]},{name:'opposed',ports:[port(3,'inlet'),port(1,'inlet'),port(0,'outlet'),port(2,'outlet')]}];
for(const c of cases){const a=F.compute(level,c.ports),saved=JSON.stringify(a);assert(a.steady.valid&&a.river.audit.massValid);assert.equal(a.ports.length,c.ports.length);assert.equal(a.river.transport.version,2);
  for(const line of a.river.transport.streamlines){assert.equal(line.globalU,line.inletIndex+line.entryU);assert(line.entryU>0&&line.entryU<1);}
  if(c.name==='merge'){assert.deepEqual(a.river.transport.definitions.map(d=>d.edge),[3,1]);const upper=F.evaluateTransport(a.river.transport,[50,25]);assert(upper.u>.6&&upper.u<1.4);}
  for(const mode of ['direction','inlet']){const m=S.mesh({...a,settings:{...a.settings,uvMode:mode}},level,5);assert.equal(m.uvAudit.overlaps,0);assert.equal(m.uvAudit.flippedTriangles,0);if(m.uvAtlas){assert(m.uvAudit.periodicContinuous);assert(m.uvAudit.periodicSharedEdgeUVJump<1e-8);}else assert.equal(m.uvAudit.uvSeams,0);assert(Number.isFinite(m.uvAudit.reverseAreaFraction));assert(Number.isFinite(m.uvAudit.directedMeanAngleDegrees));
    if(mode==='inlet'){assert(m.uvProjection.inletRequested);if(c.name!=='opposed')assert(m.uvProjection.inletCoordinates);if(m.uvProjection.inletCoordinates)assert(m.uvProjection.inletAudit.maximumEntryError<1e-7);else assert(m.uvProjection.inletFallback);}
    if(c.name!=='opposed')assert(m.uvAudit.reverseAreaFraction<.02);else assert.equal(m.uvAudit.directedFitValid,m.uvAudit.reverseAreaFraction<.01&&(m.uvAudit.materialReverseAreaFraction??0)<.01);
    const before=JSON.stringify(m),flow=A.create(m,a,S.layout(m),{resolution:44}),samples=c.name==='split'?[[20,40],[80,40]]:[[18,40],[82,40]];
    for(const p of samples){const q=flow.velocity(p),trace=flow.backtrace(p,2),delta=trace.point.map((v,i)=>p[i]-v);assert(delta[0]*q[0]+delta[1]*q[1]>0,'positive playback must follow the signed physical velocity');assert(F.visible(p,trace.point,a.river.domain,1e-5));}
    if(c.name==='opposed'){assert(flow.velocity([18,40])[0]>0);assert(flow.velocity([82,40])[0]<0);assert(flow.backtrace([18,40],2).point[0]<18);assert(flow.backtrace([82,40],2).point[0]>82);}
    const initial=flow.render('geometry',null,96).pixels;flow.advance(.25);const moved=flow.render('geometry',null,96).pixels;assert(initial.some((v,i)=>v!==moved[i]));assert.equal(JSON.stringify(m),before);assert.equal(JSON.stringify(a),saved);assert(flow.render('uv',null,96).pixels.some((v,i)=>i%4===3&&v===255));
    if(mode==='inlet'&&m.uvProjection.inletCoordinates&&c.name==='merge'){flow.advance(.75);for(const p of [[1,40],[99,40]]){const boundary=[p[0]<50?0:100,p[1]],target=flow.baseUV(boundary)[0];assert(Math.abs(flow.sampleUV(p)[0]-target)<.06,'inlet U must stay fixed while waves advance');}}
    const reverse=flow.backtrace(samples[0],-2),q=flow.velocity(samples[0]);assert((samples[0][0]-reverse.point[0])*q[0]+(samples[0][1]-reverse.point[1])*q[1]<0);
    fs.writeFileSync('artifacts/contour-lab/multi-'+c.name+'-'+mode+'.json',JSON.stringify({level,analysis:a,surface:m}));report.push({case:c.name,mode,inletCalibrated:m.uvProjection.inletCoordinates,reverseAreaFraction:m.uvAudit.reverseAreaFraction,directedAngle:m.uvAudit.directedMeanAngleDegrees,geometricOverlap:0,localMotionForwardAndReverse:true,geometryAndAnalysisUnchanged:true});console.log('PASS multi-port field, directed UV diagnostics, labels, local transport and reverse',c.name,mode);
  }
}
fs.writeFileSync('artifacts/contour-lab/multi-flow-report.json',JSON.stringify({report},null,2)+'\n');

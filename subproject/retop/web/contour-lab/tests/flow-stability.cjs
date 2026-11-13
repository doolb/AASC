const fs=require('node:fs'),assert=require('node:assert/strict'),E=require('../engine.js'),F=require('../flow.js')(E),S=require('../flow-surface.js')(E,F),A=require('../flow-advection.js')(E,F),report=[];
for(const name of ['inlet-uv-8','multi-merge-inlet','multi-opposed-inlet']){
  const d=JSON.parse(fs.readFileSync('artifacts/contour-lab/'+name+'.json')),m=d.surface,saved=JSON.stringify(m),flow=A.create(m,d.analysis,S.layout(m),{resolution:40}),axis=m.uvProjection.flowAxis;
  assert.equal(flow.audit.cumulativeResampling,false);
  flow.advance(.25);const first=flow.render('geometry',null,96).pixels;
  flow.advance(2_000_000);assert.deepEqual(flow.render('geometry',null,96).pixels,first,'same phase must look identical after arbitrarily long playback');
  assert.equal(flow.audit.alternatingUV,false);assert.equal(flow.audit.coordinateFields,1);
  if(flow.audit.stableUV){for(const q of m.quads.filter((_,i)=>i%13===0)){const p=q.v.reduce((a,id)=>a.map((v,k)=>v+m.vertices[id][k]/4),[0,0]),base=flow.baseUV(p),uv=flow.sampleUV(p);assert.equal(uv[1-axis],base[1-axis]);assert(Math.abs((uv[axis]-base[axis])+flow.phaseCells*m.checker.uvCellSize)<1e-6);}}
  flow.advance(-flow.phaseCells);assert.equal(flow.phaseCells,0);assert.equal(JSON.stringify(m),saved);
  if(!flow.audit.stableUV)assert.equal(flow.phaseCells,0);
  report.push({name,method:flow.audit.method,longPlaybackCells:2_000_000,samePhasePixelsIdentical:true,singleUV:true,baseUVUnchanged:true});console.log('PASS stable long playback, fixed UV, reverse and no UV alternation',name);
}
fs.writeFileSync('artifacts/contour-lab/flow-stability-report.json',JSON.stringify({report},null,2)+'\n');

const fs=require('node:fs'),assert=require('node:assert/strict'),E=require('../engine.js'),F=require('../flow.js')(E),S=require('../flow-surface.js')(E,F),A=require('../flow-advection.js')(E,F),report=[];
for(const [name,file]of [['valid','fourport-example8'],['failed','current-example8-two-in-one-out-before']]){
  const d=JSON.parse(fs.readFileSync('artifacts/contour-lab/'+file+'.json')),saved=JSON.stringify(d.surface),frames=[];
  for(const fallback of [false,true]){const flow=A.create(d.surface,d.analysis,S.layout(d.surface),{resolution:32,fallback}),before=flow.render('geometry',null,96).pixels;flow.advance(.5);const after=flow.render('geometry',null,96).pixels,valid=A.canScroll(d.surface);assert.equal(flow.audit.enabled,valid||fallback);assert.equal(flow.audit.fallbackUsed,!valid&&fallback);assert.equal(flow.audit.alternatingUV,!valid&&fallback);
    if(!valid&&!fallback){assert.deepEqual(after,before);assert.equal(flow.phaseCells,0);}else assert(after.some((v,i)=>v!==before[i]));
    if(flow.audit.fallbackUsed){assert.equal(flow.phaseLayers().length,2);flow.advance(2000000);assert.deepEqual(flow.render('geometry',null,96).pixels,after);}frames.push(after);report.push({name,fallback,enabled:flow.audit.enabled,method:flow.audit.method,geometryAndUVUnchanged:JSON.stringify(d.surface)===saved});console.log('PASS fallback visibility switch',name,fallback);}
  if(A.canScroll(d.surface))assert.deepEqual(frames[0],frames[1]);assert.equal(JSON.stringify(d.surface),saved);
}
fs.writeFileSync('artifacts/contour-lab/fallback-visibility-report.json',JSON.stringify({report},null,2)+'\n');

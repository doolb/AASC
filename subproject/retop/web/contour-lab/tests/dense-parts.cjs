const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('../engine.js');
const root='artifacts/contour-lab/',report=[],size=128;
const square=E.rasterize([[10,10],[118,10],[118,118],[10,118]],size,size);
const ring=(r,reverse=false)=>Array.from({length:72},(_,i)=>{const a=(reverse?-1:1)*i*Math.PI/36;return [64+r*Math.cos(a),64+r*Math.sin(a)];});
const holed=E.rasterizeLoops([[[10,10],[118,10],[118,118],[10,118]],[[48,48],[48,80],[80,80],[80,48]]],size,size);
function validate(r,expected){
  for(const [i,n]of expected.entries()){
    const l=r.levels[i+2];assert.equal(l.subcontours.length,n);assert(l.audit.valid);assert(l.partitionAudit.valid);assert(l.partitionAudit.sidePolicyValid);
    assert.equal(l.partitionAudit.euler,1-(l.holeCount||0));assert(l.partitionAudit.areaDifference<1e-5);
    assert(l.partitionEdges.every(e=>e.faces.length===1||e.faces.length===2));assert(l.subcontours.every(p=>p.segments.length>=3&&p.segments.length<=6));
    // Independent raster union and multiplicity check, including real holes.
    const sum=new Uint16Array(size*size);
    for(const p of l.subcontours){const fill=E.rasterize(E.flatten(p.segments,.25),size,size);for(let j=0;j<sum.length;j++)sum[j]+=fill[j];}
    const rings=l.boundaryLoops||[l.segments],outer=E.rasterizeLoops(rings.map(p=>E.flatten(p,.25)),size,size);let mismatch=0,overlap=0;
    for(let j=0;j<sum.length;j++){mismatch+=(sum[j]>0)!==!!outer[j];overlap+=sum[j]>1;}
    assert.equal(mismatch,0,'cell union must equal the full domain');assert.equal(overlap,0,'cells must not overlap');
    if(i)assert(l.hierarchyAudit.valid);
  }
  assert(r.levels[3].topologyAudit.valid);
  assert.deepEqual(r.levels[2].meshNodes,r.levels[3].meshNodes);
}
const cases=[{name:'square-ultra300',mask:square,middle:5,ultra:300},{name:'square-middle300',mask:square,middle:300,ultra:300},{name:'hole-middle30-ultra300',mask:holed,middle:30,ultra:300},{name:'square-only-I',mask:square,middle:30,ultra:60,iOnly:true}];
for(const c of cases.filter(c=>!process.env.CONTOUR_CASE||c.name===process.env.CONTOUR_CASE)){console.time(c.name);const before=c.mask.slice(),r=E.compute(c.mask,size,size,{middle:{maxParts:c.middle},ultra:{maxParts:c.ultra,iOnly:c.iOnly}});validate(r,[c.middle,c.middle,c.ultra]);assert.deepEqual(c.mask,before);if(c.iOnly)assert(r.levels[4].partitionEdges.every(e=>e.kind==='I'));fs.writeFileSync(root+c.name+'.json',JSON.stringify(r));report.push({name:c.name,counts:r.levels.slice(2).map(l=>l.subcontours.length),holes:r.levels[4].holeCount||0,valid:true,pixelUnion:true,noPixelOverlap:true});console.timeEnd(c.name);console.log('PASS dense cells, shared topology, true holes, parent seams, raster union and source immutability',c.name);}
for(const maxParts of [0,301,2.5])assert.throws(()=>E.stageSettings({maxParts},{maxParts:5,ratios:{I:100,C:0,S:0}}),/1～300/);
fs.writeFileSync(root+'dense-parts-'+(process.env.CONTOUR_CASE||'all')+'-report.json',JSON.stringify({report,bounds:[1,300]},null,2)+'\n');

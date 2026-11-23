const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),E=require('../engine.js')(),H=require('../hierarchy.js')(E),source=require('../reference/shoulder.json'),saved=JSON.stringify(source),hash=name=>crypto.createHash('sha256').update(fs.readFileSync('web/contour-lab-3d/'+name)).digest('hex');
console.time('actual shoulder process');const result=E.process(source,{},console.log);console.timeEnd('actual shoulder process');assert.equal(JSON.stringify(source),saved);assert.deepEqual(result.source,source);assert.equal(result.sourceFingerprint,E.fingerprint(source));assert.equal(result.processingModel,'csi-low-curvature-network-v3');assert.equal(result.levels[0].mesh.faces.length,6);
const [far,basis,low,mid,ultra]=result.levels;
for(const l of result.levels){
  assert(l.audit.valid);
  assert(l.uv);assert.equal(l.uv.indices.length,l.mesh.faces.length);
}
assert.equal(far.audit.boundaryEdges,0);assert.equal(basis.audit.boundaryEdges,0);
assert(far.allQuads&&basis.allQuads);assert(basis.mesh.primitive.expression);
assert.equal(basis.mesh.primitive.coverage.outsideVertices,0);
assert.equal(basis.mesh.primitive.coverage.uncoveredTriangles,0);
assert.equal(basis.mesh.primitive.coverage.sourceTriangles,result.sourceAudit.triangles);
assert(basis.mesh.primitive.parts<=24);
// 中远独立包覆高模，近档继续从 CSI 低模细化。
assert.equal(low.mesh.hierarchy.parentLevel,'middle-csi');assert(low.mesh.csiReport.sourceUnmodified);assert(low.audit.triangles<=result.settings.lowTriangleBudget);
for(const [child,parent] of [[mid,low],[ultra,mid]])assert.equal(child.mesh.hierarchy.parentFingerprint,E.fingerprint(parent.mesh));
assert(mid.audit.triangles>=low.audit.triangles);
if(ultra.mesh.turboReport)assert.equal(ultra.mesh.turboReport.projectedToHigh,false);
const obj=E.obj(mid),round=E.parseOBJ(obj);assert.deepEqual(round.faces,mid.mesh.faces);
for(const l of result.boundary.levels)for(const k of l.accepted){
  const metric=l.metrics[k];assert(metric.areaRatio>=result.settings.areaRatio);assert(metric.curvatureDifference>=result.settings.curvatureDifference);assert(metric.sideFaces.every(n=>n>=3));
}
fs.mkdirSync('artifacts/contour-lab-3d',{recursive:true});fs.writeFileSync('artifacts/contour-lab-3d/shoulder-result.json',JSON.stringify(result));fs.writeFileSync('artifacts/contour-lab-3d/shoulder-low.obj',E.obj(low));fs.writeFileSync('artifacts/contour-lab-3d/shoulder-mid.obj',obj);fs.writeFileSync('artifacts/contour-lab-3d/shoulder-report.json',JSON.stringify({engineHash:hash('engine.js'),primitiveHash:hash('primitives.js'),hierarchyHash:hash('hierarchy.js'),source:source.provenance,sourceUnchanged:true,farMidAllQuads:basis.allQuads,fullSourceEnclosure:basis.mesh.primitive.coverage,levels:result.levels.map(l=>({id:l.id,audit:l.audit,error:l.error,support:l.mesh.supportReport,hierarchy:l.mesh.hierarchy,primitive:l.mesh.primitive,topologyPreserved:l.topologyPreserved})),boundary:result.boundary.levels.map(l=>({division:l.division,accepted:l.accepted.length,unknown:l.unknown.length})),limitations:['中远体块允许相交。完整包覆与双向抽样误差独立核验。']},null,2)+'\n');console.table(result.levels.map(l=>({level:l.id,quads:l.audit.quads,errorPercent:(l.error.maxRelative*100).toFixed(3),p95Percent:(l.error.p95Relative*100).toFixed(3)})));console.log('PASS actual shoulder enclosure, CSI hierarchy and OBJ readback');

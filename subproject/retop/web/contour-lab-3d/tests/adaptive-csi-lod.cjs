const assert = require('node:assert/strict');
const E = require('../engine.js')();
const checker = require('../contour-check.js')(E);
const grid = require('../structure-grid.js')(E);
const source = require('../reference/shoulder.json');

const result = E.process(source, {lowTriangleBudget: 100});
const [, farMid, low, mid, ultra] = result.levels;
const {diagonal, center} = E.bounds(source);
assert.equal(E.fingerprint(farMid.mesh), E.fingerprint(E.primitiveLevel(source).mesh));
assert(low.audit.valid && low.audit.boundaryEdges === 0);
assert(low.audit.triangles <= 100);
assert(new Set(low.mesh.csiPatchGroups).size > 1);
assert(low.mesh.csiReport.curves.fittedSpans < low.mesh.csiReport.curves.originalSpans);
assert.equal(grid.intersections(low.mesh), 0);
assert(low.uv.report.nonOverlapping);
assert.equal(E.audit(E.parseOBJ(E.obj(low))).triangles, low.audit.triangles);

// 在界面默认斜视下，从真实三角面提取中段上轮廓并测量向内缩入的距离。
const yaw = .65, pitch = .36;
const z = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
const x = E.unit(E.cross([0, 1, 0], z)), y = E.cross(z, x);
const project = p => {
  const q = E.sub(p, center);
  return [.5 + E.dot(q, x) / (1.12 * diagonal), .5 - E.dot(q, y) / (1.12 * diagonal), -E.dot(q, z) / diagonal];
};
const contour = checker.analyze(source, low.mesh, [], project, {resolution: 480});
const firstRow = (mask, column) => {
  for (let i = column; i < mask.length; i += contour.w) if (mask[i]) return Math.floor(i / contour.w);
  return contour.h;
};
const left = contour.source.lo[0], span = contour.source.hi[0] - left, inward = [];
for (let col = Math.ceil(left + span * .4); col <= left + span * .6; col++) {
  inward.push((firstRow(contour.candidate.mask, col) - firstRow(contour.source.mask, col)) * 1.12 / contour.w);
}
inward.sort((a, b) => a - b);
const middleInward = inward[Math.floor((inward.length - 1) * .95)];
assert(middleInward < .025, `中段斜视轮廓内缩 ${(middleInward * 100).toFixed(2)}%`);

assert.equal(mid.mesh.hierarchy.parentFingerprint, E.fingerprint(low.mesh));
assert.equal(mid.mesh.hierarchy.parentLevel, 'low');
assert(mid.audit.valid && mid.audit.boundaryEdges === 0);
assert.equal(mid.mesh.hierarchy.triangleBudget, 600);
assert(mid.audit.triangles > low.audit.triangles && mid.audit.triangles <= 600);
assert(mid.mesh.hierarchy.parentPatches.length === mid.mesh.faces.length);
assert(grid.intersections(mid.mesh) === 0);
assert(mid.uv.report.nonOverlapping);
assert.equal(E.audit(E.parseOBJ(E.obj(mid))).triangles, mid.audit.triangles);
const midEdges = E.topology(mid.mesh).edges;
for (const edge of low.mesh.csiBoundaryKeys) {
  const [a, b] = edge.split(':').map(Number), path = mid.mesh.hierarchy.retainedSeams[edge];
  assert.deepEqual([path[0], path.at(-1)], [a, b]);
  const origin = low.mesh.vertices[a], span = E.sub(low.mesh.vertices[b], origin);
  for (let i = 0; i < path.length; i++) {
    const delta = E.sub(mid.mesh.vertices[path[i]], origin);
    const t = E.dot(delta, span) / E.dot(span, span);
    assert(t >= -1e-10 && t <= 1+1e-10);
    assert(E.len(E.sub(delta, E.mul(span, t))) < diagonal * 1e-10);
    if (i) assert(midEdges.has(E.key(path[i-1], path[i])));
  }
}
assert(mid.mesh.supportReport?.bands?.length > 0, '肩甲硬折边应有两侧的真实支撑线');
assert(mid.audit.quads > (mid.audit.faces - mid.audit.quads), '四边面应占多数');
assert(mid.mesh.hierarchy.fitReport.fittedVertices > 0);
const supports = new Set(mid.mesh.supportKeys);
for (const band of mid.mesh.supportReport.bands) for (const crease of band.creases) {
  assert.equal(crease.sides.length, 2);
  for (const side of crease.sides) {
    assert(side.length > 0);
    assert(side.every(k => supports.has(k) && midEdges.has(k)));
  }
}
assert.equal(ultra.mesh.hierarchy.parentFingerprint, E.fingerprint(mid.mesh));
assert.equal(ultra.mesh.turboReport?.method, 'Catmull-Clark');
assert.equal(grid.intersections(ultra.mesh), 0);
console.log('PASS adaptive CSI shape, actual parent, topology, and OBJ budgets', {
  middleInward, low: low.audit.triangles, mid: mid.audit.triangles,
  curves: low.mesh.csiReport.curves, retained: low.mesh.csiBoundaryKeys.length, supportEdges: supports.size,
  smoothGuard: ultra.mesh.turboReport.geometryGuard
});

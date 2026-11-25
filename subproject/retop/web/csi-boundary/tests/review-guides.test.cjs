const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../contour-lab-3d/engine.js')();
const api = require('../partition.js')(E);
test('审查导线只绑定当前分析网格并拒绝无效曲线',()=>{
  const mesh=E.cube(), fingerprint=E.fingerprint(mesh);
  const curve={type:'I',p0:[0,0,0],p1:[1/3,0,0],p2:[2/3,0,0],p3:[1,0,0],samples:[[0,0,0],[1,0,0]]};
  const data={schema:'retop/csi-partition',version:1,source:mesh,analysisSource:mesh,sourceFingerprint:fingerprint,
    analysisFingerprint:fingerprint,boundary:{sourceFingerprint:fingerprint},guides:{scales:[{},{},{proposal:{patchGroups:mesh.faces.map(()=>0),curves:[]}}]},
    reviewGuides:{version:1,analysisFingerprint:fingerprint,curves:[curve]}};
  assert.equal(api.restore(data),data);
  data.reviewGuides.analysisFingerprint='wrong';
  assert.throws(()=>api.restore(data),/审查导线/);
  data.reviewGuides.analysisFingerprint=fingerprint;
  curve.p0[0]=NaN;
  assert.throws(()=>api.restore(data),/审查导线/);
});

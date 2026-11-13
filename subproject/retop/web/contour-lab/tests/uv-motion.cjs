const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../engine.js');
const F = require('../flow.js')(E);
const S = require('../flow-surface.js')(E, F);
const checks = [];
const line = (a, b) => ({p0:a, p1:a.map((v,k)=>v+(b[k]-v)/3), p2:a.map((v,k)=>v+2*(b[k]-v)/3), p3:b});

for (const angle of [0, Math.PI / 2]) {
  const axis = [Math.cos(angle), Math.sin(angle)];
  const transform = ([x,y]) => [x*axis[0]-y*axis[1], x*axis[1]+y*axis[0]];
  const points = [[0,0],[100,0],[100,20],[0,20]].map(transform);
  const level = {id:'test', segments:points.map((p,i)=>line(p,points[(i+1)%4]))};
  const analysis = F.compute(level, [{edge:1,role:'inlet'}, {edge:3,role:'outlet'}]);
  for (const mode of ['inlet', 'direction']) {
    const mesh = S.mesh({...analysis, settings:{...analysis.settings,uvMode:mode}}, level, 4);
    const index = new Map();
    mesh.quads.forEach(q=>q.v.forEach((v,i)=>index.set(v,q.uv[i])));
    const values = x => [...index].filter(([v])=>Math.abs(mesh.vertices[v][0]*axis[0]+mesh.vertices[v][1]*axis[1]-x)<1e-6).map(([,u])=>mesh.uv[u][mesh.uvProjection.flowAxis]);
    const entry = values(100), exit = values(0);
    assert(entry.length && exit.length);
    assert(Math.max(...entry)<Math.min(...exit), 'Positive longitudinal phase must move from inlet to outlet');
    assert.equal(mesh.uvAudit.overlaps, 0);
    checks.push({mode,rotationDegrees:angle*180/Math.PI,longitudinalAxis:mesh.uvProjection.flowAxis});
    console.log('PASS positive phase follows reversed ports', mode, angle*180/Math.PI);
  }
}
fs.writeFileSync('artifacts/contour-lab/uv-motion-report.json', JSON.stringify({checks},null,2)+'\n');

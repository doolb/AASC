const fs=require('node:fs'),assert=require('node:assert/strict');
const E=require('../engine.js'),F=require('../flow.js')(E),S=require('../flow-surface.js')(E,F);
// Created by dense-parts.cjs using the current engine, without reference geometry.
const level=JSON.parse(fs.readFileSync('artifacts/contour-lab/square-middle300.json')).levels[4];
const analysis=F.compute(level,F.automaticPorts(level));
assert(analysis.coverage.complete);assert(analysis.river.audit.massValid);
const mesh=S.mesh(analysis,level,4);
assert(mesh.audit.valid);assert.equal(mesh.regions.length,300);
assert.equal(mesh.uvAudit.overlaps,0);assert.equal(mesh.uvAudit.uvSeams,0);
fs.writeFileSync('artifacts/contour-lab/dense-flow-mesh-report.json',JSON.stringify({parts:300,coverage:analysis.coverage,mass:analysis.river.audit.massValid,mesh:mesh.audit,uv:mesh.uvAudit},null,2)+'\n');
console.log('PASS 300-part flow coverage, conservation, conforming quad mesh and nonoverlapping continuous UV');

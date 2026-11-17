const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../engine.js')();
const C = require('../csi-surface.js')(E);
const N = require('../curvature-network.js')(E);
const shoulder = require('../reference/shoulder.json');

const cases = [];
function test(name, fn) {
  fn();
  cases.push(name);
  console.log('PASS', name);
}

function guideMaxTurnDegrees(points) {
  let maxTurn = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = E.unit(E.sub(points[i], points[i - 1]));
    const b = E.unit(E.sub(points[i + 1], points[i]));
    maxTurn = Math.max(maxTurn, Math.acos(E.clamp(E.dot(a, b), -1, 1)) * 180 / Math.PI);
  }
  return maxTurn;
}

function unevenBentRing() {
  const U = 36, V = 2, vertices = [], grid = [], faces = [];
  for (let j = 0; j <= V; j++) {
    grid[j] = [];
    for (let i = 0; i <= U; i++) {
      if (i === U) {
        grid[j][i] = grid[j][0];
        continue;
      }
      const u = i / U;
      const t = 2 * Math.PI * (j === 0 ? u : j === V ? (u + 0.08 * Math.sin(4 * Math.PI * u) + 1) % 1 : u);
      const r = 2 + j * 0.25;
      const z = 0.45 * Math.abs(Math.sin(t)) + 0.08 * j;
      grid[j][i] = vertices.length;
      vertices.push([r * Math.cos(t), r * Math.sin(t), z]);
    }
  }
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < U; i++) faces.push([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
  }
  const chart = { patch: 3, U, V, grid, rim: true, annular: true };
  return { vertices, faces, csiCharts: [chart], csiPatchGroups: faces.map(() => 3), csiReport: {} };
}

test('unequal annular rails align middle stations and smooth transverse bend guides', () => {
  const base = unevenBentRing();
  const saved = JSON.stringify(base);
  const chart = base.csiCharts[0];
  const patch = N.stripPatch(base, chart, { lineFairing: true });
  const mesh = N.applyStripNetworks(base, { stripPatches: [patch] });

  assert(Array.isArray(patch.railTransport.midStations));
  assert.equal(patch.railTransport.midStations.length, chart.U + 1);
  assert.equal(patch.railTransport.midStations[0], 0);
  assert.equal(patch.railTransport.midStations[chart.U], 1);
  for (let i = 1; i <= chart.U; i++) {
    assert(patch.railTransport.midStations[i] > patch.railTransport.midStations[i - 1]);
  }
  for (let i = 0; i < chart.U; i++) {
    assert.deepEqual(mesh.vertices[chart.grid[1][i]], patch.railTransport.sectionNodes[1][i]);
  }
  for (const g of patch.guides.filter(g => g.family === 'u')) {
    assert(guideMaxTurnDegrees(g.points) < 20, `u guide turn too high: ${guideMaxTurnDegrees(g.points)}`);
  }
  for (const s of patch.bendRefinement.mandatorySections) {
    assert.equal(s.rowIndices.length, chart.V + 1);
  }
  assert(E.audit(mesh).valid);
  assert.deepEqual(E.audit(mesh).euler, [0]);
  assert.equal(JSON.stringify(base), saved);
});

test('legacy annular strip parameters without midStations replay without shifting nodes', () => {
  const base = unevenBentRing();
  const chart = base.csiCharts[0];
  const patch = N.stripPatch(base, chart, { lineFairing: true });
  const legacy = structuredClone(patch);
  delete legacy.railTransport.midStations;
  delete legacy.railTransport.sectionNodes;
  legacy.nodes = chart.grid.map(row => row.map(id => base.vertices[id].slice()));
  const replayed = N.applyStripNetworks(base, { stripPatches: [legacy] });
  for (let i = 0; i < chart.U; i++) {
    assert.deepEqual(replayed.vertices[chart.grid[1][i]], base.vertices[chart.grid[1][i]]);
  }
});

const savedShoulder = JSON.stringify(shoulder);
const result = E.process(shoulder, {});
const low = result.levels[2].mesh;
const network = low.csiCurveNetwork;
const patch3 = network.stripPatches.find(p => p.periodicU);

test('shoulder annular patch fixes rail spacing, wiring triangles/angles, and transverse guide kinks', () => {
  assert.equal(JSON.stringify(shoulder), savedShoulder);
  assert(result.levels[2].audit.valid);
  assert(result.levels[2].audit.triangles <= result.settings.lowTriangleBudget);
  assert.equal(low.csiReport.intersectionAudit.remainingNonadjacentTrianglePairs, 0);
  assert.equal(result.levels[2].uv.charts, 7);
  assert(result.levels[2].uv.report.nonOverlapping);
  assert(patch3);

  const faces3 = low.faces.filter((_, i) => low.csiPatchGroups[i] === patch3.patch);
  const tris3 = faces3.filter(f => f.length === 3).length;
  let minAngle = 180, maxRatio = 1;
  for (const f of faces3) {
    const ps = f.map(v => low.vertices[v]);
    const es = ps.map((p, i) => E.dist(p, ps[(i + 1) % ps.length]));
    maxRatio = Math.max(maxRatio, Math.max(...es) / Math.min(...es));
    for (let i = 0; i < ps.length; i++) {
      const a = E.unit(E.sub(ps[(i + 1) % ps.length], ps[i]));
      const b = E.unit(E.sub(ps[(i + ps.length - 1) % ps.length], ps[i]));
      minAngle = Math.min(minAngle, Math.acos(E.clamp(E.dot(a, b), -1, 1)) * 180 / Math.PI);
    }
  }
  const r1Lens = patch3.nodes[2].slice(0, -1).map((p, i, a) => E.dist(p, a[(i + 1) % a.length]));
  const r1Ratio = Math.max(...r1Lens) / Math.min(...r1Lens);

  assert(faces3.length <= 106, `expected <= 106 faces on annular patch, got ${faces3.length}`);
  assert(tris3 <= 16, `expected <= 16 triangles on annular patch, got ${tris3}`);
  assert(minAngle >= 20, `expected min angle >= 20 deg, got ${minAngle.toFixed(2)}`);
  assert(maxRatio <= 6.0, `expected max edge ratio <= 6.0, got ${maxRatio.toFixed(2)}`);
  assert(r1Ratio < 5.0, `expected inner rail edge ratio < 5.0, got ${r1Ratio.toFixed(2)}`);

  assert(Array.isArray(patch3.railTransport.midStations));
  assert(patch3.lineFairing.lines.every(l => l.accepted));
  assert(patch3.sourceProfiles.matchedSections > 0);
  for (const g of patch3.guides.filter(g => g.family === 'u')) {
    const turn = guideMaxTurnDegrees(g.points);
    assert(turn < 20, `shoulder annular u-guide turn too high: ${turn.toFixed(2)} deg`);
  }

  // Keep continuous centeredness and rigid/OBJ contracts intact.
  const at = N.evaluator(patch3);
  for (let i = 1; i < 40; i++) {
    const s = i / 40, a = at([s, 0]), b = at([s, 1]), d = E.sub(b, a), q = at([s, 0.5]);
    assert(Math.abs(E.dot(E.sub(q, a), d) / E.dot(d, d) - 0.5) < 1e-8);
  }
  const obj = E.parseOBJ(E.obj(result.levels[2]));
  assert.equal(obj.faces.length, low.faces.length);

  console.log('METRIC shoulder annular patch:', JSON.stringify({
    patch: patch3.patch,
    faces: faces3.length,
    triangles: tris3,
    minAngleDeg: +minAngle.toFixed(2),
    maxEdgeRatio: +maxRatio.toFixed(2),
    innerRailRatio: +r1Ratio.toFixed(2),
    lowTriangles: result.levels[2].audit.triangles
  }));
});

test('rimSamplingVersion 2 proposal keeps annular rail sampling deterministic', () => {
  const source = E.orient(shoulder);
  const proposal = structuredClone(result.guides.scales[2].proposal);
  for (const k of ['surfaceFitting', 'surfaceMatching', 'structureGrid', 'curvatureNetwork']) delete proposal[k];
  const m1 = C.generate(source, proposal, result.settings).mesh;
  const m2 = C.generate(source, proposal, result.settings).mesh;
  assert.equal(E.fingerprint(m1), E.fingerprint(m2));
});

if (fs.existsSync('artifacts/contour-lab-3d')) {
  fs.writeFileSync('artifacts/contour-lab-3d/annular-section-wiring-report.json', JSON.stringify({ cases }, null, 2));
}

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

test('annular retiling falls back when a bend guide would cross an ordinary meridian', () => {
  const U = 16, V = 2, vertices = [], faces = [], grid = [], phase = 3.99235837161541;
  for (let j = 0; j <= V; j++) {
    const w = j / V, row = [];
    for (let i = 0; i < U; i++) {
      const a = 2 * Math.PI * i / U;
      const t = a + .12675082289613784 * (2 * w - 1) * Math.sin(2 * a + phase) + .065160405728966 * Math.sin(4 * a + phase);
      const radius = 2 + (w - .5) * .6979894636198878 + .45 * Math.cos(3 * t + phase) + .3 * Math.sin(2 * t) + .17 * w * Math.sin(3 * t + 1);
      const z = .3 * Math.sin(2 * t) + .05039313603192568 * w * Math.cos(3 * t + phase) + .08 * w + .15 * Math.sin(Math.PI * w) * Math.sin(6 * t);
      row.push(vertices.length);
      vertices.push([radius * Math.cos(t), radius * Math.sin(t), z]);
    }
    grid.push([...row, row[0]]);
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) faces.push([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
  const chart = { patch: 3, U, V, grid, rim: true, annular: true };
  const base = { vertices, faces, csiCharts: [chart], csiPatchGroups: faces.map(() => 3), csiReport: {} };
  const patch = N.stripPatch(base, chart, { lineFairing: false, internalLines: 7 });
  assert.equal(patch.railTransport.orthogonality.accepted, false);
  assert.match(patch.railTransport.orthogonality.reason, /经线相交/);
  const replayed = N.applyStripNetworks(base, { stripPatches: [structuredClone(patch)] });
  assert(E.audit(replayed).valid);
  assert.deepEqual(E.audit(replayed).euler, [0]);
});

const savedShoulder = JSON.stringify(shoulder);
const result = E.process(shoulder, { lowTriangleBudget: 1000 });
const low = result.levels[2].mesh;
const network = low.csiCurveNetwork;
const patch3 = network.stripPatches.find(p => p.periodicU);

test('shoulder annular meridians and exported quad edges meet the latitude near a right angle', () => {
  const deviation = (a, b) => Math.asin(E.clamp(Math.abs(E.dot(E.unit(a), E.unit(b))), 0, 1)) * 180 / Math.PI;
  const p90 = angles => angles.sort((a, b) => a - b)[Math.floor((angles.length - 1) * .9)];
  const at = N.evaluator(patch3), step = 1e-4;
  const crossings = patch3.guides.filter(g => g.family === 'u').map(g => {
    const i = Math.floor(g.points.length / 2), [u, v] = g.parameters[i];
    const across = E.sub(g.points[i + 1], g.points[i - 1]);
    const along = E.sub(at([(u + step + 1) % 1, v]), at([(u - step + 1) % 1, v]));
    return deviation(across, along);
  });
  const corners = [], lower = [], lowerLeft = [], lowerRight = [];
  const { lo, hi } = E.bounds(shoulder);
  for (const [i, face] of low.faces.entries()) {
    if (face.length !== 4 || low.csiPatchGroups[i] !== patch3.patch) continue;
    const points = face.map(id => low.vertices[id]);
    const angles = points.map((point, k) => deviation(E.sub(points[(k + 1) % 4], point), E.sub(points[(k + 3) % 4], point)));
    corners.push(...angles);
    const center = E.mul(points.reduce((sum, point) => E.add(sum, point), [0, 0, 0]), .25);
    // 此验收件的顶视顺时针转 90° 后，对应用户截图中的下缘和两个转角。
    const x = (center[0] - lo[0]) / (hi[0] - lo[0]);
    const z = (center[2] - lo[2]) / (hi[2] - lo[2]);
    if (x > .78) lower.push(...angles);
    if (x > .4 && x <= .78 && z > .65) lowerLeft.push(...angles);
    if (x > .4 && x <= .78 && z < .35) lowerRight.push(...angles);
  }
  const metrics = {guideP90:p90(crossings), guideMax:Math.max(...crossings), quadP90:p90(corners), quadMax:Math.max(...corners), lowerP90:p90(lower), lowerLeftP90:p90(lowerLeft), lowerRightP90:p90(lowerRight)};
  console.log('METRIC orthogonal shoulder:', metrics);
  assert(metrics.guideMax <= 3, `guide crossing max ${metrics.guideMax.toFixed(2)}°`);
  assert(metrics.quadP90 <= 33 && metrics.quadMax <= 60);
  assert(metrics.lowerP90 <= 34 && metrics.lowerLeftP90 <= 37 && metrics.lowerRightP90 <= 34);
});

test('orthogonal annular wiring retains both rails and puts bend guides through exported mesh edges', () => {
  const chart = low.csiCharts.find(c => c.patch === patch3.patch), vertices = new Map();
  for (const id of chart.grid.flat()) vertices.set(low.csiBaseVertices[id], id);
  for (const {vertex, uv, point} of patch3.boundary) {
    if (uv[1] === 0 || uv[1] === 1) assert.deepEqual(low.vertices[vertices.get(vertex)], point);
  }
  const obj = E.parseOBJ(E.obj(result.levels[2])), topology = E.topology(obj);
  assert.equal(E.fingerprint(obj), E.fingerprint(low));
  const guides = patch3.guides.filter(g => g.adaptive && g.family === 'u');
  assert(guides.length > 0);
  for (const guide of guides) {
    const ids = guide.meshEdgeChain.map(id => vertices.get(id));
    const edgeTurn = guideMaxTurnDegrees(ids.map(id => obj.vertices[id]));
    // 四分之一带宽采样可发现密集采样相邻线段夹角掩盖的转弯。
    const last = guide.points.length - 1;
    const quarterSamples = [0, .25, .5, .75, 1].map(t => guide.points[Math.round(t * last)]);
    const guideTurn = guideMaxTurnDegrees(quarterSamples);
    assert(edgeTurn <= 15, `exported bend guide turns ${edgeTurn.toFixed(2)}°`);
    assert(guideTurn <= 18, `displayed bend guide turns ${guideTurn.toFixed(2)}°`);
    for (let j = 0; j < ids.length; j++) {
      const sample = j * (guide.points.length - 1) / chart.V;
      assert(E.dist(obj.vertices[ids[j]], guide.points[sample]) < 1e-6);
      assert(E.dist(obj.vertices[ids[j]], guide.depth[sample]) < 1e-6);
      if (j) assert(topology.edges.has(E.key(ids[j - 1], ids[j])));
    }
    for (const [i, [, v]] of guide.parameters.entries()) {
      const f = v * chart.V, j = Math.min(chart.V - 1, Math.floor(f));
      const edgePoint = E.add(E.mul(obj.vertices[ids[j]], 1 - (f - j)), E.mul(obj.vertices[ids[j + 1]], f - j));
      assert(E.dist(guide.depth[i], edgePoint) < 1e-8);
    }
  }
});

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

test('serialized shoulder parameters replay the shifted seam, wire geometry and UV', () => {
  const proposal = JSON.parse(JSON.stringify(result.guides.scales[2].proposal));
  const replay = C.generate(E.orient(shoulder), proposal, result.settings);
  assert(replay.supported, replay.reason);
  assert.equal(E.fingerprint(replay.mesh), E.fingerprint(low));
  const chart = mesh => mesh.csiCharts.find(c => c.patch === patch3.patch);
  assert.deepEqual(chart(replay.mesh).faceParameters, chart(low).faceParameters);
  assert.deepEqual(E.uvAtlas(replay.mesh), result.levels[2].uv);
});

test('the default shoulder export stays within 500 triangles and retains smooth bend guides', () => {
  const generated = E.process(shoulder), level = generated.levels[2];
  assert.equal(generated.settings.lowTriangleBudget, 500);
  assert(level.audit.valid);
  assert(level.audit.triangles <= 500);
  assert.equal(E.audit(E.parseOBJ(E.obj(level))).triangles, level.audit.triangles);
  assert.equal(level.mesh.csiReport.intersectionAudit.remainingNonadjacentTrianglePairs, 0);
  assert(level.uv.report.nonOverlapping);
  const annular = level.mesh.csiCurveNetwork.stripPatches.find(patch => patch.periodicU);
  const bends = annular.guides.filter(guide => guide.adaptive && guide.family === 'u');
  assert(bends.length > 0);
  for (const guide of bends) {
    const middle = guide.points[Math.floor(guide.points.length / 2)];
    assert(guideMaxTurnDegrees([guide.points[0], middle, guide.points.at(-1)]) <= 15);
  }
});

if (fs.existsSync('artifacts/contour-lab-3d')) {
  fs.writeFileSync('artifacts/contour-lab-3d/annular-section-wiring-report.json', JSON.stringify({ cases }, null, 2));
}

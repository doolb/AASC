const assert = require('node:assert/strict');
const E = require('../engine.js')();
const H = require('../hierarchy.js')(E);
const C = require('../csi-surface.js')(E, H);
const R = require('../structure-grid.js')(E);

const cases = [];
const test = (name, fn) => {
  fn();
  cases.push(name);
  console.log('PASS', name);
};

// 构造封闭高亏格双环面测试网格（CSI 补面会安全回退到特征保留四边混合低模）
function doubleTorus(uSteps = 20, vSteps = 12) {
  const vertices = [];
  const faces = [];
  const addTorusGrid = (cx, skipXSign) => {
    const start = vertices.length;
    for (let i = 0; i < uSteps; i++) {
      const a = (i / uSteps) * Math.PI * 2;
      for (let j = 0; j < vSteps; j++) {
        const b = (j / vSteps) * Math.PI * 2;
        const r = 1 + 0.35 * Math.cos(b);
        vertices.push([cx + r * Math.cos(a), 0.35 * Math.sin(b), r * Math.sin(a)]);
      }
    }
    const tri = [];
    for (let i = 0; i < uSteps; i++) {
      for (let j = 0; j < vSteps; j++) {
        const i2 = (i + 1) % uSteps;
        const j2 = (j + 1) % vSteps;
        const a = start + i * vSteps + j;
        const b = start + i2 * vSteps + j;
        const c = start + i2 * vSteps + j2;
        const d = start + i * vSteps + j2;
        tri.push([a, b, c], [a, c, d]);
      }
    }
    void skipXSign;
    return tri;
  };
  // 并联两个分离球-环组合形成多分支封闭角色近似，触发非单纯单环闭塞结构
  const t1 = addTorusGrid(0, 1);
  // 构建封闭八面体细分球壳用于 slivers / non-manifold 清理验证
  faces.push(...t1);
  return E.orient({ name: 'synthetic-torus-hi', vertices, faces });
}

function subdividedOctahedron(levels = 3) {
  let vertices = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0],
    [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  let faces = [
    [0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0],
    [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5],
  ];
  for (let s = 0; s < levels; s++) {
    const mid = new Map();
    const getMid = (a, b) => {
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!mid.has(k)) {
        const p = E.unit(E.add(vertices[a], vertices[b]));
        mid.set(k, vertices.length);
        vertices.push(p);
      }
      return mid.get(k);
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = getMid(a, b), bc = getMid(b, c), ca = getMid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return E.orient({ name: 'sphere', vertices, faces });
}

test('settingsFor migrates legacy lowFaceBudget to 2x triangles and enforces 65536 triangle max', () => {
  const migrated = E.settingsFor({ lowFaceBudget: 250 });
  assert.equal(migrated.lowTriangleBudget, 500);
  assert.equal('lowFaceBudget' in migrated, false);

  const explicit = E.settingsFor({ lowTriangleBudget: 65536 });
  assert.equal(explicit.lowTriangleBudget, 65536);

  assert.throws(() => E.settingsFor({ lowTriangleBudget: 65537 }));
  assert.throws(() => E.settingsFor({ lowTriangleBudget: 47 }));
});

function quadTorus(uSteps, vSteps) {
  const vertices = [], faces = [];
  for (let i = 0; i < uSteps; i++) {
    const a = (i * 2 * Math.PI) / uSteps;
    for (let j = 0; j < vSteps; j++) {
      const b = (j * 2 * Math.PI) / vSteps;
      const r = 1 + 0.3 * Math.cos(b);
      vertices.push([r * Math.cos(a), 0.3 * Math.sin(b), r * Math.sin(a)]);
    }
  }
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      faces.push([
        i * vSteps + j,
        ((i + 1) % uSteps) * vSteps + j,
        ((i + 1) % uSteps) * vSteps + ((j + 1) % vSteps),
        i * vSteps + ((j + 1) % vSteps),
      ]);
    }
  }
  return E.orient({ name: 'quad-torus', vertices, faces });
}

test('hierarchy enforces 65536 rendered triangle ceiling instead of 32768 polygon faces', () => {
  assert.equal(H.MAX_TRIANGLES, 65536);
  const quadCube = E.cube(); // 6 quads = 12 tris
  const s1 = H.subdivide(quadCube); // 24 quads = 48 tris
  assert.equal(E.audit(s1).triangles, 48);
  // 8192 quads (16384 tris) -> subdivide -> 32768 quads = 65536 tris (exact boundary, must pass!)
  const exactBound = H.subdivide(quadTorus(128, 64));
  assert.equal(E.audit(exactBound).triangles, 65536);
  // 8256 quads (16512 tris) -> subdivide -> 66048 tris > 65536 -> must throw
  assert.throws(() => H.subdivide(quadTorus(129, 64)), /65536个三角面预算/);
});

test('structure-grid and csi-surface count rendered triangles even when legacy lowFaceBudget is passed', () => {
  const cube = E.cube();
  const csiRes = E.process(cube, { manualEdges: [...E.topology(cube).edges.keys()], lowTriangleBudget: 192 });
  const base = csiRes.levels[2].mesh;
  assert.equal(base.csiReport.budget.unit, 'triangles');
  assert(E.audit(base).triangles <= 192);

  const v2 = R.generate(base, { version: 2, mode: 'independent-structure-mixed' }, { lowTriangleBudget: 160 });
  const a2 = E.audit(v2);
  assert.equal(v2.csiReport.budget.unit, 'triangles');
  assert.equal(v2.csiReport.budget.used, a2.triangles);
  assert(a2.triangles <= 160);

  const v2Legacy = R.generate(base, { version: 2, mode: 'independent-structure-mixed' }, { lowFaceBudget: 80 });
  assert.equal(v2Legacy.csiReport.budget.limit, 160);
  assert(E.audit(v2Legacy).triangles <= 160);
});

test('cleanSculptMesh repairs slivers and non-manifold extras without poking boundary holes', () => {
  const sphere = subdividedOctahedron(2); // 128 tris closed
  const dirty = E.copy(sphere);
  // 注入超近狭长零面积退化三角形（焊接最短边）与多余非流形第3翼面
  const f0 = dirty.faces[0];
  const dupV = dirty.vertices.length;
  dirty.vertices.push([dirty.vertices[f0[0]][0] + 1e-10, dirty.vertices[f0[0]][1], dirty.vertices[f0[0]][2]]);
  dirty.faces.push([f0[0], dupV, f0[1]]); // 零面积狭长片
  dirty.faces.push([f0[0], f0[1], 1]);    // 非流形多余面
  assert.equal(E.audit(dirty).valid, false);

  const { mesh: cleaned } = E.cleanSculptMesh(dirty);
  const oriented = E.orient(cleaned);
  const a = E.audit(oriented);
  assert.equal(a.valid, true);
  assert.equal(a.boundaryEdges, 0);
  assert.deepEqual(a.euler, [2]);
});

test('fastQEM and Blossom matchQuads produce valid quad-dominant output at exact triangle budget', () => {
  const hiSphere = subdividedOctahedron(4); // 2048 tris
  const hiAudit = E.audit(hiSphere);
  assert.equal(hiAudit.triangles, 2048);

  const tri = E.fastQEM(hiSphere, 320);
  const triAudit = E.audit(tri);
  assert.equal(triAudit.valid, true);
  assert(triAudit.triangles <= 320);
  assert.deepEqual(triAudit.euler, [2]);

  const mixed = E.matchQuads(tri, 38, 4.5);
  const mixedAudit = E.audit(mixed);
  assert.equal(mixedAudit.valid, true);
  assert.equal(mixedAudit.triangles, triAudit.triangles);
  assert(mixedAudit.quads > mixedAudit.faces * 0.5);
});

test('E.process falls back cleanly to quad-dominant simplify on unsupported closed torus and obeys lowTriangleBudget', () => {
  const t = doubleTorus(24, 12); // 576 tris closed genus-1 torus
  const before = E.fingerprint(t);
  const res = E.process(t, { lowTriangleBudget: 192 });
  assert.equal(E.fingerprint(t), before);

  const low = res.levels[2];
  assert.equal(low.audit.valid, true);
  assert(low.audit.triangles <= 192);
  assert.equal(low.mesh.csiReport.fallback, true);
  assert.equal(low.mesh.csiReport.fallbackMode, 'feature-preserving-quad-dominant-simplify');
  assert.equal(low.mesh.csiReport.budget.unit, 'triangles');
  assert.equal(low.mesh.csiReport.budget.used, low.audit.triangles);
  assert(low.audit.quads > 0);
  assert.deepEqual(low.audit.euler, [0]);
  assert.equal(res.levels[3].mesh.hierarchy.fallbackDerived, true);
  assert.deepEqual(res.levels[3].audit.euler, [0]);
  assert.equal(res.levels[4].mesh.hierarchy.fallbackDerived, true);
  assert.deepEqual(res.levels[4].audit.euler, [0]);

  for (const level of res.levels) {
    assert.equal(level.audit.valid, true);
    assert(level.audit.triangles <= H.MAX_TRIANGLES);
  }

  assert.throws(() => E.rebuildHierarchy(res, { lowTriangleBudget: 140 }), /重新生成五档/);
  const rebuiltPrim = E.rebuildHierarchy(res, { farMidParts: 2 });
  assert.equal(rebuiltPrim.levels[2].audit.valid, true);
  assert(rebuiltPrim.levels[2].audit.triangles <= 192);
  const rebuiltLow = E.rebuildCSILow(res, { curveNetworkLines: 4 });
  assert.equal(rebuiltLow.levels[2].audit.valid, true);
  assert(rebuiltLow.levels[2].audit.triangles <= 192);
});

console.log('ALL PASSED:', cases.length);

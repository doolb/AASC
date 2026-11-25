const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../contour-lab-3d/engine.js')();
const createPostprocess = require('../postprocess.js');

function strip() {
  const vertices = [], faces = [], labels = [], mids = [];
  for (let x = 0; x <= 6; x++) {
    const y = x === 0 || x === 6 ? 0 : (x % 2 ? .12 : -.12);
    vertices.push([x, -1, 0], [x, y, 0], [x, 1, 0]); mids.push(3*x+1);
  }
  for (let x = 0; x < 6; x++) for (let row = 0; row < 2; row++) {
    faces.push([3*x+row, 3*(x+1)+row, 3*(x+1)+row+1, 3*x+row+1]); labels.push(row);
  }
  const sourceEdges = mids.slice(1).map((v, i) => E.key(mids[i],v));
  const curve = { id:'test', interfaceId:'boundary', type:'I', p0:[0,0,0], p1:[2,0,0], p2:[4,0,0], p3:[6,0,0], startNode:mids[0], endNode:mids.at(-1), sourceEdges };
  return { mesh:{vertices,faces}, labels, mids, proposal:{patchGroups:labels,curves:[curve],sourceCorners:[],nodes:[],interfaces:[]} };
}

test('拟合平滑改变共享实体边界而不是仅改变叠加线', () => {
  const { mesh, proposal, mids } = strip(), before = JSON.stringify(mesh), processor = createPostprocess(E);
  const none = processor.run(mesh, proposal, 0), smooth = processor.run(mesh, proposal, 1);
  assert.equal(JSON.stringify(mesh), before);
  assert.deepEqual(none.mesh.vertices, mesh.vertices);
  assert.deepEqual(smooth.mesh.faces, mesh.faces);
  assert.deepEqual(smooth.mesh.vertices[mids[0]], mesh.vertices[mids[0]]);
  assert.deepEqual(smooth.mesh.vertices[mids.at(-1)], mesh.vertices[mids.at(-1)]);
  const deviation = model => Math.max(...mids.slice(1,-1).map(id => Math.abs(model.vertices[id][1])));
  assert(deviation(smooth.mesh) < deviation(mesh) * .9, '共享边锯齿应真实减少');
  assert(smooth.report.movedVertices > 0);
  assert.equal(smooth.report.newIntersectionPairs, 0);
  assert(smooth.curves.length > 0, '导出应包含处理后的 CSI 曲线');
  assert.throws(() => processor.run(mesh, proposal, 1.1), /平滑/);
});

test('同一共享边的两段旧曲线联合拟合，消除无必要的接段', () => {
  const {mesh, proposal, mids} = strip(), original = proposal.curves[0];
  proposal.curves = [0,1].map(index => ({...original, id:'part-'+index, regionPair:[0,1],
    p0:[index*3,0,0], p1:[index*3+1,0,0], p2:[index*3+2,0,0], p3:[index*3+3,0,0],
    startNode:mids[index*3], endNode:mids[index*3+3], sourceEdges:original.sourceEdges.slice(index*3,index*3+3)}));
  const result = createPostprocess(E).run(mesh,proposal,1);
  const shared = result.curves.filter(curve => curve.regionPair?.length === 2 && curve.regionPair.includes(0) && curve.regionPair.includes(1));
  assert.equal(shared.length,1, '一条近直线共享边不应沿旧曲线分段独立拟合');
});

test('旋转、平移和缩放不会改变处理后的相对形状', () => {
  const input = strip(), processor = createPostprocess(E), transform = ([x,y,z]) => [8-2*y, 2*x-3, 2*z+1];
  const transformed = { ...input.mesh, vertices:input.mesh.vertices.map(transform) };
  const proposal = structuredClone(input.proposal);
  for (const curve of proposal.curves) for (const key of ['p0','p1','p2','p3']) curve[key] = transform(curve[key]);
  const a = processor.run(input.mesh,input.proposal,.5), b = processor.run(transformed,proposal,.5);
  a.mesh.vertices.forEach((point,i) => assert(E.dist(transform(point),b.mesh.vertices[i]) < 1e-8));
});

test('确认角点不被平滑移动，相邻面的共享连接始终一致', () => {
  const {mesh, proposal, mids, labels} = strip();
  proposal.sourceCorners = [{ nodes:[mids[3]] }];
  const result = createPostprocess(E).run(mesh,proposal,1);
  assert.deepEqual(result.mesh.vertices[mids[3]],mesh.vertices[mids[3]]);
  const corner = mids[3];
  const shared = result.curves.filter(curve => curve.regionPair?.length === 2);
  const incident = shared.flatMap(curve => [
    ...(curve.startNode === corner ? [curve.p0] : []),
    ...(curve.endNode === corner ? [curve.p3] : [])
  ]);
  assert.equal(incident.length,2,'重新拟合的两侧 CSI 段必须连接已确认角点');
  for (const point of incident) assert.deepEqual(point,mesh.vertices[corner]);
  const topology = E.topology(result.mesh);
  for (let i=0; i<mids.length-1; i++) {
    const edge = topology.edges.get(E.key(mids[i],mids[i+1]));
    assert.equal(edge.faces.length,2);
    assert.notEqual(labels[edge.faces[0]],labels[edge.faces[1]]);
  }
  assert(E.audit(result.mesh).valid);
});

test('多分区交汇点固定且不会把各条共享边拆开', () => {
  const mesh = E.cube(), topology = E.topology(mesh), edge = [...topology.edges.values()][0];
  const [a,b] = [mesh.vertices[edge.a], mesh.vertices[edge.b]], offset = [0,.3,0];
  const proposal = { patchGroups:mesh.faces.map((_,i)=>i), nodes:[], sourceCorners:[], interfaces:[], curves:[{
    id:'branch', type:'C', startNode:edge.a, endNode:edge.b, sourceEdges:[E.key(edge.a,edge.b)],
    p0:a, p1:E.add(a,offset), p2:E.add(b,offset), p3:b
  }] };
  const result = createPostprocess(E).run(mesh,proposal,1);
  assert.deepEqual(result.mesh.vertices,mesh.vertices);
  assert.equal(result.report.newIntersectionPairs,0);
  assert(result.report.lockedVertices >= 8);
});

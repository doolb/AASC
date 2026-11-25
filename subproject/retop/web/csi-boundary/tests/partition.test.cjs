const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../contour-lab-3d/engine.js')();
const createPartition = require('../partition.js');
const shoulder = require('../../contour-lab-3d/reference/shoulder.json');

test('肩甲只分析源网格并保留原有 CSI 分区与导出数据', { timeout: 180000 }, () => {
  const input = JSON.stringify(shoulder);
  const stages = [];
  const guardedEngine = { ...E, process() { throw Error('不应调用候选生成流程'); } };
  const result = createPartition(guardedEngine).analyze(shoulder, {}, message => stages.push(message));
  const proposal = result.guides.scales[2].proposal;
  assert.equal(JSON.stringify(shoulder), input);
  assert.equal(result.sourceFingerprint, 'b91bdac8');
  assert.equal(result.analysisProxy.enabled, false);
  assert.equal(proposal.patchGroups.length, 4595);
  assert.equal(new Set(proposal.patchGroups).size, 7);
  assert.equal(proposal.interfaces.length, 13);
  assert.equal(proposal.fittingReport.overTolerance, 3);
  assert(!('levels' in result));
  assert(!stages.some(message => /低模|构建解析体|中模/.test(message)));
  assert.equal(result.csiSmoothing,.5);
  assert(result.postprocess.report.movedVertices > 0, '肩甲平滑必须影响实际显示网格');
  const merged = result.postprocess.report.mergedCorners;
  assert.deepEqual(merged.map(({node,targetNode}) => [node,targetNode]), [[898,902],[353,2222]]);
  const display = result.postprocess, displayTopology = E.topology(display.mesh);
  assert.equal(new Set(display.patchGroups).size,7);
  assert.equal(display.mesh.faces.length,4591);
  const audit = E.audit(display.mesh), beforeAudit = E.audit(result.analysisSource);
  assert(audit.valid);
  assert.equal(audit.components,beforeAudit.components);
  assert.deepEqual(audit.euler,beforeAudit.euler);
  for (const id of new Set(display.patchGroups)) {
    const start = display.patchGroups.indexOf(id), queue = [start], visited = new Set(queue);
    for (let i=0; i<queue.length; i++) for (const next of displayTopology.adj[queue[i]]) {
      if (display.patchGroups[next] !== id || visited.has(next)) continue;
      visited.add(next); queue.push(next);
    }
    assert.equal(visited.size,display.patchGroups.filter(group=>id===group).length);
  }
  for (const {node,targetNode} of merged) {
    assert.equal(displayTopology.incident[node].length,0, '近角不能继续作为实际网格节点');
    assert.deepEqual(display.mesh.vertices[targetNode],result.analysisSource.vertices[targetNode]);
    assert(displayTopology.incident[targetNode].length > 0);
    assert(!display.boundaryKeys.includes(E.key(node,targetNode)));
  }
  assert.deepEqual(display.boundaryKeys,[...displayTopology.edges].filter(([,edge]) => edge.faces.length === 1 || new Set(edge.faces.map(i=>display.patchGroups[i])).size > 1).map(([key])=>key));
  assert.equal(result.postprocess.report.newIntersectionPairs,0);
  assert(result.postprocess.fittedNetwork?.interfaces.length > 0, '保存整条共享接口的重新拟合结果');
  assert.equal(result.boundaryDisplay.representation,'csi-curves');
  assert.equal(result.boundaryDisplay.projection,'analytic');
  const analyticOffset = result.postprocess.curves.some(curve => curve.displaySamples?.some((point,i) => {
    const t = i/(curve.displaySamples.length-1), q = 1-t;
    const analytic = [0,1,2].map(k=>q*q*q*curve.p0[k]+3*q*q*t*curve.p1[k]+3*q*t*t*curve.p2[k]+t*t*t*curve.p3[k]);
    return E.dist(analytic,point) > 1e-5;
  }));
  assert(analyticOffset,'独立 CSI 曲线应允许偏离表面投影采样');
  const joinedTurns = [];
  for (let i=1;i<result.postprocess.curves.length;i++) {
    const a=result.postprocess.curves[i-1], b=result.postprocess.curves[i];
    if (a.interfaceId !== b.interfaceId || a.endNode !== b.startNode || b.joinFromPrevious?.kind === 'corner') continue;
    joinedTurns.push(Math.acos(E.clamp(E.dot(E.unit(E.sub(a.p3,a.p2)),E.unit(E.sub(b.p1,b.p0))),-1,1)));
  }
  assert(joinedTurns.length > 0 && joinedTurns.reduce((sum,value)=>sum+value,0)/joinedTurns.length < Math.PI/12,
    '共享接口应作为整线拟合，不能引入大量段间折角');
  const api = createPartition(E), smoothing = [0,.5,1].map(value => api.applySmoothing(result,value));
  function meanTurn(mesh) {
    const turns = [];
    for (const chain of proposal.chains) for (let i=1;i<chain.vertices.length-1;i++) {
      const [a,b,c] = chain.vertices.slice(i-1,i+2).map(id=>mesh.vertices[id]);
      turns.push(Math.acos(E.clamp(E.dot(E.unit(E.sub(b,a)),E.unit(E.sub(c,b))),-1,1)));
    }
    return turns.reduce((sum,value)=>sum+value,0)/turns.length;
  }
  const meanTurns = smoothing.map(item=>meanTurn(item.postprocess.mesh));
  assert(meanTurns[0]>meanTurns[1] && meanTurns[1]>meanTurns[2], '肩甲整体共享边折线应随强度平顺');
  assert.deepEqual(smoothing[0].postprocess.mesh.vertices,result.analysisSource.vertices);
  assert.deepEqual(smoothing[0].postprocess.mesh.faces,result.analysisSource.faces);
  assert.equal(smoothing[0].postprocess.topologyVersion,undefined);
  assert.equal(smoothing[0].boundaryDisplay.representation,'mesh-edges');
  const triangles = E.triangulate(result.analysisSource).faces;
  for (const item of smoothing) {
    assert.equal(item.postprocess.report.newIntersectionPairs,0);
    if (item.csiSmoothing > 0) {
      const network = item.postprocess.fittedNetwork;
      const activeNodes = new Set(network.chains.flatMap(chain=>chain.vertices));
      for (const node of proposal.sourceCorners.flatMap(corner=>corner.nodes)) {
        if (!activeNodes.has(node)) continue;
        const points = network.curves.flatMap(curve=>[
          ...(curve.startNode===node ? [curve.p0] : []), ...(curve.endNode===node ? [curve.p3] : [])
        ]);
        assert(points.length >= 2,'重新拟合应保留仍存在的结构角点 '+node);
        for (const point of points) assert.deepEqual(point,item.postprocess.mesh.vertices[node]);
      }
      const endpoints = new Map();
      for (const curve of network.curves) for (const [node,point] of [[curve.startNode,curve.p0],[curve.endNode,curve.p3]]) {
        if (endpoints.has(node)) assert.deepEqual(point,endpoints.get(node),'同一节点的所有曲线端点应精确一致');
        endpoints.set(node,point);
      }
    }
    assert.equal(api.restore(JSON.parse(JSON.stringify(item))).csiSmoothing,item.csiSmoothing);
    for (const face of triangles) {
      const normal = mesh => {const [a,b,c]=face.map(id=>mesh.vertices[id]); return E.cross(E.sub(b,a),E.sub(c,a));};
      const before=normal(result.analysisSource), after=normal(item.postprocess.mesh);
      assert(E.len(after) >= E.len(before)*.5-1e-10, '平滑不可过度压缩原始面');
      assert(E.dot(E.unit(before),E.unit(after)) >= .8-1e-10, '平滑不可过度扭转原始面');
    }
  }
  const outputs = [0, .25, .5, .75, 1].map(value => api.repartition(result, value));
  const counts = outputs.map(item => item.guides.scales[2].proposal.patches.length);
  assert(counts.every((count, i) => !i || count >= counts[i - 1]));
  assert(counts[0] < counts[2] && counts[4] > counts[2], '肩甲粗细两端必须实际产生不同分区');
  assert.deepEqual(outputs[2].guides.scales[2].proposal, proposal);
  for (const [index, item] of outputs.entries()) {
    const changed = item.guides.scales[2].proposal;
    assert.equal(changed.patchGroups.length, shoulder.faces.length);
    assert.equal(item.granularity, [0, .25, .5, .75, 1][index]);
    for (const boundary of changed.interfaces) for (const region of boundary.regionPair) assert(changed.patches.some(patch => patch.id === region));
    assert.equal(api.restore(JSON.parse(JSON.stringify(item))).granularity, item.granularity);
    const topology = E.topology(item.analysisSource), labels = changed.patchGroups;
    for (const id of new Set(labels)) {
      const expected = labels.filter(value => value === id).length, start = labels.indexOf(id), queue = [start], seen = new Set(queue);
      for (let n = 0; n < queue.length; n++) for (const next of topology.adj[queue[n]]) if (labels[next] === id && !seen.has(next)) { seen.add(next); queue.push(next); }
      assert.equal(seen.size, expected, '分区应保持连通');
    }
    if (index !== 2) {
      const actual = [...topology.edges].filter(([, edge]) => edge.faces.length === 1 || edge.faces.length === 2 && labels[edge.faces[0]] !== labels[edge.faces[1]]).map(([key]) => key);
      assert.deepEqual(new Set(changed.rawKeys), new Set(actual), '共享接口必须匹配实际面标签');
    }
  }
  const restored = createPartition(E).restore(JSON.parse(JSON.stringify(result)));
  const legacy = JSON.parse(JSON.stringify(smoothing[0]));
  delete legacy.boundaryDisplay;
  assert.equal(api.restore(legacy).csiSmoothing,0);
  const coordinate = restored.postprocess.fittedNetwork.curves[0].p1[0];
  restored.postprocess.fittedNetwork.curves[0].p1[0] = NaN;
  assert.throws(() => api.restore(restored), /CSI 曲线/);
  restored.postprocess.fittedNetwork.curves[0].p1[0] = coordinate;
  assert.deepEqual(restored.guides.scales[2].proposal.patchGroups, proposal.patchGroups);
  assert.deepEqual(restored.postprocess.faceSources,display.faceSources);
  const group = restored.postprocess.patchGroups[0];
  restored.postprocess.patchGroups[0] = group + 100;
  assert.throws(() => api.restore(restored), /面来源或分区标签/);
  restored.postprocess.patchGroups[0] = group;
  assert.equal(restored.sourceFingerprint, result.sourceFingerprint);
  restored.postprocess.mesh.vertices[0][0] += 1;
  assert.throws(() => createPartition(E).restore(restored), /后处理网格/);
  restored.postprocess.mesh.vertices[0][0] -= 1;
  restored.guides.scales[2].proposal.patchGroups.pop();
  assert.throws(() => createPartition(E).restore(restored), /分区结果/);
});

test('回读拒绝指纹和分区标签不匹配的结果', () => {
  const invalid = { schema: 'retop/csi-partition', version: 1, source: E.cube(), analysisSource: E.cube(), sourceFingerprint: 'wrong' };
  assert.throws(() => createPartition(E).restore(invalid), /指纹|结果/);
  assert.throws(() => createPartition(E).analyze(E.cube(), { granularity: 1.1 }), /粒度/);
  assert.throws(() => createPartition(E).analyze(E.cube(), { csiSmoothing: -0.1 }), /平滑/);
});

test('连续粒度沿连接层级单调变化并保留每个面', () => {
  const vertices = Array.from({ length: 7 }, (_, x) => [[x, 0, 0], [x, 1, 0]]).flat();
  const mesh = { vertices, faces: Array.from({ length: 6 }, (_, x) => [2*x, 2*x+2, 2*x+3, 2*x+1]) };
  const base = [0,0,0,1,1,1], fine = [0,1,2,3,4,5];
  const hierarchy = createPartition(E).hierarchy(mesh, base, fine);
  const samples = [0, .125, .25, .375, .5, .625, .75, .875, 1];
  const groups = samples.map(value => hierarchy.groups(value));
  const counts = groups.map(labels => new Set(labels).size);
  assert.deepEqual(groups[4], base);
  assert.equal(counts[0], 1); assert.equal(counts.at(-1), 6);
  assert(counts.every((n, i) => i === 0 || n >= counts[i-1]));
  let previousCount = 0;
  for (let i = 0; i <= 1000; i++) {
    const count = new Set(hierarchy.groups(i / 1000)).size;
    assert(count >= previousCount); previousCount = count;
  }
  for (const labels of groups) {
    assert.equal(labels.length, mesh.faces.length);
    for (const group of new Set(labels)) {
      const faces = labels.map((id, i) => id === group ? i : -1).filter(i => i >= 0);
      assert.equal(faces.at(-1) - faces[0] + 1, faces.length);
    }
  }
  assert.throws(() => hierarchy.groups(-.01), /粒度/);
  assert.throws(() => hierarchy.groups(1.01), /粒度/);
  const withoutEvidence = createPartition(E).hierarchy(mesh, base, null);
  assert.equal(new Set(withoutEvidence.groups(1)).size, 2, '没有细分证据时不得凭空增加分区');
  assert.throws(() => createPartition(E).hierarchy(mesh, [0,1,0,1,0,1], fine), /不连通/);
});

// 在独立显示副本上处理共享分区边，保留原始高模和识别结果。
function createCSIBoundaryPostprocess(E) {
  'use strict';
  const { add, sub, mul, dot, cross, dist, len } = E;

  function boundaries(topology, groups) {
    return [...topology.edges].filter(([,edge]) => edge.faces.length === 1 ||
      edge.faces.length === 2 && groups[edge.faces[0]] !== groups[edge.faces[1]]).map(([key]) => key);
  }

  function topologySignature(topology, groups) {
    // 比较每一区的连通片数量和共享分区对，局部焊接不能吞掉或接通原有分区。
    const visited = new Set(), counts = new Map(), pairs = new Set();
    for (const [face, group] of groups.entries()) {
      if (visited.has(face)) continue;
      counts.set(group,(counts.get(group)||0)+1);
      const queue = [face]; visited.add(face);
      for (let i=0; i<queue.length; i++) for (const next of topology.adj[queue[i]]) {
        if (visited.has(next) || groups[next] !== group) continue;
        visited.add(next); queue.push(next);
      }
    }
    for (const edge of topology.edges.values()) {
      const [a,b] = edge.faces;
      if (b === undefined) pairs.add(groups[a]+':outside');
      else if (groups[a] !== groups[b]) pairs.add(E.key(groups[a],groups[b]));
    }
    return JSON.stringify([[...counts].sort(),[...pairs].sort()]);
  }

  function localRing(faces, node, target) {
    const outer = new Map();
    for (const face of faces) for (let i=0; i<face.length; i++) {
      const a = face[i], b = face[(i+1)%face.length], key = E.key(a,b);
      if (outer.has(key)) outer.delete(key);
      else outer.set(key,[a,b]);
    }
    const next = new Map();
    for (const edge of outer.values()) {
      const [a,b] = edge.map(id=>id===node ? target : id);
      if (a === b) continue;
      if (next.has(a)) return null;
      next.set(a,b);
    }
    if (next.size < 3) return [];
    const start = next.keys().next().value, ring = [];
    let cursor = start;
    do {
      ring.push(cursor); cursor = next.get(cursor);
      if (cursor === undefined || ring.length > next.size) return null;
    } while (cursor !== start);
    return ring.length === next.size ? ring : null;
  }

  function triangulateRing(vertices, ring, reference) {
    if (ring.length < 3) return [];
    if (ring.length > 24) return null;
    const normal = E.unit(reference.reduce((sum,face)=>add(sum,mul(face.normal,face.area)),[0,0,0]));
    const origin = vertices[ring[0]], edge = sub(vertices[ring[1]],origin);
    const axis = E.unit(sub(edge,mul(normal,dot(edge,normal)))), vertical = E.unit(cross(normal,axis));
    const points = ring.map(id=>{const offset=sub(vertices[id],origin); return [dot(offset,axis),dot(offset,vertical)];});
    const size = points.length, scale = Math.max(...points.map(point=>Math.hypot(...point))), epsilon = scale*scale*1e-10;
    const turn = (a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const between = (point,a,b)=>(point[0]-a[0])*(point[0]-b[0])+(point[1]-a[1])*(point[1]-b[1])<=0;
    const polygonArea = points.reduce((sum,a,i)=>sum+turn([0,0],a,points[(i+1)%size]),0);
    if (!(polygonArea > epsilon)) return null;
    function inside([x,y]) {
      let hit = false;
      for (let i=0; i<size; i++) {
        const [ax,ay]=points[i], [bx,by]=points[(i+1)%size];
        if ((ay>y)!==(by>y) && x < ax+(bx-ax)*(y-ay)/(by-ay)) hit=!hit;
      }
      return hit;
    }
    function visible(i,j) {
      if (j===i+1 || i===0 && j===size-1) return true;
      const a=points[i], b=points[j];
      if (!inside([(a[0]+b[0])/2,(a[1]+b[1])/2])) return false;
      for (let k=0; k<size; k++) {
        const l=(k+1)%size;
        if ([i,j].includes(k) || [i,j].includes(l)) continue;
        const c=points[k],d=points[l], x=turn(a,b,c),y=turn(a,b,d), z=turn(c,d,a),w=turn(c,d,b);
        if (x*y<0 && z*w<0 || Math.abs(x)<=epsilon && between(c,a,b) ||
            Math.abs(y)<=epsilon && between(d,a,b)) return false;
      }
      return true;
    }
    const table = Array.from({length:size},()=>Array(size).fill(null));
    // 相邻区有宽面混合细边，面积下限跟随原有的窄面，再由质量评分选择对角线。
    const minimum = Math.max(epsilon,Math.min(...reference.map(face=>face.area))*.5);
    for (let i=0; i<size-1; i++) table[i][i+1]={score:Infinity,faces:[]};
    // 对所有可用的局部划分取最差三角形质量最好的结果，避免固定扇形产生窄三角。
    for (let span=2; span<size; span++) for (let a=0; a+span<size; a++) {
      const b=a+span;
      if (!visible(a,b)) continue;
      for (let k=a+1; k<b; k++) {
        const left=table[a][k], right=table[k][b];
        if (!left || !right || turn(points[a],points[k],points[b])<=epsilon) continue;
        const face=[ring[a],ring[k],ring[b]], [p,q,r]=face.map(id=>vertices[id]);
        const vector=cross(sub(q,p),sub(r,p)), area=len(vector)/2;
        if (area<minimum || !reference.some(item=>dot(vector,item.normal)>=.8*len(vector))) continue;
        const quality=area/(dist(p,q)**2+dist(q,r)**2+dist(r,p)**2);
        const score=Math.min(left.score,right.score,quality);
        if (!table[a][b] || score>table[a][b].score) table[a][b]={score,faces:[...left.faces,...right.faces,face]};
      }
    }
    return table[0][size-1]?.faces ?? null;
  }

  function mergeCorners(initial, originalGroups, records, original, protectedEdges, intersections) {
    let mesh = initial, groups = originalGroups, faceSources = initial.faces.map((_,i)=>i);
    const merged = [], rejected = [];
    const locks = new Set(protectedEdges.flatMap(key=>key.split(':').map(Number)));
    for (const record of records) {
      const {node,targetNode,radius} = record, topology = E.topology(mesh), edge = topology.edges.get(E.key(node,targetNode));
      const reject = reason => rejected.push({node,targetNode,reason});
      if (edge?.faces.length !== 2 || groups[edge.faces[0]] === groups[edge.faces[1]]) {
        reject('近角与目标之间没有可收缩的共享短边'); continue;
      }
      if (!(radius>0) || dist(original.vertices[node],original.vertices[targetNode])>radius || locks.has(node)) {
        reject('短边超出合并距离或关联手动边'); continue;
      }
      const boundary = boundaries(topology,groups).map(key=>topology.edges.get(key));
      const degree = id => boundary.filter(item=>item.a===id || item.b===id).length;
      if (degree(node)!==2 || degree(targetNode)<3 || boundary.some(item=>item.faces.length===1 && (item.a===node || item.b===node))) {
        reject('不符合内部近角并入交汇点的拓扑'); continue;
      }
      const affected = new Set(topology.incident[node]), byGroup = new Map();
      for (const i of affected) {
        const group = groups[i];
        if (!byGroup.has(group)) byGroup.set(group,[]);
        byGroup.get(group).push(i);
      }
      const additions = [];
      for (const [group,ids] of byGroup) {
        const ring = localRing(ids.map(i=>mesh.faces[i]),node,targetNode);
        const faces = ring && triangulateRing(mesh.vertices,ring,ids.map(i=>topology.data[i]));
        if (!faces) break;
        additions.push({group,ids,faces});
      }
      if (additions.length!==byGroup.size) { reject('局部面形不满足重三角化约束'); continue; }
      const trial = {name:mesh.name,vertices:mesh.vertices,faces:[]}, trialGroups = [], trialSources = [], changed = new Set();
      for (const [i,face] of mesh.faces.entries()) if (!affected.has(i)) {
        trial.faces.push(face); trialGroups.push(groups[i]); trialSources.push(faceSources[i]);
      }
      for (const {group,ids,faces} of additions) for (const face of faces) {
        // 新面追溯到同一区域内共享顶点最多的原面，来源索引供核对和回读使用。
        const source = ids.map(i=>({i,matches:mesh.faces[i].filter(id=>face.includes(id===node?targetNode:id)).length}))
          .sort((a,b)=>b.matches-a.matches || a.i-b.i)[0].i;
        changed.add(trial.faces.length);
        trial.faces.push(face); trialGroups.push(group); trialSources.push(faceSources[source]);
      }
      const candidateTopology = E.topology(trial), before = E.audit(mesh), after = E.audit(trial);
      if (!after.valid || before.components!==after.components || before.boundaryEdges!==after.boundaryEdges || before.boundaryLoops!==after.boundaryLoops ||
          JSON.stringify(before.euler)!==JSON.stringify(after.euler) ||
          topologySignature(topology,groups)!==topologySignature(candidateTopology,trialGroups)) {
        reject('局部网格或分区拓扑不一致'); continue;
      }
      // 重整后的新三角形无法与原三角形逐一配对，保守拒绝任何涉及新面的真穿插。
      if (intersections(trial,changed)) { reject('重整后的局部三角面存在穿插'); continue; }
      mesh=trial; groups=trialGroups; faceSources=trialSources;
      merged.push({node,targetNode,interfaceId:record.interfaceId,sourceFaces:affected.size,newFaces:changed.size});
    }
    return {mesh,groups,faceSources,merged,rejected};
  }

  function run(source, proposal, strength = .5, progress = () => {}, options = {}) {
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw Error('CSI 拟合平滑须为 0～1。');
    let mesh = E.validate(source), groups = proposal?.patchGroups;
    const topology = E.topology(mesh), diagonal = E.bounds(mesh).diagonal;
    if (!Array.isArray(groups) || groups.length !== mesh.faces.length) throw Error('分区标签与分析网格不匹配。');
    let boundaryKeys = [];
    const degree = new Map(), locked = new Set();
    for (const [key, edge] of topology.edges) {
      const open = edge.faces.length === 1, separating = edge.faces.length === 2 && groups[edge.faces[0]] !== groups[edge.faces[1]];
      if (!open && !separating) continue;
      boundaryKeys.push(key);
      for (const v of [edge.a, edge.b]) { degree.set(v, (degree.get(v) || 0) + 1); if (open) locked.add(v); }
    }
    for (const [vertex, count] of degree) if (count !== 2) locked.add(vertex);
    for (const corner of proposal.sourceCorners || []) for (const vertex of corner.nodes || []) locked.add(vertex);
    for (const node of proposal.nodes || []) if (node.kind === 'junction' || node.kind === 'endpoint') locked.add(node.id);
    const candidates = new Map(), boundary = new Set(boundaryKeys);
    const point = (curve,t) => { const q=1-t; return [0,1,2].map(k=>q*q*q*curve.p0[k]+3*q*q*t*curve.p1[k]+3*q*t*t*curve.p2[k]+t*t*t*curve.p3[k]); };
    // 将识别出的 CSI 控制曲线作为平滑目标，保留交汇点与真实结构角点。
    for (const curve of proposal.curves || []) {
      if (!['p0','p1','p2','p3'].every(key => Array.isArray(curve[key]) && curve[key].length === 3 && curve[key].every(Number.isFinite))) continue;
      const points = Array.from({ length: 65 }, (_,i) => point(curve,i/64));
      for (const key of curve.sourceEdges || []) if (boundary.has(key)) {
        const edge = topology.edges.get(key);
        for (const vertex of [edge.a, edge.b]) {
          if (locked.has(vertex)) continue;
          const original = mesh.vertices[vertex]; let best = null;
          for (let i = 1; i < points.length; i++) {
            const a=points[i-1], delta=sub(points[i],a), denominator=dot(delta,delta);
            const t=denominator ? Math.max(0,Math.min(1,dot(sub(original,a),delta)/denominator)) : 0;
            const target=add(a,mul(delta,t)), distance=dist(original,target);
            if (!best || distance < best.distance) best={ target, distance };
          }
          if (best && (!candidates.has(vertex) || best.distance < candidates.get(vertex).distance)) candidates.set(vertex,best);
        }
      }
    }
    const triangulated = E.triangulate(mesh), faceTriangles = mesh.faces.map(() => []);
    triangulated.faces.forEach((triangle,index) => faceTriangles[triangulated.source[index]].push(triangle));
    const reference = triangulated.faces.map(ids => { const [a,b,c] = ids.map(id => mesh.vertices[id]); return cross(sub(b,a),sub(c,a)); });
    const triangleIndex = new Map(triangulated.faces.map((triangle,index) => [triangle,index]));
    function validFace(face) {
      return faceTriangles[face].every(ids => {
        const [a,b,c]=ids.map(id=>mesh.vertices[id]), normal=cross(sub(b,a),sub(c,a)), original=reference[triangleIndex.get(ids)];
        return len(normal) >= len(original)*.5 && dot(normal,original) >= len(normal)*len(original)*.8;
      });
    }
    let rejected = 0, damped = 0;
    for (const [vertex, candidate] of candidates) {
      if (!strength || candidate.distance < diagonal*1e-12) continue;
      const start = source.vertices[vertex], neighbors = new Set(topology.incident[vertex].flatMap(face => source.faces[face]).filter(id => id !== vertex));
      const local = Math.min(...[...neighbors].map(id => dist(start, source.vertices[id])));
      const cap = Math.min(diagonal*.015, local*.4), amount = Math.min(1,cap/(candidate.distance || 1))*strength;
      let accepted = false;
      for (const fraction of [1,.5,.25,.125]) {
        mesh.vertices[vertex] = add(start,mul(sub(candidate.target,start),amount*fraction));
        if (topology.incident[vertex].every(validFace)) { accepted=true; if (fraction < 1) damped++; break; }
      }
      if (!accepted) { mesh.vertices[vertex] = start.slice(); rejected++; }
    }
    const moved = () => [...candidates.keys()].filter(vertex => dist(mesh.vertices[vertex],source.vertices[vertex]) > diagonal*1e-12);
    let movedVertices = moved(), newIntersectionPairs = 0, crossingFallback = false;
    const intersections = () => {
      const factory = typeof createContourStructureGrid === 'function' ? createContourStructureGrid : require('../contour-lab-3d/structure-grid.js');
      return factory(E).intersections;
    };
    if (movedVertices.length) {
      progress('检查共享边附近的穿插');
      const auditIntersections = intersections(), changed = new Set(movedVertices.flatMap(vertex => topology.incident[vertex]));
      const pairKey = (a,b) => a < b ? a+':'+b : b+':'+a, existing = new Set();
      auditIntersections(source, changed, (a,b) => existing.add(pairKey(a,b)));
      auditIntersections(mesh, changed, (a,b) => { if (!existing.has(pairKey(a,b))) newIntersectionPairs++; });
      if (newIntersectionPairs) {
        for (const vertex of movedVertices) mesh.vertices[vertex] = source.vertices[vertex].slice();
        crossingFallback = true; movedVertices = [];
      }
    }
    const guideFactory = typeof createContourBoundaryGuides === 'function' ? createContourBoundaryGuides : require('../contour-lab-3d/boundary-guides.js');
    const guide = guideFactory(E), fitFallbacks = []; let curves = proposal.curves || [], fittedNetwork = null, fitOverTolerance = 0;
    let merge = {merged:[],rejected:[],faceSources:null};
    if (strength>0 && proposal.cornerMerges?.length) {
      progress('合并交汇处的近角');
      merge=mergeCorners(mesh,groups,proposal.cornerMerges,source,options.manualEdges||[],intersections());
      if (merge.merged.length) {
        mesh=merge.mesh; groups=merge.groups; boundaryKeys=boundaries(E.topology(mesh),groups);
        const removed = new Set(merge.merged.map(record=>record.node));
        movedVertices=movedVertices.filter(id=>!removed.has(id));
      }
    }
    if (movedVertices.length || merge.merged.length) {
      try {
        // 按整个共享接口联合拟合，避免逐段重拟合造成原本平顺的接缝产生折角。
        progress('重新拟合共享 CSI 整线');
        const t = E.topology(mesh), graph = guide.chains(mesh,boundaryKeys,t), chains = guide.interfaceChains(mesh,boundaryKeys,t,groups), area = new Map();
        for (const chain of chains) { chain.role='major'; chain.supportedEdges=chain.edges.length; }
        groups.forEach((id,index)=>area.set(id,(area.get(id)||0)+t.data[index].area));
        const scale = options.scale || diagonal, patches = [...area].map(([id,value])=>({id,area:value,relativeArea:value/(scale*scale)}));
        const network = { keys:boundaryKeys, groups, patches, chains, nodes:graph.nodes,
          report:{ ...(proposal.report||{}), seedEdges:boundaryKeys.length, edges:boundaryKeys.length,
            endpoints:graph.nodes.filter(node=>node.kind==='endpoint').length,
            junctions:graph.nodes.filter(node=>node.kind==='junction').length, surfaceContrastSplits:[] } };
        fittedNetwork = guide.fitNetwork(mesh,t,network,{ scale, tolerance:scale*(options.fitTolerance ?? .012),
          cornerAngle:55, regularization:.01, field:merge.merged.length ? null : options.field, fieldStrength:1,
          // 显示网格已锁定的确认角点也必须约束曲线，否则二次识别会把实体转角重新圆滑。
          fixedCornerNodes:(proposal.sourceCorners||[]).flatMap(corner=>corner.nodes||[]),
          localScaleFitting:true, curveFairing:true, internalSmoothing:strength });
        curves = fittedNetwork.curves;
        fitOverTolerance = fittedNetwork.fittingReport.overTolerance;
      } catch (error) {
        // 若整网拟合失败，连同受影响的显示边界一并回退，避免导出与色块不一致。
        mesh=E.validate(source); groups=proposal.patchGroups; boundaryKeys=boundaries(topology,groups);
        merge.rejected.push(...merge.merged.map(record=>({...record,reason:'整线拟合失败'})));
        merge.merged=[]; merge.faceSources=null;
        movedVertices = []; fittedNetwork = null; curves = proposal.curves || [];
        fitFallbacks.push('整线拟合失败：'+error.message);
      }
    }
    const maximumDisplacement = movedVertices.reduce((max,vertex)=>Math.max(max,dist(source.vertices[vertex],mesh.vertices[vertex])),0);
    return { mesh, boundaryKeys, curves, fittedNetwork, ...(merge.merged.length ? {patchGroups:groups,faceSources:merge.faceSources} : {}),
      report: { strength, movedVertices: movedVertices.length, lockedVertices: locked.size, rejectedVertices: rejected, dampedVertices:damped,
      mergedCorners:merge.merged, rejectedCornerMerges:merge.rejected,
      fittedVertices: candidates.size, maximumDisplacement, maximumDisplacementRelative: maximumDisplacement/diagonal,
      newIntersectionPairs, crossingFallback, fitFallbacks, fitOverTolerance, intersectionScope:'非相邻三角面真穿插；不覆盖共面、共点及端点接触',
      representation:'CSI 拟合曲线的受限边界采样；色块与实际显示网格边共用顶点' } };
  }
  return { run };
}
if (typeof module !== 'undefined') module.exports = createCSIBoundaryPostprocess;
if (typeof window !== 'undefined') window.createCSIBoundaryPostprocess = createCSIBoundaryPostprocess;

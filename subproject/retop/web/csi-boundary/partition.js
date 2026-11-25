// 只执行源网格分析与 CSI 分区，不创建任何候选几何。
function createCSIPartition(E) {
  'use strict';

  function hierarchy(mesh, base, fine) {
    const topology = E.topology(mesh), count = mesh.faces.length;
    if (!Array.isArray(base) || base.length !== count || base.some(id => !Number.isInteger(id) || id < 0)) throw Error('基准分区无效。');
    const fineValid = Array.isArray(fine) && fine.length === count && fine.every(id => Number.isInteger(id) && id >= 0);
    const baseIds = [...new Set(base)], baseIndex = new Map(baseIds.map((id, index) => [id, index]));
    const seen = new Set(), baseComponents = new Map(), atoms = Array(count).fill(-1), atomBase = [];
    // 将同一基准区和细尺度区的交集拆成真实连通片，避免把相隔的面误当作同一区。
    for (let root = 0; root < count; root++) if (!seen.has(root)) {
      const parent = base[root], detail = fineValid ? fine[root] : 0, id = atomBase.length;
      atomBase.push(baseIndex.get(parent)); const queue = [root]; seen.add(root); atoms[root] = id;
      for (let i = 0; i < queue.length; i++) for (const next of topology.adj[queue[i]]) {
        if (!seen.has(next) && base[next] === parent && (!fineValid || fine[next] === detail)) {
          seen.add(next); atoms[next] = id; queue.push(next);
        }
      }
    }
    // 原有基准区若本身不连通，拒绝调整，防止伪造单调和连通性保证。
    const visited = new Set();
    for (let root = 0; root < count; root++) if (!visited.has(root)) {
      const id = base[root], queue = [root]; visited.add(root); baseComponents.set(id, (baseComponents.get(id) || 0) + 1);
      for (let i = 0; i < queue.length; i++) for (const next of topology.adj[queue[i]]) if (!visited.has(next) && base[next] === id) { visited.add(next); queue.push(next); }
    }
    if ([...baseComponents.values()].some(n => n !== 1)) throw Error('原分区存在不连通区域，无法安全调整粒度。');
    const links = [];
    for (const edge of topology.edges.values()) if (edge.faces.length === 2) {
      const [a,b] = edge.faces, cosine = E.dot(topology.data[a].normal, topology.data[b].normal);
      links.push({ a, b, score: 1 - Math.max(-1, Math.min(1, cosine)) });
    }
    links.sort((a,b) => a.score - b.score || a.a - b.a || a.b - b.b);
    function mergeSequence(size, mapFace, allowed) {
      const parent = Array.from({ length: size }, (_, i) => i), merges = [];
      function find(id) { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; }
      for (const link of links) {
        const a = mapFace(link.a), b = mapFace(link.b);
        if (!allowed(a,b)) continue;
        const x = find(a), y = find(b);
        if (x !== y) { parent[y] = x; merges.push([a,b]); }
      }
      return merges;
    }
    const fineMerges = mergeSequence(atomBase.length, face => atoms[face], (a,b) => atomBase[a] === atomBase[b]);
    const coarseMerges = mergeSequence(baseIds.length, face => baseIndex.get(base[face]), () => true);
    function groups(value) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('分区粒度须为 0～1。');
      if (value === .5) return base.slice();
      const detailed = value > .5, initial = detailed ? atoms : base.map(id => baseIndex.get(id));
      const size = detailed ? atomBase.length : baseIds.length, sequence = detailed ? fineMerges : coarseMerges;
      const steps = detailed ? sequence.length - Math.floor((value - .5) * 2 * sequence.length) : Math.floor((.5 - value) * 2 * sequence.length);
      const parent = Array.from({ length: size }, (_, i) => i);
      function find(id) { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; }
      for (let i = 0; i < steps; i++) { const [a,b] = sequence[i], x = find(a), y = find(b); if (x !== y) parent[y] = x; }
      const ids = new Map();
      return initial.map(id => { const root = find(id); if (!ids.has(root)) ids.set(root, ids.size); return ids.get(root); });
    }
    return { groups, coarseSteps: coarseMerges.length, fineSteps: fineMerges.length, fineEvidence: fineValid };
  }

  function analyze(raw, settings = {}, progress = () => {}) {
    const granularity = settings.granularity ?? .5;
    if (!Number.isFinite(granularity) || granularity < 0 || granularity > 1) throw Error('分区粒度须为 0～1。');
    const smoothing = settings.csiSmoothing ?? .5;
    if (!Number.isFinite(smoothing) || smoothing < 0 || smoothing > 1) throw Error('CSI 拟合平滑须为 0～1。');
    const source = E.validate(raw);
    const sourceFingerprint = E.fingerprint(source);
    // 图片像素只在工作线程内采样，不进入持久结果，避免RGBA逐字节JSON化导致导出膨胀。
    const {textureImage, ...persistentSettings}=settings;
    const options = E.settingsFor(persistentSettings);
    const work = E.prepareWorkingSource(source, progress);
    const analysisSource = work.source;
    progress('分析高模的四档边界');
    const boundary = E.detect(analysisSource, options, progress);
    options.manualEdges = (options.manualEdges || []).filter(key => E.topology(analysisSource).edges.has(key));
    const guides = E.analyzeBoundaryGuides(work.analysisProxy ? analysisSource : source, boundary, options, progress);
    if (E.fingerprint(raw) !== sourceFingerprint) throw Error('原始模型意外改变。');
    const result = {
      schema: 'retop/csi-partition', version: 1, name: raw.name || '导入模型',
      source, sourceFingerprint, analysisSource,
      analysisFingerprint: E.fingerprint(analysisSource),
      analysisProxy: { enabled: work.analysisProxy, raw: work.rawStats, clean: work.cleanStats,
        working: { vertices: work.health.vertices, faces: work.health.faces, triangles: work.health.triangles } },
      settings: options, boundary, guides
    };
    const partitioned = repartition(result, granularity, progress);
    if (settings.textureImage && (settings.textureStrength ?? 0)>0) return applyTexture(partitioned,settings.textureImage,settings.textureStrength,progress,smoothing);
    return applySmoothing(partitioned, smoothing, progress);
  }

  function applyTexture(previous, image, strength, progress=()=>{}, smoothing=previous.csiSmoothing??.5) {
    const factory=typeof createCSITextureEvidence==='function'?createCSITextureEvidence:require('./texture-evidence.js'),api=factory(E);
    const evidence=image?api.sample(previous.source,previous.analysisSource,image,progress):previous.textureEvidence;
    if(!evidence)throw Error('请先导入与模型UV对应的贴图。');
    if(evidence.analysisFingerprint!==previous.analysisFingerprint)throw Error('贴图证据与分析模型不匹配。');
    const baseline=previous.textureBase||previous.guides.scales[2].proposal;
    const refined=api.segment(previous.analysisSource,baseline.patchGroups,evidence.colors,strength,previous.granularity??.5);
    progress('按贴图和几何证据细分小结构');
    const input={...previous,guides:{...previous.guides,scales:previous.guides.scales.map((s,i)=>i===2?{...s,proposal:baseline}:s)}};
    delete input.granularityBase;delete input.postprocess;
    const result=repartition(input,previous.granularity??.5,progress,refined.groups);
    return applySmoothing({...result,textureBase:baseline,textureEvidence:evidence,textureReport:{added:refined.added,coverage:evidence.coverage},settings:{...result.settings,textureStrength:strength}},smoothing,progress);
  }

  function applySmoothing(previous, strength, progress = () => {}) {
    const factory = typeof createCSIBoundaryPostprocess === 'function' ? createCSIBoundaryPostprocess : require('./postprocess.js');
    progress('拟合并平滑共享 CSI 边界');
    const output = factory(E).run(previous.analysisSource, previous.guides.scales[2].proposal, strength, progress,
      { scale:previous.guides.scale, field:previous.guides.scales[2].field, manualEdges:previous.settings?.manualEdges });
    return { ...previous, settings: { ...previous.settings, csiSmoothing:strength }, csiSmoothing:strength,
      boundaryDisplay:{ representation:strength > 0 ? 'csi-curves' : 'mesh-edges', projection:'analytic', version:1 },
      postprocess: { ...output, ...(output.faceSources ? { topologyVersion:2 } : {}), meshFingerprint:E.fingerprint(output.mesh) } };
  }

  function repartition(previous, value, progress = () => {}, overrideGroups = null) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('分区粒度须为 0～1。');
    // 旧文件和重算结果都保留原始中尺度；避免在已合并结果上重复合并而改变层级。
    const baseline = previous.granularityBase || previous.guides.scales[2].proposal;
    const settings = { ...previous.settings, granularity: value };
    if (value === .5 && !overrideGroups) {
      const scales = previous.guides.scales.map((scale, index) => index === 2 ? { ...scale, proposal: baseline } : scale);
      const guides = { ...previous.guides, scales };
      if (previous.granularityBase) {
        const factory = typeof createContourBoundaryGuides === 'function' ? createContourBoundaryGuides : require('../contour-lab-3d/boundary-guides.js');
        guides.layers = factory(E).boundaryLayers(previous.analysisSource, guides);
      }
      const result = { ...previous, settings, granularity: value, guides, ...(previous.granularityBase ? { granularityBase: baseline } : {}) };
      return previous.postprocess ? applySmoothing(result, previous.csiSmoothing ?? .5, progress) : result;
    }
    progress('按粒度调整 CSI 分区');
    const mesh = previous.analysisSource, topology = E.topology(mesh);
    const levels = hierarchy(mesh, baseline.patchGroups, previous.guides.scales[3]?.proposal?.patchGroups);
    const groups = overrideGroups || levels.groups(value), factory = typeof createContourBoundaryGuides === 'function' ? createContourBoundaryGuides : require('../contour-lab-3d/boundary-guides.js');
    const api = factory(E), scale = previous.guides.scale, keys = [];
    for (const [key, edge] of topology.edges) if (edge.faces.length === 1 || edge.faces.length === 2 && groups[edge.faces[0]] !== groups[edge.faces[1]]) keys.push(key);
    const graph = api.chains(mesh, keys, topology), chains = api.interfaceChains(mesh, keys, topology, groups);
    const evidence = new Set([...(baseline.rawKeys || []), ...(previous.guides.scales[3]?.proposal?.rawKeys || [])]);
    for (const chain of chains) { chain.role = 'major'; chain.supportedEdges = chain.edges.filter(key => evidence.has(key)).length; }
    const patchArea = new Map();
    groups.forEach((id, face) => patchArea.set(id, (patchArea.get(id) || 0) + topology.data[face].area));
    const patches = [...patchArea].map(([id, area]) => ({ id, area, relativeArea: area / (scale * scale) }));
    const report = { enabled: true, inferred: true, seedEdges: evidence.size, patches: patches.length, edges: keys.length,
      endpoints: graph.nodes.filter(node => node.kind === 'endpoint').length, junctions: graph.nodes.filter(node => node.kind === 'junction').length,
      surfaceContrastSplits: [], granularity: value, coarseSteps: levels.coarseSteps, fineSteps: levels.fineSteps, fineEvidence: levels.fineEvidence,
      method: '同一基准分区上按连续粒度沿相邻边合并或依照细尺度证据细分' };
    const network = { keys, groups, patches, chains, nodes: graph.nodes, report };
    const proposal = api.fitNetwork(mesh, topology, network, {
      scale, tolerance: scale * (settings.guideVectorTolerance ?? .006), cornerAngle: settings.guideCornerAngle ?? 55,
      regularization: settings.guideRegularization ?? .01, field: previous.guides.scales[2].field,
      fieldStrength: settings.guideFieldStrength ?? 1, manualEdges: settings.manualEdges || [],
      localScaleFitting: settings.guideBoundaryLocalScale === true, curveFairing: settings.guideCurveFairing === true,
      internalSmoothing: settings.internalCSISmoothing ?? 0
    });
    const scales = previous.guides.scales.map((entry, index) => index === 2 ? { ...entry, proposal } : entry);
    const guides = { ...previous.guides, scales };
    guides.layers = api.boundaryLayers(mesh, guides);
    const result = { ...previous, settings, granularity: value, granularityBase: baseline, guides };
    return previous.postprocess ? applySmoothing(result, previous.csiSmoothing ?? .5, progress) : result;
  }

  function restore(data) {
    if (!data || data.schema !== 'retop/csi-partition' || data.version !== 1) throw Error('不是支持的 CSI 分区结果。');
    const source = E.validate(data.source), analysis = E.validate(data.analysisSource);
    if (E.fingerprint(source) !== data.sourceFingerprint || E.fingerprint(analysis) !== data.analysisFingerprint ||
        data.boundary?.sourceFingerprint !== data.analysisFingerprint) throw Error('源模型或分析网格指纹不匹配。');
    const proposal = data.guides?.scales?.[2]?.proposal;
    if(data.textureEvidence){
      const ev=data.textureEvidence;
      if(ev.version!==1||ev.analysisFingerprint!==data.analysisFingerprint||!Array.isArray(ev.colors)||ev.colors.length!==analysis.faces.length||ev.colors.some(c=>c!==null&&(!Array.isArray(c)||c.length!==3||c.some(v=>!Number.isFinite(v)||v<0||v>1)))||!Number.isFinite(ev.coverage)||ev.coverage<0||ev.coverage>1)throw Error('贴图颜色证据无效。');
      if(!Number.isFinite(data.settings?.textureStrength)||data.settings.textureStrength<0||data.settings.textureStrength>1)throw Error('贴图参与强度无效。');
      if(!Array.isArray(data.textureBase?.patchGroups)||data.textureBase.patchGroups.length!==analysis.faces.length||data.textureBase.patchGroups.some(id=>!Number.isInteger(id)||id<0))throw Error('贴图细分基线无效。');
    }
    if (!proposal || !Array.isArray(proposal.patchGroups) || proposal.patchGroups.length !== analysis.faces.length ||
        proposal.patchGroups.some(group => !Number.isInteger(group) || group < 0)) throw Error('分区结果与分析网格不匹配。');
    if (data.granularity !== undefined && (!Number.isFinite(data.granularity) || data.granularity < 0 || data.granularity > 1)) throw Error('分区粒度须为 0～1。');
    if (data.csiSmoothing !== undefined && (!Number.isFinite(data.csiSmoothing) || data.csiSmoothing < 0 || data.csiSmoothing > 1)) throw Error('CSI 拟合平滑须为 0～1。');
    if (data.boundaryDisplay && (data.boundaryDisplay.version !== 1 || data.boundaryDisplay.projection !== 'analytic' ||
        !['csi-curves','mesh-edges'].includes(data.boundaryDisplay.representation))) throw Error('不支持的 CSI 曲线显示格式。');
    // 旧 JSON 可以没有显示声明，实际使用的拟合网络均需包含可绘制的有限坐标。
    const regionIds = new Set(proposal.patchGroups);
    if (data.reviewGuides) {
      const review=data.reviewGuides, point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
      if (review.version!==1 || review.analysisFingerprint!==data.analysisFingerprint || !Array.isArray(review.curves) ||
          review.curves.some(curve=>!['I','C','S'].includes(curve.type) || !['p0','p1','p2','p3'].every(key=>point(curve[key])) ||
            !Array.isArray(curve.samples) || curve.samples.length<2 || !curve.samples.every(point) ||
            curve.displaySamples!==undefined && (!Array.isArray(curve.displaySamples)||curve.displaySamples.length<2||!curve.displaySamples.every(point)))) {
        throw Error('审查导线的分析指纹或曲线坐标无效。');
      }
    }
    for (const network of [proposal,data.postprocess?.fittedNetwork].filter(Boolean)) {
      if (!Array.isArray(network.curves) || network.curves.some(curve => !['I','C','S'].includes(curve.type) ||
          ['p0','p1','p2','p3'].some(key => !Array.isArray(curve[key]) || curve[key].length !== 3 || !curve[key].every(Number.isFinite)) ||
          !Array.isArray(curve.samples) || curve.samples.length < 2 ||
          [curve.samples,curve.displaySamples ?? curve.samples].some(points => !Array.isArray(points) || points.length < 2 ||
            points.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))) ||
          curve.regionPair?.some(id => !regionIds.has(id)))) throw Error('CSI 曲线控制点、采样或相邻分区无效。');
    }
    if (data.postprocess) {
      const { mesh, meshFingerprint, topologyVersion, faceSources, patchGroups, boundaryKeys, curves, fittedNetwork } = data.postprocess;
      const processed = E.validate(mesh);
      if (E.fingerprint(processed) !== meshFingerprint || processed.vertices.length !== analysis.vertices.length) throw Error('后处理网格与分析网格不匹配。');
      if (!Array.isArray(boundaryKeys) || !Array.isArray(curves)) throw Error('后处理边界数据不完整。');
      if (topologyVersion === 2) {
        // 通过同区原面索引验证新面标签，再从实际拓扑核对黄线和拟合网络的边集。
        if (!Array.isArray(faceSources) || !Array.isArray(patchGroups) || faceSources.length !== processed.faces.length ||
            patchGroups.length !== processed.faces.length || faceSources.some((source,i) => !Number.isInteger(source) ||
              source < 0 || source >= analysis.faces.length || patchGroups[i] !== proposal.patchGroups[source]) ||
            new Set(patchGroups).size !== new Set(proposal.patchGroups).size) throw Error('后处理面来源或分区标签不匹配。');
        const edges = E.topology(processed).edges, actual = new Set(boundaryKeys);
        const expected = [...edges].filter(([,edge]) => edge.faces.length === 1 ||
          edge.faces.length === 2 && patchGroups[edge.faces[0]] !== patchGroups[edge.faces[1]]);
        if (expected.length !== boundaryKeys.length || expected.some(([key]) => !actual.has(key)) ||
            fittedNetwork?.rawKeys?.length !== boundaryKeys.length || fittedNetwork.rawKeys.some((key,i) => key !== boundaryKeys[i]) ||
            fittedNetwork?.patchGroups?.length !== patchGroups.length || fittedNetwork.patchGroups.some((id,i) => id !== patchGroups[i]) ||
            curves.some(curve => !Array.isArray(curve.sourceEdges) || curve.sourceEdges.some(key => !actual.has(key)))) throw Error('后处理边界与分区拓扑不匹配。');
      } else if (topologyVersion !== undefined || processed.faces.length !== analysis.faces.length ||
          processed.faces.some((face,i) => face.length !== analysis.faces[i].length || face.some((v,j) => v !== analysis.faces[i][j]))) {
        throw Error('后处理网格与分析网格不匹配。');
      }
    }
    return data;
  }
  return { analyze, restore, hierarchy, repartition, applySmoothing, applyTexture };
}
if (typeof module !== 'undefined') module.exports = createCSIPartition;
if (typeof window !== 'undefined') window.createCSIPartition = createCSIPartition;

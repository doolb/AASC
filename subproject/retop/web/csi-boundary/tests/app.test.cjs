const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../../contour-lab-3d/engine.js')();

test('导入结果通过独立 CSI 模式显示完整拟合网络，原始对照和零强度切换回网格边', async () => {
  // 用轻量 DOM 和绘制适配器检查网页正常导入入口，几何拟合由 partition 自测覆盖。
  const elements = new Map();
  const element = () => ({ value:'0.5', valueAsNumber:.5, checked:false, listeners:{}, style:{},
    classList:{toggle() {}}, append() {}, replaceChildren() {}, checkValidity() { return true; },
    addEventListener(name,handler) { this.listeners[name] = handler; } });
  const get = id => {
    if (!elements.has(id)) elements.set(id,element());
    return elements.get(id);
  };
  let shown, mode, options, workerInstance, workerMessage;
  const viewer = { options(value) { options = value; }, setMode(value) { mode = value; },
    setData(value) { shown = value; }, view() {} };
  const mesh = E.cube();
  const proposal = { patchGroups:mesh.faces.map(()=>0), interfaces:[], curves:[], rawKeys:[], fittingReport:{}, report:{} };
  const curve = { type:'C', p0:[0,0,0], p1:[1,0,0], p2:[1,1,0], p3:[2,1,0] };
  const fitted = { ...proposal, curves:[curve], paths:[{id:'shared'}], nodes:[] };
  const data = { schema:'retop/csi-partition', source:mesh, analysisSource:mesh,
    name:'测试模型', analysisProxy:{enabled:false}, guides:{scales:[{}, {}, {proposal}]},
    csiSmoothing:.5, granularity:.5, postprocess:{mesh, boundaryKeys:[], curves:[curve], fittedNetwork:fitted,
      report:{mergedCorners:[],movedVertices:0,maximumDisplacementRelative:0}} };
  const window = { CSI_SHOULDER:mesh };
  const context = { window, document:{getElementById:get, createElement:element,
    createDocumentFragment:element, createTextNode:text=>text, querySelectorAll:()=>[]},
    createContour3D:()=>E, createCSIPartition:()=>({restore:value=>value}), createMeshViewer:()=>viewer,
    createContourBoundaryGuides() {}, createContourStructureGrid() {}, createCSIBoundaryPostprocess() {},
    createCSITextureEvidence:require('../texture-evidence.js'),
    Blob, URL:{createObjectURL:()=> 'blob:test', revokeObjectURL() {}},
    Worker:class { constructor(){workerInstance=this;} postMessage(value) {workerMessage=value;} terminate() {} }, setTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'),'utf8'),context);
  window.csiPartitionApp.cancel();
  const load = value => window.csiPartitionApp.loadFile({name:'result.json',size:100,text:async()=>JSON.stringify(value)});
  await load(data);
  assert.equal(mode,'curves',get('status').textContent);
  assert.equal(options.projectGuideDisplay,false);
  assert.equal(options.showGuidePartitions,true);
  assert.equal(options.showGuideField,false);
  assert.deepEqual(structuredClone(shown.guides.scales[2].proposal.curves),data.postprocess.fittedNetwork.curves);
  assert.deepEqual(structuredClone(shown.guides.scales[2].proposal.nodes),[]);
  assert.match(get('proxyInfo').textContent,/红色 CSI/);
  const review = {version:1,curves:[{...curve,id:'eye-guide',role:'review-guide'}]};
  await load({...data,reviewGuides:review});
  assert.equal(shown.guides.scales[2].proposal.curves.length,2,'审查导线应追加到显示网络');
  assert.equal(shown.guides.scales[2].proposal.curves[1].role,'review-guide');
  assert.match(get('proxyInfo').textContent,/青色/);
  assert.equal(shown.guides.scales[2].proposal.interfaces.length,0,'引导线不能增加分区接口');
  get('originalBoundary').checked = true;
  get('originalBoundary').listeners.change();
  assert.equal(mode,'groups');
  assert.deepEqual(structuredClone(shown.analysisSource),mesh);
  get('originalBoundary').checked = false;
  get('originalBoundary').listeners.change();
  assert.equal(mode,'curves');
  await load(data);
  await load({...data,csiSmoothing:0});
  assert.equal(mode,'groups');
  // 较早结果没有后处理网络时，使用它已有的完整识别曲线数据。
  await load({...data,postprocess:undefined,guides:{scales:[{}, {}, {proposal:fitted}]}});
  assert.equal(mode,'curves');
  assert.deepEqual(structuredClone(shown.guides.scales[2].proposal.curves),[curve]);
  // 已保存证据可以直接在当前结果上细分，工作线程回传后不能因source对象身份变化禁用入口。
  const textured={...data,settings:{textureStrength:.65},textureEvidence:{textureName:'test.png',coverage:1,colors:mesh.faces.map(()=>[.2,.3,.4])}};
  await load(textured);get('textureStrengthNumber').valueAsNumber=.8;get('granularityNumber').valueAsNumber=.9;
  get('textureApply').listeners.click();
  assert.equal(workerMessage.refine,true);assert.equal(workerMessage.textureStrength,.8);assert.equal(workerMessage.granularity,.9);
  assert.equal(workerMessage.previous,window.csiPartitionApp.result);
  workerInstance.onmessage({data:{result:structuredClone(textured)}});
  assert.equal(window.csiPartitionApp.source,window.csiPartitionApp.result.source);
  assert.equal(get('textureApply').disabled,false);
});

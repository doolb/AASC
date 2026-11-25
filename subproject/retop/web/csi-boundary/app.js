(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = createContour3D();
  const partition = createCSIPartition(E);
  const colors = ['#8cb8a3','#adbf94','#99adcc','#c2a896','#ab9cc4','#89babb','#c9ba87','#b89ea8'];
  let source = null, result = null, worker = null, request = 0, textureImage = null, textureRequest = 0;
  let viewer;
  try {
    viewer = createMeshViewer($('viewport'), E);
    viewer.options({ split:false, wire:false, boundary:true, smooth:false,
      guideReconstruction:true, showGuidePartitions:true, showGuideField:false,
      showGuideHandles:false, showGuideNodes:false, projectGuideDisplay:false, colorGuidePaths:true });
    viewer.setMode('groups');
  } catch (error) { setStatus('无法启动三维视图：' + error.message, true); }

  function setStatus(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  function controls() {
    const busy = !!worker;
    $('run').disabled = !source || busy || !viewer;
    $('shoulder').disabled = busy;
    $('file').disabled = busy;
    $('granularity').disabled = busy;
    $('granularityNumber').disabled = busy;
    $('csiSmoothing').disabled = busy;
    $('csiSmoothingNumber').disabled = busy;
    $('cancel').hidden = !busy;
    $('export').disabled = !result || busy;
    $('textureFile').disabled = busy;
    $('textureStrength').disabled = busy;
    $('textureStrengthNumber').disabled = busy;
    $('textureApply').disabled = busy || !result || source!==result.source || !(textureImage || result.textureEvidence);
  }
  function renderResult(data, keepView = false) {
    const original = $('originalBoundary').checked, processed = original ? null : data.postprocess;
    const proposal = data.guides.scales[2].proposal;
    const baseNetwork = processed?.fittedNetwork ?? proposal;
    // 审查导线独立保存，只追加到绘制副本，不参与面标签、接口统计或后续重新识别。
    const reviewCurves = !original && (data.csiSmoothing ?? .5)>0 ? data.reviewGuides?.curves ?? [] : [];
    const network = reviewCurves.length ? {...baseNetwork,
      curves:[...baseNetwork.curves,...reviewCurves.map(curve=>({...curve,role:'review-guide'}))]} : baseNetwork;
    const showCurves = !original && (data.csiSmoothing ?? .5) > 0 && network.curves?.length > 0;
    const displayGroups = processed?.patchGroups ?? proposal.patchGroups;
    const counts = new Map();
    for (const id of displayGroups) counts.set(id, (counts.get(id) || 0) + 1);
    const fragment = document.createDocumentFragment();
    for (const [id, count] of [...counts].sort((a, b) => a[0] - b[0])) {
      const row = document.createElement('div'); row.className = 'region-row';
      const title = document.createElement('span'), dot = document.createElement('i'), number = document.createElement('span');
      dot.className = 'dot'; dot.style.background = colors[id % colors.length]; title.append(dot, document.createTextNode('分区 ' + (id + 1)));
      number.textContent = count.toLocaleString() + ' 面'; row.append(title, number); fragment.append(row);
    }
    $('regions').replaceChildren(fragment);
    $('regionCount').textContent = counts.size.toLocaleString();
    $('interfaceCount').textContent = (processed?.fittedNetwork?.interfaces ?? proposal.interfaces).length.toLocaleString();
    $('faceCount').textContent = displayGroups.length.toLocaleString();
    $('resultTag').textContent = '候选结果';
    $('resultName').textContent = '当前结果：' + data.name;
    $('appliedGranularity').textContent = '结果粒度：' + (data.granularity ?? .5) + ' · CSI 平滑：' + (data.csiSmoothing ?? '未处理');
    if(data.textureEvidence) $('appliedGranularity').textContent += ' · 贴图：' + data.settings.textureStrength + ' · 映射命中 ' + (data.textureEvidence.coverage*100).toFixed(1) + '%';
    const sourceInfo = data.analysisProxy.enabled
      ? `内部分析代理 ${data.analysisSource.faces.length.toLocaleString()} 面，原模型 ${data.analysisProxy.raw.faces.toLocaleString()} 面。`
      : `原始分析网格 ${data.analysisSource.faces.length.toLocaleString()} 面。`;
    const post = data.postprocess?.report;
    const viewInfo = original ? ' 当前显示原始边界。'
      : showCurves ? ` 当前显示红色 CSI 平滑曲线，色块用于分区参考。合并 ${post?.mergedCorners?.length ?? 0} 处近角。`
      : post ? ' 当前显示网格分界，CSI 平滑为 0。'
      : ' 当前结果未进行边界后处理，重新识别后可应用。';
    $('proxyInfo').textContent = sourceInfo + viewInfo + (reviewCurves.length ? ' 青色为美术参考布线导线，不切分区域，仍待审查。' : '');
    const warnings = [];
    if (proposal.fittingReport.overTolerance) warnings.push(`${proposal.fittingReport.overTolerance} 段边界曲线超过拟合容差`);
    if (proposal.report.endpoints) warnings.push(`${proposal.report.endpoints} 个边界端点`);
    if (proposal.report.junctions) warnings.push(`${proposal.report.junctions} 个边界交汇点`);
    if (data.postprocess?.report.crossingFallback) warnings.push('后处理发现新增穿插，已回退原边界');
    if (data.postprocess?.report.rejectedVertices) warnings.push(`${data.postprocess.report.rejectedVertices} 个采样点未通过局部检查，已回退`);
    if (data.postprocess?.report.fitFallbacks?.length) warnings.push(`${data.postprocess.report.fitFallbacks.length} 段 CSI 拟合保留原结果`);
    if (data.postprocess?.report.fitOverTolerance) warnings.push(`后处理拟合有 ${data.postprocess.report.fitOverTolerance} 段超出目标容差`);
    if (!original && post?.rejectedCornerMerges?.length) warnings.push(`${post.rejectedCornerMerges.length} 处近角保留原交汇形状`);
    $('warning').hidden = warnings.length === 0;
    $('warning').textContent = warnings.join('；') + '。请检查这些候选。';
    // 复用旧网页的解析 CSI 导线及表面深度遮挡，色块显示当前分区的面标签。
    const displayMesh = processed?.mesh ?? data.analysisSource;
    const scales = data.guides.scales.map((entry,i) => i === 2 ? {
      ...entry, proposal:{ ...network, patchGroups:displayGroups, rawKeys:processed?.boundaryKeys ?? proposal.rawKeys }
    } : entry);
    viewer.setData({ ...data, guides:{ ...data.guides, scales }, analysisSource:displayMesh, levels:[null,null,{ mesh:displayMesh }] }, 2);
    viewer.setMode(showCurves ? 'curves' : 'groups');
    if (!keepView) viewer.view('angle');
    $('empty').hidden = true;
  }
  function workerScript() {
    return `const createContourBoundaryGuides=(${createContourBoundaryGuides.toString()});
      const createContourStructureGrid=(${createContourStructureGrid.toString()});
      const createContour3D=(${createContour3D.toString()});
      const createCSIBoundaryPostprocess=(${createCSIBoundaryPostprocess.toString()});
      const createCSIPartition=(${createCSIPartition.toString()});
      const createCSITextureEvidence=(${createCSITextureEvidence.toString()});
      onmessage=event=>{try{const E=createContour3D(),P=createCSIPartition(E),d=event.data,progress=message=>postMessage({progress:message});const result=d.refine?P.applyTexture({...d.previous,granularity:d.granularity},d.textureImage,d.textureStrength,progress,d.csiSmoothing):P.analyze(d.source,{granularity:d.granularity,csiSmoothing:d.csiSmoothing,textureImage:d.textureImage,textureStrength:d.textureStrength},progress);postMessage({result});}catch(error){postMessage({error:error.message});}};`;
  }
  function run(refine = false) {
    if (!source || worker || !viewer) return;
    try {
      if(refine&&(!result||source!==result.source))throw Error('当前模型已切换，请先识别当前模型。');
      const input = $('granularityNumber');
      if (!input.value || !input.checkValidity() || !Number.isFinite(input.valueAsNumber)) throw Error('分区粒度须为 0～1。');
      const granularity = input.valueAsNumber;
      const smoothInput = $('csiSmoothingNumber');
      if (!smoothInput.value || !smoothInput.checkValidity() || !Number.isFinite(smoothInput.valueAsNumber)) throw Error('CSI 拟合平滑须为 0～1。');
      const csiSmoothing = smoothInput.valueAsNumber;
      const textureStrength=$('textureStrengthNumber').valueAsNumber;
      if(!Number.isFinite(textureStrength)||textureStrength<0||textureStrength>1)throw Error('贴图参与强度须为0～1。');
      if(!refine&&textureStrength>0&&!textureImage)throw Error('重新识别需要导入颜色贴图；已有颜色证据请使用“在当前分区上细分”。');
      const url = URL.createObjectURL(new Blob([workerScript()], { type: 'text/javascript' }));
      worker = new Worker(url); URL.revokeObjectURL(url);
      worker.onmessage = event => {
        if (event.data.progress) { setStatus(event.data.progress); return; }
        const next = event.data.result;
        worker.terminate(); worker = null;
        try {
          if (event.data.error) throw Error(event.data.error);
          partition.restore(next); renderResult(next); result = next; source = next.source;
          setStatus('识别完成。分区与边界仍需人工复核。');
        } catch (error) { setStatus('识别失败：' + error.message, true); }
        controls();
      };
      worker.onerror = event => { worker.terminate(); worker = null; setStatus('识别失败：' + event.message, true); controls(); };
      worker.postMessage({ source:refine?undefined:source, previous:refine?result:undefined, refine, granularity, csiSmoothing, textureImage, textureStrength }); setStatus('正在准备分析网格…'); controls();
    } catch (error) { worker = null; setStatus('无法启动识别：' + error.message, true); controls(); }
  }
  function cancel() { if (!worker) return; worker.terminate(); worker = null; setStatus(result ? '已取消识别，保留上一次结果。' : '已取消识别。'); controls(); }
  function selectSource(mesh, name) {
    const checked = E.validate(mesh);
    source = { ...checked, name: name || checked.name || '导入模型' };
    textureImage=null;textureRequest++;$('textureName').textContent='选择与当前模型 UV 对应的颜色贴图。';
    $('textureStrength').value=0;$('textureStrengthNumber').value=0;
    $('modelName').textContent = source.name;
    setStatus(result ? '模型已就绪；当前显示上一次结果，点击开始识别以更新。' : '模型已就绪，点击开始识别。'); controls();
  }
  async function loadFile(file) {
    if (!file) return;
    const current = ++request;
    try {
      if (file.size > 256 * 1024 * 1024) throw Error('文件超过 256 MB，请按部件导出。');
      const extension = file.name.split('.').pop().toLowerCase();
      let mesh;
      if (extension === 'obj') mesh = E.parseOBJ(await file.text());
      else if (extension === 'stl') mesh = E.parseSTL(await file.arrayBuffer());
      else if (extension === 'json') {
        const data = JSON.parse(await file.text());
        if (current !== request) return;
        if (data.schema === 'retop/csi-partition') {
          const restored = partition.restore(data);
          renderResult(restored); result = restored; source = restored.source;
          textureImage=null;textureRequest++;
          $('textureStrength').value=restored.settings?.textureStrength??0;$('textureStrengthNumber').value=restored.settings?.textureStrength??0;
          $('textureName').textContent=restored.textureEvidence?restored.textureEvidence.textureName+'（已保存颜色证据，可直接调整强度）':'选择与当前模型 UV 对应的颜色贴图。';
          $('granularity').value = restored.granularity ?? .5; $('granularityNumber').value = restored.granularity ?? .5;
          $('csiSmoothing').value = restored.csiSmoothing ?? .5; $('csiSmoothingNumber').value = restored.csiSmoothing ?? .5;
          $('modelName').textContent = restored.name; setStatus('已读取分区结果。'); controls(); return;
        }
        mesh = data.mesh || data.source || data;
      } else throw Error('请选择 OBJ、STL 或 JSON 文件。');
      if (current === request) selectSource(mesh, file.name);
    } catch (error) { if (current === request) setStatus('导入失败：' + error.message, true); }
    finally { $('file').value = ''; }
  }
  async function shoulder() {
    const current = ++request;
    try {
      const data = window.CSI_SHOULDER || await (async () => {
        const response = await fetch('../contour-lab-3d/reference/shoulder.json');
        if (!response.ok) throw Error('无法读取内置肩甲，请使用打包后的网页或本地服务器。');
        return response.json();
      })();
      if (current === request) { selectSource(data, '原肩甲高模'); run(); }
    } catch (error) { setStatus('加载肩甲失败：' + error.message, true); }
  }
  function exportResult() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'csi-partition.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('file').addEventListener('change', event => loadFile(event.target.files[0]));
  $('shoulder').addEventListener('click', shoulder); $('run').addEventListener('click', () => run());
  $('textureApply').addEventListener('click', () => run(true));
  $('textureFile').addEventListener('change', async event => {
    const file=event.target.files[0],token=++textureRequest;if(!file)return;
    try{
      if(!source)throw Error('请先导入模型。');
      if(file.size>64*1024*1024)throw Error('贴图不能超过64 MB。');
      if(!createCSITextureEvidence(E).validUV(source))throw Error('当前文件没有原模型UV。请导入包含UV的原模型或完整结果；代理审查副本只能复用已保存颜色证据。');
      const bitmap=await createImageBitmap(file);
      const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const data=context.getImageData(0,0,canvas.width,canvas.height).data;
      if(token!==textureRequest)return;
      textureImage={name:file.name,width:canvas.width,height:canvas.height,data};
      $('textureName').textContent=file.name+' · '+canvas.width+' × '+canvas.height;
      $('textureStrength').value=.65;$('textureStrengthNumber').value=.65;
      setStatus('贴图已就绪。可在当前分区上细分，或重新识别模型。');controls();
    }catch(error){if(token===textureRequest)setStatus('贴图导入失败：'+error.message,true);}
    finally{$('textureFile').value='';}
  });
  for(const id of ['textureStrength','textureStrengthNumber'])$(id).addEventListener('input',event=>{
    const input=event.target,value=input.valueAsNumber;
    if(input.value&&Number.isFinite(value)&&value>=0&&value<=1){$(id==='textureStrength'?'textureStrengthNumber':'textureStrength').value=value;setStatus('贴图强度已更改，点击“在当前分区上细分”应用。');}
    else setStatus('贴图参与强度须为0～1。',true);
  });
  $('cancel').addEventListener('click', cancel); $('export').addEventListener('click', exportResult);
  function changeGranularity(event) {
    const input = event.target, value = input.valueAsNumber;
    if (input.value && Number.isFinite(value) && value >= 0 && value <= 1) {
      const other = input.id === 'granularity' ? $('granularityNumber') : $('granularity'); other.value = value;
      setStatus('粒度已更改，点击开始识别分区应用。');
    } else setStatus('分区粒度须为 0～1。', true);
  }
  $('granularity').addEventListener('input', changeGranularity);
  $('granularityNumber').addEventListener('input', changeGranularity);
  function changeSmoothing(event) {
    const input = event.target, value = input.valueAsNumber;
    if (input.value && Number.isFinite(value) && value >= 0 && value <= 1) {
      const other = input.id === 'csiSmoothing' ? $('csiSmoothingNumber') : $('csiSmoothing'); other.value = value;
      setStatus('CSI 平滑已更改，点击开始识别分区应用。');
    } else setStatus('CSI 拟合平滑须为 0～1。', true);
  }
  $('csiSmoothing').addEventListener('input', changeSmoothing);
  $('csiSmoothingNumber').addEventListener('input', changeSmoothing);
  $('originalBoundary').addEventListener('change', () => { if (result) renderResult(result, true); });
  $('wire').addEventListener('change', event => viewer.options({ wire: event.target.checked }));
  $('boundaries').addEventListener('change', event => viewer.options({ boundary: event.target.checked }));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    viewer.view(button.dataset.view); document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button));
  }));
  window.csiPartitionApp = { run, cancel, shoulder, loadFile, get source() { return source; }, get result() { return result; }, get busy() { return !!worker; }, get viewer() { return viewer; } };
  controls(); shoulder();
})();

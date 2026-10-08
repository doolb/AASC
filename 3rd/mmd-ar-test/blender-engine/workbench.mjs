import { BlenderRuntime } from '@volter/blender-engine/browser';
import { createPresenter } from '@volter/blender-engine/browser/three/release';

const VIRTUAL_PROJECT = '/mmd-ar-project';
const DATABASE = 'mmd-ar-blender-project';
const DATABASE_VERSION = 2;
const STORE = 'handles';
const HANDLE_KEY = 'active-project';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains('chunks')) request.result.createObjectStore('chunks');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法保存本地目录权限'));
  });
}

async function saveHandle(handle) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(handle, HANDLE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('无法保存本地目录权限'));
  });
  database.close();
}

function makePanel(container) {
  const panel = document.createElement('section');
  panel.id = 'mmdBlenderWorkbench';
  panel.innerHTML = `
    <header><strong>Blender 工程</strong><span id="mmdBlenderStatus" role="status">正在读取目录…</span>
      <button type="button" data-action="permission">重新授权目录</button>
      <button type="button" data-action="close">保存并返回</button></header>
    <nav>
      <select id="mmdBlenderDocument" aria-label="Blender 工程文件"></select>
      <button type="button" data-action="open">打开工程</button>
      <button type="button" data-action="save" disabled>保存</button>
      <button type="button" data-action="render" disabled>Cycles 渲染 PNG</button>
      <button type="button" data-action="download" disabled>下载 PNG</button>
    </nav>
    <section data-mode-panel="edit" hidden>
      <div class="mmdBlenderFields">
        <label>场景对象<select id="mmdBlenderObject"></select></label>
        <fieldset><legend>对象变换</legend><div class="mmdBlenderVectors" data-fields="object"></div></fieldset>
        <button type="button" data-action="apply-object" disabled>应用对象变换</button>
        <label>骨架<select id="mmdBlenderArmature"></select></label>
        <label>骨骼<select id="mmdBlenderBone"></select></label>
        <label>编辑内容<select id="mmdBlenderBoneMode"><option value="pose">姿态</option><option value="rest">骨架结构</option></select></label>
        <div data-bone-panel="pose">
          <fieldset><legend>姿态变换</legend><div class="mmdBlenderVectors" data-fields="pose"></div></fieldset>
          <button type="button" data-action="apply-pose" disabled>应用姿态</button>
        </div>
        <div data-bone-panel="rest" hidden>
          <fieldset><legend>骨架结构（局部坐标）</legend><div class="mmdBlenderVectors" data-fields="head-tail"></div>
            <label>Roll（度）<input id="mmdBlenderRoll" type="number" step="any"></label>
            <label>父骨骼<select id="mmdBlenderParent"></select></label>
          </fieldset>
          <button type="button" data-action="apply-rest" disabled>应用骨架结构</button>
          <small>骨架结构修改后回到对象模式并刷新主视口。</small>
        </div>
      </div>
    </section>
    <section data-mode-panel="preview" class="mmdBlenderNote">Blender 角色正在使用 MMD-AR 主视口的相机、灯光和渲染器。请使用页面视口交互进行预览。</section>
    <section data-mode-panel="render" hidden><img id="mmdBlenderRender" alt="Cycles 渲染结果" hidden></section>
  `;
  const style = document.createElement('style');
  style.textContent = `
    #mmdBlenderWorkbench{color:#edf2fa;font:13px system-ui;display:grid;gap:7px}
    #mmdBlenderWorkbench header,#mmdBlenderWorkbench nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    #mmdBlenderWorkbench header span{flex:1;min-width:180px;color:#bfcaff;font-size:12px}
    #mmdBlenderWorkbench button,#mmdBlenderWorkbench select{background:#242936;color:inherit;border:1px solid #525d73;border-radius:5px;padding:7px;font:inherit}
    #mmdBlenderWorkbench button:disabled{opacity:.45}
    #mmdBlenderWorkbench [data-mode-panel]{border-top:1px solid #536078;padding-top:8px}
    #mmdBlenderWorkbench .mmdBlenderFields{display:grid;gap:6px}
    #mmdBlenderWorkbench label{display:inline-flex;align-items:center;gap:6px;margin:3px 6px 3px 0}
    #mmdBlenderWorkbench fieldset{border:1px solid #536078;border-radius:5px;margin:6px 0;padding:6px}
    #mmdBlenderWorkbench legend,#mmdBlenderWorkbench small{color:#aebfd4}
    #mmdBlenderWorkbench .mmdBlenderVectors{display:grid;grid-template-columns:repeat(3,minmax(54px,1fr));gap:4px;max-width:320px}
    #mmdBlenderWorkbench .mmdBlenderVectors[data-fields]{display:block;max-width:none}
    #mmdBlenderWorkbench input{width:100%;min-width:0;background:#242936;color:inherit;border:1px solid #525d73;border-radius:5px;padding:6px;box-sizing:border-box;font:inherit}
    #mmdBlenderWorkbench img{display:block;max-width:100%;max-height:60vh;object-fit:contain;background:#111722}
    #mmdBlenderWorkbench [hidden]{display:none!important}
  `;
  document.head.append(style);
  container.append(panel);
  return { panel, style };
}

const py = value => JSON.stringify(String(value));
const numeric = (root, name, fallback = [0, 0, 0]) => {
  const row = root?.groups?.flatMap(group => group.rows).find(item => item.identifier === name);
  return Array.isArray(row?.value) ? [...row.value] : fallback;
};
const numberFields = (container, prefix, labels = ['X', 'Y', 'Z']) => {
  container.replaceChildren(...labels.map((label, index) => {
    const input = document.createElement('input');
    input.type = 'number'; input.step = 'any'; input.dataset.vector = prefix; input.dataset.index = index;
    input.setAttribute('aria-label', `${prefix} ${label}`);
    return input;
  }));
};
function flatten(rows, output = [], depth = 0) {
  for (const row of rows || []) {
    output.push({ row, depth });
    flatten(row.children, output, depth + 1);
  }
  return output;
}
function resultText(result) {
  if (typeof result === 'string' && result.startsWith('Error executing code:')) throw new Error(result);
  return typeof result === 'string' ? result.replace(/^Code executed successfully:\s*/u, '') : String(result ?? '');
}

async function *walkDirectory(directory, prefix = '') {
  for await (const [name, entry] of directory.entries()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') yield * walkDirectory(entry, relative);
    else if (relative.toLowerCase().endsWith('.blend')) yield relative;
  }
}

function waitForWorkerActivation(worker) {
  if (worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('Blender 工程适配器更新失败'));
    };
    const timeout = setTimeout(() => finish(new Error('Blender 工程适配器更新超时，请刷新页面重试')), 15000);
    worker.addEventListener('statechange', changed);
    changed();
  });
}

async function waitForWorkerController(registration) {
  await registration.update();
  const candidate = registration.installing || registration.waiting;
  if (candidate) await waitForWorkerActivation(candidate);
  else await navigator.serviceWorker.ready;
  const active = registration.active;
  if (!active) throw new Error('Blender 工程适配器没有活动 worker');
  if (navigator.serviceWorker.controller === active) return;
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (navigator.serviceWorker.controller === active) finish();
    };
    const timeout = setTimeout(() => finish(new Error('浏览器没有接管最新的 Blender 工程请求')), 15000);
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    changed();
  });
}

function setStatus(node, message) {
  node.textContent = message;
}

export async function mountBlenderWorkbench(directory, options = {}) {
  const { displayBridge, container, onClosed = () => {}, onStart = async () => {}, onModeChange = () => {} } = options;
  if (!window.isSecureContext || !navigator.serviceWorker || !window.showDirectoryPicker)
    throw new Error('Blender 工程需要 HTTPS 桌面 Chromium 和目录读写权限');
  if (!displayBridge?.attachExternalCharacter || !container?.append)
    throw new Error('MMD-AR 主视口或 Blender 编辑面板尚未就绪');

  await saveHandle(directory);
  const projectUrl = new URL('./', window.location.href);
  const registration = await navigator.serviceWorker.register(new URL('web-blender-service-worker.js', projectUrl), {
    scope: projectUrl.pathname,
  });
  await waitForWorkerController(registration);

  const { panel, style } = makePanel(container);
  const status = panel.querySelector('#mmdBlenderStatus');
  const select = panel.querySelector('#mmdBlenderDocument');
  const renderImage = panel.querySelector('#mmdBlenderRender');
  const buttons = new Map([...panel.querySelectorAll('[data-action]')].map(button => [button.dataset.action, button]));
  let runtime = null;
  let presenter = null;
  let attachedCharacter = null;
  let rows = [];
  let selectedObject = null;
  let selectedArmature = null;
  let selectedBone = null;
  let mode = 'preview';
  let renderUrl = '';
  let busy = false;
  let opened = false;
  const activeRenderUrl = () => {
    if (!renderUrl) return;
    URL.revokeObjectURL(renderUrl);
    renderUrl = '';
  };

  const setMode = next => {
    if (!['edit', 'preview', 'render'].includes(next)) return;
    mode = next;
    for (const section of panel.querySelectorAll('[data-mode-panel]')) section.hidden = section.dataset.modePanel !== mode;
    onModeChange(mode);
  };
  const dispose = async flush => {
    if (flush && runtime) {
      setStatus(status, '正在保存 Blender 工程…');
      await runtime.stop();
    } else runtime?.terminate();
    attachedCharacter?.restore();
    attachedCharacter = null;
    presenter?.dispose();
    presenter = runtime = null;
    activeRenderUrl();
    panel.remove();
    style.remove();
    await onClosed();
  };

  const fillSelect = (node, items, emptyLabel) => {
    node.replaceChildren();
    if (!items.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = emptyLabel; node.append(option); node.disabled = true; return;
    }
    for (const item of items) {
      const option = document.createElement('option'); option.value = item.value;
      option.textContent = `${'　'.repeat(item.depth || 0)}${item.label}`; node.append(option);
    }
    node.disabled = false;
  };
  const objectItems = () => rows.filter(item => item.row.objectType).map(({ row, depth }) => ({ value: row.name, label: `${row.name} · ${row.objectType}`, depth, row }));
  const armatureItems = () => objectItems().filter(item => item.row.objectType === 'ARMATURE');
  const bonesFor = armatureName => {
    const armature = armatureItems().find(item => item.value === armatureName)?.row;
    if (!armature) return [];
    const direct = flatten(armature.children).filter(item => item.row.type === 'TSE_BONE');
    return direct.map(({ row, depth }) => ({ value: row.name, label: row.name, depth: Math.max(0, depth - 2), row }));
  };
  const refreshTrees = async () => {
    const tree = await runtime.outliner(); rows = flatten(tree.rows);
    const objects = objectItems(), armatures = armatureItems();
    fillSelect(panel.querySelector('#mmdBlenderObject'), objects, '场景没有对象');
    fillSelect(panel.querySelector('#mmdBlenderArmature'), armatures, '场景没有骨架');
    if (!objects.some(item => item.value === selectedObject)) selectedObject = objects[0]?.value || null;
    if (!armatures.some(item => item.value === selectedArmature)) selectedArmature = armatures[0]?.value || null;
    panel.querySelector('#mmdBlenderObject').value = selectedObject || '';
    panel.querySelector('#mmdBlenderArmature').value = selectedArmature || '';
    const bones = bonesFor(selectedArmature);
    fillSelect(panel.querySelector('#mmdBlenderBone'), bones, '骨架没有骨骼');
    if (!bones.some(item => item.value === selectedBone)) selectedBone = bones[0]?.value || null;
    panel.querySelector('#mmdBlenderBone').value = selectedBone || '';
    buttons.get('apply-object').disabled = !selectedObject;
    buttons.get('apply-pose').disabled = !selectedArmature || !selectedBone;
    buttons.get('apply-rest').disabled = !selectedArmature || !selectedBone;
  };
  const objectPath = name => objectItems().find(item => item.value === name)?.row.path;
  const readVectors = async () => {
    if (selectedObject) {
      const view = await runtime.rna(objectPath(selectedObject));
      const specs = [['location', 'object-location', 3, 1], ['rotation_euler', 'object-rotation', 3, 180 / Math.PI], ['scale', 'object-scale', 3, 1]];
      for (const [property, prefix, count, factor] of specs) {
        const values = numeric(view, property, property === 'scale' ? [1, 1, 1] : [0, 0, 0]);
        for (let index = 0; index < count; index++) panel.querySelector(`[data-vector="${prefix}"][data-index="${index}"]`).value = (values[index] ?? 0) * factor;
      }
    }
    if (selectedArmature && selectedBone) {
      const path = `${objectPath(selectedArmature)}.pose.bones[${py(selectedBone)}]`;
      const view = await runtime.rna(path);
      for (const [property, prefix, factor, fallback] of [['location', 'pose-location', 1, [0,0,0]], ['rotation_euler', 'pose-rotation', 180 / Math.PI, [0,0,0]], ['scale', 'pose-scale', 1, [1,1,1]]]) {
        const values = numeric(view, property, fallback);
        for (let index = 0; index < 3; index++) panel.querySelector(`[data-vector="${prefix}"][data-index="${index}"]`).value = (values[index] ?? 0) * factor;
      }
      if (panel.querySelector('#mmdBlenderBoneMode').value === 'rest') await readRestBone();
    }
  };
  const vector = prefix => [...panel.querySelectorAll(`[data-vector="${prefix}"]`)].map(input => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error('坐标和变换值必须是有限数字');
    return value;
  });
  const readRestBone = async () => {
    const code = `import json\nobj = bpy.data.objects.get(${py(selectedArmature)})\nif obj is None or obj.type != 'ARMATURE': raise RuntimeError('骨架对象无效')\nold_active = bpy.context.view_layer.objects.active\nold_selected = [o for o in bpy.context.selected_objects]\ntry:\n    if bpy.context.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')\n    for o in bpy.context.selected_objects: o.select_set(False)\n    obj.select_set(True)\n    bpy.context.view_layer.objects.active = obj\n    bpy.ops.object.mode_set(mode='EDIT')\n    bone = obj.data.edit_bones.get(${py(selectedBone)})\n    if bone is None: raise RuntimeError('骨骼不存在')\n    print(json.dumps({'head': list(bone.head), 'tail': list(bone.tail), 'roll': bone.roll, 'parent': bone.parent.name if bone.parent else ''}))\nfinally:\n    if obj.mode == 'EDIT': bpy.ops.object.mode_set(mode='OBJECT')\n    for o in bpy.context.selected_objects: o.select_set(False)\n    for o in old_selected:\n        if o.name in bpy.context.view_layer.objects: o.select_set(True)\n    if old_active and old_active.name in bpy.context.view_layer.objects: bpy.context.view_layer.objects.active = old_active`;
    const raw = resultText(await runtime.execute(code, false, '读取骨骼结构'));
    const match = raw.match(/\{[^\n]*\}/u);
    if (!match) throw new Error(`无法读取骨骼结构：${raw}`);
    const data = JSON.parse(match[0]);
    for (const [prefix, values] of [['head', data.head], ['tail', data.tail]]) values.forEach((value, index) => panel.querySelector(`[data-vector="${prefix}"][data-index="${index}"]`).value = value);
    panel.querySelector('#mmdBlenderRoll').value = Number(data.roll || 0) * 180 / Math.PI;
    const parents = bonesFor(selectedArmature).filter(item => item.value !== selectedBone);
    fillSelect(panel.querySelector('#mmdBlenderParent'), [{ value: '', label: '(无父级)' }, ...parents], '没有可选父骨骼');
    panel.querySelector('#mmdBlenderParent').value = data.parent || '';
  };

  try {
    for await (const path of walkDirectory(directory)) {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = path;
      select.append(option);
    }
  } catch (error) { panel.remove(); style.remove(); throw error; }
  if (!select.options.length) {
    setStatus(status, '所选目录没有 .blend 文件。请选择包含 Blender 工程的目录。');
    buttons.get('open').disabled = true;
  } else setStatus(status, `找到 ${select.options.length} 个 .blend 工程；选择后才下载和启动 Blender。`);

  const withBusy = async (work) => {
    if (busy) return;
    busy = true;
    try { await work(); }
    catch (error) { setStatus(status, error?.message || String(error)); }
    finally { busy = false; }
  };
  buttons.get('save').disabled = true;
  buttons.get('render').disabled = true;
  buttons.get('download').disabled = true;

  for (const prefix of ['object-location','object-rotation','object-scale','pose-location','pose-rotation','pose-scale','head','tail']) {
    const holder = panel.querySelector(`[data-fields="${prefix.startsWith('object-') ? 'object' : prefix.startsWith('pose-') ? 'pose' : 'head-tail'}"]`);
    const title = document.createElement('label'); title.textContent = `${prefix.replace(/^(object|pose)-/u, '').replace('-', ' ')} `;
    const fields = document.createElement('span'); fields.className = 'mmdBlenderVectors'; numberFields(fields, prefix); title.append(fields); holder.append(title);
  }
  for (const [id, label] of [['object-location','位置'],['object-rotation','旋转（度）'],['object-scale','缩放'],['pose-location','位置'],['pose-rotation','旋转（度）'],['pose-scale','缩放'],['head','头部'],['tail','尾部']]) {
    const field = panel.querySelector(`[data-vector="${id}"]`)?.closest('label'); if (field) field.firstChild.textContent = `${label} `;
  }

  buttons.get('open').onclick = () => withBusy(async () => {
    if (runtime) throw new Error('请先关闭当前工程，再重新选择工程目录');
    const permission = await directory.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('需要授予所选目录读写权限才能打开并保存工程');
    setStatus(status, '正在按需下载 Blender 引擎与约 38 MB 的压缩核心运行资源…');
    const relativePath = select.value;
    let started = false;
    try {
      const previewCanvas = new OffscreenCanvas(1, 1);
      presenter = createPresenter({ canvas: previewCanvas });
      runtime = new BlenderRuntime({
        stage: part => presenter.view.stageFrame(part),
        present: async (frame, description, capture) => {
          const answer = await presenter.present(frame, description, capture);
          attachedCharacter?.refresh();
          return answer;
        },
        log: (_level, text) => {
          if (text.startsWith('@@VOLTER-WORK')) setStatus(status, '正在读取 Blender 与工程资源…');
          else if (text.startsWith('@@VOLTER-READY')) setStatus(status, 'Blender 已启动，正在打开工程…');
        },
        documentMoved: ({ document: nextPath }) => setStatus(status, `Blender 工程已切换到 ${nextPath}`),
      });
      started = true; await onStart();
      await runtime.start(VIRTUAL_PROJECT, relativePath);
      await runtime.present();
      attachedCharacter = displayBridge.attachExternalCharacter(presenter.view.root);
      buttons.get('open').disabled = true;
      buttons.get('save').disabled = false;
      buttons.get('render').disabled = false;
      setStatus(status, `已打开 ${relativePath}。工程文件保存在所选目录。`);
      await refreshTrees();
      await readVectors();
      setMode('preview');
      opened = true;
    } catch (error) {
      if (!opened) runtime?.terminate();
      attachedCharacter?.restore(); attachedCharacter = null;
      presenter?.dispose();
      presenter = runtime = null;
      buttons.get('open').disabled = false;
      buttons.get('save').disabled = true;
      buttons.get('render').disabled = true;
      if (started) await onClosed();
      throw error;
    }
  });

  panel.querySelector('#mmdBlenderObject').onchange = () => withBusy(async () => { selectedObject = panel.querySelector('#mmdBlenderObject').value; await readVectors(); });
  panel.querySelector('#mmdBlenderArmature').onchange = () => withBusy(async () => { selectedArmature = panel.querySelector('#mmdBlenderArmature').value; selectedBone = bonesFor(selectedArmature)[0]?.value || null; await refreshTrees(); await readVectors(); });
  panel.querySelector('#mmdBlenderBone').onchange = () => withBusy(async () => { selectedBone = panel.querySelector('#mmdBlenderBone').value; await readVectors(); });
  panel.querySelector('#mmdBlenderBoneMode').onchange = () => withBusy(async () => {
    const rest = panel.querySelector('#mmdBlenderBoneMode').value === 'rest';
    for (const section of panel.querySelectorAll('[data-bone-panel]')) section.hidden = section.dataset.bonePanel !== (rest ? 'rest' : 'pose');
    if (rest) await readRestBone();
  });
  buttons.get('apply-object').onclick = () => withBusy(async () => {
    const name = selectedObject, path = objectPath(name);
    if (!path) throw new Error('请选择一个对象');
    const location = vector('object-location'), rotation = vector('object-rotation').map(value => value * Math.PI / 180), scale = vector('object-scale');
    const code = `o = bpy.data.objects.get(${py(name)})\nif o is None: raise RuntimeError('对象不存在')\no.location = ${JSON.stringify(location)}\no.rotation_mode = 'XYZ'\no.rotation_euler = ${JSON.stringify(rotation)}\no.scale = ${JSON.stringify(scale)}`;
    resultText(await runtime.execute(code, true, '编辑 Blender 对象变换')); await readVectors(); setStatus(status, `已更新对象：${name}`);
  });
  buttons.get('apply-pose').onclick = () => withBusy(async () => {
    const name = selectedArmature, bone = selectedBone;
    const location = vector('pose-location'), rotation = vector('pose-rotation').map(value => value * Math.PI / 180), scale = vector('pose-scale');
    const code = `o = bpy.data.objects.get(${py(name)})\nif o is None or o.type != 'ARMATURE': raise RuntimeError('骨架对象无效')\nb = o.pose.bones.get(${py(bone)})\nif b is None: raise RuntimeError('骨骼不存在')\nb.location = ${JSON.stringify(location)}\nb.rotation_mode = 'XYZ'\nb.rotation_euler = ${JSON.stringify(rotation)}\nb.scale = ${JSON.stringify(scale)}`;
    resultText(await runtime.execute(code, true, '编辑 Blender 骨骼姿态')); await readVectors(); setStatus(status, `已更新姿态：${bone}`);
  });
  buttons.get('apply-rest').onclick = () => withBusy(async () => {
    const name = selectedArmature, boneName = selectedBone, parentName = panel.querySelector('#mmdBlenderParent').value;
    const head = vector('head'), tail = vector('tail'), roll = (Number(panel.querySelector('#mmdBlenderRoll').value) || 0) * Math.PI / 180;
    if (!Number.isFinite(roll)) throw new Error('Roll 必须是有限数字');
    const code = `obj = bpy.data.objects.get(${py(name)})\nif obj is None or obj.type != 'ARMATURE': raise RuntimeError('骨架对象无效')\nold_active = bpy.context.view_layer.objects.active\nold_selected = [o for o in bpy.context.selected_objects]\ntry:\n    if bpy.context.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')\n    for o in bpy.context.selected_objects: o.select_set(False)\n    obj.select_set(True)\n    bpy.context.view_layer.objects.active = obj\n    bpy.ops.object.mode_set(mode='EDIT')\n    b = obj.data.edit_bones.get(${py(boneName)})\n    if b is None: raise RuntimeError('骨骼不存在')\n    b.head = ${JSON.stringify(head)}\n    b.tail = ${JSON.stringify(tail)}\n    b.roll = ${JSON.stringify(roll)}\n    b.parent = obj.data.edit_bones.get(${py(parentName)}) if ${py(parentName)} else None\nfinally:\n    if obj.mode == 'EDIT': bpy.ops.object.mode_set(mode='OBJECT')\n    for o in bpy.context.selected_objects: o.select_set(False)\n    for o in old_selected:\n        if o.name in bpy.context.view_layer.objects: o.select_set(True)\n    if old_active and old_active.name in bpy.context.view_layer.objects: bpy.context.view_layer.objects.active = old_active`;
    resultText(await runtime.execute(code, true, '编辑 Blender 骨架结构')); await runtime.present(); await refreshTrees(); await readVectors(); setStatus(status, `已更新骨架：${boneName}`);
  });
  for (const button of panel.querySelectorAll('[data-mode]')) button.onclick = () => setMode(button.dataset.mode);

  buttons.get('save').onclick = () => withBusy(async () => {
    setStatus(status, '正在保存 .blend…');
    const answer = await runtime.execute('bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)', true, '保存 Blender 工程');
    setStatus(status, answer.includes('Error executing') ? answer : '保存请求已完成；工程写回所选目录。');
  });

  buttons.get('render').onclick = () => withBusy(async () => {
    renderImage.hidden = true;
    setStatus(status, 'Cycles 正在渲染 PNG…');
    const result = await runtime.nativePreview({ width: 1280, height: 720, samples: 32 });
    const bytes = await runtime.readFile(result.path);
    activeRenderUrl();
    renderUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    renderImage.src = renderUrl;
    renderImage.hidden = false;
    buttons.get('download').disabled = false;
    setStatus(status, `Cycles 渲染完成，${result.seconds.toFixed(1)} 秒。`);
  });

  buttons.get('download').onclick = () => {
    if (!renderUrl) return;
    const link = document.createElement('a');
    link.href = renderUrl;
    link.download = `${select.value.replace(/\.blend$/iu, '')}-render.png`.split('/').at(-1);
    link.click();
  };

  buttons.get('close').onclick = () => withBusy(() => dispose(true));
  buttons.get('permission').onclick = () => withBusy(async () => {
    const permission = await directory.requestPermission({ mode: 'readwrite' });
    setStatus(status, permission === 'granted' ? '目录读写权限已恢复。' : '浏览器没有授予目录读写权限。');
  });
  return { close: () => dispose(true), setMode, refreshCharacter: () => attachedCharacter?.refresh() };
}

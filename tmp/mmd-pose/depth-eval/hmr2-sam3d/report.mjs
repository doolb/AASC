// 独立报告仅展示确实保存的HMR2.0b模型输出；缺资源时保留阻塞状态。
const sampleSelect = document.querySelector('#sample');
const footTrialSelect = document.querySelector('#foot-trial');
const footTrialControl = document.querySelector('#foot-trial-control');
const common = document.querySelector('#common');
const models = ['hmr2'];
const viewState = new Map(models.map((key) => [key, { yaw: 0, pitch: 0, output: null, photo: null, viewer: null }]));
let audit = null;
let depthManifest = null;
let sampleGeneration = 0;
let customImage = null;
const customFile = document.querySelector('#custom-file');
const customBoxControls = document.querySelector('#custom-box-controls');
const customInputs = ['x', 'y', 'w', 'h'].map((key) => document.querySelector(`#box-${key}`));

function pointColor(name) {
  if (name.startsWith('left_') || name.startsWith('left-')) return '#61c8ff';
  if (name.startsWith('right_') || name.startsWith('right-')) return '#ffad73';
  return '#eef3fb';
}

function fitCoordinates(points, width, height, yaw, pitch) {
  const low = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const high = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  const center = low.map((value, axis) => (value + high[axis]) / 2);
  const extent = Math.max(...low.map((value, axis) => high[axis] - value), 1e-6);
  return points.map((point) => {
    const [x, y, z] = point.map((value, axis) => (value - center[axis]) * Math.min(width, height) * 0.75 / extent);
    const rotatedX = x * Math.cos(yaw) + z * Math.sin(yaw);
    const rotatedZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return [width / 2 + rotatedX, height / 2 + y * Math.cos(pitch) - rotatedZ * Math.sin(pitch)];
  });
}

async function initializeViewer(key) {
  const card = document.getElementById(key);
  const canvas = card.querySelector('canvas.xyz');
  const state = viewState.get(key);
  try {
    // 复用网页构建已有的本地Three.js，报告不请求外网资源。
    const three = await import('/js/vendor/three/three.module.js');
    const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.outputColorSpace = three.SRGBColorSpace;
    renderer.toneMapping = three.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = false;
    const scene = new three.Scene();
    scene.background = new three.Color('#172130');
    const camera = new three.OrthographicCamera(-1.85, 1.85, 1.85, -1.85, 0.1, 20);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);
    const skeleton = new three.Group();
    scene.add(skeleton);
    // 三盏固定灯只产生曲面明暗；不投射阴影，避免暗示图片里不存在的地面接触。
    scene.add(new three.HemisphereLight(0xf2f7ff, 0x344158, 1.55));
    const keyLight = new three.DirectionalLight(0xffffff, 2.15);
    keyLight.position.set(-3, 4, 5);
    scene.add(keyLight);
    const fillLight = new three.DirectionalLight(0x8bb9ff, 0.85);
    fillLight.position.set(3, -2, -4);
    scene.add(fillLight);
    const materials = Object.fromEntries([
      ['left', '#61c8ff'], ['right', '#ffad73'], ['center', '#eef3fb'],
    ].map(([side, color]) => [side, new three.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.06 })]));
    const cylinder = new three.CylinderGeometry(1, 1, 1, 12);
    const sphere = new three.SphereGeometry(1, 16, 12);
    renderer.domElement.className = canvas.className;
    canvas.replaceWith(renderer.domElement);
    state.viewer = { three, renderer, scene, camera, skeleton, cylinder, sphere, materials };
    renderer.domElement.dataset.renderer = 'three-webgl';
    renderer.domElement.dataset.lights = '3';
    renderer.domElement.dataset.projectedShadows = 'false';
  } catch (error) {
    // 无WebGL或本地模块缺失时继续展示原有线条骨架，不影响图片叠点。
    state.viewerError = error.message;
    canvas.dataset.renderer = 'canvas-2d-fallback';
  }
}

function materialFor(viewer, name) {
  if (name.startsWith('left_') || name.startsWith('left-')) return viewer.materials.left;
  if (name.startsWith('right_') || name.startsWith('right-')) return viewer.materials.right;
  return viewer.materials.center;
}

function rotateSkeleton(key) {
  const state = viewState.get(key);
  if (!state.viewer) {
    drawSkeleton3D(key);
    return;
  }
  const canvas = document.querySelector(`#${key} canvas.xyz`);
  state.viewer.skeleton.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
  state.viewer.renderer.render(state.viewer.scene, state.viewer.camera);
  canvas.dataset.yaw = String(state.yaw);
  canvas.dataset.pitch = String(state.pitch);
}

function drawSkeleton3D(key) {
  const state = viewState.get(key);
  const canvas = document.querySelector(`#${key} canvas.xyz`);
  const result = state.output;
  const viewer = state.viewer;
  if (!viewer) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!result) return;
    const screen = fitCoordinates(result.xyz, canvas.width, canvas.height, state.yaw, state.pitch);
    context.lineWidth = 4;
    for (const [source, target] of result.edges) {
      context.strokeStyle = pointColor(result.names[target]);
      context.beginPath();
      context.moveTo(...screen[source]);
      context.lineTo(...screen[target]);
      context.stroke();
    }
    screen.forEach((point, index) => {
      context.fillStyle = pointColor(result.names[index]);
      context.beginPath();
      context.arc(point[0], point[1], 4, 0, 2 * Math.PI);
      context.fill();
    });
    return;
  }

  viewer.skeleton.clear();
  let boneCount = 0;
  if (result) {
    // 仅统一尺寸与中心，不改模型关节间的比例、左右语义或深度顺序。
    const { three } = viewer;
    const points = result.xyz.map(([x, y, z]) => new three.Vector3(x, -y, -z));
    const bounds = new three.Box3().setFromPoints(points);
    const center = bounds.getCenter(new three.Vector3());
    const size = bounds.getSize(new three.Vector3());
    const scale = 2.75 / Math.max(size.x, size.y, size.z, 1e-6);
    points.forEach((point) => point.sub(center).multiplyScalar(scale));
    const up = new three.Vector3(0, 1, 0);
    for (const [source, target] of result.edges) {
      const direction = new three.Vector3().subVectors(points[target], points[source]);
      const length = direction.length();
      if (length < 1e-6) continue;
      const bone = new three.Mesh(viewer.cylinder, materialFor(viewer, result.names[target]));
      bone.position.copy(points[source]).add(points[target]).multiplyScalar(0.5);
      bone.quaternion.setFromUnitVectors(up, direction.normalize());
      bone.scale.set(0.036, length, 0.036);
      viewer.skeleton.add(bone);
      boneCount += 1;
    }
    points.forEach((point, index) => {
      const joint = new three.Mesh(viewer.sphere, materialFor(viewer, result.names[index]));
      joint.position.copy(point);
      joint.scale.setScalar(0.057);
      viewer.skeleton.add(joint);
    });
  }
  rotateSkeleton(key);
  canvas.dataset.joints = String(result?.xyz.length || 0);
  canvas.dataset.bones = String(boneCount);
}

function drawModel(key) {
  const card = document.getElementById(key);
  const state = viewState.get(key);
  const overlay = card.querySelector('.overlay');
  const photoContext = overlay.getContext('2d');
  photoContext.clearRect(0, 0, overlay.width, overlay.height);
  if (state.photo) photoContext.drawImage(state.photo, 0, 0);
  if (!state.output) {
    drawSkeleton3D(key);
    return;
  }
  const { names, edges, xy } = state.output;
  photoContext.lineWidth = 2.5;
  for (const [source, target] of edges) {
    photoContext.strokeStyle = pointColor(names[target]);
    photoContext.beginPath();
    photoContext.moveTo(...xy[source]);
    photoContext.lineTo(...xy[target]);
    photoContext.stroke();
  }
  xy.forEach((point, index) => {
    photoContext.fillStyle = pointColor(names[index]);
    photoContext.beginPath();
    photoContext.arc(point[0], point[1], 3, 0, 2 * Math.PI);
    photoContext.fill();
  });
  drawSkeleton3D(key);
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;
  return response.json();
}

async function showSample(name) {
  if (name === 'custom') { showCustomPreview(); return; }
  const generation = ++sampleGeneration;
  const sample = audit?.samples?.find((item) => item.name === name);
  footTrialControl.hidden = name !== 'anime';
  if (name !== 'anime') footTrialSelect.value = 'original';
  const variant = name === 'anime' ? footTrialSelect.value : 'original';
  const variantSuffix = variant === 'original' ? '' : `-${variant}`;
  common.textContent = sample?.available
    ? `${sample.label} · ${sample.width}×${sample.height} · 人工框 ${sample.box.join(', ')}；原图SHA-256 ${sample.sha256}`
    : `${name} 原图缺失；当前不能比较姿态。`;
  if (variantSuffix) common.textContent += '；当前为实验候选，脚掌未改善，原始输出未被覆盖。';
  const photo = new Image();
  photo.src = `/sample/${name}`;
  const card = document.getElementById('hmr2');
  const depthImage = card.querySelector('img.depth');
  const depthVerified = depthManifest?.images?.some((item) => item.sha256 === sample?.sha256) || false;
  if (depthVerified) depthImage.src = `../rigid-projection/${name}-depth.png`;
  else depthImage.removeAttribute('src');
  const [, depthReady] = await Promise.all([
    photo.decode().then(() => true).catch(() => false),
    depthVerified ? depthImage.decode().then(() => true).catch(() => false) : Promise.resolve(false),
  ]);
  if (generation !== sampleGeneration) return;
  card.querySelector('.depth-status').textContent = !depthVerified
    ? '相对深度来源未核对，暂不显示；原图叠点与3D骨架仍可查看。'
    : depthReady
      ? '相对深度：黄色较近、蓝色较远；只比较当前图片的可见表面。'
      : '相对深度图缺失；原图叠点与3D骨架仍可查看。';
  if (!depthReady) depthImage.removeAttribute('src');
  await Promise.all(models.map(async (key) => {
    const card = document.getElementById(key);
    const state = viewState.get(key);
    const output = await loadJson(`./results/${key}-${name}${variantSuffix}.json`);
    if (generation !== sampleGeneration) return;
    state.photo = photo.naturalWidth ? photo : null;
    state.output = output;
    if (variantSuffix && state.output) {
      common.textContent = `${sample.label} · ${sample.width}×${sample.height} · 候选人物框 ${state.output.box.join(', ')}；${state.output.mirroredInput ? '输入已镜像并映回原图' : '未镜像'}；原图SHA-256 ${sample.sha256}；脚掌未改善，原始输出未被覆盖。`;
    }
    const overlay = card.querySelector('.overlay');
    overlay.width = sample?.width || photo.naturalWidth || 236;
    overlay.height = sample?.height || photo.naturalHeight || 314;
    const result = state.output;
    const needed = '官方checkpoint、配置和均值参数';
    card.querySelector('.status').textContent = result
      ? `${name} ${variant === 'original' ? '原版推理完成' : `实验候选${variant}推理完成 · 脚掌未改善`} · ${Math.round(result.inferenceMs)} ms · ${result.device}`
      : audit?.ready?.[key] ? '资源已齐，尚无成功的原版推理结果。' : `暂无原版推理结果；需要${needed}。`;
    if (!state.viewer) card.querySelector('.status').textContent += ' · WebGL不可用，已回退线条预览';
    card.querySelector('.details').textContent = result
      ? JSON.stringify({ source: result.source, provenance: result.provenance, variant: result.variant || 'original', mirroredInput: result.mirroredInput || false, camera: result.camera, joints: result.xyz.length, box: result.box, modelLoadMs: result.modelLoadMs, peakWorkingSetMiB: result.peakWorkingSetMiB, peakGpuAllocatedMiB: result.peakGpuAllocatedMiB }, null, 2)
      : JSON.stringify({ sourceRevision: audit?.source?.[key], localPatch: audit?.sourcePatches?.[key], resources:
        { checkpoint: audit?.resources?.hmr2Checkpoint?.available, meanParams: audit?.resources?.hmr2MeanParams?.available, smpl: audit?.resources?.smplSource } }, null, 2);
    drawModel(key);
  }));
}

function selectedBox() {
  const box = customInputs.map((input) => Number(input.value));
  const [x, y, width, height] = box;
  if (!customImage || customInputs.some((input) => !input.value.trim()) || !box.every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1
      || x + width > customImage.width || y + height > customImage.height) throw new Error('人物框必须是图片内部的整数矩形');
  return box;
}

function showCustomPreview() {
  ++sampleGeneration;
  if (!customImage) return;
  footTrialControl.hidden = true;
  customBoxControls.hidden = false;
  const card = document.querySelector('#hmr2');
  const state = viewState.get('hmr2');
  state.photo = customImage.photo;
  state.output = null;
  document.querySelector('#custom-run').disabled = false;
  const overlay = card.querySelector('canvas.overlay');
  overlay.width = customImage.width;
  overlay.height = customImage.height;
  drawModel('hmr2');
  try {
    const [x, y, width, height] = selectedBox();
    const context = overlay.getContext('2d');
    context.strokeStyle = '#ffe37e';
    context.lineWidth = Math.max(2, customImage.width / 500);
    context.strokeRect(x, y, width, height);
    card.querySelector('.status').textContent = '图片已载入；确认人物框后点击识别。';
  } catch (error) { card.querySelector('.status').textContent = error.message; }
  card.querySelector('.depth').removeAttribute('src');
  card.querySelector('.depth-status').textContent = '识别后在浏览器生成整图相对深度。';
  card.querySelector('.details').textContent = '';
  common.textContent = `自选图片 · ${customImage.width}×${customImage.height} · ${customImage.name}；仅在本机处理。`;
}

async function acceptCustomFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择PNG、JPEG或WebP图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过20 MiB');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 4096 * 4096) throw new Error('图片解码像素过多');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size > 20 * 1024 * 1024) throw new Error('处理后PNG过大');
    const url = URL.createObjectURL(blob);
    const photo = new Image();
    photo.src = url;
    try { await photo.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
    if (customImage?.url) URL.revokeObjectURL(customImage.url);
    customImage = { photo, blob, url, width: canvas.width, height: canvas.height, name: file.name || '剪贴板图片' };
    customInputs.forEach((input, index) => { input.value = String([0, 0, canvas.width, canvas.height][index]); });
    sampleSelect.querySelector('option[value="custom"]').disabled = false;
    sampleSelect.value = 'custom';
    showCustomPreview();
  } finally { bitmap.close(); }
}

async function runCustom() {
  const card = document.querySelector('#hmr2');
  let box;
  try { box = selectedBox(); } catch (error) { card.querySelector('.status').textContent = error.message; return; }
  const generation = ++sampleGeneration;
  const image = customImage;
  const runButton = document.querySelector('#custom-run');
  runButton.disabled = true;
  card.querySelector('.status').textContent = '本机HMR推理和浏览器深度推理中…';
  card.querySelector('.depth-status').textContent = '正在计算整图相对深度…';
  try {
    const [hmr, depth] = await Promise.allSettled([
      (async () => {
        const response = await fetch('/api/hmr2-custom', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Person-Box': JSON.stringify(box) }, body: image.blob });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '本机HMR服务不可用');
        return result;
      })(),
      import('./custom-depth.mjs').then(({ inferDepth }) => inferDepth(image.photo)),
    ]);
    if (generation !== sampleGeneration) return;
    const state = viewState.get('hmr2');
    state.photo = image.photo;
    state.output = hmr.status === 'fulfilled' ? hmr.value : null;
    drawModel('hmr2');
    card.querySelector('.status').textContent = hmr.status === 'fulfilled'
      ? `自选图推理完成 · ${Math.round(hmr.value.inferenceMs)} ms · ${hmr.value.device}`
      : `HMR失败：${hmr.reason.message}`;
    card.querySelector('.details').textContent = hmr.status === 'fulfilled' ? JSON.stringify({ source: hmr.value.source, provenance: hmr.value.provenance, camera: hmr.value.camera, box, modelLoadMs: hmr.value.modelLoadMs }, null, 2) : '';
    if (depth.status === 'fulfilled') card.querySelector('.depth').src = depth.value.src;
    card.querySelector('.depth-status').textContent = depth.status === 'fulfilled'
      ? `整图相对深度完成 · ${Math.round(depth.value.ms)} ms；黄色较近、蓝色较远，仅可见表面。`
      : `深度推理失败：${depth.reason.message}`;
  } finally { if (generation === sampleGeneration) runButton.disabled = false; }
}

await Promise.all(models.map((key) => initializeViewer(key)));

for (const key of models) {
  const canvas = document.querySelector(`#${key} .xyz`);
  const state = viewState.get(key);
  let last = null;
  canvas.addEventListener('pointerdown', (event) => { last = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { last = null; });
  canvas.addEventListener('pointercancel', () => { last = null; });
  canvas.addEventListener('pointermove', (event) => {
    if (!last) return;
    state.yaw += (event.clientX - last[0]) * 0.01;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch + (event.clientY - last[1]) * 0.01));
    last = [event.clientX, event.clientY];
    rotateSkeleton(key);
  });
  canvas.addEventListener('dblclick', () => { state.yaw = 0; state.pitch = 0; rotateSkeleton(key); });
}

sampleSelect.value = new URLSearchParams(location.search).get('image') || 'seated';
if (![...sampleSelect.options].some((option) => option.value === sampleSelect.value)) sampleSelect.value = 'seated';
footTrialSelect.value = new URLSearchParams(location.search).get('variant') || 'original';
if (![...footTrialSelect.options].some((option) => option.value === footTrialSelect.value)) footTrialSelect.value = 'original';
sampleSelect.addEventListener('change', () => {
  customBoxControls.hidden = sampleSelect.value !== 'custom';
  showSample(sampleSelect.value);
});
footTrialSelect.addEventListener('change', () => showSample(sampleSelect.value));
customFile.addEventListener('change', async () => {
  try { await acceptCustomFile(customFile.files[0]); }
  catch (error) { document.querySelector('#hmr2 .status').textContent = error.message; }
  customFile.value = '';
});
customInputs.forEach((input) => input.addEventListener('input', () => {
  if (sampleSelect.value === 'custom') showCustomPreview();
}));
document.querySelector('#custom-run').addEventListener('click', () => runCustom().catch((error) => {
  document.querySelector('#hmr2 .status').textContent = error.message;
  document.querySelector('#custom-run').disabled = false;
}));
document.querySelector('#custom-paste').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.read) throw new Error('浏览器不支持读取剪贴板，请按Ctrl+V或选择文件');
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.some((type) => ['image/png', 'image/jpeg', 'image/webp'].includes(type)));
    if (!item) throw new Error('剪贴板中没有图片');
    const type = item.types.find((value) => ['image/png', 'image/jpeg', 'image/webp'].includes(value));
    await acceptCustomFile(new File([await item.getType(type)], '剪贴板图片', { type }));
  } catch (error) { document.querySelector('#hmr2 .status').textContent = error.message; }
});
document.addEventListener('paste', async (event) => {
  if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) return;
  const file = [...(event.clipboardData?.files || [])].find((item) => ['image/png', 'image/jpeg', 'image/webp'].includes(item.type));
  if (!file) return;
  event.preventDefault();
  try { await acceptCustomFile(file); }
  catch (error) { document.querySelector('#hmr2 .status').textContent = error.message; }
});
[audit, depthManifest] = await Promise.all([
  loadJson('./status.json'),
  loadJson('../rigid-projection/manifest.json'),
]);
await showSample(sampleSelect.value);
globalThis.showSample = showSample;
globalThis.reportReady = true;

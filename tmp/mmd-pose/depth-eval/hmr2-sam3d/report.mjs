// 独立报告仅展示确实保存的HMR2.0b模型输出；缺资源时保留阻塞状态。
const sampleSelect = document.querySelector('#sample');
const footTrialSelect = document.querySelector('#foot-trial');
const footTrialControl = document.querySelector('#foot-trial-control');
const common = document.querySelector('#common');
const models = ['hmr2'];
const viewState = new Map(models.map((key) => [key, { yaw: 0, pitch: 0, output: null, photo: null, viewer: null }]));
let audit = null;

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
  try { await photo.decode(); } catch { /* 原图缺失由状态栏说明。 */ }
  await Promise.all(models.map(async (key) => {
    const card = document.getElementById(key);
    const state = viewState.get(key);
    state.photo = photo.naturalWidth ? photo : null;
    state.output = await loadJson(`./results/${key}-${name}${variantSuffix}.json`);
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
sampleSelect.addEventListener('change', () => showSample(sampleSelect.value));
footTrialSelect.addEventListener('change', () => showSample(sampleSelect.value));
audit = await loadJson('./status.json');
await showSample(sampleSelect.value);
globalThis.showSample = showSample;
globalThis.reportReady = true;

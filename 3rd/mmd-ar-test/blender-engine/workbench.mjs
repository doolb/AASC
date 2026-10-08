import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

function makePanel() {
  const panel = document.createElement('section');
  panel.id = 'mmdBlenderWorkbench';
  panel.innerHTML = `
    <header><strong>Blender 工程</strong><span id="mmdBlenderStatus" role="status">正在读取目录…</span>
      <button type="button" data-action="permission">重新授权目录</button>
      <button type="button" data-action="close">保存并关闭</button></header>
    <nav>
      <select id="mmdBlenderDocument" aria-label="Blender 工程文件"></select>
      <button type="button" data-action="open">打开工程</button>
      <button type="button" data-action="save" disabled>保存</button>
      <button type="button" data-action="render" disabled>Cycles 渲染 PNG</button>
      <button type="button" data-action="download" disabled>下载 PNG</button>
    </nav>
    <canvas aria-label="Blender 工程预览"></canvas>
    <img id="mmdBlenderRender" alt="Cycles 渲染结果" hidden>
  `;
  const style = document.createElement('style');
  style.textContent = `
    #mmdBlenderWorkbench{position:fixed;inset:0;z-index:200;background:#111722;color:#edf2fa;font:14px system-ui;display:grid;grid-template-rows:auto auto 1fr;gap:8px;padding:10px;box-sizing:border-box}
    #mmdBlenderWorkbench header,#mmdBlenderWorkbench nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    #mmdBlenderWorkbench header span{flex:1;min-width:180px;color:#bfcaff;font-size:12px}
    #mmdBlenderWorkbench button,#mmdBlenderWorkbench select{background:#242936;color:inherit;border:1px solid #525d73;border-radius:5px;padding:7px;font:inherit}
    #mmdBlenderWorkbench canvas{width:100%;height:100%;min-height:0;background:#20242e;touch-action:none}
    #mmdBlenderWorkbench img{position:absolute;inset:58px 10px 10px;width:calc(100% - 20px);height:calc(100% - 68px);object-fit:contain;background:#111722}
    #mmdBlenderWorkbench [hidden]{display:none!important}
  `;
  document.head.append(style);
  document.body.append(panel);
  return { panel, style };
}

async function *walkDirectory(directory, prefix = '') {
  for await (const [name, entry] of directory.entries()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') yield * walkDirectory(entry, relative);
    else if (relative.toLowerCase().endsWith('.blend')) yield relative;
  }
}

async function waitForWorkerController(registration) {
  if (navigator.serviceWorker.controller) return;
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('本地工程适配器启动超时，请刷新页面重试')), 15000)),
  ]);
  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('浏览器没有接管 Blender 工程请求')), 15000);
    const finish = (error) => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => finish();
    navigator.serviceWorker.addEventListener('controllerchange', changed, { once: true });
    if (registration.active && navigator.serviceWorker.controller) finish();
  });
}

function setStatus(node, message) {
  node.textContent = message;
}

export async function mountBlenderWorkbench(directory, onClosed = () => {}) {
  if (!window.isSecureContext || !navigator.serviceWorker || !window.showDirectoryPicker)
    throw new Error('Blender 工程需要 HTTPS 桌面 Chromium 和目录读写权限');

  await saveHandle(directory);
  const projectUrl = new URL('./', window.location.href);
  const registration = await navigator.serviceWorker.register(new URL('web-blender-service-worker.js', projectUrl), {
    scope: projectUrl.pathname,
  });
  await waitForWorkerController(registration);

  const { panel, style } = makePanel();
  const status = panel.querySelector('#mmdBlenderStatus');
  const select = panel.querySelector('#mmdBlenderDocument');
  const canvas = panel.querySelector('canvas');
  const renderImage = panel.querySelector('#mmdBlenderRender');
  const buttons = new Map([...panel.querySelectorAll('[data-action]')].map(button => [button.dataset.action, button]));
  let runtime = null;
  let presenter = null;
  let renderer = null;
  let camera = null;
  let controls = null;
  let animation = 0;
  let renderUrl = '';
  let busy = false;
  const activeRenderUrl = () => {
    if (!renderUrl) return;
    URL.revokeObjectURL(renderUrl);
    renderUrl = '';
  };

  const draw = () => {
    if (!renderer || !presenter || !camera) return;
    presenter.view.root.updateMatrixWorld(true);
    renderer.render(presenter.scene, camera);
  };

  const dispose = async (flush) => {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    if (flush && runtime) {
      setStatus(status, '正在保存 Blender 工程…');
      await runtime.stop();
    } else runtime?.terminate();
    controls?.dispose();
    panel._resizeObserver?.disconnect();
    renderer?.dispose();
    presenter?.dispose();
    controls = renderer = presenter = runtime = camera = null;
    activeRenderUrl();
    panel.remove();
    style.remove();
    onClosed();
  };

  for await (const path of walkDirectory(directory)) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path;
    select.append(option);
  }
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

  buttons.get('open').onclick = () => withBusy(async () => {
    if (runtime) throw new Error('请先关闭当前工程，再重新选择工程目录');
    const permission = await directory.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('需要授予所选目录读写权限才能打开并保存工程');
    setStatus(status, '正在按需下载 Blender 引擎与约 38 MB 的压缩核心运行资源…');
    const relativePath = select.value;
    let opened = false;
    try {
      const previewCanvas = new OffscreenCanvas(1, 1);
      presenter = createPresenter({ canvas: previewCanvas });
      runtime = new BlenderRuntime({
        present: async (frame, description, capture) => {
          const answer = await presenter.present(frame, description, capture);
          draw();
          return answer;
        },
        log: (_level, text) => {
          if (text.startsWith('@@VOLTER-WORK')) setStatus(status, '正在读取 Blender 与工程资源…');
          else if (text.startsWith('@@VOLTER-READY')) setStatus(status, 'Blender 已启动，正在打开工程…');
        },
        documentMoved: ({ document: nextPath }) => setStatus(status, `Blender 工程已切换到 ${nextPath}`),
      });
      await runtime.start(VIRTUAL_PROJECT, relativePath);
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false);
      camera = new THREE.PerspectiveCamera(45, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight), 0.01, 10000);
      const bounds = new THREE.Box3().setFromObject(presenter.view.root);
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const distance = Math.max(2, sphere.radius * 2.8);
      camera.position.set(sphere.center.x + distance, sphere.center.y + distance * 0.6, sphere.center.z + distance);
      camera.lookAt(sphere.center);
      controls = new OrbitControls(camera, canvas);
      controls.target.copy(sphere.center);
      controls.addEventListener('change', draw);
      await runtime.present();
      draw();
      buttons.get('open').disabled = true;
      buttons.get('save').disabled = false;
      buttons.get('render').disabled = false;
      setStatus(status, `已打开 ${relativePath}。工程文件保存在所选目录。`);
      const resize = () => {
        const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        draw();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      panel._resizeObserver = observer;
      const tick = () => { animation = requestAnimationFrame(tick); controls?.update(); renderer?.render(presenter.scene, camera); };
      tick();
      opened = true;
    } catch (error) {
      if (!opened) runtime?.terminate();
      controls?.dispose();
      renderer?.dispose();
      presenter?.dispose();
      controls = renderer = presenter = runtime = camera = null;
      panel._resizeObserver?.disconnect();
      panel._resizeObserver = null;
      buttons.get('open').disabled = false;
      buttons.get('save').disabled = true;
      buttons.get('render').disabled = true;
      throw error;
    }
  });

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
  return { close: () => dispose(true) };
}

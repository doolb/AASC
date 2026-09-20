/*
 * 浏览器端 VRM 运行时。
 *
 * 该文件使用 import map 加载随服务代码包分发的 three.js/three-vrm，模型本身
 * 仍由同源服务端在线代理。运行时只负责 WebGL、VRM 生命周期、缩放和命中检测，
 * 不直接处理聊天或 WebSocket。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// v2 表示服务端已经把 VRoid optimized_preview 的顶点恢复为正常 GLB；不能继续复用
// 旧版本缓存中的压缩顶点，否则模型会出现拉伸、破面或看似空白。
const MODEL_CACHE_NAME = 'aasc-vrm-models-v2';
const TARGET_MODEL_HEIGHT = 1.75;

async function readCachedModel(url) {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        const response = await cache.match(url);
        if (!response) return null;
        return await response.arrayBuffer();
    } catch (error) {
        console.warn('[显示端 VRM] 读取缓存失败:', error);
        return null;
    }
}

async function fetchModel(url) {
    const cached = await readCachedModel(url);
    if (cached) return cached;

    const response = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
    if (!response.ok) {
        throw new Error(`模型代理返回 HTTP ${response.status}`);
    }
    const clone = typeof response.clone === 'function' ? response.clone() : null;
    const buffer = await response.arrayBuffer();
    if (clone && typeof caches !== 'undefined') {
        try {
            const cache = await caches.open(MODEL_CACHE_NAME);
            await cache.put(url, clone);
        } catch (error) {
            console.warn('[显示端 VRM] 写入缓存失败:', error);
        }
    }
    return buffer;
}

function normalizeModel(vrm) {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const height = Math.max(0.01, size.y);
    vrm.scene.scale.setScalar(TARGET_MODEL_HEIGHT / height);

    const scaledBox = new THREE.Box3().setFromObject(vrm.scene);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    vrm.scene.position.x -= scaledCenter.x;
    vrm.scene.position.y -= scaledBox.min.y;
    vrm.scene.position.z -= scaledCenter.z;
}

function classifyHit(object) {
    const name = String(object?.name || '').toLowerCase();
    if (/(head|face|eye|hair|髪|顔|頭)/u.test(name)) return 'head';
    if (/(hand|arm|finger|手|腕)/u.test(name)) return 'hand';
    if (/(body|chest|skirt|leg|foot|体|胸|脚)/u.test(name)) return 'body';
    return 'body';
}

export function createDisplayVrmRuntime({ canvas, onStatus = () => {} } = {}) {
    if (!canvas) throw new Error('VRM Canvas 不存在');

    const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
    camera.position.set(0, TARGET_MODEL_HEIGHT * 0.55, TARGET_MODEL_HEIGHT * 2.8);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(1.5, 3, 2.5);
    scene.add(ambientLight, keyLight);

    const loader = new GLTFLoader();
    const ktx2Loader = new KTX2Loader()
        .setTranscoderPath('/js/vendor/three/basis/')
        .detectSupport(renderer);
    loader.setKTX2Loader(ktx2Loader);
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let currentVrm = null;
    let frameHandle = 0;
    let lastFrameAt = performance.now();
    let visible = true;

    function renderFrame(now) {
        frameHandle = 0;
        if (!visible) return;
        const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
        lastFrameAt = now;
        if (currentVrm) currentVrm.update(delta);
        renderer.render(scene, camera);
        frameHandle = requestAnimationFrame(renderFrame);
    }

    function startRendering() {
        if (!visible || frameHandle) return;
        lastFrameAt = performance.now();
        frameHandle = requestAnimationFrame(renderFrame);
    }

    function disposeCurrentModel() {
        if (!currentVrm) return;
        scene.remove(currentVrm.scene);
        VRMUtils.deepDispose(currentVrm.scene);
        currentVrm = null;
    }

    function resize(width, height, devicePixelRatio = window.devicePixelRatio || 1) {
        const safeWidth = Math.max(1, Number(width) || window.innerWidth || 1);
        const safeHeight = Math.max(1, Number(height) || window.innerHeight || 1);
        const pixelRatio = Math.min(2, Math.max(1, Number(devicePixelRatio) || 1));
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(safeWidth, safeHeight, false);
        camera.aspect = safeWidth / safeHeight;
        camera.updateProjectionMatrix();
        camera.lookAt(0, TARGET_MODEL_HEIGHT * 0.5, 0);
        startRendering();
    }

    async function load(url) {
        const isModelProxyUrl = typeof url === 'string'
            && (url.startsWith('/api/vrm/model/file?') || url.startsWith('/api/vrm/model/static?'));
        if (!isModelProxyUrl) {
            throw new Error('VRM 模型地址必须是同源代理地址');
        }
        onStatus('正在下载在线 VRM 模型…');
        const buffer = await fetchModel(url);
        const gltf = await loader.parseAsync(buffer, `${window.location.origin}/`);
        const nextVrm = gltf.userData?.vrm;
        if (!nextVrm?.scene) throw new Error('VRM 文件缺少可渲染场景');

        try {
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.removeUnnecessaryJoints(gltf.scene);
        } catch (error) {
            console.warn('[显示端 VRM] 优化模型几何失败，继续加载:', error);
        }
        VRMUtils.rotateVRM0(nextVrm);
        normalizeModel(nextVrm);
        disposeCurrentModel();
        currentVrm = nextVrm;
        scene.add(currentVrm.scene);
        onStatus('VRM 模型已加载');
        startRendering();
    }

    function setVisible(nextVisible) {
        visible = nextVisible === true;
        if (visible) {
            startRendering();
            return;
        }
        if (frameHandle) cancelAnimationFrame(frameHandle);
        frameHandle = 0;
    }

    function raycast(point) {
        if (!currentVrm || !point) return null;
        pointer.set(Number(point.normalizedX) || 0, Number(point.normalizedY) || 0);
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObject(currentVrm.scene, true);
        return intersections.length ? classifyHit(intersections[0].object) : null;
    }

    function handleActionPlan(plan) {
        if (!currentVrm || !plan) return false;
        const action = String(plan.fallbackAction || plan.action || '').toLowerCase();
        const expressionName = action.includes('happy') || action.includes('开心') ? 'happy' : null;
        if (expressionName && currentVrm.expressionManager?.getExpression) {
            const expression = currentVrm.expressionManager.getExpression(expressionName);
            expression?.setWeight(1);
            window.setTimeout(() => expression?.setWeight(0), 700);
        }
        return true;
    }

    function dispose() {
        if (frameHandle) cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        disposeCurrentModel();
        renderer.dispose();
        ktx2Loader.dispose();
    }

    return Object.freeze({ dispose, handleActionPlan, load, raycast, resize, setVisible });
}

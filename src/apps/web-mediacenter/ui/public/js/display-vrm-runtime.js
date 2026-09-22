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
const SHADOW_MAP_SIZE = 1024;
const SHADOW_FRUSTUM_MARGIN = 1.18;

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
    camera.position.set(0, TARGET_MODEL_HEIGHT * 0.55, TARGET_MODEL_HEIGHT * 2.8);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(1.5, 3, 2.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -5;
    keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5;
    keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    const shadowMaterial = new THREE.ShadowMaterial({
        color: 0x000000,
        opacity: 0.28,
        transparent: true,
        depthWrite: false
    });
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), shadowMaterial);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    scene.add(ambientLight, keyLight, keyLight.target, shadowPlane);

    let shadowEnabled = true;

    const applyShadowFlags = (root) => {
        root?.traverse?.((object) => {
            if (!object.isMesh) return;
            object.castShadow = shadowEnabled;
            object.receiveShadow = shadowEnabled;
        });
    };

    const fitShadowCamera = (root) => {
        const shadowCamera = keyLight.shadow.camera;
        const fallbackCenter = new THREE.Vector3(0, TARGET_MODEL_HEIGHT * 0.5, 0);
        const bounds = root?.isObject3D
            ? new THREE.Box3().setFromObject(root)
            : new THREE.Box3();
        const center = bounds.isEmpty()
            ? fallbackCenter
            : bounds.getCenter(new THREE.Vector3());
        const size = bounds.isEmpty()
            ? new THREE.Vector3(TARGET_MODEL_HEIGHT, TARGET_MODEL_HEIGHT, TARGET_MODEL_HEIGHT)
            : bounds.getSize(new THREE.Vector3());
        const radius = Math.max(TARGET_MODEL_HEIGHT * 0.65, size.length() * 0.5);
        const extent = radius * SHADOW_FRUSTUM_MARGIN;
        const lightDistance = keyLight.position.distanceTo(center);

        keyLight.target.position.copy(center);
        shadowCamera.left = -extent;
        shadowCamera.right = extent;
        shadowCamera.top = extent;
        shadowCamera.bottom = -extent;
        shadowCamera.near = Math.max(0.1, lightDistance - radius * 2.2);
        shadowCamera.far = Math.max(shadowCamera.near + 1, lightDistance + radius * 2.2);
        shadowCamera.updateProjectionMatrix();
        keyLight.shadow.needsUpdate = true;
    };

    const applyShadowMode = () => {
        renderer.shadowMap.enabled = shadowEnabled;
        keyLight.castShadow = shadowEnabled;
        shadowPlane.visible = shadowEnabled;
        applyShadowFlags(currentVrm?.scene);
        fitShadowCamera(currentVrm?.scene);
    };

    const normalizeLightNumber = (value, minimum, maximum, fallback) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(maximum, Math.max(minimum, number));
    };

    const normalizeLightColor = (value) => {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/iu.test(color) ? color : '#ffffff';
    };

    const setLighting = (lighting = {}) => {
        const position = lighting.keyPosition && typeof lighting.keyPosition === 'object'
            ? lighting.keyPosition
            : {};
        ambientLight.color.set(normalizeLightColor(lighting.ambientColor));
        ambientLight.intensity = normalizeLightNumber(lighting.ambientIntensity, 0, 4, 1.8);
        keyLight.color.set(normalizeLightColor(lighting.keyColor));
        keyLight.intensity = normalizeLightNumber(lighting.keyIntensity, 0, 5, 2.3);
        keyLight.position.set(
            normalizeLightNumber(position.x, -10, 10, 1.5),
            normalizeLightNumber(position.y, -10, 10, 3),
            normalizeLightNumber(position.z, -10, 10, 2.5)
        );
        shadowEnabled = lighting.shadowEnabled !== false;
        applyShadowMode();
        return {
            ambientColor: normalizeLightColor(lighting.ambientColor),
            ambientIntensity: ambientLight.intensity,
            keyColor: normalizeLightColor(lighting.keyColor),
            keyIntensity: keyLight.intensity,
            keyPosition: {
                x: keyLight.position.x,
                y: keyLight.position.y,
                z: keyLight.position.z
            },
            shadowEnabled
        };
    };

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
        applyShadowFlags(currentVrm.scene);
        scene.add(currentVrm.scene);
        fitShadowCamera(currentVrm.scene);
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
        scene.remove(shadowPlane);
        shadowMaterial.dispose();
        shadowPlane.geometry.dispose();
        renderer.dispose();
        ktx2Loader.dispose();
    }

    return Object.freeze({ dispose, handleActionPlan, load, raycast, resize, setLighting, setVisible });
}

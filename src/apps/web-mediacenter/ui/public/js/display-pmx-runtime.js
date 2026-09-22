/*
 * 浏览器端 PMX/VMD 运行时。
 *
 * PMX 的纹理路径由 MMDLoader 以 PMX 所在目录为基准解析，因此模型目录、tex/
 * 和 toon/ 必须由服务端以同源模型或静态代理路径提供。运行时只接受已由显示模块
 * 校验过的 profile/resourceId，不接受动作计划传入的任意 URL。
 */
import * as THREE from 'three';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';

const TARGET_MODEL_HEIGHT = 1.75;
const MMD_MODEL_PREFIXES = Object.freeze([
    '/models/mmd/',
    '/api/mmd/static/mmd/'
]);
const SHADOW_MAP_SIZE = 1024;
const SHADOW_FRUSTUM_MARGIN = 1.18;
const MAX_MODEL_PITCH_RADIANS = Math.PI / 4;
const MAX_CAMERA_PITCH_RADIANS = Math.PI / 4;
const ROTATION_EASING_PER_SECOND = 1 / 0.14;
const ROTATION_SETTLE_EPSILON = 0.0005;

const classifyHit = (object) => {
    const name = String(object?.name || '').toLowerCase();
    if (/(head|face|eye|hair|髪|顔|頭)/u.test(name)) return 'head';
    if (/(hand|arm|finger|手|腕)/u.test(name)) return 'hand';
    if (/(body|chest|skirt|leg|foot|体|胸|脚)/u.test(name)) return 'body';
    return 'body';
};

const disposeMaterial = (material) => {
    if (!material) return;
    for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && value.isTexture) value.dispose();
    }
    material.dispose?.();
};

const disposeObject = (root) => {
    root?.traverse?.((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) {
            object.material.forEach(disposeMaterial);
        } else {
            disposeMaterial(object.material);
        }
    });
};

const isSameOriginMmdAsset = (url, extension) => {
    if (typeof url !== 'string' || url.includes('://') || url.startsWith('//')
        || url.includes('..') || /[?#\\]/u.test(url)) return false;
    return MMD_MODEL_PREFIXES.some((prefix) => url.startsWith(prefix))
        && url.toLowerCase().endsWith(extension);
};

const waitForManagedLoad = (startLoad, label) => new Promise((resolve, reject) => {
    const loadingManager = new THREE.LoadingManager();
    let result;
    let resultReady = false;
    let managerReady = false;
    let settled = false;

    const createError = (error) => {
        const normalized = error instanceof Error ? error : new Error(`${label}资源加载失败`);
        if (result !== undefined) normalized.partialResult = result;
        return normalized;
    };
    const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(createError(error));
    };
    const tryResolve = () => {
        if (!settled && managerReady && resultReady) {
            settled = true;
            resolve(result);
        }
    };

    loadingManager.onLoad = () => {
        managerReady = true;
        tryResolve();
    };
    loadingManager.onError = (url) => fail(new Error(`${label}资源加载失败：${url}`));

    try {
        const loader = new MMDLoader(loadingManager);
        startLoad(loader, (value) => {
            result = value;
            resultReady = true;
            tryResolve();
        }, fail);
    } catch (error) {
        fail(error);
    }
});

const normalizeModel = (mesh) => {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const height = Math.max(0.01, size.y);
    mesh.scale.setScalar(TARGET_MODEL_HEIGHT / height);
    const scaledBox = new THREE.Box3().setFromObject(mesh);
    const center = scaledBox.getCenter(new THREE.Vector3());
    mesh.position.x -= center.x;
    mesh.position.y -= scaledBox.min.y;
    mesh.position.z -= center.z;
};

function createModelRotationPivot(model) {
    const pivot = new THREE.Group();
    if (!model?.isObject3D) return pivot;
    const bounds = new THREE.Box3().setFromObject(model);
    if (!bounds.isEmpty()) {
        pivot.position.copy(bounds.getCenter(new THREE.Vector3()));
    }
    // attach 保持模型当前世界变换，使贴地、骨骼动画和资源自身姿态不被枢轴改变。
    pivot.updateWorldMatrix(true, false);
    model.updateWorldMatrix(true, false);
    pivot.attach(model);
    return pivot;
}

export function createDisplayPmxRuntime({ canvas, onStatus = () => {} } = {}) {
    if (!canvas) throw new Error('PMX Canvas 不存在');

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
    const cameraTarget = new THREE.Vector3(0, TARGET_MODEL_HEIGHT * 0.5, 0);
    const cameraDistance = TARGET_MODEL_HEIGHT * 2.8;
    const cameraViewState = {
        targetYaw: 0,
        targetPitch: 0,
        currentYaw: 0,
        currentPitch: 0
    };

    const applyCameraView = () => {
        const cosPitch = Math.cos(cameraViewState.currentPitch);
        camera.position.set(
            Math.sin(cameraViewState.currentYaw) * cosPitch * cameraDistance,
            cameraTarget.y + Math.sin(cameraViewState.currentPitch) * cameraDistance,
            Math.cos(cameraViewState.currentYaw) * cosPitch * cameraDistance
        );
        camera.lookAt(cameraTarget);
    };

    const updateCameraView = (delta) => {
        const yawDistance = cameraViewState.targetYaw - cameraViewState.currentYaw;
        const pitchDistance = cameraViewState.targetPitch - cameraViewState.currentPitch;
        if (Math.abs(yawDistance) < ROTATION_SETTLE_EPSILON
            && Math.abs(pitchDistance) < ROTATION_SETTLE_EPSILON) {
            cameraViewState.currentYaw = cameraViewState.targetYaw;
            cameraViewState.currentPitch = cameraViewState.targetPitch;
            applyCameraView();
            return false;
        }
        const easing = 1 - Math.exp(-ROTATION_EASING_PER_SECOND * Math.max(0, delta));
        cameraViewState.currentYaw += yawDistance * easing;
        cameraViewState.currentPitch += pitchDistance * easing;
        applyCameraView();
        return true;
    };

    const setCameraViewRotation = (yawRadians, pitchRadians = 0) => {
        const yaw = Number(yawRadians);
        const pitch = Number(pitchRadians);
        if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return false;
        cameraViewState.targetYaw = Math.max(-Math.PI, Math.min(Math.PI, yaw));
        cameraViewState.targetPitch = Math.max(
            -MAX_CAMERA_PITCH_RADIANS,
            Math.min(MAX_CAMERA_PITCH_RADIANS, pitch)
        );
        startRendering();
        return true;
    };
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
        applyShadowFlags(currentMesh);
        fitShadowCamera(currentRotationPivot || currentMesh);
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

    const helper = { current: null };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let currentMesh = null;
    let currentRotationPivot = null;
    const rotationState = {
        targetYaw: 0,
        targetPitch: 0,
        fitShadowWhenSettled: false
    };
    let currentProfile = null;
    let currentMotionResourceId = null;
    let motionSequence = 0;
    let modelSequence = 0;
    let frameHandle = 0;
    let lastFrameAt = performance.now();
    let visible = true;
    let disposed = false;
    let fallbackObject = null;

    function resetModelRotation() {
        rotationState.targetYaw = currentRotationPivot?.rotation.y || 0;
        rotationState.targetPitch = currentRotationPivot?.rotation.x || 0;
        rotationState.fitShadowWhenSettled = false;
    }

    function updateModelRotation(delta) {
        if (!currentRotationPivot) return false;
        const yawDistance = rotationState.targetYaw - currentRotationPivot.rotation.y;
        const pitchDistance = rotationState.targetPitch - currentRotationPivot.rotation.x;
        const settled = Math.abs(yawDistance) < ROTATION_SETTLE_EPSILON
            && Math.abs(pitchDistance) < ROTATION_SETTLE_EPSILON;
        if (settled) {
            currentRotationPivot.rotation.y = rotationState.targetYaw;
            currentRotationPivot.rotation.x = rotationState.targetPitch;
            if (rotationState.fitShadowWhenSettled) {
                rotationState.fitShadowWhenSettled = false;
                currentRotationPivot.updateWorldMatrix(true, true);
                fitShadowCamera(currentRotationPivot);
            }
            return false;
        }
        const easing = 1 - Math.exp(-ROTATION_EASING_PER_SECOND * delta);
        currentRotationPivot.rotation.y += yawDistance * easing;
        currentRotationPivot.rotation.x += pitchDistance * easing;
        keyLight.shadow.needsUpdate = true;
        return true;
    }

    const clearFallback = () => {
        if (!fallbackObject) return;
        scene.remove(fallbackObject);
        disposeObject(fallbackObject);
        fallbackObject = null;
    };

    const showFallback = () => {
        // 模型切换失败时保留当前完整模型，避免加载错误导致画面闪回占位或 T-pose。
        if (currentMesh) return;
        if (!fallbackObject) {
            const material = new THREE.MeshBasicMaterial({
                color: 0x87cefa,
                transparent: true,
                opacity: 0.78,
                wireframe: true
            });
            fallbackObject = new THREE.Group();
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), material);
            head.position.y = 1.25;
            const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 8, 16), material);
            body.position.y = 0.58;
            fallbackObject.add(head, body);
            scene.add(fallbackObject);
            applyShadowFlags(fallbackObject);
        }
        startRendering();
    };

    const stopMotion = () => {
        if (helper.current && currentMesh) {
            try {
                helper.current.remove(currentMesh);
            } catch (error) {
                console.warn('[显示端 PMX] 停止动作失败:', error);
            }
        }
        helper.current = null;
        currentMotionResourceId = null;
    };

    const disposeCurrentModel = () => {
        motionSequence += 1;
        stopMotion();
        if (!currentMesh) return;
        scene.remove(currentRotationPivot || currentMesh);
        currentRotationPivot?.remove(currentMesh);
        disposeObject(currentMesh);
        currentMesh = null;
        currentRotationPivot = null;
        resetModelRotation();
    };

    const renderFrame = (now) => {
        frameHandle = 0;
        if (!visible || disposed) return;
        const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
        lastFrameAt = now;
        if (helper.current) helper.current.update(delta);
        updateModelRotation(delta);
        updateCameraView(delta);
        renderer.render(scene, camera);
        frameHandle = requestAnimationFrame(renderFrame);
    };

    const startRendering = () => {
        if (!visible || disposed || frameHandle) return;
        lastFrameAt = performance.now();
        frameHandle = requestAnimationFrame(renderFrame);
    };

    const resize = (width, height, devicePixelRatio = window.devicePixelRatio || 1) => {
        const safeWidth = Math.max(1, Number(width) || window.innerWidth || 1);
        const safeHeight = Math.max(1, Number(height) || window.innerHeight || 1);
        const pixelRatio = Math.min(2, Math.max(1, Number(devicePixelRatio) || 1));
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(safeWidth, safeHeight, false);
        camera.aspect = safeWidth / safeHeight;
        camera.updateProjectionMatrix();
        applyCameraView();
        startRendering();
    };

    const loadModelMesh = (url) => waitForManagedLoad(
        (loader, resolve, reject) => loader.load(url, resolve, undefined, reject),
        'PMX 模型'
    );

    const loadAnimationClip = (url, mesh) => waitForManagedLoad(
        (loader, resolve, reject) => loader.loadAnimation(url, mesh, resolve, undefined, reject),
        'VMD 动作'
    );

    const createMotionHelper = (mesh, clip, playMode = 'loop') => {
        const shouldLoop = playMode !== 'once';
        const nextHelper = new MMDAnimationHelper({ sync: false, pmxAnimation: true });
        // physics=false 避免浏览器端额外加载 Ammo；IK 和 grant 仍由 helper 更新。
        nextHelper.add(mesh, { animation: clip, physics: false });
        const animationState = nextHelper.objects.get(mesh);
        const action = animationState?.mixer?._actions?.[0];
        if (action) {
            action.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);
            action.clampWhenFinished = !shouldLoop;
            action.reset().play();
        }
        return nextHelper;
    };

    const validateMotionResource = (profile, resourceId) => {
        if (!profile || resourceId !== profile.motionResourceId) {
            throw new Error('动作资源不在当前 PMX profile 白名单中');
        }
        if (!isSameOriginMmdAsset(profile.motionUrl, '.vmd')) {
            throw new Error('VMD 地址必须是同源 MMD 资源');
        }
    };

    const prepareMotion = async (mesh, profile, resourceId) => {
        validateMotionResource(profile, resourceId);
        const clip = await loadAnimationClip(profile.motionUrl, mesh);
        return createMotionHelper(mesh, clip, profile.playMode);
    };

    const disposeStagedResources = (mesh, stagedHelper) => {
        if (stagedHelper && mesh) {
            try {
                stagedHelper.remove(mesh);
            } catch (error) {
                console.warn('[显示端 PMX] 释放待提交动作失败:', error);
            }
        }
        if (mesh) disposeObject(mesh);
    };

    const loadMotionInternal = async (resourceId) => {
        validateMotionResource(currentProfile, resourceId);
        if (!currentMesh) throw new Error('当前 PMX 模型尚未加载');
        const sequence = ++motionSequence;
        const mesh = currentMesh;
        const profile = currentProfile;
        const nextHelper = await prepareMotion(mesh, profile, resourceId);
        if (disposed || sequence !== motionSequence || mesh !== currentMesh || profile !== currentProfile) {
            disposeStagedResources(mesh, nextHelper);
            return false;
        }
        stopMotion();
        helper.current = nextHelper;
        currentMotionResourceId = resourceId;
        return true;
    };

    const loadMotion = async (resourceId) => {
        try {
            const loaded = await loadMotionInternal(resourceId);
            if (loaded) onStatus('VMD 动作已加载');
            return loaded;
        } catch (error) {
            onStatus(`VMD 动作加载失败：${error.message}`);
            return false;
        }
    };

    const load = async (profile) => {
        if (!profile || profile.modelType !== 'pmx' || !isSameOriginMmdAsset(profile.modelUrl, '.pmx')) {
            throw new Error('PMX profile 或模型地址无效');
        }
        disposed = false;
        const sequence = ++modelSequence;
        let stagedMesh = null;
        let stagedHelper = null;
        onStatus('正在加载 PMX 模型…');
        try {
            stagedMesh = await loadModelMesh(profile.modelUrl);
            normalizeModel(stagedMesh);
            if (profile.motionUrl && profile.motionResourceId) {
                stagedHelper = await prepareMotion(stagedMesh, profile, profile.motionResourceId);
            }
            if (disposed || sequence !== modelSequence) {
                disposeStagedResources(stagedMesh, stagedHelper);
                return false;
            }

            // PMX、纹理和 VMD 准备完成后一次性替换当前模型，避免半成品穿帮。
            clearFallback();
            disposeCurrentModel();
            currentMesh = stagedMesh;
            currentRotationPivot = createModelRotationPivot(currentMesh);
            resetModelRotation();
            currentProfile = profile;
            helper.current = stagedHelper;
            currentMotionResourceId = profile.motionResourceId || null;
            applyShadowFlags(currentMesh);
            scene.add(currentRotationPivot);
            fitShadowCamera(currentRotationPivot);
            stagedMesh = null;
            stagedHelper = null;
            onStatus('PMX 模型已加载');
            startRendering();
            return true;
        } catch (error) {
            const partialMesh = error?.partialResult;
            if (!stagedMesh && partialMesh?.isObject3D) stagedMesh = partialMesh;
            disposeStagedResources(stagedMesh, stagedHelper);
            throw error instanceof Error ? error : new Error('PMX 模型加载失败');
        }
    };

    const playMotion = async (resourceId) => loadMotion(resourceId);

    const handleActionPlan = (plan) => {
        const steps = Array.isArray(plan?.steps) ? plan.steps : [];
        return Promise.all(steps
            .filter((step) => step?.type === 'MOTION_ADD' && typeof step.resourceId === 'string')
            .map((step) => playMotion(step.resourceId)))
            .then((results) => results.every(Boolean));
    };

    const setVisible = (nextVisible) => {
        visible = nextVisible === true;
        if (visible) {
            startRendering();
            return;
        }
        if (frameHandle) cancelAnimationFrame(frameHandle);
        frameHandle = 0;
    };

    const rotateModelBy = (yawRadians, pitchRadians = 0) => {
        if (!currentMesh || !currentRotationPivot) return false;
        const yawDelta = Number(yawRadians);
        const pitchDelta = Number(pitchRadians);
        if (!Number.isFinite(yawDelta) || !Number.isFinite(pitchDelta)) return false;
        if (Math.abs(yawDelta) < Number.EPSILON && Math.abs(pitchDelta) < Number.EPSILON) return false;
        rotationState.targetYaw += yawDelta;
        rotationState.targetPitch = Math.max(
            -MAX_MODEL_PITCH_RADIANS,
            Math.min(MAX_MODEL_PITCH_RADIANS, rotationState.targetPitch + pitchDelta)
        );
        startRendering();
        return true;
    };

    const finishModelRotation = () => {
        if (!currentRotationPivot) return false;
        rotationState.fitShadowWhenSettled = true;
        updateModelRotation(0);
        startRendering();
        return true;
    };

    const raycast = (point) => {
        if (!currentRotationPivot || !point) return null;
        pointer.set(Number(point.normalizedX) || 0, Number(point.normalizedY) || 0);
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObject(currentRotationPivot, true);
        return intersections.length ? classifyHit(intersections[0].object) : null;
    };

    const dispose = () => {
        disposed = true;
        modelSequence += 1;
        motionSequence += 1;
        if (frameHandle) cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        disposeCurrentModel();
        clearFallback();
        scene.remove(shadowPlane);
        disposeObject(shadowPlane);
        renderer.dispose();
    };

    return Object.freeze({
        dispose,
        handleActionPlan,
        load,
        loadMotion,
        playMotion,
        raycast,
        rotateModelBy,
        finishModelRotation,
        setCameraViewRotation,
        resize,
        setLighting,
        setVisible,
        showFallback
    });
}

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
import { ensureAmmoPhysics } from './mmd-ammo-physics.mjs';
import {
    createPmxMotionHelper,
    stagePmxMesh,
    advancePmxMotionFrame
} from './mmd-pmx-helper.mjs';
import { calculatePmxCameraFrame, normalizePmxPhysicsMesh } from './pmx-display-layout.mjs';
import { createPmxAmbientOcclusion } from './display-pmx-ao.mjs';

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
const KEY_LIGHT_DISTANCE = Math.hypot(1.5, 3, 2.5);

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
    return normalizePmxPhysicsMesh(mesh, THREE);
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
    // 体感环绕只允许改变 yaw/pitch；距离固定，避免手机姿态输入变成缩放或推拉镜头。
    let cameraDistance = TARGET_MODEL_HEIGHT * 2.8;
    const cameraViewState = {
        targetYaw: 0,
        targetPitch: 0,
        currentYaw: 0,
        currentPitch: 0
    };

    const applyCameraView = () => {
        const cosPitch = Math.cos(cameraViewState.currentPitch);
        camera.position.set(
            cameraTarget.x + Math.sin(cameraViewState.currentYaw) * cosPitch * cameraDistance,
            cameraTarget.y + Math.sin(cameraViewState.currentPitch) * cameraDistance,
            cameraTarget.z + Math.cos(cameraViewState.currentYaw) * cosPitch * cameraDistance
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
    const ambientOcclusion = createPmxAmbientOcclusion({ THREE, renderer, scene, camera });
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
    let pmxAoEnabled = true;
    const lightingState = {
        ambientColor: '#ffffff',
        ambientIntensity: 1.8,
        keyColor: '#ffffff',
        keyIntensity: 2.3,
        keyDirection: { longitude: 31, latitude: 46 },
        physicsFps: 65,
        rotationPhysicsLimit: 180,
        pmxAoColor: '#931231',
        pmxAoIntensity: 0.6,
        pmxAoRadiusPercent: 6,
        pmxAoResolution: 'half'
    };

    const getModelBounds = (root) => {
        if (root?.isObject3D) {
            const bounds = new THREE.Box3().setFromObject(root);
            if (!bounds.isEmpty()) return bounds;
        }
        return new THREE.Box3(
            new THREE.Vector3(-TARGET_MODEL_HEIGHT * 0.25, 0, -TARGET_MODEL_HEIGHT * 0.25),
            new THREE.Vector3(TARGET_MODEL_HEIGHT * 0.25, TARGET_MODEL_HEIGHT, TARGET_MODEL_HEIGHT * 0.25)
        );
    };

    const applyKeyLightPosition = (bounds) => {
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const unitScale = Math.max(0.01, size.y / TARGET_MODEL_HEIGHT);
        const position = lightDirectionToPosition(lightingState.keyDirection);
        keyLight.position.set(
            center.x + position.x * unitScale,
            center.y + position.y * unitScale,
            center.z + position.z * unitScale
        );
    };

    const applyAoRadius = (bounds) => {
        // AO 半径随当前角色包围盒缩放；调整滑块或换模型时都沿用同一比例。
        const modelHeight = bounds.getSize(new THREE.Vector3()).y;
        ambientOcclusion.setRadius(Math.max(0.005, modelHeight * lightingState.pmxAoRadiusPercent / 100));
    };

    const fitCameraToModel = (root) => {
        const bounds = getModelBounds(root);
        const frame = calculatePmxCameraFrame(bounds, {
            fovDegrees: camera.fov,
            aspect: camera.aspect
        });
        camera.near = frame.near;
        camera.far = frame.far;
        cameraTarget.copy(frame.center);
        cameraDistance = frame.distance;
        applyCameraView();
        camera.updateProjectionMatrix();
        applyAoRadius(bounds);
        return frame;
    };

    const applyShadowFlags = (root) => {
        root?.traverse?.((object) => {
            if (!object.isMesh) return;
            object.castShadow = shadowEnabled;
            object.receiveShadow = shadowEnabled;
        });
    };

    const fitShadowCamera = (root) => {
        const shadowCamera = keyLight.shadow.camera;
        const bounds = getModelBounds(root);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const radius = Math.max(TARGET_MODEL_HEIGHT * 0.65, size.length() * 0.5);
        const extent = radius * SHADOW_FRUSTUM_MARGIN;
        applyKeyLightPosition(bounds);
        shadowPlane.scale.setScalar(Math.max(1, Math.max(size.x, size.z) * 2 / 8));
        shadowPlane.position.y = bounds.min.y - Math.max(0.001, size.y * 0.0001);
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

    const normalizePhysicsFps = (value) => {
        const clamped = normalizeLightNumber(value, 30, 90, lightingState.physicsFps);
        return Math.round(clamped / 5) * 5;
    };

    const normalizeRotationPhysicsLimit = (value) => {
        const clamped = normalizeLightNumber(value, 30, 720, lightingState.rotationPhysicsLimit);
        return Math.round(clamped / 10) * 10;
    };

    const normalizeLightColor = (value, fallback = '#ffffff') => {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/iu.test(color) ? color : fallback;
    };

    const normalizeLightDirection = (value) => ({
        longitude: normalizeLightNumber(value?.longitude, -180, 180, 31),
        latitude: normalizeLightNumber(value?.latitude, -90, 90, 46)
    });

    const lightDirectionToPosition = (value) => {
        const direction = normalizeLightDirection(value);
        const longitude = direction.longitude * Math.PI / 180;
        const latitude = direction.latitude * Math.PI / 180;
        const horizontalDistance = Math.cos(latitude) * KEY_LIGHT_DISTANCE;
        return {
            x: Math.sin(longitude) * horizontalDistance,
            y: Math.sin(latitude) * KEY_LIGHT_DISTANCE,
            z: Math.cos(longitude) * horizontalDistance
        };
    };

    const setLighting = (lighting = {}) => {
        const keyDirection = normalizeLightDirection(lighting.keyDirection);
        lightingState.ambientColor = normalizeLightColor(lighting.ambientColor);
        lightingState.ambientIntensity = normalizeLightNumber(lighting.ambientIntensity, 0, 4, 1.8);
        lightingState.keyColor = normalizeLightColor(lighting.keyColor);
        lightingState.keyIntensity = normalizeLightNumber(lighting.keyIntensity, 0, 5, 2.3);
        lightingState.keyDirection = keyDirection;
        lightingState.physicsFps = normalizePhysicsFps(lighting.physicsFps);
        lightingState.rotationPhysicsLimit = normalizeRotationPhysicsLimit(lighting.rotationPhysicsLimit);
        lightingState.pmxAoColor = normalizeLightColor(lighting.pmxAoColor, '#931231');
        lightingState.pmxAoIntensity = normalizeLightNumber(lighting.pmxAoIntensity, 0, 2, 0.6);
        lightingState.pmxAoRadiusPercent = Math.round(normalizeLightNumber(lighting.pmxAoRadiusPercent, 1, 20, 6));
        lightingState.pmxAoResolution = lighting.pmxAoResolution === 'full' ? 'full' : 'half';
        const currentPhysics = helper.current?.objects?.get(currentMesh)?.physics;
        if (currentPhysics) currentPhysics.unitStep = 1 / lightingState.physicsFps;
        ambientLight.color.set(lightingState.ambientColor);
        ambientLight.intensity = lightingState.ambientIntensity;
        keyLight.color.set(lightingState.keyColor);
        keyLight.intensity = lightingState.keyIntensity;
        shadowEnabled = lighting.shadowEnabled !== false;
        pmxAoEnabled = lighting.pmxAoEnabled !== false;
        ambientOcclusion.setEnabled(pmxAoEnabled);
        ambientOcclusion.setResolution(lightingState.pmxAoResolution);
        ambientOcclusion.setColor(lightingState.pmxAoColor);
        ambientOcclusion.setIntensity(lightingState.pmxAoIntensity);
        applyAoRadius(getModelBounds(currentRotationPivot || currentMesh));
        applyShadowMode();
        return {
            ambientColor: lightingState.ambientColor,
            ambientIntensity: ambientLight.intensity,
            keyColor: lightingState.keyColor,
            keyIntensity: keyLight.intensity,
            keyDirection,
            shadowEnabled,
            physicsFps: lightingState.physicsFps,
            rotationPhysicsLimit: lightingState.rotationPhysicsLimit,
            pmxAoEnabled,
            pmxAoColor: lightingState.pmxAoColor,
            pmxAoIntensity: lightingState.pmxAoIntensity,
            pmxAoRadiusPercent: lightingState.pmxAoRadiusPercent,
            pmxAoResolution: lightingState.pmxAoResolution
        };
    };

    const helper = { current: null };
    const physicsGate = { paused: false };
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
        physicsGate.paused = false;
    }

    function updateModelRotation(delta) {
        if (!currentRotationPivot) return false;
        const yawDistance = rotationState.targetYaw - currentRotationPivot.rotation.y;
        const pitchDistance = rotationState.targetPitch - currentRotationPivot.rotation.x;
        const settled = Math.abs(yawDistance) < ROTATION_SETTLE_EPSILON
            && Math.abs(pitchDistance) < ROTATION_SETTLE_EPSILON;
        if (settled) {
            const pivotMoved = Math.abs(yawDistance) >= Number.EPSILON
                || Math.abs(pitchDistance) >= Number.EPSILON;
            currentRotationPivot.rotation.y = rotationState.targetYaw;
            currentRotationPivot.rotation.x = rotationState.targetPitch;
            if (rotationState.fitShadowWhenSettled) {
                rotationState.fitShadowWhenSettled = false;
                currentRotationPivot.updateWorldMatrix(true, true);
                fitShadowCamera(currentRotationPivot);
            }
            return pivotMoved ? Math.hypot(yawDistance, pitchDistance) : 0;
        }
        const easing = 1 - Math.exp(-ROTATION_EASING_PER_SECOND * delta);
        currentRotationPivot.rotation.y += yawDistance * easing;
        currentRotationPivot.rotation.x += pitchDistance * easing;
        keyLight.shadow.needsUpdate = true;
        return Math.hypot(yawDistance * easing, pitchDistance * easing);
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
        // 先推进角色中心缓动，让物理从新骨骼姿态移动运动学锚点；
        // 动态布料刚体留在 Bullet 世界，由约束牵引并保留已有速度。
        advancePmxMotionFrame({
            delta,
            advanceRotation: updateModelRotation,
            helper: helper.current,
            pivot: currentRotationPivot,
            physics: helper.current?.objects?.get(currentMesh)?.physics,
            physicsGate,
            rotationPhysicsLimit: lightingState.rotationPhysicsLimit
        });
        updateCameraView(delta);
        if (currentMesh) ambientOcclusion.render();
        else renderer.render(scene, camera);
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
        const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
        ambientOcclusion.resize(drawingSize.x, drawingSize.y);
        camera.aspect = safeWidth / safeHeight;
        fitCameraToModel(currentRotationPivot || currentMesh);
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

    const createMotionHelper = async (mesh, clip, playMode = 'loop') => {
        const prepared = await createPmxMotionHelper({
            mesh,
            clip,
            playMode,
            MMDAnimationHelper,
            loopRepeat: THREE.LoopRepeat,
            loopOnce: THREE.LoopOnce,
            physicsFps: lightingState.physicsFps,
            // 仅刚体 PMX 才会在这里惰性初始化 Ammo；失败时 helper 自动回退为无物理解算。
            ensurePhysics: ensureAmmoPhysics
        });
        const physics = prepared.helper?.objects?.get(mesh)?.physics;
        if (physics) physics.unitStep = 1 / lightingState.physicsFps;
        return prepared;
    };

    const validateMotionResource = (profile, resourceId) => {
        if (!profile || resourceId !== profile.motionResourceId) {
            throw new Error('动作资源不在当前 PMX profile 白名单中');
        }
        if (!isSameOriginMmdAsset(profile.motionUrl, '.vmd')) {
            throw new Error('VMD 地址必须是同源 MMD 资源');
        }
    };

    const preparePmxHelper = async (mesh, profile, resourceId = profile.motionResourceId) => {
        let clip = null;
        if (resourceId && profile.motionUrl) {
            validateMotionResource(profile, resourceId);
            clip = await loadAnimationClip(profile.motionUrl, mesh);
        }
        return createMotionHelper(mesh, clip, profile.playMode);
    };

    const disposeStagedResources = (mesh, stagedHelper, stagedPivot = null) => {
        if (stagedPivot) scene.remove(stagedPivot);
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
        const preparedHelper = await preparePmxHelper(mesh, profile, resourceId);
        const nextHelper = preparedHelper.helper;
        if (disposed || sequence !== motionSequence || mesh !== currentMesh || profile !== currentProfile) {
            disposeStagedResources(mesh, nextHelper);
            return false;
        }
        stopMotion();
        helper.current = nextHelper;
        currentMotionResourceId = resourceId;
        return preparedHelper;
    };

    const loadMotion = async (resourceId) => {
        try {
            const preparedHelper = await loadMotionInternal(resourceId);
            if (!preparedHelper) return false;
            onStatus(preparedHelper.physicsError
                ? `PMX 物理不可用，已回退骨骼动画：${preparedHelper.physicsError.message}`
                : 'VMD 动作已加载');
            return true;
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
        let stagedPivot = null;
        let stagedPhysicsError = null;
        onStatus('正在加载 PMX 模型…');
        try {
            stagedMesh = await loadModelMesh(profile.modelUrl);
            // MMDLoader 把 PMX 材质的环境色映射成 emissive；按显示端规则始终忽略这部分亮度。
            stagedMesh.traverse((object) => {
                if (!object.isMesh) return;
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                for (const material of materials) {
                    if (material?.isMMDToonMaterial) material.emissive.setRGB(0, 0, 0);
                }
            });
            normalizeModel(stagedMesh);
            const staged = await stagePmxMesh({
                scene,
                mesh: stagedMesh,
                createPivot: createModelRotationPivot,
                prepareHelper: () => preparePmxHelper(stagedMesh, profile)
            });
            stagedPivot = staged.pivot;
            stagedHelper = staged.preparedHelper.helper;
            stagedPhysicsError = staged.preparedHelper.physicsError;
            if (disposed || sequence !== modelSequence) {
                disposeStagedResources(stagedMesh, stagedHelper, stagedPivot);
                return false;
            }

            // 暂存枢轴已在最终场景中完成初始状态准备，提交后下一帧才推进物理。
            clearFallback();
            disposeCurrentModel();
            currentMesh = stagedMesh;
            currentRotationPivot = stagedPivot;
            resetModelRotation();
            currentRotationPivot.updateWorldMatrix(true, true);
            currentProfile = profile;
            helper.current = stagedHelper;
            currentMotionResourceId = profile.motionResourceId || null;
            applyShadowFlags(currentMesh);
            stagedPivot.visible = true;
            fitCameraToModel(currentRotationPivot);
            fitShadowCamera(currentRotationPivot);
            stagedMesh = null;
            stagedHelper = null;
            stagedPivot = null;
            onStatus(stagedPhysicsError
                ? `PMX 物理不可用，已回退骨骼动画：${stagedPhysicsError.message}`
                : 'PMX 模型已加载');
            startRendering();
            return true;
        } catch (error) {
            const partialMesh = error?.partialResult;
            if (!stagedMesh && partialMesh?.isObject3D) stagedMesh = partialMesh;
            disposeStagedResources(stagedMesh, stagedHelper, stagedPivot);
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
        ambientOcclusion.dispose();
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

import { calculateCanvasSize } from './mmd-render-settings.mjs';
import { runTemporalAction } from './mmd-temporal-aa.mjs';
import { DEFAULT_AR_CAMERA_SETTINGS, normalizeArCameraSettings, classifyHit, disposeObject, waitForManagedLoad, normalizeModel, createModelRotationPivot } from './mmd-runtime-utils.mjs';
import { createPmxLighting } from './mmd-lighting-runtime.mjs';
import { createPmxArCamera } from './mmd-ar-camera-runtime.mjs';
import { createPmxModelResources } from './mmd-model-runtime.mjs';
import { createManualExpressions } from './mmd-expressions.mjs';
import { createPmxCameraMotion } from './mmd-camera-motion.mjs';
import { normalizeWindSettings } from './mmd-physics-wind.mjs';
import { configureLocalLoader as configureCameraMotionLoader } from './mmd-local-assets.mjs';
import { getWebPhysicsStepOptions, normalizeWebStabilityReference } from './mmd-physics-rate.mjs';
import { prepareMotionSwitch, clearPmxPhysicsMotion } from './mmd-motion-switch.mjs';
import { configureLocalLoader, validateLocalModel, isRegisteredLocalAsset } from './mmd-local-assets.mjs';
import { createGravityFilter } from './mmd-gravity-filter.mjs';
import { createShadowCameraAlignment, releaseShadowTargets } from "./mmd-shadow-camera.mjs";
/*
 * 浏览器端 PMX/VMD 运行时。
 *
 * PMX 的纹理路径由 MMDLoader 以 PMX 所在目录为基准解析，因此模型目录、tex/
 * 和 toon/ 必须由服务端以同源模型或静态代理路径提供。运行时只接受已由显示模块
 * 校验过的 profile/resourceId，不接受动作计划传入的任意 URL。
 */
import * as THREE from 'three';
import { createArFootAnchor } from './display-mmd-ar-pose.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { ensureAmmoPhysics } from './mmd-ammo-physics.mjs';
import {
    createPmxMotionHelper,
    stagePmxMesh,
    advancePmxMotionFrame,
    setPmxMotionPlaybackEnabled
} from './mmd-pmx-helper.mjs';
import {
    calculatePmxCameraFrame,
    normalizePmxPhysicsMesh,
    normalizePmxProjectionNear,
    PMX_CAMERA_NEAR
} from './pmx-display-layout.mjs';
import { createPmxAmbientOcclusion } from './display-pmx-ao.mjs';
import { preparePmxLightingMaterial, setPmxLightingMode, setPmxRimLights, setPmxFillShadowMode } from './display-pmx-lighting-mode.mjs';
const TARGET_MODEL_HEIGHT = 1.75;
const MINIMUM_CAMERA_ZOOM = 0.1;
const MAXIMUM_CAMERA_ZOOM = 10;
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
const isSameOriginMmdAsset = (url, extension) => {
    if (isRegisteredLocalAsset(url, extension)) return true;
    if (typeof url !== 'string' || url.includes('://') || url.startsWith('//')
        || url.includes('..') || /[?#\\]/u.test(url)) return false;
    const isVersionedStaticAsset = /^\/api\/mmd\/static\/[a-f0-9]{64}\/mmd\//iu.test(url);
    return (MMD_MODEL_PREFIXES.some((prefix) => url.startsWith(prefix)) || isVersionedStaticAsset)
        && url.toLowerCase().endsWith(extension);
};
export function createDisplayPmxRuntime({ canvas, onStatus = () => {}, onProgress = () => {} } = {}) {
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
    const camera = new THREE.PerspectiveCamera(28, 1, PMX_CAMERA_NEAR, 100);
    camera.position.set(0, TARGET_MODEL_HEIGHT * 0.55, TARGET_MODEL_HEIGHT * 2.8);
    const cameraTarget = new THREE.Vector3(0, TARGET_MODEL_HEIGHT * 0.5, 0);
    let cameraZoomFactor = 1;
    let cameraDistance = TARGET_MODEL_HEIGHT * 2.8;
    const cameraViewState = {
        targetYaw: 0,
        targetPitch: 0,
        currentYaw: 0,
        currentPitch: 0
    };
    const applyCameraView = () => {
        const cosPitch = Math.cos(cameraViewState.currentPitch);
        const distance = cameraDistance / cameraZoomFactor;
        const target = cameraTarget;
        camera.position.set(
            target.x + Math.sin(cameraViewState.currentYaw) * cosPitch * distance,
            target.y + Math.sin(cameraViewState.currentPitch) * distance,
            target.z + Math.cos(cameraViewState.currentYaw) * cosPitch * distance
        );
        camera.lookAt(target);
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
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    const ambientOcclusion = createPmxAmbientOcclusion({ THREE, renderer, scene, camera, keyLight });
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0);
    fillLight.castShadow = false;
    keyLight.position.set(1.5, 3, 2.5);
    keyLight.castShadow = true;
    // 两盏方向光沿用相同阴影质量参数，但运行时只允许所选光源生成一张阴影贴图。
    for (const light of [keyLight, fillLight]) {
        light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 20;
        light.shadow.camera.left = -5;
        light.shadow.camera.right = 5;
        light.shadow.camera.top = 5;
        light.shadow.camera.bottom = -5;
        light.shadow.bias = -0.0005;
        light.shadow.normalBias = 0.02;
    }
    // 仅独立测试生成副本：渲染前读取主光设置，不改正式配置或补光自己的阴影。
    const syncTestKeyShadowBias = (() => {

      const shadowBiasFields = [{"key":"bias","id":"mmdArKeyShadowBias","label":"阴影深度偏移 bias","min":-0.005,"max":0.005,"step":0.0001,"digits":4,"defaultValue":-0.0005},{"key":"normalBias","id":"mmdArKeyShadowNormalBias","label":"阴影法线偏移 normalBias","min":0,"max":0.1,"step":0.001,"digits":3,"defaultValue":0.02}];
      function normalizeShadowBias(value, field) {
  // 空值、布尔值和对象不参与 Number 隐式换算，避免误把坏存储值解释为零。
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return field.defaultValue;
  const number = Number(value);
  if (!Number.isFinite(number)) return field.defaultValue;
  const bounded = Math.min(field.max, Math.max(field.min, number));
  return Number((Math.round(bounded / field.step) * field.step).toFixed(field.digits));
}
      let appliedSettings = null;
      return () => {
        const settings = window.DisplayMmdKeyShadowSettings;
        if (!settings || settings === appliedSettings) return;
        const bias = normalizeShadowBias(settings.bias, shadowBiasFields[0]);
        const normalBias = normalizeShadowBias(settings.normalBias, shadowBiasFields[1]);
        appliedSettings = settings;
        if (keyLight.shadow.bias === bias && keyLight.shadow.normalBias === normalBias) return;
        keyLight.shadow.bias = bias;
        keyLight.shadow.normalBias = normalBias;
        keyLight.shadow.needsUpdate = true;
      };
    })();
    syncTestKeyShadowBias();
    function normalizeShadowMapSize(value, maxSize = 4096) {
  const sizes = [512, 1024, 2048, 4096];
  const requested = ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
    && sizes.includes(Number(value)) ? Number(value) : 1024;
  const limit = Number.isFinite(Number(maxSize)) && Number(maxSize) >= 1 ? Number(maxSize) : 4096;
  const supported = sizes.filter(size => size <= limit && size <= requested);
  return supported.at(-1) || Math.min(512, 2 ** Math.floor(Math.log2(limit)));
}
    function normalizeShadowCameraScale(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return 1;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Number((Math.round(Math.max(0.1, Math.min(2, number)) * 100) / 100).toFixed(2));
}
    const alignTestShadowCamera = createShadowCameraAlignment(THREE);
    let shadowFollowRoot = null;
    const shadowFollowPosition = new THREE.Vector3();
    const shadowFollowScale = new THREE.Vector3();
    const shadowRootPosition = new THREE.Vector3();
    const shadowRootScale = new THREE.Vector3();
    const shadowFollowDelta = new THREE.Vector3();
    let shadowFitCount = 0;
    let shadowTranslationCount = 0;
    const captureTestShadowRoot = (root) => {
        shadowFollowRoot = root?.isObject3D ? root : null;
        if (!shadowFollowRoot) return;
        root.getWorldPosition(shadowFollowPosition);
        root.getWorldScale(shadowFollowScale);
    };
    // 纯平移只搬动已拟合的灯位/目标/承接面；换根或缩放才重新计算角色包围范围。
    const followTestShadowRoot = () => {
        const root = currentRotationPivot || currentMesh;
        if (!root) { shadowFollowRoot = null; return; }
        root.getWorldPosition(shadowRootPosition);
        root.getWorldScale(shadowRootScale);
        if (root !== shadowFollowRoot || shadowRootScale.distanceToSquared(shadowFollowScale) > 1e-16) {
            fitShadowCamera(root);
            return;
        }
        shadowFollowDelta.subVectors(shadowRootPosition, shadowFollowPosition);
        if (shadowFollowDelta.lengthSq() <= 1e-20) return;
        for (const light of [keyLight, fillLight]) {
            light.position.add(shadowFollowDelta);
            light.target.position.add(shadowFollowDelta);
            light.shadow.needsUpdate = true;
        }
        shadowPlane.position.add(shadowFollowDelta);
        shadowFollowPosition.copy(shadowRootPosition);
        shadowTranslationCount += 1;
    };
    const shadowMapLimit = renderer.capabilities.maxTextureSize;
    window.DisplayMmdShadowMapLimit = shadowMapLimit;
    window.dispatchEvent(new CustomEvent('mmd-ar-shadow-map-limit'));
    // 初次同步发生在fitShadowCamera/角色变量声明前，初值不触发拟合；模型提交会正常拟合。
    let appliedShadowCameraScale = normalizeShadowCameraScale(window.DisplayMmdShadowMapSettings?.cameraScale);
    const syncTestShadowMapSize = () => {
        const settings = window.DisplayMmdShadowMapSettings;
        const size = normalizeShadowMapSize(settings?.size, shadowMapLimit);
        for (const light of [keyLight, fillLight]) {
            if (light.shadow.mapSize.x === size && light.shadow.mapSize.y === size) continue;
            releaseShadowTargets(light.shadow);
            light.shadow.mapSize.set(size, size);
            light.shadow.needsUpdate = true;
        }
        const cameraScale = normalizeShadowCameraScale(settings?.cameraScale);
        if (cameraScale !== appliedShadowCameraScale) {
            appliedShadowCameraScale = cameraScale;
            fitShadowCamera(currentRotationPivot || currentMesh);
        }
    };
    syncTestShadowMapSize();
    const shadowMaterial = new THREE.ShadowMaterial({
        color: 0x000000,
        opacity: 0.28,
        transparent: true,
        depthWrite: false
    });
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), shadowMaterial);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    scene.add(ambientLight, keyLight, keyLight.target, fillLight, fillLight.target, shadowPlane);
    let shadowEnabled = true;
    let shadowSource = 'key';
    let webFillShadowMode = false;
    let keyShadowEnabled = true;
    let pmxAoEnabled = true;
    const lightingState = {
        ambientColor: '#ffffff',
        ambientIntensity: 1.8,
        keyColor: '#ffffff',
        keyIntensity: 2.3,
        keyDirection: { longitude: 31, latitude: 46 },
        fillEnabled: false,
        fillColor: '#ffffff',
        fillIntensity: 1,
        fillDirection: { longitude: -45, latitude: 25 },
        rimLights: [
            { enabled: false, color: '#8acbff', intensity: 1, direction: { longitude: -130, latitude: 25 } },
            { enabled: false, color: '#ffb6d9', intensity: 1, direction: { longitude: 130, latitude: 25 } }
        ],
        pmxToonEnabled: false,
        physicsFps: 90,
        rotationPhysicsLimit: 720,
        pmxAoColor: '#931231',
        pmxAoIntensity: 0.6,
        pmxAoRadiusPercent: 6,
        pmxAoResolution: 'half',
        pmxAoSampleCount: 24,
        pmxAoBlurPassCount: 1,
        pmxAoBlurRadii: [3, 3, 3]
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
        const fillPosition = lightDirectionToPosition(lightingState.fillDirection);
        fillLight.position.set(
            center.x + fillPosition.x * unitScale,
            center.y + fillPosition.y * unitScale,
            center.z + fillPosition.z * unitScale
        );
        fillLight.target.position.copy(center);
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
        cameraZoomFactor = 1;
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
        const bounds = getModelBounds(root);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const radius = Math.max(TARGET_MODEL_HEIGHT * 0.65, size.length() * 0.5);
        const extent = radius * SHADOW_FRUSTUM_MARGIN * 0.5 * normalizeShadowCameraScale(window.DisplayMmdShadowMapSettings?.cameraScale);
        applyKeyLightPosition(bounds);
        shadowPlane.scale.setScalar(Math.max(1, Math.max(size.x, size.z) * 2 / 8));
        shadowPlane.position.y = bounds.min.y - Math.max(0.001, size.y * 0.0001);
        for (const light of [keyLight, fillLight]) {
            const shadowCamera = light.shadow.camera;
            const lightDistance = light.position.distanceTo(center);
            light.target.position.copy(center);
            shadowCamera.left = -extent;
            shadowCamera.right = extent;
            shadowCamera.top = extent;
            shadowCamera.bottom = -extent;
            shadowCamera.near = Math.max(0.1, lightDistance - radius * 2.2);
            shadowCamera.far = Math.max(shadowCamera.near + 1, lightDistance + radius * 2.2);
            shadowCamera.updateProjectionMatrix();
            light.shadow.needsUpdate = true;
        }
        shadowPlane.position.x = center.x; shadowPlane.position.z = center.z;
        captureTestShadowRoot(root);
        shadowFitCount += 1;
    };
    const applyShadowMode = () => {
        renderer.shadowMap.enabled = shadowEnabled;
        if (webFillShadowMode) {
            // 网页实验模式下两盏灯的投影独立；补光复用主光模式要求主光投影可用。
            keyLight.castShadow = keyShadowEnabled;
            fillLight.castShadow = lightingState.fillEnabled && shadowSource === 'fill';
        } else {
            keyLight.castShadow = shadowEnabled && shadowSource === 'key';
            fillLight.castShadow = shadowEnabled && shadowSource === 'fill';
        }
        shadowPlane.visible = shadowEnabled;
        applyShadowFlags(currentMesh);
        fitShadowCamera(currentRotationPivot || currentMesh);
    };
    const helper = { current: null };
    // 共用PMX表情覆盖：逐帧恢复动画基线，并在物理前/帧末应用手动选择。
    const manualExpressions = createManualExpressions({
        getMesh: () => currentMesh, getHelper: () => helper.current,
        getProfile: () => currentProfile,
        onChanged: () => { ambientOcclusion.invalidateTemporal(); startRendering(); }
    });
    const physicsGate = { paused: false };
    let motionPlaybackEnabled = true;
    let pendingInitialMotionHelper = null;
    let motionSwitchMesh = null;
    let physicsEnabled = true;
    let physicsSolver = 'ammo';
    function normalizePhysicsSolver(value) {
    return ['xpbd', 'three-xpbd'].includes(value) ? 'xpbd' : 'ammo';
}
    const setPhysicsSolver = (value) => { physicsSolver = normalizePhysicsSolver(value); return physicsSolver; };
    const getPhysicsSolverState = () => {
        const physics = helper.current?.objects?.get(currentMesh)?.physics;
        if (!physics) return { solver: physicsSolver, active: false, bodyCount: 0, frameMs: 0 };
        return { solver: physics.engine || 'ammo', active: physicsEnabled,
            bodyCount: physics.bodies.length, jointCount: physics.constraints.length,
            frameMs: physics.frameMs || 0, ...physics.getState?.() };
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let currentMesh = null;
    const syncTestFillFacingRange = (() => {
      function normalizeFillFacingRange(value = {}, editedKey = '') {
  const normalize = (input, fallback) => {
    if (!['number', 'string'].includes(typeof input) || String(input).trim() === '') return fallback;
    const number = Number(input);
    return Number.isFinite(number) ? Math.round(Math.max(-1, Math.min(1, number)) * 100) / 100 : fallback;
  };
  let start = Math.min(0.99, normalize(value?.start, -0.3));
  let end = Math.max(-0.99, normalize(value?.end, 0.3));
  if (end - start < 0.0099) {
    if (editedKey === 'end') start = Number((end - 0.01).toFixed(2));
    else end = Number((start + 0.01).toFixed(2));
  }
  return { start, end };
}
      let appliedSettings = null;
      let appliedMesh = null;
      return () => {
        const settings = window.DisplayMmdFillFacingRange;
        if (!currentMesh || !settings || (settings === appliedSettings && currentMesh === appliedMesh)) return;
        const range = normalizeFillFacingRange(settings);
        let updated = false;
        currentMesh.traverse(object => {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            const uniform = material?.uniforms?.pmxFillKeyFacingRange;
            if (!uniform) continue;
            uniform.value.set(range.start, range.end);
            updated = true;
          }
        });
        // 材质尚未进入测试阴影路径时继续等待，不缓存未成功应用的模型。
        if (!updated) return;
        appliedSettings = settings;
        appliedMesh = currentMesh;
      };
    })();
    let currentRotationPivot = null;
    const arCameraState = {
        active: false,
        trackingLost: false,
        savedVisible: null,
        targetPosition: null,
        targetWidth: 1,
        settings: { ...DEFAULT_AR_CAMERA_SETTINGS },
        acceptedAnchorPosition: new THREE.Vector3(),
        acceptedAnchorQuaternion: new THREE.Quaternion(),
        acceptedBasePosition: new THREE.Vector3(),
        acceptedPosition: new THREE.Vector3(),
        acceptedQuaternion: new THREE.Quaternion(),
        lastPose: null
    };
    const getArCameraTargetCenter = (aspect = 1) => {
        const center = arCameraState.targetPosition?.clone();
        if (!center) return null;
        if (arCameraState.settings.targetPlane === 'vertical') {
            center.y += arCameraState.targetWidth * aspect / 2;
        }
        return center;
    };
    const zoomCameraBy = (factor) => {
        const numericFactor = Number(factor);
        if (!Number.isFinite(numericFactor) || numericFactor <= 0) return false;
        const nextZoom = Math.max(MINIMUM_CAMERA_ZOOM,
            Math.min(MAXIMUM_CAMERA_ZOOM, cameraZoomFactor * numericFactor));
        if (Math.abs(nextZoom - cameraZoomFactor) < Number.EPSILON) return false;
        if (arCameraState.active) {
            const targetCenter = getArCameraTargetCenter(arCameraState.lastPose?.targetAspect || 1);
            if (!targetCenter) return false;
            const currentBasePosition = camera.position.clone().sub(targetCenter)
                .multiplyScalar(cameraZoomFactor).add(targetCenter);
            cameraZoomFactor = nextZoom;
            arCameraState.acceptedPosition.copy(arCameraState.acceptedBasePosition)
                .sub(targetCenter).multiplyScalar(1 / cameraZoomFactor).add(targetCenter);
            camera.position.copy(currentBasePosition.sub(targetCenter)
                .multiplyScalar(1 / cameraZoomFactor).add(targetCenter));
            camera.updateMatrix();
            camera.updateMatrixWorld(true);
        } else {
            cameraZoomFactor = nextZoom;
            applyCameraView();
        }
        startRendering();
        return true;
    };
    // 手动角度和相机坐标中的重力倾斜分别保存，最终只合成角色锚点四元数。
    const manualRotation = { yaw: 0, pitch: 0 };
    const gravityFilter = createGravityFilter(THREE);
    const setModelGravityRotation = (value, force = false) => {
        if (!gravityFilter.setTarget(value, force)) return false;
        rotationState.fitShadowWhenSettled = true;
        startRendering();
        return true;
    };
    const setModelGravitySettings = (value) => {
        const settings = gravityFilter.setSettings(value);
        rotationState.fitShadowWhenSettled = true;
        startRendering();
        return settings;
    };
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
    let physicsStabilityReferenceHz = 45;
    const setPhysicsStabilityReference = (value) => {
        physicsStabilityReferenceHz = normalizeWebStabilityReference(value);
        const physics = helper.current?.objects?.get(currentMesh)?.physics;
        if (physics) {
            Object.assign(physics, getWebPhysicsStepOptions(lightingState.physicsFps, physicsStabilityReferenceHz));
            // 只改基准不触发变频检测，需显式立即重算六轴纠错率。
            if (typeof physics.setStabilityReferenceHz === 'function') {
                physics.setStabilityReferenceHz(physicsStabilityReferenceHz);
            }
        }
        startRendering();
        return physicsStabilityReferenceHz;
    };
    let windSettings = normalizeWindSettings();
    let windVersion = 0;
    const appliedWindVersions = new WeakMap();
    const syncPhysicsWind = (physics) => {
        if (!physics || appliedWindVersions.get(physics) === windVersion) return;
        physics.setWindSettings(windSettings);
        appliedWindVersions.set(physics, windVersion);
    };
    const setWindSettings = (value) => {
        windSettings = normalizeWindSettings(value);
        windVersion += 1;
        syncPhysicsWind(helper.current?.objects?.get(currentMesh)?.physics);
        startRendering();
        return { ...windSettings };
    };
    let visible = true;
    let disposed = false;
    let fallbackObject = null;
    function resetModelRotation() {
        rotationState.targetYaw = currentRotationPivot?.rotation.y || 0;
        rotationState.targetPitch = currentRotationPivot?.rotation.x || 0;
        manualRotation.yaw = rotationState.targetYaw;
        manualRotation.pitch = rotationState.targetPitch;
        rotationState.fitShadowWhenSettled = false;
        physicsGate.paused = false;
    }
    function updateModelRotation(delta) {
        if (!currentRotationPivot) return false;
        const previous = currentRotationPivot.quaternion.clone();
        const yawDistance = rotationState.targetYaw - manualRotation.yaw;
        const pitchDistance = rotationState.targetPitch - manualRotation.pitch;
        const manualSettled = Math.abs(yawDistance) < ROTATION_SETTLE_EPSILON
            && Math.abs(pitchDistance) < ROTATION_SETTLE_EPSILON;
        const easing = manualSettled ? 1 : 1 - Math.exp(-ROTATION_EASING_PER_SECOND * delta);
        manualRotation.yaw += yawDistance * easing;
        manualRotation.pitch += pitchDistance * easing;
        const gravityQuaternion = gravityFilter.update(delta);
        const settled = manualSettled && gravityFilter.isSettled();
        const manual = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(manualRotation.pitch, manualRotation.yaw, 0, 'XYZ'));
        // 相机方向已经在本帧更新，倾斜先转到世界坐标，再左乘手动角度。
        const worldGravity = camera.quaternion.clone().multiply(gravityQuaternion)
            .multiply(camera.quaternion.clone().invert());
        currentRotationPivot.quaternion.copy(worldGravity.multiply(manual)).normalize();
        const moved = previous.angleTo(currentRotationPivot.quaternion);
        if (moved > Number.EPSILON) {
            keyLight.shadow.needsUpdate = true;
            fillLight.shadow.needsUpdate = true;
        }
        if (settled && rotationState.fitShadowWhenSettled) {
            rotationState.fitShadowWhenSettled = false;
            currentRotationPivot.updateWorldMatrix(true, true);
            fitShadowCamera(currentRotationPivot);
        }
        // 组合后的实际旋转角进入原物理保护，快速重力倾斜也不能绕过保护。
        return moved;
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
        pendingInitialMotionHelper = null;
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
        ambientOcclusion.invalidateTemporal();
        motionSequence += 1;
        stopMotion();
        if (!currentMesh) return;
        resetArCameraPose();
        arFootAnchor.reset();
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
        syncTestKeyShadowBias();
        syncTestFillFacingRange();
        syncTestShadowMapSize();
        const frameSeconds = Math.max(0, (now - lastFrameAt) / 1000);
        // 浏览器后台暂停后不沿用旧时间余量；只同步历史，保留动态布料已有运动。
        if (frameSeconds > 0.1) helper.current?.objects?.get(currentMesh)?.physics?.resetAnchorInterpolation();
        const delta = Math.min(0.1, frameSeconds);
        lastFrameAt = now;
        if (arCameraState.active && !arCameraState.trackingLost) {
            // 以实际帧间隔做指数缓动；只有目标姿态越过死区才会移动。
            const easingSeconds = arCameraState.settings.smoothingMs / 1000;
            const alpha = easingSeconds <= 0 ? 1 : 1 - Math.exp(-delta / easingSeconds);
            camera.position.lerp(arCameraState.acceptedPosition, alpha);
            camera.quaternion.slerp(arCameraState.acceptedQuaternion, alpha);
            camera.updateMatrix();
            camera.updateMatrixWorld(true);
        } else if (!arCameraState.active) {
            if (!advanceCameraMotion(delta)) updateCameraView(delta);
        }
        const frameHelper = motionSwitchMesh === currentMesh ? null : helper.current;
        manualExpressions.before(frameHelper);
        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);
        const delayInitialMotion = frameHelper && pendingInitialMotionHelper === frameHelper;
        if (delayInitialMotion) {
            // 新模型第一个实际显示帧先让物理和画面更新，VMD 从下一帧才推进。
            pendingInitialMotionHelper = null;
            setPmxMotionPlaybackEnabled(frameHelper, false);
        }
        // 先推进角色中心缓动，让物理从新骨骼姿态移动运动学锚点；
        // 动态布料刚体留在 Bullet 世界，由约束牵引并保留已有速度。
        try {
            advancePmxMotionFrame({
                delta,
                advanceRotation: updateModelRotation,
                helper: frameHelper,
                pivot: currentRotationPivot,
                physics: frameHelper?.objects?.get(currentMesh)?.physics,
                physicsGate,
                rotationPhysicsLimit: lightingState.rotationPhysicsLimit
            });
        } finally {
            manualExpressions.after();
            if (delayInitialMotion) setPmxMotionPlaybackEnabled(frameHelper, motionPlaybackEnabled);
        }
        const firstFramePivot = delayInitialMotion ? currentRotationPivot : null;
        const firstFramePivotVisible = firstFramePivot?.visible;
        if (firstFramePivot) firstFramePivot.visible = false;
        try {
            // 首帧物理照常运行，但不把动作起始姿态绘制出来；下一帧才显示模型。
            followTestShadowRoot();
            if (renderer.shadowMap.enabled) {
                for (const light of [keyLight, fillLight]) if (light.castShadow) alignTestShadowCamera(light);
            }
            if (currentMesh) {
                ambientOcclusion.setTemporalContent(currentMesh, currentMotionResourceId, lightingState);
                ambientOcclusion.render();
            }
            else renderer.render(scene, camera);
        } finally {
            // 恢复原始可见性，避免覆盖 AR 失锁或其他显示状态。
            if (firstFramePivot) firstFramePivot.visible = firstFramePivotVisible;
        }
        frameHandle = requestAnimationFrame(renderFrame);
    };
    const startRendering = () => {
        if (!visible || disposed || frameHandle) return;
        lastFrameAt = performance.now();
        frameHandle = requestAnimationFrame(renderFrame);
    };
    const arFootAnchor = createArFootAnchor({
        camera,
        getModelRoot: () => currentRotationPivot,
        getViewport: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
        startRendering
    });
    const resize = (width, height, devicePixelRatio = window.devicePixelRatio || 1) => {
        const safeWidth = Math.max(1, Number(width) || window.innerWidth || 1);
        const safeHeight = Math.max(1, Number(height) || window.innerHeight || 1);
        const gl = renderer.getContext();
        const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
        const renderSize = calculateCanvasSize(safeWidth, safeHeight, devicePixelRatio, window.DisplayMmdRenderSettings?.canvasScale, limit);
        const pixelRatio = renderSize.pixelRatio;
        window.DisplayMmdRenderInfo = { taaSupported: renderer.capabilities.isWebGL2 === true, ...renderSize };
        window.dispatchEvent(new Event('mmd-ar-render-capability'));
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(safeWidth, safeHeight, false);
        const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
        ambientOcclusion.resize(drawingSize.x, drawingSize.y);
        camera.aspect = safeWidth / safeHeight;
        if (!arCameraState.active) camera.updateProjectionMatrix();
        startRendering();
    };
    const playMotion = async (resourceId) => await runTemporalAction(ambientOcclusion.invalidateTemporal, () => loadMotion(resourceId));
    const setMotionPlaybackEnabled = (enabled) => {
        ambientOcclusion.invalidateTemporal();
        motionPlaybackEnabled = enabled === true;
        setPmxMotionPlaybackEnabled(helper.current, motionPlaybackEnabled);
        startRendering();
        return motionPlaybackEnabled;
    };
    const setPhysicsEnabled = (enabled) => {
        // 仅影响下次创建的 helper；调用方重新加载模型，避免把冻结的布料误判为无物理结果。
        physicsEnabled = enabled === true;
        return physicsEnabled;
    };
    const handleActionPlan = (plan) => {
        const steps = Array.isArray(plan?.steps) ? plan.steps : [];
        return Promise.all(steps
            .filter((step) => step?.type === 'MOTION_ADD' && typeof step.resourceId === 'string')
            .map((step) => playMotion(step.resourceId)))
            .then((results) => results.every(Boolean));
    };
    const setVisible = (nextVisible) => {
        if (nextVisible === true && !visible) {
            helper.current?.objects?.get(currentMesh)?.physics?.resetAnchorInterpolation();
        }
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
/* aasc-module-start:mmd-lighting-runtime.mjs */
    const { setLighting, lightDirectionToPosition } = createPmxLighting({
        KEY_LIGHT_DISTANCE,
        ambientLight,
        ambientOcclusion,
        applyAoRadius,
        applyShadowMode,
        fillLight,
        getModelBounds,
        getWebPhysicsStepOptions,
        helper,
        keyLight,
        lightingState,
        setPmxFillShadowMode,
        setPmxLightingMode,
        setPmxRimLights,
        get currentMesh() { return currentMesh; }, set currentMesh(value) { currentMesh = value; },
        get shadowSource() { return shadowSource; }, set shadowSource(value) { shadowSource = value; },
        get shadowEnabled() { return shadowEnabled; }, set shadowEnabled(value) { shadowEnabled = value; },
        get webFillShadowMode() { return webFillShadowMode; }, set webFillShadowMode(value) { webFillShadowMode = value; },
        get keyShadowEnabled() { return keyShadowEnabled; }, set keyShadowEnabled(value) { keyShadowEnabled = value; },
        get pmxAoEnabled() { return pmxAoEnabled; }, set pmxAoEnabled(value) { pmxAoEnabled = value; },
        get physicsStabilityReferenceHz() { return physicsStabilityReferenceHz; }, set physicsStabilityReferenceHz(value) { physicsStabilityReferenceHz = value; },
        get currentRotationPivot() { return currentRotationPivot; }, set currentRotationPivot(value) { currentRotationPivot = value; }
    });
/* aasc-module-end:mmd-lighting-runtime.mjs */
/* aasc-module-start:mmd-ar-camera-runtime.mjs */
    const { resetArCameraPose, resetArPose, suspendArCameraPose, setArCameraSettings, setArCameraPose } = createPmxArCamera({
        THREE,
        applyCameraView,
        arCameraState,
        arFootAnchor,
        camera,
        canvas,
        fitCameraToModel,
        getArCameraTargetCenter,
        getModelBounds,
        normalizeArCameraSettings,
        normalizePmxProjectionNear,
        startRendering,
        get currentMesh() { return currentMesh; }, set currentMesh(value) { currentMesh = value; },
        get currentRotationPivot() { return currentRotationPivot; }, set currentRotationPivot(value) { currentRotationPivot = value; },
        get cameraZoomFactor() { return cameraZoomFactor; }, set cameraZoomFactor(value) { cameraZoomFactor = value; },
        get cameraDistance() { return cameraDistance; }, set cameraDistance(value) { cameraDistance = value; }
    });
/* aasc-module-end:mmd-ar-camera-runtime.mjs */
/* aasc-module-start:mmd-model-runtime.mjs */
    const { load, loadSelectedMotion, loadMotion, validateMotionResource } = createPmxModelResources({
        MMDAnimationHelper,
        THREE,
        applyShadowFlags,
        clearFallback,
        clearPmxPhysicsMotion,
        configureLocalLoader,
        createModelRotationPivot,
        createPmxMotionHelper,
        disposeCurrentModel,
        disposeObject,
        ensureAmmoPhysics,
        fitCameraToModel,
        fitShadowCamera,
        getWebPhysicsStepOptions,
        helper,
        isSameOriginMmdAsset,
        lightingState,
        normalizeModel,
        onProgress,
        onStatus,
        physicsGate,
        prepareMotionSwitch,
        preparePmxLightingMaterial,
        resetModelRotation,
        scene,
        setPmxFillShadowMode,
        setPmxMotionPlaybackEnabled,
        setPmxRimLights,
        stagePmxMesh,
        startRendering,
        stopMotion,
        syncPhysicsWind,
        validateLocalModel,
        waitForManagedLoad,
        get currentMesh() { return currentMesh; }, set currentMesh(value) { currentMesh = value; },
        get currentRotationPivot() { return currentRotationPivot; }, set currentRotationPivot(value) { currentRotationPivot = value; },
        get currentProfile() { return currentProfile; }, set currentProfile(value) { currentProfile = value; },
        get currentMotionResourceId() { return currentMotionResourceId; }, set currentMotionResourceId(value) { currentMotionResourceId = value; },
        get motionSequence() { return motionSequence; }, set motionSequence(value) { motionSequence = value; },
        get modelSequence() { return modelSequence; }, set modelSequence(value) { modelSequence = value; },
        get disposed() { return disposed; }, set disposed(value) { disposed = value; },
        get motionSwitchMesh() { return motionSwitchMesh; }, set motionSwitchMesh(value) { motionSwitchMesh = value; },
        get pendingInitialMotionHelper() { return pendingInitialMotionHelper; }, set pendingInitialMotionHelper(value) { pendingInitialMotionHelper = value; },
        get physicsSolver() { return physicsSolver; }, set physicsSolver(value) { physicsSolver = value; },
        get physicsEnabled() { return physicsEnabled; }, set physicsEnabled(value) { physicsEnabled = value; },
        get physicsStabilityReferenceHz() { return physicsStabilityReferenceHz; }, set physicsStabilityReferenceHz(value) { physicsStabilityReferenceHz = value; },
        get motionPlaybackEnabled() { return motionPlaybackEnabled; }, set motionPlaybackEnabled(value) { motionPlaybackEnabled = value; },
        get keyShadowEnabled() { return keyShadowEnabled; }, set keyShadowEnabled(value) { keyShadowEnabled = value; },
        get shadowSource() { return shadowSource; }, set shadowSource(value) { shadowSource = value; },
        get webFillShadowMode() { return webFillShadowMode; }, set webFillShadowMode(value) { webFillShadowMode = value; }
    });
/* aasc-module-end:mmd-model-runtime.mjs */
    const cameraMotion = createPmxCameraMotion({ THREE, camera, arCameraState, PMX_CAMERA_NEAR,
        MMDAnimationHelper, fitCameraToModel, getModelBounds, validateMotionResource,
        configureCameraMotionLoader, waitForManagedLoad, onProgress, onStatus, startRendering,
        get currentMesh() { return currentMesh; }, get currentProfile() { return currentProfile; },
        get currentRotationPivot() { return currentRotationPivot; }, get disposed() { return disposed; }
    });
    const { advanceCameraMotion, loadCameraMotion, setCameraMotionPlaybackEnabled,
        getCameraMotionProgress, clearCameraMotion } = cameraMotion;
    const dispose = () => {
        manualExpressions.dispose();
        disposed = true;
        cameraMotion.disposeCameraMotion();
        modelSequence += 1;
        motionSequence += 1;
        if (frameHandle) cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        disposeCurrentModel();
        clearFallback();
        scene.remove(shadowPlane);
        disposeObject(shadowPlane);
        for (const light of [keyLight, fillLight]) releaseShadowTargets(light.shadow);
        ambientOcclusion.dispose();
        renderer.dispose();
    };
    return Object.freeze({
        dispose,
        getArCameraSyncState: () => window.MmdArAframeMode || window.MmdArTestAframeMode === true ? {
            active: arCameraState.active,
            trackingLost: arCameraState.trackingLost
        } : null,
        getArCameraState: () => window.MmdArAframeMode || window.MmdArTestAframeMode === true ? {
            active: arCameraState.active,
            cameraPosition: camera.position.toArray(),
            cameraQuaternion: camera.quaternion.toArray(),
            acceptedPosition: arCameraState.acceptedPosition.toArray(),
            cameraZoomFactor,
            cameraNear: camera.near,
            cameraFar: camera.far,
            trackingLost: arCameraState.trackingLost,
            settings: { ...arCameraState.settings },
            modelVisible: currentRotationPivot?.visible ?? false,
            modelFootY: currentRotationPivot ? getModelBounds(currentRotationPivot).min.y : null,
            modelPosition: currentRotationPivot?.position.toArray() ?? null,
            modelScale: currentRotationPivot?.scale.toArray() ?? null,
            targetWidth: arCameraState.targetWidth,
            targetPosition: arCameraState.targetPosition?.toArray() ?? null
        } : null,
        handleActionPlan,
        load,
        loadMotion: playMotion,
        loadSelectedMotion: async (...args) => await runTemporalAction(ambientOcclusion.invalidateTemporal, () => loadSelectedMotion(...args)),
        playMotion,
        raycast,
        resetArPose,
        resetArCameraPose,
        rotateModelBy,
        setModelGravityRotation,
        setModelGravitySettings,
        getModelGravityState: () => gravityFilter.getState(),
        finishModelRotation,
        setCameraViewRotation,
        setArCameraPose,
        setArCameraSettings,
        setPhysicsStabilityReference,
        getPhysicsStabilityReference: () => physicsStabilityReferenceHz,
        setWindSettings,
        getWindSettings: () => ({ ...windSettings }),
        setPhysicsSolver,
        getPhysicsSolverState,
        setMotionPlaybackEnabled,
        getMotionPlaybackEnabled: () => motionPlaybackEnabled,
        loadCameraMotion,
        setCameraMotionPlaybackEnabled,
        getCameraMotionProgress,
        clearCameraMotion,
        // 动作面板只读当前 VMD action；不向外暴露 mixer，也不改变物理状态。
        getMplModelState: () => {
            const state = manualExpressions.getState();
            const dictionary = currentMesh?.morphTargetDictionary || {};
            return { token: state.token, ready: state.ready,
                bones: (currentMesh?.skeleton?.bones || []).map(bone => bone.name),
                morphs: state.items.map(item => ({ name: item.name, type: item.type, panel: item.panel,
                    supported: item.supported && Object.hasOwn(dictionary, item.name)
                        && dictionary[item.name] === item.index })) };
        },
        getManualExpressions: () => manualExpressions.getState(),
        setManualExpression: (index, weight) => manualExpressions.set(index, weight),
        clearManualExpressions: () => manualExpressions.clear(),
        getMotionProgress: () => {
            const action = helper.current?.objects?.get(currentMesh)?.mixer?._actions?.[0];
            const durationSeconds = action?.getClip?.()?.duration;
            const timeSeconds = action?.time;
            return Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(timeSeconds)
                ? { timeSeconds, durationSeconds } : null;
        },
        setPhysicsEnabled,
        getPhysicsEnabled: () => physicsEnabled,
        setArPose: arFootAnchor.setPose,
        translateModelByPixels: arFootAnchor.translateByPixels,
        zoomCameraBy,
        resize,
        setLighting,
        setVisible,
        suspendArCameraPose,
        showFallback
    });
}
/* aasc-shared:addShadowBiasRuntime */
/* aasc-shared:addFillFacingRuntime */
/* aasc-shared:addShadowMapRuntime */
/* aasc-shared:addGravityRuntime */
/* aasc-shared:addLocalRuntime */
/* aasc-shared:addPhysicsRateRuntime */
/* aasc-shared:addSubstepRuntime */
/* aasc-shared:addCameraMotionRuntime */
/* aasc-shared:addStabilityRuntime */

/* aasc-shared:addWindRuntime */

/* aasc-shared:addSolverRuntime */

/* aasc-shared:screen-lighting */
/* aasc-shared:render-settings */
/* aasc-shared:preserve-camera-resize */

import { landmarkQuality, poseLandmarkThreshold } from './web-human-pose-core.mjs';

// 身体对应只含PMX可实际回读的肩肘腕髋膝踝；nose不是PMX头中心，不能加入相机拟合。
export const POSE_BODY_KEYS = Object.freeze([
    'leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
    'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
]);
export const POSE_LIMB_SEGMENTS = Object.freeze([
    ['leftArm', 'leftElbow'], ['leftElbow', 'leftWrist'], ['rightArm', 'rightElbow'], ['rightElbow', 'rightWrist'],
    ['leftLeg', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['rightLeg', 'rightKnee'], ['rightKnee', 'rightAnkle'],
].map(segment => Object.freeze(segment)));
const MP_BODY_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const MP_INDEX = Object.freeze(Object.fromEntries(POSE_BODY_KEYS.map((key, i) => [key, MP_BODY_INDICES[i]])));
const MP_EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
    [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 7], [0, 8]];
const MP_NAMES = ['nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner',
    'right_eye', 'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb',
    'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
    'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'];

// 与hmr2_gpu_service.py的NAMES/EDGES逐项一致，保持BODY25顺序和原生左右标签。
export const HMR2_BODY25_NAMES = Object.freeze([
    'nose', 'neck', 'right_shoulder', 'right_elbow', 'right_wrist',
    'left_shoulder', 'left_elbow', 'left_wrist', 'mid_hip', 'right_hip',
    'right_knee', 'right_ankle', 'left_hip', 'left_knee', 'left_ankle',
    'right_eye', 'left_eye', 'right_ear', 'left_ear', 'left_big_toe',
    'left_small_toe', 'left_heel', 'right_big_toe', 'right_small_toe', 'right_heel',
]);
export const HMR2_BODY25_EDGES = Object.freeze([
    [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [10, 11],
    [8, 12], [12, 13], [13, 14], [0, 1], [0, 15], [0, 16], [15, 17], [16, 18],
    [11, 22], [22, 23], [11, 24], [14, 19], [19, 20], [14, 21],
].map(edge => Object.freeze(edge)));
const HMR_INDEX = Object.freeze({
    leftArm: 5, rightArm: 2, leftElbow: 6, rightElbow: 3, leftWrist: 7, rightWrist: 4,
    leftLeg: 12, rightLeg: 9, leftKnee: 13, rightKnee: 10, leftAnkle: 14, rightAnkle: 11,
    hips: 8, neck: 1, head: 0,
});
const HMR_KEY = Object.fromEntries(Object.entries(HMR_INDEX).map(([key, index]) => [index, key]));
const MP_KEY = { ...Object.fromEntries(Object.entries(MP_INDEX).map(([key, index]) => [index, key])), 0: 'head' };
const inImage = point => !!point && [point.x, point.y].every(Number.isFinite)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
const finiteWorld = world => Array.isArray(world) && world.length === 3 && world.every(Number.isFinite);
// 来源只说明执行位置；两条HMR链共享原生BODY25语义，不能补成MediaPipe点集。
export const isHmrPose = pose => ['hmr2-api', 'hmr2-web'].includes(pose?.source);

function mpPoint(pose, point) {
    if (!point) return null;
    if (point.world !== undefined && !finiteWorld(point.world)) return { ...point, weight: 0, usable: false };
    // 二维相机参考只需要XY；临时零向量仅供旧质量函数检查，绝不写回或输出伪造world。
    // 若原结果提供了损坏的world，仍由旧landmarkQuality拒绝，而不是降级到二维掩盖错误。
    const weight = landmarkQuality(point.world === undefined ? { ...point, world: [0, 0, 0] } : point);
    return { ...point, weight, usable: inImage(point) && weight >= poseLandmarkThreshold(pose) };
}

/** 按PMX身体语义读取；weight是拟合权重，不等于关节置信度或坐标正确率。 */
export function getPosePoint(pose, key) {
    if (isHmrPose(pose)) {
        const joint = Object.hasOwn(HMR_INDEX, key) ? pose.joints?.[key] : null;
        if (!joint) return null;
        return { ...joint, weight: 1, usable: joint.usable === true && inImage(joint) && finiteWorld(joint.world) };
    }
    if (!Object.hasOwn(MP_INDEX, key)) return null;
    return mpPoint(pose, pose?.landmarks?.[MP_INDEX[key]]);
}

/** 统一低质量列表为语义键，同时保留旧quality的score等额外字段。 */
export function getPoseQuality(pose) {
    const previous = pose?.quality || {};
    const points = POSE_BODY_KEYS.map(key => getPosePoint(pose, key));
    const computedLow = POSE_BODY_KEYS.filter((_, i) => !points[i]?.usable);
    const toKey = value => typeof value === 'number' ? POSE_BODY_KEYS[MP_BODY_INDICES.indexOf(value)] : value;
    const lowConfidence = Array.isArray(previous.lowConfidence)
        ? [...new Set(previous.lowConfidence.map(toKey).filter(key => Object.hasOwn(HMR_INDEX, key)))] : computedLow;
    const visible = Number.isInteger(previous.visible) && previous.visible >= 0 && previous.visible <= POSE_BODY_KEYS.length
        ? previous.visible : points.filter(point => point?.usable).length;
    const torsoReady = typeof previous.torsoReady === 'boolean' ? previous.torsoReady
        : ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].every(key => getPosePoint(pose, key)?.usable);
    return { ...previous, total: POSE_BODY_KEYS.length, visible, lowConfidence, torsoReady };
}

/** 只做原生数据到语义数据的映射；调用方须先严格校验API或网页Worker结果，不能在这里修正原始姿态。 */
export function createHmr2SemanticPose(nativeResult, source = 'hmr2-api') {
    if (!isHmrPose({ source })) throw new Error('HMR语义来源无效');
    const [width, height] = nativeResult.imageSize;
    const joints = Object.fromEntries(Object.entries(HMR_INDEX).map(([key, index]) => {
        const point = { x: nativeResult.xy[index][0] / width, y: nativeResult.xy[index][1] / height,
            world: [...nativeResult.xyz[index]] };
        return [key, { ...point, usable: inImage(point) && finiteWorld(point.world)
            && Number.isFinite(nativeResult.cameraDepth[index]) && nativeResult.cameraDepth[index] > 0 }];
    }));
    const pose = { source, dimensions: 3, imageAspect: width / height, raw: nativeResult, joints };
    const quality = getPoseQuality(pose);
    pose.quality = { torsoReady: quality.torsoReady, visible: quality.visible, lowConfidence: quality.lowConfidence };
    return pose;
}

// UI与FK共用纯数值过滤：不引入Three、不转换原始world、不把表面线索当人体归属。
export function filterImageDepthHints(pose, depthHints = [], rig = null) {
    const allowed = new Set(POSE_LIMB_SEGMENTS.map(([a, b]) => a + ':' + b));
    const hints = [], rejected = [], seen = new Set();
    for (const hint of Array.isArray(depthHints) ? depthHints : []) {
        const key = hint?.a + ':' + hint?.b;
        const a = getPosePoint(pose, hint?.a), b = getPosePoint(pose, hint?.b);
        const validPoints = a?.usable && b?.usable && finiteWorld(a.world) && finiteWorld(b.world);
        const distance = validPoints ? Math.hypot(...a.world.map((value, index) => b.world[index] - value)) : 0;
        const hasNodes = !rig || [hint?.a, hint?.b].every(name => rig.nodes.some(node => node.semantic === name));
        if (!allowed.has(key) || !hasNodes || ![-1, 1].includes(hint?.sign)
            || !Number.isFinite(hint?.weight) || hint.weight <= 0 || !validPoints || !Number.isFinite(distance) || distance < 1e-5) {
            rejected.push({ a: hint?.a, b: hint?.b, reason: '深度线索结构、权重或原生端点无效' }); continue;
        }
        if (seen.has(key)) { rejected.push({ a: hint.a, b: hint.b, reason: '深度线索肢段重复' }); continue; }
        // HMR/MP的原生world.z正向均为相机前；共同相机平移不会改变两点差。
        const delta = b.world[2] - a.world[2];
        if (Math.abs(delta) > .03 && Math.sign(delta) !== hint.sign) {
            rejected.push({ a: hint.a, b: hint.b, reason: '与原生三维方向冲突' }); continue;
        }
        seen.add(key); hints.push({ ...hint, weight: Math.min(.25, hint.weight) });
    }
    return { hints, rejected };
}

function legalEdges(edges, count) {
    if (!Array.isArray(edges)) return [];
    return edges.filter(edge => Array.isArray(edge) && edge.length === 2
        && edge.every(index => Number.isInteger(index) && index >= 0 && index < count) && edge[0] !== edge[1])
        .map(edge => [...edge]);
}

/** 预览始终使用来源的原始点数/连线；不补33点，也不将nose参考作为PMX相机对应。 */
export function getPoseReference(pose) {
    if (isHmrPose(pose)) {
        const raw = pose.raw;
        if (!Array.isArray(raw?.xy) || raw.xy.length !== 25 || !Array.isArray(raw.imageSize)
            || raw.imageSize.length !== 2 || !raw.imageSize.every(value => Number.isFinite(value) && value > 0)) {
            return { points: [], edges: [] };
        }
        const [width, height] = raw.imageSize;
        const points = Array.from({ length: 25 }, (_, index) => {
            const point = { x: raw.xy[index]?.[0] / width, y: raw.xy[index]?.[1] / height,
                key: HMR_KEY[index] || raw.names?.[index] || HMR2_BODY25_NAMES[index] };
            return { ...point, usable: inImage(point) && finiteWorld(raw.xyz?.[index])
                && Number.isFinite(raw.cameraDepth?.[index]) && raw.cameraDepth[index] > 0 };
        });
        return { points, edges: legalEdges(raw.edges, 25) };
    }
    if (!Array.isArray(pose?.landmarks)) return { points: [], edges: [] };
    const points = Array.from({ length: 33 }, (_, index) => {
        const point = mpPoint(pose, pose.landmarks[index]);
        return { x: point?.x, y: point?.y, usable: point?.usable === true, key: MP_KEY[index] || MP_NAMES[index] };
    });
    return { points, edges: legalEdges(MP_EDGES, 33) };
}

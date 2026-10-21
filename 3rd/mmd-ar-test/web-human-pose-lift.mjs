import { Matrix4 } from 'three';
import { POSE_BODY_KEYS, getPosePoint, getPoseReference } from './web-human-pose-semantic.mjs';
import { createImagePosePrior, filterImageDepthHints } from './web-human-pose-prior.mjs';
import { createPoseFK } from './web-human-pose-fk.mjs';

export function needsImagePoseFit(pose, options = {}, rig = null) {
    return pose?.source === 'hmr2-api' || (pose?.source === 'rtmpose-m' && pose.dimensions === 2)
        || (options.depthEnabled === true && pose?.source === 'mediapipe-pose'
            && filterImageDepthHints(pose, options.depthHints, rig).hints.length > 0);
}
const abort = () => { const error = new Error('姿态拟合已取消或场景已变化'); error.name = 'AbortError'; return error; };
const ensureCurrent = options => { if (options.isCurrent?.() === false) throw abort(); };

// 同步/异步入口共用有限迭代器。完整当前姿态始终参选，不因二维接近就随意改深度。
function* fit(pose, rig, camera, options) {
    ensureCurrent(options);
    if (!needsImagePoseFit(pose, options, rig) || !camera?.isPerspectiveCamera
        || !Number.isFinite(pose.imageAspect) || pose.imageAspect <= 0) throw new Error('图片姿态或参考相机无效');
    const point = key => { const value = getPosePoint(pose, key); return value?.usable ? value : null; };
    if (!['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].every(key => point(key))) throw new Error('肩部或骨盆关键点不完整，未修改姿态');
    const node = semantic => rig.nodes.find(n => n.semantic === semantic);
    if (!rig.pelvis || !node('upperBody')) throw new Error('模型缺少骨盆或躯干骨骼');
    const observations = POSE_BODY_KEYS.flatMap(name => point(name) && node(name)
        ? [{ node: node(name), x: (point(name).x - .5) * pose.imageAspect, y: .5 - point(name).y, weight: point(name).weight }] : []);
    const span = key => Math.max(...observations.map(p => p[key])) - Math.min(...observations.map(p => p[key]));
    if (observations.length < 6 || span('x') < .025 || span('y') < .05) throw new Error('身体关键点分布退化，未修改姿态');
    const fk = createPoseFK(rig), mesh = rig.model.mesh;
    camera.updateWorldMatrix(true, false);
    const view = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
        .multiply(new Matrix4().makeScale(1 / rig.metersPerUnit, 1 / rig.metersPerUnit, 1 / rig.metersPerUnit));
    const projection = options.projection || 'perspective';
    const project = position => {
        const p = position.clone().applyMatrix4(view);
        if (p.z >= -camera.near || !p.toArray().every(Number.isFinite)) return null;
        if (projection === 'weak-perspective') return { x: p.x, y: p.y };
        // 使用参考相机内参，换成图片高度单位；取景只允许等比缩放和平移。
        const ndc = p.applyMatrix4(camera.projectionMatrix);
        return { x: ndc.x * camera.aspect / 2, y: ndc.y / 2 };
    };
    const weight = observations.reduce((s, p) => s + p.weight, 0);
    const scale3D = Math.max(.1, ...[0, 1, 2].map(axis => {
        const values = [...fk.source.values()].map(p => p.position.getComponent(axis)); return Math.max(...values) - Math.min(...values);
    }));
    const prior = pose.dimensions === 3 ? createImagePosePrior(pose, rig, fk, view,
        { depthHints: options.depthEnabled === true ? options.depthHints : [] }) : null;
    let useDepth = false;
    let nominalScale = null, evaluations = 0;
    function evaluate(parameters) {
        evaluations++;
        const candidate = fk.evaluate(parameters), projected = observations.map(p => project(candidate.poses.get(p.node).position));
        if (projected.some(p => !p)) return { loss: Infinity, error: Infinity };
        const mean = (key, array) => array.reduce((sum, p, i) => sum + observations[i].weight * p[key], 0) / weight;
        const px = mean('x', projected), py = mean('y', projected), ix = mean('x', observations), iy = mean('y', observations);
        let numerator = 0, denominator = 0, imageVariance = 0;
        for (let i = 0; i < observations.length; i++) {
            const p = projected[i], q = observations[i];
            numerator += q.weight * ((p.x - px) * (q.x - ix) + (p.y - py) * (q.y - iy));
            denominator += q.weight * ((p.x - px) ** 2 + (p.y - py) ** 2);
            imageVariance += q.weight * ((q.x - ix) ** 2 + (q.y - iy) ** 2);
        }
        if (denominator < 1e-12) return { loss: Infinity, error: Infinity };
        nominalScale ??= Math.sqrt(imageVariance / denominator);
        const scale = Math.max(nominalScale / 3, Math.min(nominalScale * 3, numerator / denominator));
        let squareError = 0, positionPrior = 0, rotationPrior = 0;
        for (let i = 0; i < observations.length; i++) {
            const p = projected[i], q = observations[i];
            squareError += q.weight * ((scale * (p.x - px) + ix - q.x) ** 2 + (scale * (p.y - py) + iy - q.y) ** 2);
        }
        for (const [node, p] of candidate.poses) {
            const prior = fk.source.get(node);
            positionPrior += p.position.distanceToSquared(prior.position) / (scale3D * scale3D);
            rotationPrior += p.quaternion.clone().normalize().angleTo(prior.quaternion.clone().normalize()) ** 2;
        }
        const error = Math.sqrt(squareError / weight);
        const additional = prior?.loss(candidate.poses, scale3D, useDepth) || { directionLoss: 0, depthLoss: 0 };
        return { ...candidate, parameters: [...parameters], error, directionLoss: additional.directionLoss,
            loss: error ** 2 + .0005 * positionPrior / candidate.poses.size + .0002 * rotationPrior / candidate.poses.size
                + additional.directionLoss + additional.depthLoss };
    }
    const seeds = [[...fk.initial], [...fk.reference]];
    if (prior?.seed) seeds.unshift(prior.seed);
    // 深度分支通过真实关节角生成，膝盖方向取模型限位，不独立猜每根骨段的前后。
    {
        const seed = [...fk.reference];
        fk.parameters.forEach((p, i) => {
            if (/Leg$/u.test(p.node.semantic) && p.axis === 0) seed[i] -= 1.2;
            if (/Knee$/u.test(p.node.semantic) && p.axis === p.node.hingeAxis) seed[i] += Math.abs(p.high) > Math.abs(p.low) ? 1.2 : -1.2;
        }); seeds.push(seed);
    }
    const turned = [...fk.reference]; fk.parameters.forEach((p, i) => { if (p.node === rig.pelvis && p.axis === 1) turned[i] += Math.PI; }); seeds.push(turned);
    let best = evaluate(fk.initial), iterations = 0;
    if (best.error > 1e-7 || best.directionLoss > 1e-7) for (const seed of seeds) {
        const params = seed.map((v, i) => Math.max(fk.parameters[i].low, Math.min(fk.parameters[i].high, v)));
        let current = evaluate(params), seedIterations = 0;
        for (const step of [.6, .3, .15, .07, .03, .015, .007]) for (let sweep = 0; sweep < 4 && seedIterations < 60; sweep++) {
            let changed = false;
            for (let i = 0; i < params.length; i++) {
                const original = params[i], bounds = fk.parameters[i]; let chosen = original, candidateBest = current;
                for (const direction of [-1, 1]) {
                    const value = Math.max(bounds.low, Math.min(bounds.high, original + direction * step));
                    if (value === original) continue;
                    params[i] = value; const candidate = evaluate(params);
                    if (candidate.loss < candidateBest.loss) { candidateBest = candidate; chosen = value; }
                }
                params[i] = chosen;
                if (chosen !== original) { current = candidateBest; changed = true; }
            }
            iterations++; seedIterations++;
            if (current.loss < best.loss) best = current;
            if (iterations % 8 === 0) { yield; ensureCurrent(options); }
            if (!changed) break;
        }
    }
    let depthFallback = false;
    if (prior?.depthAccepted && best?.parameters && best.error <= .08) {
        const baseline = best; useDepth = true;
        const params = [...baseline.parameters]; let current = evaluate(params);
        for (const step of [.07, .03, .015, .007]) for (let sweep = 0; sweep < 3; sweep++) {
            let changed = false;
            for (let i = 0; i < params.length; i++) {
                const original = params[i], bounds = fk.parameters[i]; let chosen = original, candidateBest = current;
                for (const direction of [-1, 1]) {
                    params[i] = Math.max(bounds.low, Math.min(bounds.high, original + direction * step));
                    const candidate = evaluate(params);
                    if (candidate.loss < candidateBest.loss) { chosen = params[i]; candidateBest = candidate; }
                }
                params[i] = chosen; changed ||= chosen !== original; current = candidateBest;
            }
            iterations++; yield; ensureCurrent(options);
            if (!changed) break;
        }
        depthFallback = current.error > Math.min(.08, baseline.error + .002)
            || current.directionLoss > baseline.directionLoss + .0002;
        best = depthFallback ? baseline : current;
    }
    ensureCurrent(options);
    if (!best?.poses || !Number.isFinite(best.error) || best.error > .08) throw new Error('图片与合法骨架拟合误差较大，请检查参考点并在3D场景手动调整');
    const targets = [];
    const target = (key, semantic, rotation = false) => {
        const candidate = best.poses.get(node(semantic)); if (!candidate) return;
        const position = rig.targetToWorld(candidate.position).toArray(), q = rotation ? rig.targetRotationToWorld(candidate.quaternion).toArray() : null;
        if (![...position, ...(q || [])].every(Number.isFinite)) throw new Error('图片拟合目标无效，未修改姿态');
        targets.push({ key, position, rotation: q });
    };
    target('pelvis', 'hips', true); target('chest', 'upperBody', true);
    for (const side of ['left', 'right']) for (const [root, middle, end, middleKey, endKey] of [
        ['Arm', 'Elbow', 'Wrist', 'Elbow', 'Hand'], ['Leg', 'Knee', 'Ankle', 'Knee', 'Foot']]) {
        if (!point(side + root) || !point(side + middle)) continue;
        target(side + middleKey, side + middle, true);
        if (point(side + end)) target(side + endKey, side + end);
    }
    // MP原同步入口包含可用脸参考的head控制；辅助也保留它，但不把nose直接当PMX头中心。
    if (pose.source === 'mediapipe-pose' && getPoseReference(pose).points.some(p => p.usable && ['head', 'left_ear', 'right_ear'].includes(p.key))) target('head', 'head');
    if (targets.length < 3) throw new Error('可见身体关键点不足，未修改姿态');
    return { targets, error: best.error, projection, depthSource: pose.source === 'hmr2-api' ? 'hmr2-native-directions' : 'current-pose-joint-prior',
        directionError: best.directionLoss || 0, depthAccepted: prior?.depthAccepted || 0,
        depthRejected: prior?.depthRejected || [], depthFallback, iterations, evaluations };
}

export function fitImagePose2D(pose, rig, camera, options = {}) {
    const iterator = fit(pose, rig, camera, options); let result = iterator.next();
    while (!result.done) result = iterator.next();
    return result.value;
}
export async function fitImagePose2DAsync(pose, rig, camera, options = {}) {
    const iterator = fit(pose, rig, camera, options); let result = iterator.next();
    while (!result.done) { await new Promise(resolve => setTimeout(resolve, 0)); ensureCurrent(options); result = iterator.next(); }
    return result.value;
}

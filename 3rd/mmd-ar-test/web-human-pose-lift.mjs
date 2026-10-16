import { Matrix4 } from 'three';
import { landmarkQuality, poseLandmarkThreshold } from './web-human-pose-core.mjs';
import { createPoseFK } from './web-human-pose-fk.mjs';

const BODY = { leftArm: 11, rightArm: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
    leftLeg: 23, rightLeg: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28 };
const abort = () => { const error = new Error('姿态拟合已取消或场景已变化'); error.name = 'AbortError'; return error; };
const ensureCurrent = options => { if (options.isCurrent?.() === false) throw abort(); };

// 同步/异步入口共用有限迭代器。完整当前姿态始终参选，不因二维接近就随意改深度。
function* fit(pose, rig, camera, options) {
    ensureCurrent(options);
    if (pose?.source !== 'rtmpose-m' || pose.dimensions !== 2 || pose.landmarks?.length !== 33
        || !camera?.isPerspectiveCamera || !Number.isFinite(pose.imageAspect) || pose.imageAspect <= 0) throw new Error('二维姿态或参考相机无效');
    const threshold = poseLandmarkThreshold(pose), point = i => landmarkQuality(pose.landmarks[i]) >= threshold ? pose.landmarks[i] : null;
    if (![11, 12, 23, 24].every(i => point(i))) throw new Error('肩部或骨盆关键点不完整，未修改姿态');
    const node = semantic => rig.nodes.find(n => n.semantic === semantic);
    if (!rig.pelvis || !node('upperBody')) throw new Error('模型缺少骨盆或躯干骨骼');
    const observations = Object.entries(BODY).flatMap(([name, index]) => point(index) && node(name)
        ? [{ node: node(name), x: (point(index).x - .5) * pose.imageAspect, y: .5 - point(index).y, weight: landmarkQuality(point(index)) }] : []);
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
        return { ...candidate, error, loss: error ** 2 + .0005 * positionPrior / candidate.poses.size + .0002 * rotationPrior / candidate.poses.size };
    }
    const seeds = [[...fk.initial], [...fk.reference]];
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
    if (best.error > 1e-7) for (const seed of seeds) {
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
        if (!point(BODY[side + root]) || !point(BODY[side + middle])) continue;
        target(side + middleKey, side + middle, true);
        if (point(BODY[side + end])) target(side + endKey, side + end);
    }
    if (targets.length < 3) throw new Error('可见身体关键点不足，未修改姿态');
    return { targets, error: best.error, projection, depthSource: 'current-pose-joint-prior', iterations, evaluations };
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

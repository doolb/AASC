import { Euler, Quaternion, Vector3 } from 'three';
import { landmarkQuality, poseLandmarkThreshold } from './web-human-pose-core.mjs';

// 单图不能唯一确定深度。本模块只生成有界、固定骨长的弱透视初值，最终关节范围仍由VaM物理约束。
// 所有拟合在写目标之前完成；失败抛错，由调用方保持原来的控制点。
export function fitImagePose2D(pose, rig, camera) {
    if (pose?.source !== 'rtmpose-m' || pose.dimensions !== 2 || pose.landmarks?.length !== 33
        || !camera?.isPerspectiveCamera || !Number.isFinite(pose.imageAspect) || pose.imageAspect <= 0) throw new Error('二维姿态或参考相机无效');
    const threshold = poseLandmarkThreshold(pose);
    const point = i => landmarkQuality(pose.landmarks[i]) >= threshold ? pose.landmarks[i] : null;
    if (![11, 12, 23, 24].every(i => point(i))) throw new Error('肩部或骨盆关键点不完整，未修改姿态');
    const node = semantic => rig.nodes.find(n => n.semantic === semantic);
    const pelvis = rig.pelvis, chest = node('upperBody');
    if (!pelvis || !chest) throw new Error('模型缺少骨盆或躯干骨骼');
    const mesh = rig.model.mesh;
    mesh.updateWorldMatrix(true, true); camera.updateWorldMatrix(true, false);
    // 相机局部x向右、y向上、z向观察者；旋转去掉模型变换后，长度始终保持rig的米制单位。
    const toCamera = camera.getWorldQuaternion(new Quaternion()).invert().multiply(mesh.getWorldQuaternion(new Quaternion()));
    const fromCamera = toCamera.clone().invert(), animated = rig.animatedPoses();
    const anchor = animated.get(pelvis)?.position.clone();
    if (!anchor) throw new Error('当前骨盆姿态不可用');
    const reference = semantic => {
        const p = node(semantic)?.position;
        if (!p) throw new Error('模型缺少骨骼：' + semantic);
        return p.clone().sub(pelvis.position).applyQuaternion(toCamera);
    };
    const coordinates = new Map(), observations = [];
    const semantics = { leftArm: 11, rightArm: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
        leftLeg: 23, rightLeg: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28 };
    for (const [semantic, index] of Object.entries(semantics)) {
        coordinates.set(semantic, reference(semantic));
        const p = point(index);
        if (p) observations.push({ semantic, x: (p.x - .5) * pose.imageAspect, y: .5 - p.y, weight: landmarkQuality(p) });
    }
    const span = key => Math.max(...observations.map(p => p[key])) - Math.min(...observations.map(p => p[key]));
    if (observations.length < 6 || span('x') < .025 || span('y') < .05) throw new Error('身体关键点分布退化，未修改姿态');
    const segments = [], parameters = Array(6).fill(0);
    const projectedDirection = (a, b) => {
        const first = point(semantics[a]), last = point(semantics[b]);
        if (!first || !last) return null;
        const dx = (last.x - first.x) * pose.imageAspect, dy = first.y - last.y;
        return Math.hypot(dx, dy) > .002 ? Math.atan2(dy, dx) : null;
    };
    for (const side of ['left', 'right']) for (const [root, middle, end, middleKey, endKey] of [
        ['Arm', 'Elbow', 'Wrist', 'Elbow', 'Hand'], ['Leg', 'Knee', 'Ankle', 'Knee', 'Foot']]) {
        const names = [root, middle, end].map(name => side + name);
        for (let j = 0; j < 2; j++) {
            const a = names[j], b = names[j + 1], delta = coordinates.get(b).clone().sub(coordinates.get(a));
            const length = delta.length();
            if (!Number.isFinite(length) || length < .001) throw new Error('模型骨长退化，未修改姿态');
            const actualA = animated.get(node(a))?.position, actualB = animated.get(node(b))?.position;
            const prior = actualA && actualB ? actualB.clone().sub(actualA).applyQuaternion(toCamera).normalize() : delta.clone().normalize();
            const offset = parameters.length;
            parameters.push(projectedDirection(a, b) ?? Math.atan2(prior.y, prior.x), Math.asin(Math.max(-1, Math.min(1, prior.z))));
            segments.push({ a, b, length, prior, offset, key: side + (j ? endKey : middleKey),
                // 缺中间点时整条链不应用，不能用未观测的关节拼接一个末端目标。
                apply: !!point(semantics[names[0]]) && !!point(semantics[names[1]]) && (j === 0 || !!point(semantics[names[2]])) });
        }
    }
    const totalWeight = observations.reduce((sum, p) => sum + p.weight, 0);
    const evaluate = params => {
        const hipRotation = new Quaternion().setFromEuler(new Euler(...params.slice(0, 3), 'XYZ'));
        const torsoRotation = new Quaternion().setFromEuler(new Euler(...params.slice(3, 6), 'XYZ'));
        const points = new Map();
        for (const name of ['leftLeg', 'rightLeg', 'leftArm', 'rightArm']) {
            points.set(name, coordinates.get(name).clone().applyQuaternion(name.endsWith('Leg') ? hipRotation : torsoRotation));
        }
        let priorLoss = 0;
        for (const s of segments) {
            const azimuth = params[s.offset], elevation = params[s.offset + 1];
            const direction = new Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation));
            points.set(s.b, points.get(s.a).clone().addScaledVector(direction, s.length));
            priorLoss += direction.distanceToSquared(s.prior);
        }
        let px = 0, py = 0, ix = 0, iy = 0;
        for (const p of observations) { const v = points.get(p.semantic); px += p.weight * v.x; py += p.weight * v.y; ix += p.weight * p.x; iy += p.weight * p.y; }
        px /= totalWeight; py /= totalWeight; ix /= totalWeight; iy /= totalWeight;
        let numerator = 0, denominator = 0;
        for (const p of observations) {
            const v = points.get(p.semantic);
            numerator += p.weight * ((v.x - px) * (p.x - ix) + (v.y - py) * (p.y - iy));
            denominator += p.weight * ((v.x - px) ** 2 + (v.y - py) ** 2);
        }
        const scale = numerator / Math.max(denominator, 1e-12);
        if (!Number.isFinite(scale) || scale <= 0) return { loss: Infinity, error: Infinity };
        let squareError = 0;
        for (const p of observations) { const v = points.get(p.semantic);
            squareError += p.weight * ((scale * (v.x - px) + ix - p.x) ** 2 + (scale * (v.y - py) + iy - p.y) ** 2); }
        const error = Math.sqrt(squareError / totalWeight);
        return { points, hipRotation, torsoRotation, error,
            loss: error ** 2 + 0.00002 * priorLoss / segments.length + 0.000001 * params.slice(0, 6).reduce((sum, v) => sum + v * v, 0) };
    };
    let best = null;
    // 两个确定性深度分支防止平面初值在foreshortening处零梯度卡住；只按当前姿态弱先验择优，不声称识别前后。
    for (const sign of [1, -1]) {
        const params = [...parameters];
        for (const s of segments) if (Math.abs(params[s.offset + 1]) < .1) params[s.offset + 1] = sign * .35;
        let current = evaluate(params);
        for (const step of [.6, .3, .15, .07, .03, .015, .007]) for (let sweep = 0; sweep < 4; sweep++) {
            let changed = false;
            for (let index = 0; index < params.length; index++) {
                const original = params[index]; let chosen = original, candidateBest = current;
                for (const direction of [-1, 1]) {
                    const value = original + direction * step;
                    if (index >= 6 && index % 2 === 1 && Math.abs(value) > Math.PI / 2 - .001) continue;
                    params[index] = value; const candidate = evaluate(params);
                    if (candidate.loss < candidateBest.loss) { candidateBest = candidate; chosen = value; }
                }
                params[index] = chosen;
                if (chosen !== original) { current = candidateBest; changed = true; }
            }
            if (!changed) break;
        }
        if (!best || current.loss < best.loss) best = current;
    }
    if (!best?.points || !Number.isFinite(best.error) || best.error > .08) throw new Error('图片与固定骨长拟合误差较大，请在3D场景手动调整');
    const targets = [];
    const target = (key, relative, rotation = null) => {
        const position = rig.targetToWorld(relative.clone().applyQuaternion(fromCamera).add(anchor)).toArray();
        const q = rotation ? rig.targetRotationToWorld(fromCamera.clone().multiply(rotation).multiply(toCamera)
            .multiply(key === 'pelvis' ? pelvis.quaternion : chest.quaternion)).toArray() : null;
        if (![...position, ...(q || [])].every(Number.isFinite)) throw new Error('图片拟合目标无效，未修改姿态');
        targets.push({ key, position, rotation: q });
    };
    target('pelvis', new Vector3(), best.hipRotation);
    target('chest', reference('upperBody').applyQuaternion(best.torsoRotation), best.torsoRotation);
    for (const s of segments) if (s.apply) target(s.key, best.points.get(s.b));
    if (targets.length < 3) throw new Error('可见身体关键点不足，未修改姿态');
    return { targets, error: best.error, depthSource: 'current-pose-prior', projection: 'weak-perspective' };
}

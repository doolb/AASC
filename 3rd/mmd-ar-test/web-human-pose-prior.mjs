import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { POSE_BODY_KEYS, POSE_LIMB_SEGMENTS, getPosePoint, filterImageDepthHints } from './web-human-pose-semantic.mjs';
export { filterImageDepthHints } from './web-human-pose-semantic.mjs';

const SEGMENTS = [...POSE_LIMB_SEGMENTS, ['rightArm', 'leftArm'], ['rightLeg', 'leftLeg']];
const vector = point => point?.usable && point.world?.length === 3 && point.world.every(Number.isFinite)
    ? new Vector3(point.world[0], -point.world[1], -point.world[2]) : null;
function frame(x, y) {
    if (!x || !y || x.lengthSq() < 1e-10 || y.lengthSq() < 1e-10) return null;
    x = x.clone().normalize(); y = y.clone().addScaledVector(x, -y.dot(x)).normalize();
    const z = x.clone().cross(y);
    return y.lengthSq() > .9 && z.lengthSq() > .9 ? new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)) : null;
}

// 三维点只贡献方向与根部初值，真实位置仍由PMX父链/固定骨长/共享关节限位生成。
// HMR和MediaPipe均采用图右/图下/相机前方向；不拼接两种模型，不改写原始XYZ。
export function createImagePosePrior(pose, rig, fk, view, { depthHints = [] } = {}) {
    const node = key => rig.nodes.find(value => value.semantic === key);
    const points = new Map(POSE_BODY_KEYS.map(key => [key, vector(getPosePoint(pose, key))]));
    const directions = SEGMENTS.flatMap(([a, b]) => {
        const pa = points.get(a), pb = points.get(b);
        if (!pa || !pb || !node(a) || !node(b) || pa.distanceToSquared(pb) < 1e-10) return [];
        return [{ a, b, direction: pb.clone().sub(pa).normalize() }];
    });
    const midpoint = (a, b) => a && b ? a.clone().add(b).multiplyScalar(.5) : null;
    const hip = midpoint(points.get('leftLeg'), points.get('rightLeg'));
    const shoulder = midpoint(points.get('leftArm'), points.get('rightArm'));
    const up = hip && shoulder ? shoulder.clone().sub(hip) : null;
    const observedFrame = frame(points.get('leftLeg')?.clone().sub(points.get('rightLeg') || new Vector3()), up);
    const reference = fk.evaluate(fk.reference).poses;
    const referenceHip = midpoint(reference.get(node('leftLeg'))?.position, reference.get(node('rightLeg'))?.position);
    const referenceShoulder = midpoint(reference.get(node('leftArm'))?.position, reference.get(node('rightArm'))?.position);
    let seed = null;
    if (observedFrame && referenceHip && referenceShoulder) {
        const inverseView = view.clone().invert();
        const referenceFrame = frame(reference.get(node('leftLeg')).position.clone().sub(reference.get(node('rightLeg')).position), referenceShoulder.clone().sub(referenceHip));
        const desiredFrame = frame(points.get('leftLeg').clone().sub(points.get('rightLeg')).transformDirection(inverseView), up.clone().transformDirection(inverseView));
        if (referenceFrame && desiredFrame) {
            const desiredRoot = desiredFrame.multiply(referenceFrame.invert()).multiply(reference.get(rig.pelvis).quaternion);
            const delta = fk.source.get(rig.pelvis).quaternion.clone().invert().multiply(desiredRoot);
            const angles = new Euler().setFromQuaternion(delta, 'XYZ').toArray();
            seed = [...fk.reference];
            fk.parameters.forEach((parameter, index) => {
                if (parameter.node === rig.pelvis && !rig.pelvis.hasModelLimits) seed[index] = Math.max(parameter.low, Math.min(parameter.high, angles[parameter.axis]));
            });
        }
    }
    // 稳定表面仍不等于人体归属；统一过滤还要检查当前PMX是否具有两个实际节点。
    const { hints: accepted, rejected } = filterImageDepthHints(pose, depthHints, rig);
    const cameraPoint = (poses, key) => poses.get(node(key))?.position.clone().applyMatrix4(view);
    const cameraReference = POSE_BODY_KEYS.map(key => cameraPoint(fk.source, key)).filter(Boolean);
    let cameraScale = 1e-8;
    for (const a of cameraReference) for (const b of cameraReference) cameraScale = Math.max(cameraScale, a.distanceTo(b));
    // 差与分母均为同一view的场景单位。固定身体跨度在搜索中不变，平移、均匀缩放和PMX单位抵消。
    function loss(poses, _localScale, useDepth = true) {
        let directionLoss = 0;
        for (const { a, b, direction } of directions) {
            const pa = cameraPoint(poses, a), pb = cameraPoint(poses, b);
            const candidate = pb.sub(pa);
            directionLoss += candidate.lengthSq() > 1e-10 ? candidate.normalize().distanceToSquared(direction) : 4;
        }
        let depthLoss = 0;
        if (useDepth) for (const hint of accepted) {
            const a = cameraPoint(poses, hint.a), b = cameraPoint(poses, hint.b);
            const difference = -(b.z - a.z) / cameraScale;
            depthLoss += hint.weight * Math.min(1, Math.max(0, .02 - hint.sign * difference) ** 2);
        }
        // 相对表面只占很小的惩罚，不转换为米制目标，也不改变PMX骨长。
        return { directionLoss: directions.length ? .01 * directionLoss / directions.length : 0,
            depthLoss: accepted.length ? .002 * depthLoss / accepted.length : 0 };
    }
    return { seed, directions: directions.length, depthAccepted: accepted.length, depthRejected: rejected, loss };
}

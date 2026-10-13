import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

// 人体代理只覆盖语义身体骨；原PMX的头发/服饰动态骨仍由原物理负责。
const SEMANTICS = ['hips', 'upperBody', 'chest', 'neck', 'head',
    'leftShoulder', 'leftArm', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightArm', 'rightElbow', 'rightWrist',
    'leftLeg', 'leftKnee', 'leftAnkle', 'rightLeg', 'rightKnee', 'rightAnkle'];
const NEXT = { upperBody: ['chest', 'neck'], chest: ['neck'], neck: ['head'],
    Shoulder: ['Arm'], Arm: ['Elbow'], Elbow: ['Wrist'], Leg: ['Knee'], Knee: ['Ankle'] };
const depth = bone => { let value = 0; for (let node = bone.parent; node; node = node.parent) value++; return value; };
const components = value => Array.isArray(value) ? [...value] : [value.x, value.y, value.z];
const finite = value => value.every(Number.isFinite);

export function createHumanPhysicsRig(model) {
    const mesh = model.mesh, inverse = new Matrix4(), matrix = new Matrix4();
    const scale = new Vector3(), worldRotation = new Quaternion(), parentRotation = new Quaternion();
    const saved = new Map(), savedPositions = new Map();
    const seen = new Set(), nodes = [];
    for (const semantic of SEMANTICS) {
        const binding = model.bindings['bones:' + semantic];
        if (!binding || binding.dynamic || seen.has(binding.bone)) continue;
        seen.add(binding.bone);
        nodes.push({ ...binding, semantic });
    }
    const pelvis = nodes.find(node => node.semantic === 'hips');
    if (!pelvis || nodes.length < 3) throw new Error('身体物理需要骨盆和至少两个可绑定的身体骨骼');
    const mover = model.bindings['bones:center']?.bone || pelvis.bone;
    // 模型局部空间避免镜头、AR定位和模型整体缩放成为物理冲量；长度统一换算为米。
    function sample() {
        mesh.updateWorldMatrix(true, true); inverse.copy(mesh.matrixWorld).invert();
        return new Map(nodes.map(node => {
            matrix.multiplyMatrices(inverse, node.bone.matrixWorld);
            const position = new Vector3(), quaternion = new Quaternion();
            matrix.decompose(position, quaternion, scale);
            return [node, { position, quaternion }];
        }));
    }
    const initial = sample();
    const rest = semantic => model.bindings['bones:' + semantic]?.restPosition;
    const feet = ['leftAnkle', 'rightAnkle'].map(rest).filter(Boolean);
    const restHeight = rest('head') && feet.length ? rest('head').y - Math.min(...feet.map(point => point.y)) : 0;
    const heights = [...initial.values()].map(pose => pose.position.y);
    const height = restHeight > 0.01 ? restHeight : Math.max(...heights) - Math.min(...heights);
    if (!Number.isFinite(height) || height < 0.01) throw new Error('人体骨架尺寸退化，无法建立物理代理');
    const metersPerUnit = 1.6 / height;
    const limits = new Map();
    for (const ik of mesh.geometry.userData.MMD.iks || []) for (const link of ik.links || []) {
        if (!link.rotationMin || !link.rotationMax) continue;
        const low = components(link.rotationMin), high = components(link.rotationMax);
        if (finite(low) && finite(high) && low.every((value, index) => value <= high[index])) limits.set(link.index, { low, high });
    }
    const byBone = new Map(nodes.map(node => [node.bone, node]));
    for (const node of nodes) {
        const pose = initial.get(node);
        node.position = pose.position.clone().multiplyScalar(metersPerUnit);
        node.quaternion = pose.quaternion.clone();
        node.offset = new Vector3();
        const side = node.semantic.startsWith('left') ? 'left' : node.semantic.startsWith('right') ? 'right' : '';
        const kind = side ? node.semantic.slice(side.length) : node.semantic;
        const next = (NEXT[kind] || []).map(key => nodes.find(item => item.semantic === side + key)).find(Boolean);
        if (next) node.offset.subVectors(initial.get(next).position, pose.position)
            .multiplyScalar(metersPerUnit / 2).applyQuaternion(node.quaternion.clone().invert());
        node.length = node.offset.length() * 2;
        node.radius = kind === 'hips' ? 0.095 : kind === 'head' ? 0.075
            : Math.max(0.025, Math.min(['Leg', 'Knee'].includes(kind) ? 0.065 : 0.08, node.length * 0.14 || 0.035));
        node.mass = ({ hips: 8, upperBody: 7, chest: 5, neck: 0.8, head: 3.5,
            Shoulder: 0.8, Arm: 1.8, Elbow: 1.2, Wrist: 0.4, Leg: 6, Knee: 3, Ankle: 0.8 })[kind] || 1;
        node.parentNode = null;
        if (node !== pelvis) {
            for (let parent = node.bone.parent; parent; parent = parent.parent) {
                if (byBone.has(parent)) { node.parentNode = byBone.get(parent); break; }
            }
            // PMX上下半身往往同为center子骨；人体关节图仍把躯干连接到骨盆。
            node.parentNode ||= pelvis;
        }
        node.hasModelLimits = limits.has(node.index);
        let limit = limits.get(node.index);
        if (!limit) {
            const range = ['Arm', 'Leg'].includes(kind) ? 2.2 : ['Wrist', 'Ankle'].includes(kind) ? 1 : 0.8;
            limit = { low: [-range, -range, -range], high: [range, range, range] };
            if (kind === 'Knee') limit = { low: [-2.8, 0, 0], high: [0.04, 0, 0] };
            if (kind === 'Elbow') {
                const bend = node.offset.clone().cross(new Vector3(0, 0, 1));
                const axis = [Math.abs(bend.x), Math.abs(bend.y), Math.abs(bend.z)].indexOf(Math.max(Math.abs(bend.x), Math.abs(bend.y), Math.abs(bend.z)));
                limit = { low: [0, 0, 0], high: [0, 0, 0] };
                limit.low[axis] = bend.getComponent(axis) < 0 ? -2.8 : -0.04;
                limit.high[axis] = bend.getComponent(axis) < 0 ? 0.04 : 2.8;
            }
        }
        node.limits = limit;
        node.jointFrameRotation = node.parentNode ? initial.get(node.parentNode).quaternion.clone().invert()
            .multiply(node.quaternion).multiply(node.bone.quaternion.clone().invert()) : new Quaternion();
    }
    const ordered = [...nodes].sort((a, b) => depth(a.bone) - depth(b.bone));
    function restore() {
        for (const [bone, rotation] of saved) bone.quaternion.copy(rotation);
        for (const [bone, position] of savedPositions) bone.position.copy(position);
        saved.clear(); savedPositions.clear(); mesh.updateWorldMatrix(true, true);
    }
    function animatedPoses() {
        return new Map([...sample()].map(([node, pose]) => [node,
            { position: pose.position.multiplyScalar(metersPerUnit), quaternion: pose.quaternion }]));
    }
    function write(poses, animated) {
        for (const node of nodes) saved.set(node.bone, node.bone.quaternion.clone());
        savedPositions.set(mover, mover.position.clone());
        const pelvisPose = poses.get(pelvis);
        const origin = pelvisPose.position.clone().sub(nodeOffset(pelvis, pelvisPose.quaternion));
        const delta = origin.sub(animated.get(pelvis).position).multiplyScalar(1 / metersPerUnit);
        const point = mover.getWorldPosition(new Vector3());
        const sceneDelta = delta.applyMatrix4(mesh.matrixWorld).sub(new Vector3().setFromMatrixPosition(mesh.matrixWorld));
        point.add(sceneDelta);
        mover.position.copy(mover.parent ? mover.parent.worldToLocal(point) : point);
        mesh.updateWorldMatrix(true, true); mesh.getWorldQuaternion(worldRotation);
        const projected = [];
        for (const node of ordered) {
            const pose = poses.get(node);
            node.bone.parent?.getWorldQuaternion(parentRotation) || parentRotation.identity();
            const rotation = parentRotation.clone().invert().multiply(worldRotation).multiply(pose.quaternion).normalize();
            // 膝/肘与PMX link限位最终在骨骼局部轴验证；投影同时反馈代理，避免两份姿态脱节。
            // 人体默认限位属于物理父关节；PMX上下半身常为center同级，不能把躯干世界转角误当成关节弯曲。
            const basis = !node.hasModelLimits && node.parentNode
                ? poses.get(node.parentNode).quaternion.clone().multiply(node.jointFrameRotation) : null;
            const constraintRotation = basis ? basis.clone().invert().multiply(pose.quaternion) : rotation;
            const euler = new Euler().setFromQuaternion(constraintRotation, 'XYZ');
            for (let axis = 0; axis < 3; axis++) euler[['x', 'y', 'z'][axis]] = Math.max(node.limits.low[axis], Math.min(node.limits.high[axis], euler[['x', 'y', 'z'][axis]]));
            const limited = new Quaternion().setFromEuler(euler);
            const unrestrictedRoot = node === pelvis && !node.hasModelLimits;
            const mapped = basis ? parentRotation.clone().invert().multiply(worldRotation).multiply(basis).multiply(limited) : limited;
            node.bone.quaternion.copy(unrestrictedRoot ? rotation : mapped);
            node.bone.updateWorldMatrix(false, true);
            if (!unrestrictedRoot && limited.angleTo(constraintRotation) > 1e-5) projected.push(node);
        }
        const corrected = animatedPoses();
        return projected.map(node => ({ node, position: corrected.get(node).position.clone().add(nodeOffset(node, corrected.get(node).quaternion)), quaternion: corrected.get(node).quaternion }));
    }
    function targetToLocal(target) { return mesh.worldToLocal(target.clone()).multiplyScalar(metersPerUnit); }
    function targetRotationToLocal(rotation) { mesh.getWorldQuaternion(worldRotation); return worldRotation.clone().invert().multiply(rotation); }
    function targetToWorld(position) { return mesh.localToWorld(position.clone().multiplyScalar(1 / metersPerUnit)); }
    function targetRotationToWorld(rotation) { mesh.getWorldQuaternion(worldRotation); return worldRotation.clone().multiply(rotation); }
    return { model, nodes, pelvis, initial, metersPerUnit, animatedPoses, write, restore,
        targetToLocal, targetToWorld, targetRotationToLocal, targetRotationToWorld };
}

export function nodeOffset(node, rotation) { return node.offset.clone().applyQuaternion(rotation); }

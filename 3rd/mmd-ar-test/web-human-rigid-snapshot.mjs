import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describeRigidBodyShape } from './web-rigid-body-debug.mjs';

// 与刚体诊断/物理一致：尺寸沿用PMX，动态体读取当前实际COM；不把骨骼蒙皮当成物理结果。
export function createHumanRigidSnapshot(mesh) {
    const params = mesh.geometry?.userData?.MMD?.rigidBodies || [];
    const unit = new Vector3(1, 1, 1), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    const worldInverse = new Matrix4(), spaceInverse = new Matrix4(), matrix = new Matrix4();
    const bodies = params.map((value, index) => {
        if (!describeRigidBodyShape(value) || !Array.isArray(value.position) || value.position.length !== 3
            || !Array.isArray(value.rotation) || value.rotation.length !== 3
            || !value.position.every(Number.isFinite) || !value.rotation.every(Number.isFinite)) return null;
        return { index, params: value, dynamic: value.type !== 0,
            position: new Vector3(), quaternion: new Quaternion(),
            offset: new Matrix4().compose(new Vector3(...value.position), new Quaternion().setFromEuler(new Euler(...value.rotation)), unit),
            axes: [new Vector3(), new Vector3(), new Vector3()], halfSize: new Vector3(),
            start: new Vector3(), end: new Vector3(), min: new Vector3(), max: new Vector3(), available: false };
    });
    // 接触算法编码用原数组长度；非法形状不压缩索引，以免碰撞过滤错配。
    const valid = bodies.length <= 4096 && bodies.every(Boolean);
    function sampleAnimated(animated) {
        for (const body of bodies) {
            if (!animated.has(body.params.boneIndex)) continue;
            const bone = mesh.skeleton.bones[body.params.boneIndex];
            bone.updateWorldMatrix(true, false);
            matrix.copy(bone.matrixWorld).multiply(body.offset).premultiply(worldInverse);
            matrix.decompose(body.position, body.quaternion, scale); body.available = true;
        }
    }
    function sample(physics, animated = new Set(), { paused = false } = {}) {
        if (!valid || !bodies.length) return false;
        const base = physics?.base || physics;
        if (base?.disposed) return false;
        mesh.updateWorldMatrix(true, true);
        worldInverse.copy(mesh.matrixWorld).invert();
        mesh.matrixWorld.decompose(position, rotation, scale);
        const nonUnit = ['x', 'y', 'z'].some(axis => Math.abs(scale[axis] - 1) > 0.001);
        spaceInverse.compose(nonUnit ? mesh.position : position, nonUnit ? mesh.quaternion : rotation, unit).invert();
        // 旋转暂停的整体同步在helper.update之后执行。此时COM仍在上次求解空间，
        // 按保存空间还原相对衣服形状，避免把尚未同步的一帧旋转误当成手部穿透。
        if (paused && base?.physicsTransform) spaceInverse.copy(base.physicsTransform).invert();
        const manager = base?.manager;
        let nativeRotation = null;
        try {
            if (manager) nativeRotation = manager.allocQuaternion();
            for (const body of bodies) {
                const bone = mesh.skeleton.bones[body.params.boneIndex];
                body.available = false;
                if (body.params.type === 0 || animated.has(body.params.boneIndex)) {
                    // 运动学手臂尚未进入物理update，必须采样本帧IK后的骨骼目标，而非上帧COM。
                    matrix.copy(bone?.matrixWorld || mesh.matrixWorld).multiply(body.offset).premultiply(worldInverse);
                } else {
                    const native = base?.bodies?.[body.index]?.body;
                    const read = base?.getBodyPose?.(body.index, position, rotation);
                    if (!read && native && nativeRotation) {
                        const transform = native.getCenterOfMassTransform(), origin = transform.getOrigin();
                        transform.getBasis().getRotation(nativeRotation);
                        position.set(origin.x(), origin.y(), origin.z());
                        rotation.set(nativeRotation.x(), nativeRotation.y(), nativeRotation.z(), nativeRotation.w());
                    } else if (!read) continue;
                    matrix.compose(position, rotation, unit).premultiply(spaceInverse);
                }
                matrix.decompose(body.position, body.quaternion, scale);
                body.available = true;
            }
        } finally { if (nativeRotation) manager.freeQuaternion(nativeRotation); }
        return true;
    }
    return { bodies, sample, sampleAnimated, valid };
}

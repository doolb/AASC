import { Bone, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { createXpbdBody, createXpbdJoint, createXpbdSolver } from './mmd-xpbd-rigid.mjs';
import { normalizeWindSettings, windFlowDirection, createWindState, advanceWindState,
    calculateRigidWindForce, sampleRigidWindStrength } from './mmd-physics-wind.mjs';
import { normalizeWebStabilityReference } from './mmd-physics-rate.mjs';

// 对齐MMDAnimationHelper的update/reset/warmup/dispose契约；不创建或伪造Ammo对象。
// PMX刚体坐标、关节锚点和骨骼回写独立于网格布料，原模型蒙皮保持原样。
const vectorsFinite = (values, length) => Array.isArray(values) && values.length === length && values.every(Number.isFinite);
const readVector = (value) => new Vector3(...value);
const readRotation = (value) => new Quaternion().setFromEuler(new Euler(...value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class XpbdPmxPhysics {
    constructor(mesh, bodyParams, jointParams = [], options = {}) {
        // 空间/骨骼/风与生命周期共用，数值后端由工厂提供；默认仍是原独立XPBD。
        const backend = options.xpbdBackend || { engine: 'xpbd', createBody: createXpbdBody,
            createJoint: createXpbdJoint, createSolver: createXpbdSolver };
        this.engine = backend.engine;
        this.mesh = mesh;
        this.unitStep = options.unitStep ?? 1 / 90;
        this.maxStepNum = options.maxStepNum ?? 10;
        // 沿用共享参数名；XPBD将基准数值直接作为每帧子步数，物理Hz暂不参与步进。
        this.stabilityReferenceHz = normalizeWebStabilityReference(options.stabilityReferenceHz);
        this.gravity = new Vector3(0, -98, 0);
        if (options.gravity) this.gravity.copy(options.gravity);
        this.bodies = [];
        this.constraints = [];
        this.disposed = false;
        this.onDiagnosticSubstep = null;
        this.windSettings = normalizeWindSettings();
        this.windState = createWindState();
        this.windDirection = windFlowDirection(this.windSettings);
        this.targetAlpha = 1;
        this.frameSubsteps = 0;
        this.frameMs = 0;
        this.position = new Vector3(); this.scale = new Vector3(); this.rotation = new Quaternion();
        this.windSceneRotation = new Quaternion();
        this.windVector = new Vector3(); this.lever = new Vector3(); this.torque = new Vector3();
        this.windSceneMatrix = new Matrix4(); this.windSamplingMatrix = new Matrix4();
        this.windSamplingPosition = new Vector3();
        this.frameRotation = new Quaternion(); this.deltaRotation = new Quaternion();
        this.matrix = new Matrix4();
        this.bonePosition = new Vector3(); this.boneRotation = new Quaternion(); this.unitScale = new Vector3(1, 1, 1);
        this.frameAction = () => this._advanceFrame();
        this.resetAction = () => this._resetBodies();
        this.applyTargets = (h) => this._applyTargets(h);
        this.validate(bodyParams, jointParams);
        // 和MMDPhysics初始化一致：以模型绑定姿态、单位尺度建立关节框架；恢复父级及局部P/Q/S。
        const parent = mesh.parent, position = mesh.position.clone(), rotation = mesh.quaternion.clone(), scale = mesh.scale.clone();
        try {
            mesh.parent = null; mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
            mesh.updateMatrixWorld(true);
            for (const [index, params] of bodyParams.entries()) {
                const bone = params.boneIndex === -1 ? new Bone() : mesh.skeleton.bones[params.boneIndex];
                const offset = new Matrix4().compose(readVector(params.position), readRotation(params.rotation), new Vector3(1, 1, 1));
                // PMX loader已把刚体position变为相对关联骨骼的位置；neutral关节position仍是模型坐标。
                const initialPosition = bone.getWorldPosition(new Vector3()).add(readVector(params.position));
                const body = backend.createBody(params, index, initialPosition, readRotation(params.rotation));
                body.bone = bone; body.offset = offset; body.inverseOffset = offset.clone().invert();
                body.targetPosition = new Vector3(); body.previousTargetPosition = new Vector3();
                body.targetQuaternion = new Quaternion(); body.previousTargetQuaternion = new Quaternion();
                body.windLever = readVector(params.position).applyQuaternion(readRotation(params.rotation).invert()).clampLength(0, 1);
                this.bodies.push(body);
            }
            this.constraints = jointParams.map((params) => backend.createJoint(params,
                this.bodies[params.rigidBodyIndex1], this.bodies[params.rigidBodyIndex2]));
            this.solver = backend.createSolver(this.bodies, this.constraints);
        } catch (error) {
            this.dispose();
            throw error;
        } finally {
            mesh.parent = parent; mesh.position.copy(position); mesh.quaternion.copy(rotation); mesh.scale.copy(scale);
            mesh.updateMatrixWorld(true);
        }
        try { this.reset(); }
        catch (error) { this.dispose(); throw error; }
    }

    validate(bodies, joints) {
        for (const body of bodies) {
            if (![0, 1, 2].includes(body.type) || ![0, 1, 2].includes(body.shapeType)
                || !vectorsFinite(body.position, 3) || !vectorsFinite(body.rotation, 3)
                || !['width', 'height', 'depth', 'weight', 'positionDamping', 'rotationDamping', 'friction', 'restitution'].every((key) => Number.isFinite(body[key]))
                || body.weight < 0 || body.width <= 0 || body.height < 0 || body.depth < 0
                || (body.shapeType === 1 && (body.height === 0 || body.depth === 0))
                || !Number.isInteger(body.boneIndex) || body.boneIndex < -1 || body.boneIndex >= this.mesh.skeleton.bones.length
                || !Number.isInteger(body.groupIndex) || body.groupIndex < 0 || body.groupIndex > 15 || !Number.isInteger(body.groupTarget)) {
                throw new Error('XPBD遇到无效的PMX刚体参数：' + (body.name || '未命名'));
            }
        }
        for (const joint of joints) {
            if ((joint.type ?? 0) !== 0 || ![joint.rigidBodyIndex1, joint.rigidBodyIndex2].every((index) =>
                Number.isInteger(index) && index >= 0 && index < bodies.length)
                || !['position', 'rotation', 'translationLimitation1', 'translationLimitation2',
                    'rotationLimitation1', 'rotationLimitation2', 'springPosition', 'springRotation'].every((key) => vectorsFinite(joint[key], 3))
                || [...joint.springPosition, ...joint.springRotation].some((value) => value < 0)) {
                throw new Error('XPBD仅支持有效的PMX六轴弹簧关节：' + (joint.name || '未命名'));
            }
        }
    }

    // 保留现有MMDPhysics非单位缩放规则，所有改动用finally恢复，诊断可复用同一空间映射。
    _withPhysicsSpace(action) {
        const mesh = this.mesh;
        mesh.updateWorldMatrix(true, true);
        mesh.matrixWorld.decompose(this.position, this.rotation, this.scale);
        const nonUnit = Math.abs(this.scale.x - 1) > 0.001 || Math.abs(this.scale.y - 1) > 0.001 || Math.abs(this.scale.z - 1) > 0.001;
        const parent = mesh.parent;
        this.scale.copy(mesh.scale);
        try {
            if (nonUnit) { mesh.parent = null; mesh.scale.set(1, 1, 1); mesh.updateMatrixWorld(true); }
            action();
        } finally {
            if (nonUnit) { mesh.parent = parent; mesh.scale.copy(this.scale); mesh.updateMatrixWorld(true); }
        }
    }

    _bonePose(body, position, quaternion) {
        body.bone.updateWorldMatrix(true, false);
        // MMDPhysics的骨骼锚点只取位置/旋转；骨骼非单位缩放不能重复放大刚体局部偏移。
        body.bone.matrixWorld.decompose(this.bonePosition, this.boneRotation, this.position);
        this.matrix.compose(this.bonePosition, this.boneRotation, this.unitScale).multiply(body.offset);
        this.matrix.decompose(position, quaternion, this.position);
    }

    _resetBodies() {
        for (const body of this.bodies) {
            this._bonePose(body, body.position, body.quaternion);
            body.targetPosition.copy(body.position); body.previousTargetPosition.copy(body.position);
            body.targetQuaternion.copy(body.quaternion); body.previousTargetQuaternion.copy(body.quaternion);
        }
        this.resetMotion();
    }

    resetMotion() {
        for (const body of this.bodies) {
            body.velocity.set(0, 0, 0); body.omega.set(0, 0, 0); body.force.set(0, 0, 0); body.torque.set(0, 0, 0);
        }
        this.solver?.reset();
        this.frameSubsteps = 0;
        return this;
    }

    reset() {
        if (!this.disposed) this._withPhysicsSpace(this.resetAction);
        return this;
    }

    resetAnchorInterpolation() {
        if (this.disposed) return this;
        for (const body of this.bodies) {
            body.previousTargetPosition.copy(body.targetPosition); body.previousTargetQuaternion.copy(body.targetQuaternion);
        }
        this.frameSubsteps = 0;
        return this;
    }

    _applyTargets(h) {
        for (const body of this.bodies) {
            if (body.params.type !== 0 && !body.positionDriven) continue;
            if (body.params.type !== 0 && !body.dynamic) continue;
            body.position.lerpVectors(body.previousTargetPosition, body.targetPosition, this.targetAlpha);
            body.velocity.subVectors(body.position, body.previousPosition).multiplyScalar(1 / h);
            if (body.params.type !== 0) continue;
            body.quaternion.slerpQuaternions(body.previousTargetQuaternion, body.targetQuaternion, this.targetAlpha);
            this.deltaRotation.copy(body.previousQuaternion).invert().premultiply(body.quaternion).normalize();
            if (this.deltaRotation.w < 0) this.deltaRotation.set(-this.deltaRotation.x, -this.deltaRotation.y, -this.deltaRotation.z, -this.deltaRotation.w);
            const length = Math.hypot(this.deltaRotation.x, this.deltaRotation.y, this.deltaRotation.z);
            body.omega.set(this.deltaRotation.x, this.deltaRotation.y, this.deltaRotation.z)
                .multiplyScalar(length > 1e-10 ? 2 * Math.atan2(length, this.deltaRotation.w) / (length * h) : 0);
        }
    }

    _applyWind(h) {
        if (!this.windSettings.enabled) return;
        const average = advanceWindState(this.windState, h, this.windSettings, false);
        if (average <= 0) return;
        this.frameRotation.copy(this.windSceneRotation).invert();
        this.windVector.set(this.windDirection.x, this.windDirection.y, this.windDirection.z).applyQuaternion(this.frameRotation);
        this.mesh.getWorldQuaternion(this.frameRotation); this.windVector.applyQuaternion(this.frameRotation);
        this.windSamplingMatrix.copy(this.mesh.matrixWorld).invert().premultiply(this.windSceneMatrix);
        for (const body of this.bodies) {
            if (!body.dynamic) continue;
            this.windSamplingPosition.copy(body.position).applyMatrix4(this.windSamplingMatrix);
            const strength = sampleRigidWindStrength(average, this.windState.time - h / 2,
                this.windSettings.gust, this.windSamplingPosition);
            this.lever.set(0, 0, 0);
            if (body.positionDriven) this.lever.copy(body.windLever).applyQuaternion(body.quaternion);
            calculateRigidWindForce(body.force, body.params, body.quaternion, body.velocity, body.omega,
                this.lever, body.inertia, this.windVector, strength, h);
            if (!body.positionDriven) continue;
            this.torque.crossVectors(this.lever, body.force).applyQuaternion(this.frameRotation.copy(body.quaternion).invert());
            for (let i = 0; i < 3; i += 1) {
                const limit = Math.max(0, body.inertia.getComponent(i)) * 12;
                this.torque.setComponent(i, clamp(this.torque.getComponent(i), -limit, limit));
            }
            body.torque.copy(this.torque).applyQuaternion(body.quaternion);
        }
    }

    _updateBones() {
        for (const body of this.bodies) {
            if (body.params.type === 0 || body.params.boneIndex === -1) continue;
            this.matrix.compose(body.position, body.quaternion, this.position.set(1, 1, 1)).multiply(body.inverseOffset);
            this.matrix.decompose(this.position, this.rotation, this.lever);
            const bone = body.bone;
            if (bone.parent) {
                bone.parent.getWorldQuaternion(this.frameRotation).invert();
                bone.quaternion.copy(this.frameRotation.multiply(this.rotation)).normalize();
                if (body.params.type === 1) bone.position.copy(bone.parent.worldToLocal(this.position));
            } else {
                bone.quaternion.copy(this.rotation);
                if (body.params.type === 1) bone.position.copy(this.position);
            }
            bone.updateMatrixWorld(true);
        }
    }

    _advanceFrame() {
        for (const body of this.bodies) {
            if (body.params.type !== 0 && !body.positionDriven) continue;
            body.previousTargetPosition.copy(body.targetPosition); body.previousTargetQuaternion.copy(body.targetQuaternion);
            this._bonePose(body, body.targetPosition, body.targetQuaternion);
        }
        // 参考Ten Minute Physics 22/25：整个有效帧间隔拆成N个小步，每步只求解一轮。
        // 基准10表示10子步；不把数值当频率或再与物理Hz相除，N的上限180控制帧预算。
        const steps = normalizeWebStabilityReference(this.stabilityReferenceHz);
        const h = this.frameDelta / steps;
        this.frameSubsteps = 0;
        for (let i = 0; i < steps; i += 1) {
            this.targetAlpha = (i + 1) / steps;
            this._applyWind(h);
            this.solver.step(h, this.gravity, this.applyTargets);
            this.frameSubsteps += 1;
            this.onDiagnosticSubstep?.();
        }
        this._updateBones();
    }

    update(delta) {
        if (this.disposed || !Number.isFinite(delta) || delta <= 0) return this;
        const begin = performance.now();
        this.frameDelta = delta;
        if (this.windSettings.enabled) {
            this.mesh.getWorldQuaternion(this.windSceneRotation);
            this.windSceneMatrix.copy(this.mesh.matrixWorld);
        }
        this._withPhysicsSpace(this.frameAction);
        this.frameMs = performance.now() - begin;
        return this;
    }

    setGravity(value) { this.gravity.copy(value); return this; }
    setStabilityReferenceHz(value) {
        this.stabilityReferenceHz = normalizeWebStabilityReference(value);
        return this.stabilityReferenceHz;
    }
    setWindSettings(value) {
        this.windSettings = normalizeWindSettings(value); this.windDirection = windFlowDirection(this.windSettings);
        if (!this.windSettings.enabled) this.windState.strength = 0;
        return { ...this.windSettings };
    }
    warmup(cycles) { for (let i = 0; i < cycles; i += 1) this.update(1 / 60); return this; }
    getBodyPose(index, position, quaternion) {
        const body = this.bodies[index];
        if (!body || this.disposed) return false;
        position.copy(body.position); quaternion.copy(body.quaternion); return true;
    }
    get contacts() { return this.solver?.contacts || []; }
    getState() { return { solver: this.engine, bodyCount: this.bodies.length, jointCount: this.constraints.length,
        frameMs: this.frameMs, substeps: normalizeWebStabilityReference(this.stabilityReferenceHz),
        frameSubsteps: this.frameSubsteps, ...this.solver?.getState() }; }
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.solver?.dispose(); this.solver = null;
        for (const body of this.bodies) body.dispose?.();
        this.bodies.length = 0; this.constraints.length = 0; this.onDiagnosticSubstep = null; this.mesh = null;
    }
}

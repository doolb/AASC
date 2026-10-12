import { XpbdPmxPhysics } from './web-xpbd-physics.mjs';
import { createXpbdBody, createXpbdJoint, createXpbdSolver } from './web-xpbd-rigid.mjs';
import { normalizeWebStabilityReference } from './web-physics-rate.mjs';
import { createWebglSolver } from './web-xpbd-webgl-solver.mjs';
import { Matrix4, Quaternion } from 'three';

// 按网格绑定所属renderer，WeakMap不持有已释放模型；动作重建复用同一上下文。
const renderers = new WeakMap();
export function bindWebglRenderer(mesh, renderer) { renderers.set(mesh, renderer); }
class WebglXpbdPhysics extends XpbdPmxPhysics {
    constructor(mesh, bodies, joints, options) {
        // 生命周期继续使用XPBD契约；实际计算后端由getState.solver显式报告。
        super(mesh, bodies, joints, { ...options, xpbdBackend: { engine: 'xpbd', createBody: createXpbdBody,
            createJoint: createXpbdJoint, createSolver: () => ({ reset() {}, dispose() {} }) } });
        this.renderer = options.renderer || renderers.get(mesh); this.fallbackReason = ''; this.contextLost = false;
        this.directRequested = false; this.poseAnimated = true; this.directCompatibilityReason = ''; this.lostPose = false;
        this.directCpuPoseRequired = false;
        this.renderRoot = new Matrix4(); this.originalFrustumCulled = mesh.frustumCulled;
        try { this.solver = createWebglSolver(this.renderer, this.bodies, this.constraints); }
        catch (error) { super.dispose(); throw error; }
        // 在丢失事件内解除旧资源和查询，不能等恢复后向新上下文删除旧句柄。
        this.onLost = () => { this.lostPose = this.lostPose || Boolean(this.solver?.directActive);
            this.mesh.frustumCulled = this.originalFrustumCulled;
            this.contextLost = true; this.solver?.dispose(); this.solver = null; };
        this.onRestored = () => {
            if (this.disposed) return;
            this.contextLost = false;
            try { this.solver?.dispose(); this.solver = createWebglSolver(this.renderer, this.bodies, this.constraints);
                if (this.lostPose) this.reset(); else this.resetMotion(); this.lostPose = false; }
            catch (error) { this.useCpu(error); }
        };
        this.renderer.domElement.addEventListener('webglcontextlost', this.onLost);
        this.renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);
    }
    _withPhysicsSpace(action) {
        this.mesh?.updateWorldMatrix(true, true);
        this.renderRoot?.copy(this.mesh.matrixWorld);
        return super._withPhysicsSpace(action);
    }
    setDirectPoseAnimated(value) { this.poseAnimated = value === true; }
    // API诊断与UI诊断共用条件，避免只看复选框导致CPU Overlay使用旧骨树。
    setDirectCpuPoseRequired(value) { this.directCpuPoseRequired = value === true; }
    setDirectBoneTexture(value) {
        this.directRequested = value === true;
        if (!this.directRequested && this.solver?.directActive) this.syncGpuPose();
        return this.directRequested;
    }
    // 同步仅在显式CPU消费者或直连退出时执行；位置/速度一起提交，保持后续CPU求解连续。
    syncGpuPose() {
        if (!this.solver?.directActive || this.contextLost) return false;
        this.solver.syncState();
        this._withPhysicsSpace(() => this._updateBones());
        this.mesh.frustumCulled = this.originalFrustumCulled;
        return true;
    }
    getBodyPose(index, position, quaternion) {
        if (this.solver?.directActive) this.syncGpuPose();
        return super.getBodyPose(index, position, quaternion);
    }
    syncPausedTransform() {
        if (this.solver?.directActive) {
            // 根已经变化时，先在新根中重建上一帧的局部骨姿态；否则type2锚点会取到抵消根变换的父骨。
            // 临时映射只供骨树回写，随后还原刚体旧姿态，让基类执行完整的跟随/清速度契约。
            const previousTransform = this.physicsTransform.clone();
            this.solver.syncState();
            try { this._withPhysicsSpace(() => {
                const delta = previousTransform.clone().invert().premultiply(this.mesh.matrixWorld);
                const rotation = new Quaternion().setFromRotationMatrix(delta).normalize();
                const poses = this.bodies.map(body => [body.position.clone(), body.quaternion.clone()]);
                try {
                    for (const body of this.bodies) {
                        body.position.applyMatrix4(delta); body.quaternion.premultiply(rotation).normalize();
                    }
                    this._updateBones();
                } finally {
                    this.bodies.forEach((body, i) => { body.position.copy(poses[i][0]); body.quaternion.copy(poses[i][1]); });
                }
            }); }
            finally { this.physicsTransform.copy(previousTransform); }
        }
        return super.syncPausedTransform();
    }
    resetAnchorInterpolation() {
        this.solver?.resetAnchorInterpolation?.();
        return super.resetAnchorInterpolation();
    }
    directBlocker() {
        if (!this.directRequested) return '开关关闭';
        if (this.fallbackReason) return '物理已回退CPU：' + this.fallbackReason;
        if (this.contextLost) return 'WebGL上下文丢失';
        if (this.directCpuPoseRequired) return '骨骼或刚体诊断需要CPU姿态';
        if (typeof document === 'undefined') return '';
        if (document.getElementById('mmdArSkeletonEnabled')?.checked || document.getElementById('mmdArRigidBodyEnabled')?.checked) {
            return '骨骼或刚体诊断需要CPU姿态';
        }
        if (globalThis.window?.DisplayMmd?.getHumanInterface?.()?.getArmAvoidanceState?.().enabled) {
            return '手部防穿模需要CPU刚体，请先关闭其开关';
        }
        return '';
    }
    useCpu(error) {
        let resetPose = this.lostPose || this.solver?.directActive || this.contextLost;
        if (this.solver?.syncState && !this.renderer?.getContext().isContextLost()) {
            try { this.solver.syncState(); this._withPhysicsSpace(() => this._updateBones()); resetPose = false; }
            catch (syncError) { resetPose = true; }
        }
        this.solver?.dispose(); this.solver = createXpbdSolver(this.bodies, this.constraints);
        this.mesh.frustumCulled = this.originalFrustumCulled;
        this.fallbackReason = error?.message || 'WebGL后端不可用';
        if (resetPose) this.reset(); else this.resetMotion();
    }
    _advanceFrame() {
        if (this.contextLost || this.renderer?.getContext().isContextLost()) return;
        if (this.fallbackReason) { super._advanceFrame(); return; }
        this.directCompatibilityReason = this.directBlocker();
        const direct = this.directRequested && !this.directCompatibilityReason && this.solver.prepareDirect(this.mesh);
        if (this.directRequested && !direct && !this.directCompatibilityReason) {
            this.directCompatibilityReason = this.solver.getState().directReason || '模型不适用';
        }
        if (!direct && this.solver.directActive) {
            try { this.solver.syncState(); this._updateBones(); }
            catch (error) { this.useCpu(error); super._advanceFrame(); return; }
        }
        if (!direct) for (const body of this.bodies) {
            if (body.params.type !== 0 && !body.positionDriven) continue;
            body.previousTargetPosition.copy(body.targetPosition); body.previousTargetQuaternion.copy(body.targetQuaternion);
            this._bonePose(body, body.targetPosition, body.targetQuaternion);
        }
        const steps = normalizeWebStabilityReference(this.stabilityReferenceHz);
        let active;
        try { active = this.solver.runFrame(this, steps, this.frameDelta / steps, direct); }
        catch (error) {
            if (this.renderer.getContext().isContextLost()) { this.contextLost = true; return; }
            this.useCpu(error); return;
        }
        this.frameSubsteps = steps;
        if (active) this.mesh.frustumCulled = false;
        else { this._updateBones(); this.mesh.frustumCulled = this.originalFrustumCulled; }
        this.onDiagnosticSubstep?.();
    }
    getState() { return { ...super.getState(), requestedSolver: 'xpbd-webgl', fallbackReason: this.fallbackReason,
        directRequested: this.directRequested, directCompatibilityReason: this.directCompatibilityReason || this.directBlocker(),
        contextLost: this.contextLost, solver: this.fallbackReason ? 'xpbd' : 'xpbd-webgl' }; }
    dispose() {
        if (this.mesh) this.mesh.frustumCulled = this.originalFrustumCulled;
        this.renderer?.domElement.removeEventListener('webglcontextlost', this.onLost);
        this.renderer?.domElement.removeEventListener('webglcontextrestored', this.onRestored);
        super.dispose(); this.renderer = null;
    }
}
export function createWebglPmxPhysics(mesh, bodies, joints, options = {}) {
    try { return new WebglXpbdPhysics(mesh, bodies, joints, options); }
    catch (error) {
        const cpu = new XpbdPmxPhysics(mesh, bodies, joints, options), getState = cpu.getState.bind(cpu);
        cpu.getState = () => ({ ...getState(), requestedSolver: 'xpbd-webgl', computeBackend: 'cpu', fallbackReason: error.message });
        return cpu;
    }
}

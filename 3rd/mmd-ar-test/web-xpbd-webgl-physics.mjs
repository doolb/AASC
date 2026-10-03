import { XpbdPmxPhysics } from './web-xpbd-physics.mjs';
import { createXpbdBody, createXpbdJoint, createXpbdSolver } from './web-xpbd-rigid.mjs';
import { normalizeWebStabilityReference } from './web-physics-rate.mjs';
import { createWebglSolver } from './web-xpbd-webgl-solver.mjs';

// 按网格绑定所属renderer，WeakMap不持有已释放模型；动作重建复用同一上下文。
const renderers = new WeakMap();
export function bindWebglRenderer(mesh, renderer) { renderers.set(mesh, renderer); }
class WebglXpbdPhysics extends XpbdPmxPhysics {
    constructor(mesh, bodies, joints, options) {
        // 生命周期继续使用XPBD契约；实际计算后端由getState.solver显式报告。
        super(mesh, bodies, joints, { ...options, xpbdBackend: { engine: 'xpbd', createBody: createXpbdBody,
            createJoint: createXpbdJoint, createSolver: () => ({ reset() {}, dispose() {} }) } });
        this.renderer = options.renderer || renderers.get(mesh); this.fallbackReason = ''; this.contextLost = false;
        try { this.solver = createWebglSolver(this.renderer, this.bodies, this.constraints); }
        catch (error) { super.dispose(); throw error; }
        // 在丢失事件内解除旧资源和查询，不能等恢复后向新上下文删除旧句柄。
        this.onLost = () => { this.contextLost = true; this.solver?.dispose(); this.solver = null; };
        this.onRestored = () => {
            if (this.disposed) return;
            this.contextLost = false;
            try { this.solver?.dispose(); this.solver = createWebglSolver(this.renderer, this.bodies, this.constraints); this.resetMotion(); }
            catch (error) { this.useCpu(error); }
        };
        this.renderer.domElement.addEventListener('webglcontextlost', this.onLost);
        this.renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);
    }
    useCpu(error) {
        this.solver?.dispose(); this.solver = createXpbdSolver(this.bodies, this.constraints);
        this.fallbackReason = error?.message || 'WebGL后端不可用'; this.resetMotion();
    }
    _advanceFrame() {
        if (this.contextLost || this.renderer?.getContext().isContextLost()) return;
        if (this.fallbackReason) { super._advanceFrame(); return; }
        for (const body of this.bodies) {
            if (body.params.type !== 0 && !body.positionDriven) continue;
            body.previousTargetPosition.copy(body.targetPosition); body.previousTargetQuaternion.copy(body.targetQuaternion);
            this._bonePose(body, body.targetPosition, body.targetQuaternion);
        }
        const steps = normalizeWebStabilityReference(this.stabilityReferenceHz);
        try { this.solver.runFrame(this, steps, this.frameDelta / steps); }
        catch (error) { if (this.renderer.getContext().isContextLost()) { this.contextLost = true; return; }
            this.useCpu(error); return; }
        this.frameSubsteps = steps; this._updateBones(); this.onDiagnosticSubstep?.();
    }
    getState() { return { ...super.getState(), requestedSolver: 'xpbd-webgl', fallbackReason: this.fallbackReason,
        contextLost: this.contextLost, solver: this.fallbackReason ? 'xpbd' : 'xpbd-webgl' }; }
    dispose() {
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

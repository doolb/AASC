import { getWebPhysicsStepOptions } from './mmd-physics-rate.mjs';
/*
 * PMX 的 MMDAnimationHelper 创建逻辑。
 *
 * 将物理是否可用与动画动作初始化集中在此处，使刚体 PMX 的降级路径和普通 PMX
 * 使用完全相同的 VMD、IK、grant 更新流程。
 */
import { hasMmdPhysics } from './mmd-ammo-physics.mjs';

const DEFAULT_PMX_PHYSICS_FPS = 90;

const normalizePmxPhysicsFps = (value) => {
    if (value === null || (typeof value === 'string' && value.trim() === '')) return DEFAULT_PMX_PHYSICS_FPS;
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_PMX_PHYSICS_FPS;
    const clamped = Math.min(180, Math.max(30, number));
    return Math.round(clamped / 5) * 5;
};

const buildMotionHelper = ({
    mesh,
    clip,
    playMode,
    MMDAnimationHelper,
    loopRepeat,
    loopOnce,
    physics,
    physicsFps,
    physicsSolver
}) => {
    // 默认动作、本地VMD和MPL循环保留布料的刚体状态，显式切换仍走原初始化。
    /* aasc-shared:addContinuousMotionHelper */
    const helper = new MMDAnimationHelper({ sync: false, pmxAnimation: true, resetPhysicsOnLoop: false });
    const options = { physics, physicsSolver };
    if (physics) {
        // 不在隐藏加载阶段推进物理或自动套用 VMD 首帧；动作从可见后的渲染帧开始。
        options.warmup = 0;
        options.animationWarmup = false;
        Object.assign(options, getWebPhysicsStepOptions(normalizePmxPhysicsFps(physicsFps)));
    }
    if (clip) options.animation = clip;
    helper.add(mesh, options);

    const action = helper.objects.get(mesh)?.mixer?._actions?.[0];
    if (action) {
        const shouldLoop = playMode !== 'once';
        action.setLoop(shouldLoop ? loopRepeat : loopOnce, shouldLoop ? Infinity : 1);
        action.clampWhenFinished = !shouldLoop;
        action.reset().play();
    }
    return helper;
};

/*
 * 将新 PMX 先以不可见状态挂到最终场景，再初始化 Ammo 物理。
 * 这样物理系统读取的是最终父级和世界矩阵，且初始化失败时不会留下暂存节点。
 */
export async function stagePmxMesh({ scene, mesh, createPivot, prepareHelper }) {
    const pivot = createPivot(mesh);
    pivot.visible = false;
    try {
        scene.add(pivot);
        pivot.updateWorldMatrix(true, true);
        const preparedHelper = await prepareHelper();
        return { pivot, preparedHelper };
    } catch (error) {
        scene.remove(pivot);
        throw error;
    }
}

/*
 * 先让角色枢轴完成本帧缓动，再把更新后的骨骼世界矩阵交给 MMDPhysics。
 * MMDPhysics 只从骨骼移动 type=0 运动学锚点；动态刚体留在 Bullet 世界里，
 * 由约束产生跟随、滞后与惯性，不在这里整批传送位置或速度。
 */
function resetPmxPhysicsAfterRotation(physics, pivot) {
    // 动作已经推进到当前帧；先刷新骨骼矩阵，再让刚体贴合当前姿态。
    pivot?.updateWorldMatrix?.(true, true);
    physics.reset();
    if (physics.engine === 'xpbd') { physics.resetMotion(); return; }
    const zero = physics.manager.allocVector3();
    zero.setValue(0, 0, 0);
    try {
        for (const entry of physics.bodies) {
            if (entry.params.type === 0) continue;
            entry.body.setLinearVelocity(zero);
            entry.body.setAngularVelocity(zero);
            entry.body.clearForces();
            entry.body.activate();
        }
    } finally {
        physics.manager.freeVector3(zero);
    }
}

export function advancePmxMotionFrame({
    delta, pivot, helper, advanceRotation, physics, physicsGate, rotationPhysicsLimit
} = {}) {
    const rotationRadians = advanceRotation?.(delta);
    pivot?.updateWorldMatrix?.(true, true);
    if (physics && physicsGate && helper?.enabled) {
        const speed = delta > 0 && Number.isFinite(rotationRadians)
            ? Math.abs(rotationRadians) * 180 / Math.PI / delta
            : 0;
        const tooFast = Number.isFinite(rotationPhysicsLimit)
            && rotationPhysicsLimit > 0 && speed > rotationPhysicsLimit;
        if (tooFast) {
            // 只关闭 Ammo 步进；MMDAnimationHelper 仍推进 VMD、IK 和 grant。
            helper.enabled.physics = false;
            physicsGate.paused = true;
            helper.update(delta);
            return;
        }
        if (physicsGate.paused) {
            // 减速后的首帧先推进动画，再复位刚体；下一帧才重新步进物理。
            helper.enabled.physics = false;
            helper.update(delta);
            resetPmxPhysicsAfterRotation(physics, pivot);
            helper.enabled.physics = true;
            physicsGate.paused = false;
            return;
        }
        helper.enabled.physics = true;
    }
    helper?.update(delta);
}

/* 只控制 VMD/骨骼动画，保留 Ammo 刚体和布料物理的原有运行状态。 */
export function setPmxMotionPlaybackEnabled(helper, enabled) {
    if (!helper?.enabled) return false;
    helper.enabled.animation = enabled === true;
    return helper.enabled.animation;
}

export async function createPmxMotionHelper({
    mesh,
    clip = null,
    playMode = 'loop',
    MMDAnimationHelper,
    loopRepeat,
    loopOnce,
    ensurePhysics,
    physicsEnabled = true,
    physicsFps = DEFAULT_PMX_PHYSICS_FPS,
    physicsSolver = 'ammo'
}) {
    const commonOptions = {
        mesh,
        clip,
        playMode,
        MMDAnimationHelper,
        loopRepeat,
        loopOnce,
        physicsFps,
        physicsSolver
    };
    if (!physicsEnabled || !hasMmdPhysics(mesh)) {
        return {
            helper: buildMotionHelper({ ...commonOptions, physics: false }),
            physicsEnabled: false,
            physicsError: null
        };
    }

    try {
        if (physicsSolver !== 'xpbd') await ensurePhysics();
        return {
            helper: buildMotionHelper({ ...commonOptions, physics: true }),
            physicsEnabled: true,
            physicsError: null
        };
    } catch (error) {
        if (physicsSolver !== 'ammo') throw error;
        return {
            helper: buildMotionHelper({ ...commonOptions, physics: false }),
            physicsEnabled: false,
            physicsError: error instanceof Error ? error : new Error('Ammo 物理初始化失败')
        };
    }
}

/* aasc-shared:addPhysicsRateHelper */

/* aasc-shared:addSolverHelper */

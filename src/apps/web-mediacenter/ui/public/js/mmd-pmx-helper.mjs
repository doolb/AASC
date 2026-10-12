import { getWebPhysicsStepOptions } from './mmd-physics-rate.mjs';
import { instrumentPhysics } from './mmd-performance.mjs';
/*
 * PMX 的 MMDAnimationHelper 创建逻辑。
 *
 * 将物理是否可用与动画动作初始化集中在此处，使刚体 PMX 的降级路径和普通 PMX
 * 使用完全相同的 VMD、IK、grant 更新流程。
 */
import { hasMmdPhysics } from './mmd-ammo-physics.mjs';

const DEFAULT_PMX_PHYSICS_FPS = 90;

const getPhysicsDebugState = () => {
    if (globalThis.MmdArPhysicsDebug !== true) return null;
    if (!globalThis.MmdArPhysicsDebugState) globalThis.MmdArPhysicsDebugState = { events: [], frame: 0 };
    return globalThis.MmdArPhysicsDebugState;
};

const summarizeBody = (entry) => {
    const readVector = (value) => value && ['x', 'y', 'z'].every(key => typeof value[key] === 'function')
        ? [value.x(), value.y(), value.z()] : null;
    return {
        type: entry.params?.type,
        linearVelocity: readVector(entry.body?.getLinearVelocity?.()),
        angularVelocity: readVector(entry.body?.getAngularVelocity?.())
    };
};

const recordPhysicsDebug = (event, data = {}) => {
    const state = getPhysicsDebugState();
    if (!state) return;
    const row = { event, time: performance.now(), ...data };
    state.last = row;
    state.events.push(row);
    if (state.events.length > 100) state.events.shift();
    console.debug('[mmd-ar physics]', row);
};

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
    // 包装实际实例而非第三方原型，Ammo/XPBD与独立后端沿用相同口径。
    instrumentPhysics(helper.objects.get(mesh)?.physics);

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
export function advancePmxMotionFrame({
    delta, pivot, helper, advanceRotation, physics, physicsGate, rotationPhysicsLimit
} = {}) {
    const rotationRadians = advanceRotation?.(delta);
    pivot?.updateWorldMatrix?.(true, true);
    const debugState = getPhysicsDebugState();
    if (debugState) debugState.frame = (debugState.frame || 0) + 1;
    if (physics && physicsGate && helper?.enabled) {
        const speed = delta > 0 && Number.isFinite(rotationRadians)
            ? Math.abs(rotationRadians) * 180 / Math.PI / delta
            : 0;
        const tooFast = Number.isFinite(rotationPhysicsLimit)
            && rotationPhysicsLimit > 0 && speed > rotationPhysicsLimit;
        if (tooFast) {
            const enteringPause = !physicsGate.paused;
            helper.enabled.physics = false;
            physicsGate.paused = true;
            if (enteringPause) recordPhysicsDebug('pause', {
                frame: debugState?.frame,
                speed,
                threshold: rotationPhysicsLimit,
                engine: physics.engine || 'ammo',
                bodyCount: physics.bodies?.length || 0
            });
            helper.update(delta);
            // 暂停期间每帧同步，防止恢复时一次性追赶整个旋转；同步不执行物理步进。
            physics.syncPausedTransform();
            return;
        }
        if (physicsGate.paused) {
            helper.enabled.physics = false;
            helper.update(delta);
            physics.syncPausedTransform();
            helper.enabled.physics = true;
            physicsGate.paused = false;
            recordPhysicsDebug('resume', {
                frame: debugState?.frame,
                speed,
                threshold: rotationPhysicsLimit,
                animationEnabled: helper.enabled.animation,
                engine: physics.engine || 'ammo'
            });
            return;
        }
    }
    helper?.update(delta);
    if (debugState?.last?.event === 'resume' && debugState.last.frame !== debugState.frame) {
        recordPhysicsDebug('first-physics-frame', {
            frame: debugState.frame,
            engine: physics?.engine || 'ammo',
            frameMs: physics?.frameMs || 0,
            bodies: physics?.bodies?.filter(entry => entry.params.type !== 0).slice(0, 3).map(summarizeBody) || []
        });
    }
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

/*
 * PMX 的 MMDAnimationHelper 创建逻辑。
 *
 * 将物理是否可用与动画动作初始化集中在此处，使刚体 PMX 的降级路径和普通 PMX
 * 使用完全相同的 VMD、IK、grant 更新流程。
 */
import { hasMmdPhysics } from './mmd-ammo-physics.mjs';

// 不在模型加载栈内推进物理；首个 helper.update 由显示后的下一渲染帧执行。
const PMX_PHYSICS_WARMUP_STEPS = 0;
const DEFAULT_PMX_PHYSICS_FPS = 65;

const normalizePmxPhysicsFps = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_PMX_PHYSICS_FPS;
    const clamped = Math.min(90, Math.max(30, number));
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
    physicsFps
}) => {
    const helper = new MMDAnimationHelper({ sync: false, pmxAnimation: true });
    const options = { physics };
    if (physics) {
        options.warmup = PMX_PHYSICS_WARMUP_STEPS;
        options.unitStep = 1 / normalizePmxPhysicsFps(physicsFps);
        options.maxStepNum = 3;
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
export function advancePmxMotionFrame({ delta, pivot, helper, advanceRotation } = {}) {
    advanceRotation?.(delta);
    pivot?.updateWorldMatrix?.(true, true);
    helper?.update(delta);
}

export async function createPmxMotionHelper({
    mesh,
    clip = null,
    playMode = 'loop',
    MMDAnimationHelper,
    loopRepeat,
    loopOnce,
    ensurePhysics,
    physicsFps = DEFAULT_PMX_PHYSICS_FPS
}) {
    const commonOptions = {
        mesh,
        clip,
        playMode,
        MMDAnimationHelper,
        loopRepeat,
        loopOnce,
        physicsFps
    };
    if (!hasMmdPhysics(mesh)) {
        return {
            helper: buildMotionHelper({ ...commonOptions, physics: false }),
            physicsEnabled: false,
            physicsError: null
        };
    }

    try {
        await ensurePhysics();
        return {
            helper: buildMotionHelper({ ...commonOptions, physics: true }),
            physicsEnabled: true,
            physicsError: null
        };
    } catch (error) {
        return {
            helper: buildMotionHelper({ ...commonOptions, physics: false }),
            physicsEnabled: false,
            physicsError: error instanceof Error ? error : new Error('Ammo 物理初始化失败')
        };
    }
}

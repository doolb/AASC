// 模型和动作共享初始化清理；只在新物理第一次步进前调用，不参与自动循环重播。
export function clearPmxPhysicsMotion(physics) {
    if (!physics) return;
    const zero = physics.manager.allocVector3();
    try {
        zero.setValue(0, 0, 0);
        for (const { body } of physics.bodies) {
            body.setLinearVelocity(zero);
            body.setAngularVelocity(zero);
            body.clearForces();
            body.activate();
        }
    } finally {
        physics.manager.freeVector3(zero);
    }
}

// 网页手动换动作先恢复模型绑定姿态，再建立物理；动作由渲染首帧门控延后播放。
export async function prepareMotionSwitch({ mesh, oldHelper, createHelper, ensurePhysics,
    physicsEnabled, physicsFps, playbackEnabled, isCurrent, canRestore = isCurrent,
    onStage = () => {} }) {
    const transforms = [mesh, ...mesh.skeleton.bones].map((node) => ({ node,
        position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
    const parent = mesh.parent;
    const morphs = mesh.morphTargetInfluences?.slice();
    const links = (mesh.geometry.userData.MMD.iks || []).flatMap((ik) => ik.links)
        .map((link) => ({ link, enabled: link.enabled }));
    const oldPhysics = oldHelper?.enabled?.physics;
    let nextHelper = null;
    let poseChanged = false;
    let released = false;
    const rollback = () => {
        if (released) return;
        released = true;
        nextHelper?.remove(mesh);
        // 新模型已经取代旧网格时只清理 helper，不写入已释放的骨骼。
        if (!poseChanged || !canRestore()) return;
        mesh.parent = parent;
        for (const saved of transforms) {
            saved.node.position.copy(saved.position);
            saved.node.quaternion.copy(saved.quaternion);
            saved.node.scale.copy(saved.scale);
        }
        if (morphs) mesh.morphTargetInfluences.splice(0, morphs.length, ...morphs);
        for (const saved of links) {
            if (saved.enabled === undefined) delete saved.link.enabled;
            else saved.link.enabled = saved.enabled;
        }
        mesh.updateWorldMatrix(true, true);
    };
    try {
        if (oldHelper?.enabled) oldHelper.enabled.physics = false;
        const needsPhysics = physicsEnabled && (mesh.geometry.userData.MMD.rigidBodies?.length || 0) > 0;
        onStage('准备动作与物理');
        // 等待期间由 runtime 阻止旧 helper 步进；异步返回后先检查网格与请求是否仍有效。
        if (needsPhysics) await ensurePhysics();
        if (!isCurrent()) return null;
        // 先恢复绑定姿态，再让新 mixer 捕获初始属性，避免缓存旧动作的骨骼和表情。
        poseChanged = true;
        onStage('恢复 T Pose（模型绑定姿态）');
        mesh.pose();
        mesh.morphTargetInfluences?.fill(0);
        nextHelper = (await createHelper()).helper;
        if (!isCurrent()) { rollback(); return null; }
        nextHelper.enable('physics', false);
        // 创建 mixer 只注册动作，不执行 update(0)；物理必须读取绑定姿态而非 VMD 首帧。
        nextHelper.enabled.animation = false;
        mesh.updateWorldMatrix(true, true);
        if (needsPhysics) {
            onStage('初始化物理');
            // 禁止自动套用 VMD 首帧和物理预热，所有刚体都从模型绑定姿态开始。
            nextHelper._setupMeshPhysics(mesh, { warmup: 0, animationWarmup: false,
                unitStep: 1 / physicsFps, maxStepNum: 3 });
            clearPmxPhysicsMotion(nextHelper.objects.get(mesh).physics);
            nextHelper.enable('physics', true);
        }
        nextHelper.enabled.animation = playbackEnabled;
        return { helper: nextHelper, physicsEnabled: Boolean(needsPhysics), physicsError: null, rollback };
    } catch (error) {
        rollback();
        throw error;
    } finally {
        if (oldHelper?.enabled) oldHelper.enabled.physics = oldPhysics;
    }
}

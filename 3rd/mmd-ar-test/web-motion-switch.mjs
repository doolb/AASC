// 仅网页手动换动作使用：在同一 helper 上先应用起始骨骼姿态，再建立物理。
export async function prepareMotionSwitch({ mesh, oldHelper, createHelper, ensurePhysics,
    physicsEnabled, physicsFps, playbackEnabled, isCurrent, canRestore = isCurrent }) {
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
        // 等待期间由 runtime 阻止旧 helper 步进；异步返回后先检查网格与请求是否仍有效。
        if (needsPhysics) await ensurePhysics();
        if (!isCurrent()) return null;
        // 先恢复绑定姿态，再让新 mixer 捕获初始属性，避免缓存旧动作的骨骼和表情。
        poseChanged = true;
        mesh.pose();
        mesh.morphTargetInfluences?.fill(0);
        nextHelper = (await createHelper()).helper;
        if (!isCurrent()) { rollback(); return null; }
        nextHelper.enable('physics', false);
        nextHelper.enabled.animation = true;
        // delta=0 应用 VMD 起始关键帧、IK 与 grant，不推进动作时间或刚体。
        nextHelper.update(0);
        mesh.updateWorldMatrix(true, true);
        if (needsPhysics) {
            // 固定的 r160 vendor 提供该初始化步骤；在同一 helper 上保留动画骨骼缓存，
            // 禁止物理初始化再次套用首帧，避免 grant 叠加或从旧动作创建刚体。
            nextHelper._setupMeshPhysics(mesh, { warmup: 0, animationWarmup: false,
                unitStep: 1 / physicsFps, maxStepNum: 3 });
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

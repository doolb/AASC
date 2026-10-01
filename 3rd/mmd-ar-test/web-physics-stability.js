'use strict';

// 稳定性只接入独立测试构建副本；固定源升级时必须显式核对补丁入口。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`网页物理稳定性缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
}

function addPhysicsStability(source) {
    // 未显式传入步长时也采用测试默认90Hz，固定vendor文件保持原65Hz。
    let output = once(source, 'this.unitStep = ( params.unitStep !== undefined ) ? params.unitStep : 1 / 65;',
        'this.unitStep = ( params.unitStep !== undefined ) ? params.unitStep : 1 / 90;');
    output = once(output, '\t\tthis.constraints = [];', `\t\tthis.constraints = [];
        this.stabilityUnitStep = null;
        this.stabilityReferenceHz = 45;
        this.stabilityAppliedReferenceHz = null;`);
    output = once(output, '    resetAnchorInterpolation() {', `    // 原库STOP_ERP=0.475以65Hz为参考；归一单位时间的误差衰减，而不修改弹簧/质量。
    // 参考Hz运行时可调（默认45）：unitStep或参考值任一变化都重算六轴纠错率。
    _refreshConstraintStability() {
        if (this.stabilityUnitStep === this.unitStep
            && this.stabilityAppliedReferenceHz === this.stabilityReferenceHz) return;
        const reference = Number(this.stabilityReferenceHz);
        const referenceHz = Number.isFinite(reference) && reference > 0 ? reference : 45;
        const stopErp = 1 - Math.pow(1 - 0.475, referenceHz * this.unitStep);
        for (const entry of this.constraints) {
            if (typeof entry.constraint.setParam !== 'function') continue;
            for (let axis = 0; axis < 6; axis += 1) entry.constraint.setParam(2, stopErp, axis);
        }
        this.stabilityUnitStep = this.unitStep;
        this.stabilityAppliedReferenceHz = this.stabilityReferenceHz;
    }

    // 运行时实时改基准：立即重算六轴，不等待变频/复位；非法值按45。
    setStabilityReferenceHz(value) {
        const reference = Number(value);
        this.stabilityReferenceHz = Number.isFinite(reference) && reference > 0 ? reference : 45;
        this._refreshConstraintStability();
        return this.stabilityReferenceHz;
    }

    resetAnchorInterpolation() {`);
    output = once(output, '        if (this.disposed) return this;\n        // 复位和恢复',
        '        if (this.disposed) return this;\n        this._refreshConstraintStability();\n        // 复位和恢复');
    output = once(output, '\t\tbody.setSleepingThresholds( 0, 0 );', `\t\tbody.setSleepingThresholds( 0, 0 );
        // type2有骨骼时位置随骨骼、旋转随物理：屏蔽自由平移力，保留原质量及角惯量。
        // 无骨骼的type2没有位置目标，必须继续作为自由动态刚体。
        this.positionDriven = params.type === 2 && params.boneIndex !== -1;
        if (this.positionDriven) {
            const factor = manager.allocVector3();
            try { factor.setValue(0, 0, 0); body.setLinearFactor(factor); }
            finally { manager.freeVector3(factor); }
        }`);
    output = once(output, '\t\tif ( this.params.type === 2 ) {',
        '\t\tif ( this.params.type === 2 && !this.positionDriven ) {');
    // 完整替换旋转回写入口，不依赖旧局部姿态和可能滞后一帧的骨骼世界矩阵。
    // 两个边界各校验一次，固定库升级或重复注入时停止构建，避免静默保留错误反馈。
    const rotationStart = '\t_updateBoneRotation() {';
    const rotationEnd = '\t_updateBonePosition() {';
    output = once(output, rotationStart, rotationStart);
    output = once(output, rotationEnd, rotationEnd);
    const start = output.indexOf(rotationStart);
    const end = output.indexOf(rotationEnd);
    if (end <= start) throw new Error('网页物理稳定性旋转回写边界顺序错误');
    output = output.slice(0, start) + `    _updateBoneRotation() {
        const manager = this.manager;
        const form = this._getWorldTransformForBone();
        const rotation = manager.getBasis(form);
        const worldQuaternion = manager.allocThreeQuaternion();
        const parentQuaternion = manager.allocThreeQuaternion();
        try {
            worldQuaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
            // 父骨骼可能刚被物理回写或动作恢复。getWorldQuaternion更新祖先及父级自身，
            // 不遍历整个模型；世界目标必须由父世界旋转的逆换算为局部旋转。
            if (this.bone.parent) this.bone.parent.getWorldQuaternion(parentQuaternion).invert();
            else parentQuaternion.identity();
            this.bone.quaternion.copy(parentQuaternion.multiply(worldQuaternion).normalize());
        } finally {
            // 只归还本次取得的池对象，不清理借用刚体、不改速度、质量或关节参数。
            manager.freeThreeQuaternion(parentQuaternion);
            manager.freeThreeQuaternion(worldQuaternion);
            manager.freeQuaternion(rotation);
            manager.freeTransform(form);
        }
    }

` + output.slice(end);
    return output;
}

// 网页运行时接口：参考Hz进入共享步进参数；变更时立即改写当前物理实例，下一帧重算六轴纠错率。
// getWebPhysicsStepOptions / normalizeWebStabilityReference 由频率模块的运行时导入提供。
function addStabilityRuntime(source) {
    let output = once(source, '    let visible = true;', `    let physicsStabilityReferenceHz = 45;
    const setPhysicsStabilityReference = (value) => {
        physicsStabilityReferenceHz = normalizeWebStabilityReference(value);
        const physics = helper.current?.objects?.get(currentMesh)?.physics;
        if (physics) {
            Object.assign(physics, getWebPhysicsStepOptions(lightingState.physicsFps, physicsStabilityReferenceHz));
            // 只改基准不触发变频检测，需显式立即重算六轴纠错率。
            if (typeof physics.setStabilityReferenceHz === 'function') {
                physics.setStabilityReferenceHz(physicsStabilityReferenceHz);
            }
        }
        startRendering();
        return physicsStabilityReferenceHz;
    };

    let visible = true;`);
    return once(output, '        setMotionPlaybackEnabled,', `        setPhysicsStabilityReference,
        getPhysicsStabilityReference: () => physicsStabilityReferenceHz,
        setMotionPlaybackEnabled,`);
}

// 显示层：参考Hz只属于测试网页物理分类；runtime重建后补发。
// 经典脚本不能导入共享模块，这里按同一规则（3–180、步长1、非法回退45）本地归一，
// 保证runtime尚未创建时也能保存待补发的值。
function addStabilityDisplay(source) {
    let output = once(source, '    function setMotionPlaybackEnabled(enabled) {', `    let physicsStabilityReference = 45;
    function setPhysicsStabilityReference(value) {
        // 缺失/空串/非有限值回退45；其余3-180截断并按整数取整（与共享归一化一致）。
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
            physicsStabilityReference = 45;
        } else {
            const number = Number(value);
            physicsStabilityReference = Number.isFinite(number)
                ? Math.round(Math.min(180, Math.max(3, number))) : 45;
        }
        state.runtime?.setPhysicsStabilityReference?.(physicsStabilityReference);
        return physicsStabilityReference;
    }

    function setMotionPlaybackEnabled(enabled) {`);
    output = once(output, '                state.runtime.setVisible(state.visible);',
        '                state.runtime.setPhysicsStabilityReference?.(physicsStabilityReference);\n                state.runtime.setVisible(state.visible);');
    return once(output, '        setMotionPlaybackEnabled,',
        '        setPhysicsStabilityReference,\n        setMotionPlaybackEnabled,');
}

module.exports = { addPhysicsStability, addStabilityRuntime, addStabilityDisplay };

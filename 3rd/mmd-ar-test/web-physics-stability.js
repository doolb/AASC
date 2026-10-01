'use strict';

// 稳定性只接入独立测试构建副本；固定源升级时必须显式核对补丁入口。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`网页物理稳定性缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
}

function addPhysicsStability(source) {
    let output = once(source, '\t\tthis.constraints = [];', `\t\tthis.constraints = [];
        this.stabilityUnitStep = null;`);
    output = once(output, '    resetAnchorInterpolation() {', `    // 原库STOP_ERP=0.475以65Hz为参考；归一单位时间的误差衰减，而不修改弹簧/质量。
    _refreshConstraintStability() {
        if (this.stabilityUnitStep === this.unitStep) return;
        const stopErp = 1 - Math.pow(1 - 0.475, 65 * this.unitStep);
        for (const entry of this.constraints) {
            if (typeof entry.constraint.setParam !== 'function') continue;
            for (let axis = 0; axis < 6; axis += 1) entry.constraint.setParam(2, stopErp, axis);
        }
        this.stabilityUnitStep = this.unitStep;
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

module.exports = { addPhysicsStability };

'use strict';

// 仅适配独立网页副本，所有锚点都校验唯一性，避免库升级时静默漏掉一个入口。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`网页子步锚点适配缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
}

function addPhysicsSubsteps(source) {
    let output = once(source, '\t\tthis.constraints = [];', `\t\tthis.constraints = [];
        // 每个物理实例独占历史；初始化失败时也有可释放的完整状态。
        this.anchorSamples = [];
        this.physicsRemainder = 0;
        this.physicsSampleTime = 0;
        this.physicsStepTime = 0;
        this.interpolationUnitStep = this.unitStep;
        // 独立网页诊断的可选观察入口，未选中骨骼时保持null。
        this.onDiagnosticSubstep = null;`);
    output = once(output, '\tupdate( delta ) {', `\tupdate( delta ) {
        // 高频画面帧允许没有物理子步，非法/零时间不采样也不推进。
        if (!Number.isFinite(delta) || delta <= 0) return this;`);
    output = once(output, `\t\tthis._updateRigidBodies();
\t\tthis._stepSimulation( delta );
\t\tthis._updateBones();`, `        try {
            this._updateRigidBodies();
            this._stepSimulation(delta);
            // 骨骼只在所有子步完成后回写一次，VMD/IK仍按画面帧推进。
            this._updateBones();
        } finally {`);
    output = once(output, '\t\tmanager.freeThreeVector3( position );\n\n\t\treturn this;',
        '\t\tmanager.freeThreeVector3( position );\n        }\n\n\t\treturn this;');
    output = once(output, `\t\treturn this;

\t}

\t/**
\t * Warm ups Rigid bodies.`, `        this.resetAnchorInterpolation();
\t\treturn this;

\t}

\t/**
\t * Warm ups Rigid bodies.`);
    output = once(output, '            this.bodies.length = 0;', `            this.anchorSamples.length = 0;
            this.physicsRemainder = 0;
            this.physicsSampleTime = 0;
            this.physicsStepTime = 0;
            this.onDiagnosticSubstep = null;
            this.bodies.length = 0;`);
    const start = output.indexOf('\t_stepSimulation( delta ) {');
    const end = output.indexOf('\t_updateBones() {', start);
    if (start < 0 || end < 0) throw new Error('网页子步锚点缺少物理步进边界');
    output = output.slice(0, start) + `    // getter返回的origin/rotation是借用值，只复制分量，绝不销毁借用包装。
    _readAnchorTransform(form, position, quaternion) {
        const origin = form.getOrigin();
        const rotation = form.getRotation();
        position.set(origin.x(), origin.y(), origin.z());
        quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w()).normalize();
    }

    resetAnchorInterpolation() {
        if (this.disposed) return this;
        // 复位和恢复只重建驱动历史，不修改动态刚体速度、力或姿态。
        if (this.anchorSamples.length === 0) {
            this.anchorSamples = this.bodies
                .filter((entry) => (entry.params.type === 0 && entry.params.boneIndex !== -1) || entry.positionDriven)
                .map((entry) => ({ entry, previousPosition: new Vector3(), position: new Vector3(),
                    previousQuaternion: new Quaternion(), quaternion: new Quaternion(),
                    stepPosition: new Vector3(), stepQuaternion: new Quaternion() }));
        }
        for (const sample of this.anchorSamples) {
            this._readAnchorTransform(sample.entry.body.getCenterOfMassTransform(), sample.position, sample.quaternion);
            sample.previousPosition.copy(sample.position);
            sample.previousQuaternion.copy(sample.quaternion);
        }
        this.physicsRemainder = 0;
        this.physicsSampleTime = 0;
        this.physicsStepTime = 0;
        this.interpolationUnitStep = this.unitStep;
        return this;
    }

    _updateRigidBodies() {
        // 调节频率时从实际锚点姿态重新计时，随后再采集本帧骨骼目标。
        if (this.interpolationUnitStep !== this.unitStep) this.resetAnchorInterpolation();
        for (const sample of this.anchorSamples) {
            sample.previousPosition.copy(sample.position);
            sample.previousQuaternion.copy(sample.quaternion);
            const form = sample.entry._getBoneTransform();
            try { this._readAnchorTransform(form, sample.position, sample.quaternion); }
            finally { this.manager.freeTransform(form); }
        }
    }

    _applyAnchorTargets(alpha, form, velocity) {
        for (const sample of this.anchorSamples) {
            sample.stepPosition.lerpVectors(sample.previousPosition, sample.position, alpha);
            if (sample.entry.positionDriven) {
                // 只指定本步终点所需线速度，不能先跳到终点再积分，否则会重复移动。
                // 当前COM是借用值；角速度与姿态不被改写，仍由Ammo处理旋转及接触。
                const origin = sample.entry.body.getCenterOfMassTransform().getOrigin();
                velocity.setValue((sample.stepPosition.x - origin.x()) / this.unitStep,
                    (sample.stepPosition.y - origin.y()) / this.unitStep,
                    (sample.stepPosition.z - origin.z()) / this.unitStep);
                sample.entry.body.setLinearVelocity(velocity);
                continue;
            }
            sample.stepQuaternion.slerpQuaternions(sample.previousQuaternion, sample.quaternion, alpha);
            this.manager.setOriginFromThreeVector3(form, sample.stepPosition);
            this.manager.setBasisFromThreeQuaternion(form, sample.stepQuaternion);
            // 只写运动学MotionState。每次单步调用前Bullet会读取目标并计算线/角速度。
            // type1不被覆盖；type2位置驱动不通用清零任何刚体速度。
            sample.entry.body.getMotionState().setWorldTransform(form);
        }
    }

    _stepSimulation(delta) {
        const h = this.unitStep;
        const previousTime = this.physicsSampleTime;
        this.physicsSampleTime += delta;
        this.physicsRemainder += delta;
        // 只补偿浮点边界误差；不足一步的画面帧不强制模拟，余量跨帧保存。
        const due = Math.floor(this.physicsRemainder / h + 1e-9);
        const steps = Math.min(due, this.maxStepNum);
        const skipped = due - steps;
        // 超预算丢弃整步而非形成无限积压，同时推进采样时钟，使插值比例仍对应真实时间。
        this.physicsStepTime += skipped * h;
        this.physicsRemainder -= skipped * h;
        if (steps === 0) return;
        let form = null;
        let velocity = null;
        try {
            form = this.anchorSamples.length ? this.manager.allocTransform() : null;
            if (this.anchorSamples.some((sample) => sample.entry.positionDriven)) velocity = this.manager.allocVector3();
            // 受控平移必须到达目标，暂时跳过其线性阻尼；旋转阻尼原值保留。
            // 即使原始线性阻尼为1也能驱动，finally恢复参数，不影响其余动态刚体。
            for (const sample of this.anchorSamples) {
                if (sample.entry.positionDriven) sample.entry.body.setDamping(0, sample.entry.params.rotationDamping);
            }
            for (let index = 0; index < steps; index += 1) {
                const nextTime = this.physicsStepTime + h;
                const alpha = Math.min(1, Math.max(0, (nextTime - previousTime) / delta));
                if (form) this._applyAnchorTargets(alpha, form, velocity);
                // 外层负责固定时钟，maxSubSteps=0让Bullet恰好求解一次，避免重复内部拆步。
                this.world.stepSimulation(h, 0, h);
                this.onDiagnosticSubstep?.();
                this.physicsStepTime = nextTime;
                this.physicsRemainder = Math.max(0, this.physicsRemainder - h);
            }
        } finally {
            try {
                for (const sample of this.anchorSamples) {
                    if (sample.entry.positionDriven) sample.entry.body.setDamping(
                        sample.entry.params.positionDamping, sample.entry.params.rotationDamping);
                }
            } finally {
                // 参数恢复异常也必须归还临时值，避免下一次切换累积native分配。
                if (velocity) this.manager.freeVector3(velocity);
                if (form) this.manager.freeTransform(form);
            }
        }
    }

` + output.slice(end);
    return output;
}

function addSubstepRuntime(source) {
    let output = once(source,
        '        const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));', `        const frameSeconds = Math.max(0, (now - lastFrameAt) / 1000);
        // 浏览器后台暂停后不沿用旧时间余量；只同步历史，保留动态布料已有运动。
        if (frameSeconds > 0.1) helper.current?.objects?.get(currentMesh)?.physics?.resetAnchorInterpolation();
        const delta = Math.min(0.1, frameSeconds);`);
    output = once(output, '        visible = nextVisible === true;', `        if (nextVisible === true && !visible) {
            helper.current?.objects?.get(currentMesh)?.physics?.resetAnchorInterpolation();
        }
        visible = nextVisible === true;`);
    return output;
}

module.exports = { addPhysicsSubsteps, addSubstepRuntime };

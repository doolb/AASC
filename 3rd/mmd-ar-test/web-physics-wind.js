'use strict';

const fs = require('node:fs');
const path = require('node:path');
// 同一个归一化声明同时用于ESM、经典Display及面板；不对正式显示端源码做修改。
const sharedSource = fs.readFileSync(path.join(__dirname, 'web-physics-wind.mjs'), 'utf8');
const normalizeSource = sharedSource.slice(sharedSource.indexOf('export function normalizeWindSettings'),
    sharedSource.indexOf('export function windFlowDirection')).replace('export ', '').trim();

function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`风场缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
}

function addPhysicsWind(source, moduleUrl) {
    let output = `import { normalizeWindSettings, windFlowDirection, createWindState, advanceWindState } from '${moduleUrl}';\n${source}`;
    output = once(output, '\t\tthis.constraints = [];', `\t\tthis.constraints = [];
        this.windSettings = normalizeWindSettings();
        this.windState = createWindState();
        this.windDirection = windFlowDirection(this.windSettings);
        this.windBodies = null;
        this.windSceneQuaternion = new Quaternion();
        this.windScratch = { force: new Vector3(), direction: new Vector3(), lever: new Vector3(), torque: new Vector3(),
            frameQuaternion: new Quaternion(), quaternion: new Quaternion() };`);
    output = once(output, '        if (!Number.isFinite(delta) || delta <= 0) return this;',
        '        if (!Number.isFinite(delta) || delta <= 0) return this;\n        if (this.windSettings.enabled) this.mesh.getWorldQuaternion(this.windSceneQuaternion);');
    // 保存Bullet实际形状计算出的局部惯量，而不是按外观推测。只保留JS数值，无额外native资源。
    output = once(output, '\t\tthis.body = body;', `\t\tthis.body = body;
        if (this.positionDriven) {
            this.windInertia = new Vector3(localInertia.x(), localInertia.y(), localInertia.z());
            const offsetRotation = new Quaternion().setFromEuler(new Euler(...params.rotation));
            this.windLever = new Vector3(...params.position).applyQuaternion(offsetRotation.invert()).clampLength(0, 1);
        }`);
    output = once(output, '    resetAnchorInterpolation() {', `    setWindSettings(value) {
        this.windSettings = normalizeWindSettings(value);
        this.windDirection = windFlowDirection(this.windSettings);
        // 关闭立刻停止新施力，保留刚体已有速度；下次开启从0缓动。
        if (!this.windSettings.enabled) this.windState.strength = 0;
        return { ...this.windSettings };
    }

    _applyWind(seconds) {
        if (this.disposed || !this.windSettings.enabled) return;
        const strength = advanceWindState(this.windState, seconds, this.windSettings);
        if (strength <= 0) return;
        // 第一次开启才筛选受风刚体；关闭时完全不遍历。模型切换由新物理实例重新建立缓存。
        if (!this.windBodies) this.windBodies = this.bodies.filter((entry) => entry.params.type !== 0
            && Number.isFinite(entry.params.weight) && entry.params.weight > 0);
        const scratch = this.windScratch;
        const direction = this.windDirection;
        // 原MMDPhysics非单位缩放时会暂时脱离父级。将场景风向换到当前物理坐标，
        // 保证经纬度和灯光同属场景方向，角色旋转/缩放不带动外部风。
        scratch.frameQuaternion.copy(this.windSceneQuaternion).invert();
        scratch.direction.set(direction.x, direction.y, direction.z).applyQuaternion(scratch.frameQuaternion);
        this.mesh.getWorldQuaternion(scratch.frameQuaternion);
        scratch.direction.applyQuaternion(scratch.frameQuaternion);
        let force = null;
        let torque = null;
        try {
            force = this.manager.allocVector3();
            torque = this.manager.allocVector3();
            for (const entry of this.windBodies) {
                scratch.force.copy(scratch.direction).multiplyScalar(entry.params.weight * 10 * strength);
                if (!entry.positionDriven) {
                    force.setValue(scratch.force.x, scratch.force.y, scratch.force.z);
                    entry.body.applyCentralForce(force);
                    continue;
                }
                // type2位置由骨骼锚点驱动：只添加近似风致力矩，不改线性因子/目标速度。
                // 借用的Bullet姿态只读分量；等效力臂来自骨骼到刚体COM的偏移，不制造虚构偏移。
                const rotation = entry.body.getCenterOfMassTransform().getRotation();
                scratch.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w()).normalize();
                scratch.lever.copy(entry.windLever).applyQuaternion(scratch.quaternion);
                scratch.torque.crossVectors(scratch.lever, scratch.force);
                scratch.torque.applyQuaternion(scratch.quaternion.invert());
                const inertia = entry.windInertia;
                // 局部各轴角加速度上限12rad/s²，极小/零惯量时力矩同步趋零，避免小物件被风吹炸。
                for (const axis of ['x', 'y', 'z']) {
                    const limit = Number.isFinite(inertia[axis]) ? Math.max(0, inertia[axis]) * 12 : 0;
                    scratch.torque[axis] = Math.min(limit, Math.max(-limit, scratch.torque[axis]));
                }
                scratch.torque.applyQuaternion(scratch.quaternion.invert());
                torque.setValue(scratch.torque.x, scratch.torque.y, scratch.torque.z);
                entry.body.applyTorque(torque);
            }
        } finally {
            if (torque) this.manager.freeVector3(torque);
            if (force) this.manager.freeVector3(force);
        }
    }

    resetAnchorInterpolation() {`);
    return once(output, '            this.bodies.length = 0;', `            this.windBodies = null;
            this.windScratch = null;
            this.bodies.length = 0;`);
}

function addWindRuntime(source, moduleUrl) {
    let output = `import { normalizeWindSettings } from '${moduleUrl}';\n${source}`;
    output = once(output, '    let visible = true;', `    let windSettings = normalizeWindSettings();
    let windVersion = 0;
    const appliedWindVersions = new WeakMap();
    const syncPhysicsWind = (physics) => {
        if (!physics || appliedWindVersions.get(physics) === windVersion) return;
        physics.setWindSettings(windSettings);
        appliedWindVersions.set(physics, windVersion);
    };
    const setWindSettings = (value) => {
        windSettings = normalizeWindSettings(value);
        windVersion += 1;
        syncPhysicsWind(helper.current?.objects?.get(currentMesh)?.physics);
        startRendering();
        return { ...windSettings };
    };

    let visible = true;`);
    // 原刷新/换模型路径立即补发；手动VMD新建物理则在首次helper更新之前补发。
    output = once(output, '        const physics = prepared.helper?.objects?.get(mesh)?.physics;',
        '        const physics = prepared.helper?.objects?.get(mesh)?.physics;\n        syncPhysicsWind(physics);');
    output = once(output, '        const delayInitialMotion = frameHelper && pendingInitialMotionHelper === frameHelper;',
        '        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);\n        const delayInitialMotion = frameHelper && pendingInitialMotionHelper === frameHelper;');
    return once(output, '        setMotionPlaybackEnabled,', `        setWindSettings,
        getWindSettings: () => ({ ...windSettings }),
        setMotionPlaybackEnabled,`);
}

function addWindDisplay(source) {
    let output = once(source, '    function setMotionPlaybackEnabled(enabled) {', `    ${normalizeSource}
    let windSettings = normalizeWindSettings();
    function setWindSettings(value) {
        windSettings = normalizeWindSettings(value);
        state.runtime?.setWindSettings?.(windSettings);
        return { ...windSettings };
    }

    function setMotionPlaybackEnabled(enabled) {`);
    output = once(output, '                state.runtime.setVisible(state.visible);',
        '                state.runtime.setWindSettings?.(windSettings);\n                state.runtime.setVisible(state.visible);');
    return once(output, '        setMotionPlaybackEnabled,', `        setWindSettings,
        getWindSettings: () => ({ ...windSettings }),
        setMotionPlaybackEnabled,`);
}

const WIND_CONTROL_IDS = Object.freeze(['mmdArWindEnabled', 'mmdArWindStrength', 'mmdArWindStrengthValue',
    'mmdArWindLongitude', 'mmdArWindLongitudeValue', 'mmdArWindLatitude', 'mmdArWindLatitudeValue',
    'mmdArWindGust', 'mmdArWindGustValue', 'mmdArWindHint']);
const WIND_PANEL_HTML = `
    <label class="display-mmd-lighting-field"><input id="mmdArWindEnabled" type="checkbox"><span>启用风</span></label>
    <label class="mind-basic-field"><span>风力强度 <output id="mmdArWindStrengthValue">0.30</output></span><input id="mmdArWindStrength" type="range" min="0" max="30" step="0.05" value="0.3"></label>
    <label class="mind-basic-field"><span>风向经度 <output id="mmdArWindLongitudeValue">0°</output></span><input id="mmdArWindLongitude" type="range" min="-180" max="180" step="1" value="0"></label>
    <label class="mind-basic-field"><span>风向纬度 <output id="mmdArWindLatitudeValue">0°</output></span><input id="mmdArWindLatitude" type="range" min="-90" max="90" step="1" value="0"></label>
    <label class="mind-basic-field"><span>阵风幅度 <output id="mmdArWindGustValue">0%</output></span><input id="mmdArWindGust" type="range" min="0" max="100" step="5" value="0"></label>
    <p id="mmdArWindHint" class="mind-basic-note">经纬度与灯光一致，表示风从哪里吹来；正纬度从上方吹来。强度为效果等级，阵风0为恒定风。</p>`;
const WIND_PANEL_JS = `
    (() => {
        ${normalizeSource}
        const storageKey = 'aasc.mmdArTest.wind.v1';
        const fields = { enabled: 'mmdArWindEnabled', strength: 'mmdArWindStrength',
            longitude: 'mmdArWindLongitude', latitude: 'mmdArWindLatitude', gust: 'mmdArWindGust' };
        const controls = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, document.getElementById(id)]));
        if (Object.values(controls).some((control) => !control)) return;
        let settings = normalizeWindSettings();
        try { settings = normalizeWindSettings(JSON.parse(localStorage.getItem(storageKey))); }
        catch (error) { /* 存储受限/损坏时使用默认关闭的风。 */ }
        const apply = (value, persist = false) => {
            settings = normalizeWindSettings(value);
            for (const [key, control] of Object.entries(controls)) {
                if (key === 'enabled') { control.checked = settings.enabled; continue; }
                control.value = String(settings[key]);
                const output = document.getElementById(fields[key] + 'Value');
                output.textContent = key === 'strength' ? settings[key].toFixed(2)
                    : String(settings[key]) + (key === 'gust' ? '%' : '°');
            }
            window.DisplayMmd?.setWindSettings?.(settings);
            if (!persist) return;
            try { localStorage.setItem(storageKey, JSON.stringify(settings)); }
            catch (error) { /* 隐私模式保留本次效果，不阻断物理。 */ }
        };
        const read = () => Object.fromEntries(Object.entries(controls).map(([key, control]) =>
            [key, key === 'enabled' ? control.checked : control.value]));
        for (const control of Object.values(controls)) {
            control.addEventListener('input', () => apply(read()));
            control.addEventListener('change', () => apply(read(), true));
        }
        apply(settings);
    })();
`;

module.exports = { addPhysicsWind, addWindRuntime, addWindDisplay, WIND_CONTROL_IDS, WIND_PANEL_HTML, WIND_PANEL_JS };

// 先执行已有适配，再注入测试气动逻辑；兼容正式共享复用和原始vendor两种来源。
const basePhysicsWind = module.exports.addPhysicsWind;
function addRigidAerodynamics(source, moduleUrl) {
    let output = `import { calculateRigidWindForce, sampleRigidWindStrength } from '${moduleUrl}';\n${source}`;
    output = once(output, 'frameQuaternion: new Quaternion(), quaternion: new Quaternion() };',
        `frameQuaternion: new Quaternion(), quaternion: new Quaternion(),
            velocity: new Vector3(), omega: new Vector3(), position: new Vector3(), matrix: new Matrix4() };
        this.windSceneMatrix = new Matrix4();`);
    output = once(output, '        if (this.windSettings.enabled) this.mesh.getWorldQuaternion(this.windSceneQuaternion);',
        `        if (this.windSettings.enabled) {
            this.mesh.getWorldQuaternion(this.windSceneQuaternion);
            this.windSceneMatrix.copy(this.mesh.matrixWorld);
        }`);
    const start = output.indexOf('    _applyWind(seconds) {');
    const end = output.indexOf('    resetAnchorInterpolation() {', start);
    if (start < 0 || end < 0 || output.indexOf('    _applyWind(seconds) {', start + 1) !== -1) {
        throw new Error('刚体气动缺少唯一锚点：_applyWind');
    }
    return output.slice(0, start) + `    _applyWind(seconds) {
        if (this.disposed || !this.windSettings.enabled) return;
        const average = advanceWindState(this.windState, seconds, this.windSettings, false);
        if (average <= 0) return;
        if (!this.windBodies) this.windBodies = this.bodies.filter((entry) => entry.params.type !== 0
            && Number.isFinite(entry.params.weight) && entry.params.weight > 0);
        const scratch = this.windScratch;
        const direction = this.windDirection;
        scratch.frameQuaternion.copy(this.windSceneQuaternion).invert();
        scratch.direction.set(direction.x, direction.y, direction.z).applyQuaternion(scratch.frameQuaternion);
        this.mesh.getWorldQuaternion(scratch.frameQuaternion);
        scratch.direction.applyQuaternion(scratch.frameQuaternion);
        // 物理可能临时解除父级/尺度；此矩阵把物理COM映射回真实场景用于阵风采样。
        scratch.matrix.copy(this.mesh.matrixWorld).invert().premultiply(this.windSceneMatrix);
        let force = null;
        let torque = null;
        try {
            force = this.manager.allocVector3();
            torque = this.manager.allocVector3();
            for (const entry of this.windBodies) {
                // Bullet返回的transform/速度都是借用包装，只读，绝不destroy或放进池。
                const transform = entry.body.getCenterOfMassTransform();
                const origin = transform.getOrigin(), rotation = transform.getRotation();
                const velocity = entry.body.getLinearVelocity(), omega = entry.body.getAngularVelocity();
                scratch.position.set(origin.x(), origin.y(), origin.z()).applyMatrix4(scratch.matrix);
                scratch.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w()).normalize();
                scratch.velocity.set(velocity.x(), velocity.y(), velocity.z());
                scratch.omega.set(omega.x(), omega.y(), omega.z());
                scratch.lever.set(0, 0, 0);
                if (entry.positionDriven) scratch.lever.copy(entry.windLever).applyQuaternion(scratch.quaternion);
                const strength = sampleRigidWindStrength(average, this.windState.time - seconds / 2,
                    this.windSettings.gust, scratch.position);
                calculateRigidWindForce(scratch.force, entry.params, scratch.quaternion, scratch.velocity,
                    scratch.omega, scratch.lever, entry.windInertia, scratch.direction, strength, seconds);
                if (!entry.positionDriven) {
                    force.setValue(scratch.force.x, scratch.force.y, scratch.force.z);
                    entry.body.applyCentralForce(force);
                    continue;
                }
                // type2位置仍由骨骼驱动，只使用真实偏移的等效风矩，保留惯量限幅。
                scratch.torque.crossVectors(scratch.lever, scratch.force);
                scratch.torque.applyQuaternion(scratch.quaternion.invert());
                for (const axis of ['x', 'y', 'z']) {
                    const limit = Math.max(0, entry.windInertia[axis]) * 12;
                    scratch.torque[axis] = Math.min(limit, Math.max(-limit, scratch.torque[axis]));
                }
                scratch.torque.applyQuaternion(scratch.quaternion.invert());
                torque.setValue(scratch.torque.x, scratch.torque.y, scratch.torque.z);
                entry.body.applyTorque(torque);
            }
        } finally {
            if (torque) this.manager.freeVector3(torque);
            if (force) this.manager.freeVector3(force);
        }
    }

` + output.slice(end);
}
module.exports = { ...module.exports,
    addPhysicsWind: (source, moduleUrl) => addRigidAerodynamics(basePhysicsWind(source, moduleUrl), moduleUrl) };

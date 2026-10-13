import { Euler, Group, Mesh, MeshBasicMaterial, Plane, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { calculateInverseRotationalMass, calculateKneePoleTarget, calculatePbdAngularCorrections,
    KNEE_POLE_STRENGTH, PBD_MAX_ITERATIONS, PBD_TARGET_EPSILON } from './web-human-ik-pbd.mjs';
import { createHumanPhysicsRig } from './web-human-physics-rig.mjs';
import { BODY_STATES, createHumanPhysicsDrive, normalizeBodySettings } from './web-human-physics-drive.mjs';

const TARGETS = [
    { key: 'head', label: '头部', bone: 'head', color: 0xffd166 },
    { key: 'leftHand', label: '左手', bone: 'leftWrist', color: 0xff7777 },
    { key: 'rightHand', label: '右手', bone: 'rightWrist', color: 0x78aaff },
    { key: 'leftKnee', label: '左膝', bone: 'leftKnee', color: 0xffad66 },
    { key: 'rightKnee', label: '右膝', bone: 'rightKnee', color: 0xf2e66c },
    { key: 'leftFoot', label: '左脚', bone: 'leftAnkle', color: 0x77dfb0 },
    { key: 'rightFoot', label: '右脚', bone: 'rightAnkle', color: 0xd59bff },
];
const BODY_TARGETS = [...TARGETS,
    { key: 'pelvis', label: '骨盆', bone: 'hips', color: 0xffffff },
    { key: 'chest', label: '胸部', bone: 'upperBody', color: 0xffb0d8 },
    { key: 'leftElbow', label: '左肘', bone: 'leftElbow', color: 0xff7777 },
    { key: 'rightElbow', label: '右肘', bone: 'rightElbow', color: 0x78aaff }];
const MAX_LINKS = 12;
const MAX_CORRECTION = 45 * Math.PI / 180, MAX_KNEE_CORRECTION = 150 * Math.PI / 180;
const UNREACHABLE_DISTANCE = 0.08, MAX_DRAG_DISTANCE = 10;
const ROTATION_AXES = ['x', 'y', 'z'];
const ancestor = (bone, parent) => {
    for (let node = bone; node; node = node.parent) if (node === parent) return true;
    return false;
};

export function getJointCorrectionLimit(boneIndex, kneeIndices) {
    return kneeIndices?.has(boneIndex) ? MAX_KNEE_CORRECTION : MAX_CORRECTION;
}

// 先限制相对本帧原姿态的总旋转，再夹紧PMX原生IK link范围；放宽膝关节预算不覆盖模型限位。
export function clampIKBoneRotation(rotation, original, maximumCorrection, limits) {
    const proposed = rotation.clone();
    const constrained = proposed.clone();
    const originalAngle = original.angleTo(proposed);
    if (originalAngle > maximumCorrection) {
        constrained.copy(original).slerp(proposed, maximumCorrection / originalAngle);
    }
    if (!limits) return constrained;

    const axisValue = (value, axis) => Array.isArray(value) ? value[ROTATION_AXES.indexOf(axis)] : value[axis];
    const euler = new Euler().setFromQuaternion(constrained, 'XYZ');
    for (const axis of ROTATION_AXES) {
        const minimum = axisValue(limits.rotationMin, axis), maximum = axisValue(limits.rotationMax, axis);
        if (Number.isFinite(minimum) && Number.isFinite(maximum)) euler[axis] = Math.max(minimum, Math.min(maximum, euler[axis]));
    }
    return constrained.setFromEuler(euler);
}

// PMX 控制点使用原骨架姿态作为每帧基准，不把 IK 修正累计到 VMD 或物理骨骼。
export function createHumanIK({ getScene, getCamera, canvas, onChange = () => {},
    loadAmmo = async () => (await import('./mmd-ammo-physics.mjs')).ensureAmmoPhysics() } = {}) {
    const raycaster = new Raycaster(), pointer = new Vector2(), plane = new Plane();
    const planeNormal = new Vector3(), intersection = new Vector3();
    const endPosition = new Vector3();
    const worldChange = new Quaternion(), parentRotation = new Quaternion(), localChange = new Quaternion();
    const baseline = new Map(), linkLimits = new Map(), kneeIndices = new Set();
    let enabled = false, bound = null, helperRoot = null, handles = [], drag = null;
    let mode = 'pbd', ammoModule = null, bodyRig = null, bodyDrive = null, loadEpoch = 0, selected = '';
    let bodySettings = normalizeBodySettings();
    let state = { enabled: false, available: false, targets: 0, activeTargets: 0, unreachable: 0, reason: '已关闭' };

    function stopDrag() {
        if (!drag) return;
        const pointerId = drag.pointerId;
        drag = null;
        try {
            if (canvas?.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
        } catch (error) { /* 页面切换期间浏览器可能已自动释放指针。 */ }
    }
    function disposeHelpers() {
        stopDrag();
        for (const handle of handles) {
            helperRoot?.remove(handle.mesh);
            handle.mesh.geometry.dispose();
            handle.mesh.material.dispose();
        }
        handles = [];
        if (helperRoot) helperRoot.removeFromParent();
        helperRoot = null;
    }
    function restore() {
        bodyRig?.restore();
        for (const [bone, rotation] of baseline) bone.quaternion.copy(rotation);
        baseline.clear();
        if (bound?.mesh) bound.mesh.updateMatrixWorld(true);
    }
    function resetTargets() {
        stopDrag(); restore(); bodyDrive?.reset();
        for (const handle of handles) { handle.active = false; handle.positionState = 'Off'; handle.rotationState = 'Off'; }
        state = { ...state, activeTargets: 0, unreachable: 0, reason: enabled ? (state.available ? '' : state.reason) : '已关闭' };
        onChange();
    }
    function reset() {
        loadEpoch++; restore(); bodyDrive?.dispose(); bodyDrive = null; bodyRig = null;
        enabled = false;
        disposeHelpers();
        bound = null;
        baseline.clear();
        state = { enabled: false, available: false, targets: 0, activeTargets: 0, unreachable: 0, reason: '已关闭' };
    }
    function readLimits(model) {
        linkLimits.clear();
        kneeIndices.clear();
        for (const semantic of ['leftKnee', 'rightKnee']) {
            const index = model.bindings['bones:' + semantic]?.index;
            if (Number.isInteger(index)) kneeIndices.add(index);
        }
        for (const ik of model.mesh.geometry.userData.MMD.iks || []) {
            for (const link of ik.links || []) {
                if (link.rotationMin && link.rotationMax && Number.isInteger(link.index)) linkLimits.set(link.index, link);
            }
        }
    }
    function chainFor(model, endpoint) {
        const chain = [];
        let child = endpoint.bone;
        for (let bone = endpoint.bone.parent; bone && chain.length < MAX_LINKS; bone = bone.parent) {
            const index = model.mesh.skeleton.bones.indexOf(bone);
            if (index < 0) break;
            if (!model.bones[index]?.dynamic && !model.groups.root.has(index)) {
                // 逆转动权重参考父子骨段长度；短骨允许分担更多角度，零长度链节由下限保护。
                chain.push({ ...model.bones[index], segmentLength: child.position.length() });
            }
            child = bone;
            // 不通过PMX全身根骨旋转角色整体；center以上不再参与该末端的定位。
            if (bone.name === model.bindings['bones:center']?.name || bone.name === model.bindings['bones:root']?.name) break;
        }
        return chain;
    }
    function bind(model) {
        if (bound === model) return;
        loadEpoch++;
        restore(); bodyDrive?.dispose(); bodyDrive = null; bodyRig = null;
        disposeHelpers(); bound = model;
        if (!model || !enabled) {
        state = { enabled, available: false, targets: 0, activeTargets: 0, unreachable: 0,
                reason: enabled ? '等待PMX模型' : '已关闭' };
            return;
        }
        readLimits(model);
        const scene = getScene?.();
        if (!scene) {
            state = { enabled, available: false, targets: 0, activeTargets: 0, unreachable: 0, reason: '三维场景尚未就绪' };
            return;
        }
        if (mode === 'physics') {
            try {
                if (!ammoModule) throw new Error('请先选择身体物理模式，等待Ammo就绪');
                bodyRig = createHumanPhysicsRig(model); bodyDrive = createHumanPhysicsDrive(ammoModule, bodyRig);
            } catch (error) {
                bodyRig?.restore(); bodyDrive?.dispose(); bodyDrive = null; bodyRig = null;
                state = { enabled, available: false, targets: 0, activeTargets: 0, unreachable: 0, reason: error.message };
                return;
            }
        }
        // 独立场景容器让控制点留在世界空间，不跟随模型根节点移动。
        helperRoot = new Group();
        scene.add(helperRoot);
        const radius = Math.max(0.018, Math.min(0.09, (model.mesh.geometry.boundingSphere?.radius || 1) * 0.035));
        model.mesh.updateMatrixWorld(true);
        const specs = mode === 'physics' ? BODY_TARGETS : TARGETS;
        for (const spec of specs) {
            const endpoint = model.bindings['bones:' + spec.bone];
            if (!endpoint || endpoint.dynamic) continue;
            const chain = chainFor(model, endpoint);
            const node = bodyRig?.nodes.find(node => node.bone === endpoint.bone);
            if (mode === 'physics' ? !node : !chain.length || chain.some(link => !ancestor(endpoint.bone, link.bone))) continue;
            const material = new MeshBasicMaterial({ color: spec.color, depthTest: false, depthWrite: false });
            const mesh = new Mesh(new SphereGeometry(radius, 12, 8), material);
            mesh.renderOrder = 1200;
            mesh.userData.humanIKTarget = spec.key;
            helperRoot.add(mesh);
            handles.push({ ...spec, endpoint, chain, mesh, node, target: new Vector3(),
                targetRotation: endpoint.bone.getWorldQuaternion(new Quaternion()), positionState: 'Off', rotationState: 'Off', active: false });
        }
        for (const handle of handles) {
            handle.endpoint.bone.getWorldPosition(handle.target);
            handle.mesh.position.copy(handle.target);
        }
        selected = handles[0]?.key || '';
        const missing = specs.filter(spec => !handles.some(handle => handle.key === spec.key)).map(spec => spec.label);
        state = { enabled, available: handles.length > 0, targets: handles.length, activeTargets: 0, unreachable: 0,
            reason: handles.length ? (missing.length ? '部分控制点不可用：' + missing.join('、') : '') : '未找到可用的头/腕/踝语义骨骼链' };
    }
    function ndc(event) {
        const rect = canvas?.getBoundingClientRect?.();
        if (!rect?.width || !rect?.height) return false;
        const stage = window.DisplayStage, geometry = stage?.getRotationGeometry?.();
        if (geometry && typeof stage.mapViewportPointToStage === 'function') {
            const point = stage.mapViewportPointToStage(event.clientX, event.clientY, rect, geometry);
            if (!point) return false;
            pointer.set(point.normalizedX, point.normalizedY);
            return true;
        }
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
            1 - (event.clientY - rect.top) / rect.height * 2);
        return true;
    }
    function pick(event) {
        const camera = getCamera?.();
        if (!camera || !ndc(event)) return null;
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects(handles.map(handle => handle.mesh), false)[0] || null;
    }
    function pointerDown(event) {
        if (!enabled || !state.available || event.button !== 0 || event.isPrimary === false) return;
        const hit = pick(event), handle = handles.find(item => item.mesh === hit?.object);
        if (!handle) return;
        event.stopImmediatePropagation(); event.preventDefault();
        selected = handle.key;
        if (mode === 'physics' && handle.positionState === 'Hold') { onChange(); return; }
        handle.endpoint.bone.getWorldPosition(handle.target);
        if (mode === 'physics' && handle.positionState !== 'Comply') handle.positionState = 'On';
        handle.active = true;
        const camera = getCamera();
        camera.getWorldDirection(planeNormal).normalize();
        plane.setFromNormalAndCoplanarPoint(planeNormal, handle.target);
        drag = { handle, pointerId: event.pointerId, start: new Vector2(event.clientX, event.clientY) };
        let captured = false;
        try {
            if (canvas.setPointerCapture) {
                canvas.setPointerCapture(event.pointerId);
                captured = canvas.hasPointerCapture ? canvas.hasPointerCapture(event.pointerId) : true;
            }
        } catch (error) { /* pointerup仍由window兜底。 */ }
        drag.fallback = !captured;
        state.activeTargets = handles.filter(item => item.active).length;
        state.unreachable = 0;
        state.reason = '';
        onChange();
    }
    function pointerMove(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.fallback ? event.currentTarget !== window : event.currentTarget !== canvas) return;
        event.stopImmediatePropagation(); event.preventDefault();
        if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > MAX_DRAG_DISTANCE) {
            const camera = getCamera();
            if (!camera || !ndc(event)) return;
            raycaster.setFromCamera(pointer, camera);
            if (raycaster.ray.intersectPlane(plane, intersection)) drag.handle.target.copy(intersection);
        } else return;
        drag.handle.mesh.position.copy(drag.handle.target);
        state.activeTargets = handles.filter(item => item.active).length;
        onChange();
    }
    function pointerUp(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.fallback ? event.currentTarget !== window : event.currentTarget !== canvas) return;
        event.stopImmediatePropagation(); event.preventDefault(); stopDrag(); onChange();
    }
    function applyLimit(link, original) {
        const maximumCorrection = getJointCorrectionLimit(link.index, kneeIndices);
        link.bone.quaternion.copy(clampIKBoneRotation(
            link.bone.quaternion,
            original,
            maximumCorrection,
            linkLimits.get(link.index)
        ));
    }
    function targetDistance(handle, target = handle.target) {
        const endpoint = handle.endpoint.bone;
        endpoint.updateWorldMatrix(true, false);
        endpoint.getWorldPosition(endPosition);
        return endPosition.distanceTo(target);
    }
    function solvePbdConstraint(handle, target, strength = 1) {
        const endpoint = handle.endpoint.bone;
        if (targetDistance(handle, target) <= PBD_TARGET_EPSILON) return false;
        endpoint.updateWorldMatrix(true, false);
        endpoint.getWorldPosition(endPosition);
        const joints = handle.chain.map(link => {
            link.bone.updateWorldMatrix(true, false);
            return {
                link,
                position: link.bone.getWorldPosition(new Vector3()),
                inverseRotationalMass: calculateInverseRotationalMass(link.segmentLength)
            };
        });
        const corrections = calculatePbdAngularCorrections(endPosition, target, joints, { strength });
        let changed = false;
        for (const correction of corrections) {
            const { joint, axis, angle } = correction, link = joint.link;
            const bone = link.bone, original = baseline.get(bone);
            if (!original) continue;
            worldChange.setFromAxisAngle(axis, angle);
            bone.parent?.getWorldQuaternion(parentRotation) || parentRotation.identity();
            localChange.copy(parentRotation).invert().multiply(worldChange).multiply(parentRotation);
            const before = bone.quaternion.clone();
            bone.quaternion.premultiply(localChange).normalize();
            applyLimit(link, original);
            bone.updateWorldMatrix(true, false);
            endpoint.updateWorldMatrix(true, false);
            changed ||= before.angleTo(bone.quaternion) > 1e-7;
        }
        return changed;
    }
    function createKneePoleConstraints(active) {
        const activeKeys = new Set(active.map(handle => handle.key));
        const constraints = [];
        for (const side of ['left', 'right']) {
            const foot = handles.find(handle => handle.key === side + 'Foot');
            const knee = handles.find(handle => handle.key === side + 'Knee');
            const hip = bound?.bindings['bones:' + side + 'Leg']?.bone;
            if (!foot?.active || !knee || activeKeys.has(knee.key) || !hip) continue;
            bound.mesh.updateMatrixWorld(true);
            const hipPosition = hip.getWorldPosition(new Vector3());
            const kneePosition = knee.endpoint.bone.getWorldPosition(new Vector3());
            const anklePosition = foot.endpoint.bone.getWorldPosition(new Vector3());
            const target = calculateKneePoleTarget(hipPosition, kneePosition, anklePosition, foot.target);
            if (target) constraints.push({ handle: knee, target });
        }
        return constraints;
    }
    function solveTargets(active, kneePoles) {
        for (let iteration = 0; iteration < PBD_MAX_ITERATIONS; iteration++) {
            let changed = false;
            // 膝盖软偏好先给出弯曲方向，随后硬目标再次投影，保证用户目标具有更高优先级。
            for (const pole of kneePoles) changed = solvePbdConstraint(pole.handle, pole.target, KNEE_POLE_STRENGTH) || changed;
            for (const handle of active) changed = solvePbdConstraint(handle, handle.target) || changed;
            if (!changed || active.every(handle => targetDistance(handle) <= PBD_TARGET_EPSILON)) break;
        }
        return active.reduce((count, handle) => count + Number(targetDistance(handle) > UNREACHABLE_DISTANCE), 0);
    }
    function apply(model, delta = 1 / 60) {
        if (!enabled || !model) return;
        bind(model);
        if (!state.available) return;
        restore();
        const active = handles.filter(handle => handle.active);
        if (mode === 'physics') {
            try {
                bodyDrive.step(delta, bodyRig.animatedPoses(), active, bodySettings);
                state.unreachable = active.filter(handle => handle.positionState !== 'Off' && targetDistance(handle) * bodyRig.metersPerUnit > 0.05).length;
                state.reason = state.unreachable ? '部分目标受关节限位、碰撞或牵引强度影响，尚未到达' : '';
            } catch (error) {
                restore(); bodyDrive?.dispose(); bodyDrive = null;
                state.available = false; state.reason = error.message;
            }
            updateMarkers(); return;
        }
        if (!active.length) { updateMarkers(); return; }
        const kneePoles = createKneePoleConstraints(active);
        const participants = [...active, ...kneePoles.map(pole => pole.handle)];
        for (const handle of participants) for (const link of handle.chain) {
            if (!baseline.has(link.bone)) baseline.set(link.bone, link.bone.quaternion.clone());
        }
        const unreachable = solveTargets(active, kneePoles);
        state.unreachable = unreachable;
        state.reason = unreachable ? '部分目标超出骨骼链或角度限制的可达范围' : '';
        updateMarkers();
    }
    function updateMarkers() {
        if (!bound || !enabled) return;
        bound.mesh.updateMatrixWorld(true);
        for (const handle of handles) {
            if (!handle.active || (mode === 'physics' && handle.positionState === 'Off')) handle.endpoint.bone.getWorldPosition(handle.target);
            handle.mesh.position.copy(handle.target);
        }
    }
    function setEnabled(value, model) {
        loadEpoch++; restore(); stopDrag();
        enabled = value === true;
        if (!enabled) {
            bodyDrive?.dispose(); bodyDrive = null; bodyRig = null;
            disposeHelpers(); bound = null;
            state = { enabled: false, available: false, targets: 0, activeTargets: 0, unreachable: 0, reason: '已关闭' };
            onChange(); return getState();
        }
        bind(model || bound);
        state.enabled = true;
        onChange(); return getState();
    }
    async function setMode(value, model = bound) {
        if (!['pbd', 'physics'].includes(value)) throw new Error('不支持的人体控制模式');
        const epoch = ++loadEpoch;
        if (value === 'physics' && !ammoModule) {
            state.reason = '正在加载人体物理…'; onChange();
            let loaded;
            try { loaded = await loadAmmo(); }
            catch (error) {
                if (epoch === loadEpoch) { state.reason = '人体物理加载失败：' + error.message; onChange(); }
                throw error;
            }
            if (epoch !== loadEpoch) return getState();
            ammoModule = loaded;
        }
        if (epoch !== loadEpoch) return getState();
        restore(); bodyDrive?.dispose(); bodyDrive = null; bodyRig = null; disposeHelpers(); bound = null;
        mode = value;
        if (enabled) bind(model);
        onChange(); return getState();
    }
    function setBodySettings(value) {
        bodySettings = normalizeBodySettings({ ...bodySettings, ...value }); onChange(); return getState();
    }
    function setTargetState(key, positionState, rotationState) {
        const handle = handles.find(handle => handle.key === key);
        if (mode !== 'physics' || !handle) throw new Error('请先启用身体物理模式并选择控制点');
        if (!BODY_STATES.includes(positionState) || !BODY_STATES.includes(rotationState)) throw new Error('不支持的控制点状态');
        if (handle.positionState === 'Off' && positionState !== 'Off') handle.endpoint.bone.getWorldPosition(handle.target);
        if (handle.rotationState === 'Off' && rotationState !== 'Off') handle.endpoint.bone.getWorldQuaternion(handle.targetRotation);
        handle.positionState = positionState; handle.rotationState = rotationState;
        handle.active = positionState !== 'Off' || rotationState !== 'Off'; selected = key;
        onChange(); return getState();
    }
    function setTarget(key, position, rotation) {
        const handle = handles.find(handle => handle.key === key);
        if (!handle) throw new Error('控制点不存在');
        if (!position && !rotation) throw new Error('请提供目标位置或旋转');
        if (rotation && mode !== 'physics') throw new Error('PBD姿态模式只支持位置目标');
        if (position) {
            const values = position.isVector3 ? position.toArray() : position;
            if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) throw new Error('目标位置需要三个有限数值');
            if (mode === 'physics' && handle.positionState === 'Hold') throw new Error('请将位置状态改为On后移动保持目标');
            handle.target.fromArray(values); handle.positionState = handle.positionState === 'Comply' ? 'Comply' : 'On';
        }
        if (rotation) {
            const values = rotation.isQuaternion ? rotation.toArray() : rotation;
            if (!Array.isArray(values) || values.length !== 4 || !values.every(Number.isFinite) || Math.hypot(...values) < 1e-8) throw new Error('目标旋转需要有效四元数');
            if (mode === 'physics' && handle.rotationState === 'Hold') throw new Error('请将旋转状态改为On后移动保持目标');
            handle.targetRotation.fromArray(values).normalize(); handle.rotationState = handle.rotationState === 'Comply' ? 'Comply' : 'On';
        }
        handle.active = true; selected = key; onChange(); return getState();
    }
    function getState() {
        const camera = getCamera?.(), rect = canvas?.getBoundingClientRect?.();
        return { ...state, mode, settings: { ...bodySettings }, selected, enabled, targets: handles.length,
            activeTargets: handles.filter(handle => handle.active).length, physics: bodyDrive?.getState() || null,
            controls: handles.map(handle => {
                const achieved = handle.endpoint.bone.getWorldPosition(new Vector3());
                // 活动标记停留在目标点，屏幕位置必须投影标记；达成位置单独用于误差诊断。
                const screen = camera && handle.mesh.getWorldPosition(new Vector3()).project(camera);
                return { key: handle.key, label: handle.label, positionState: handle.positionState, rotationState: handle.rotationState,
                    target: handle.target.toArray(), rotation: handle.targetRotation.toArray(), achieved: achieved.toArray(),
                    screen: screen && rect ? { x: rect.left + (screen.x + 1) * rect.width / 2,
                        y: rect.top + (1 - screen.y) * rect.height / 2, visible: screen.z >= -1 && screen.z <= 1 } : null };
            }) };
    }

    canvas?.addEventListener('pointerdown', pointerDown, true);
    canvas?.addEventListener('pointermove', pointerMove, true);
    canvas?.addEventListener('pointerup', pointerUp, true);
    canvas?.addEventListener('pointercancel', pointerUp, true);
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointercancel', pointerUp, true);

    return {
        apply, restore, reset, resetTargets, setEnabled, setMode, setBodySettings, setTargetState, setTarget, getState,
        isPhysicsEnabled: () => enabled && mode === 'physics' && bodyDrive !== null,
        dispose() {
            reset();
            canvas?.removeEventListener('pointerdown', pointerDown, true);
            canvas?.removeEventListener('pointermove', pointerMove, true);
            canvas?.removeEventListener('pointerup', pointerUp, true);
            canvas?.removeEventListener('pointercancel', pointerUp, true);
            window.removeEventListener('pointermove', pointerMove, true);
            window.removeEventListener('pointerup', pointerUp, true);
            window.removeEventListener('pointercancel', pointerUp, true);
        }
    };
}

import { Euler, Group, Mesh, MeshBasicMaterial, Plane, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';

const TARGETS = [
    { key: 'head', label: '头部', bone: 'head', color: 0xffd166 },
    { key: 'leftHand', label: '左手', bone: 'leftWrist', color: 0xff7777 },
    { key: 'rightHand', label: '右手', bone: 'rightWrist', color: 0x78aaff },
    { key: 'leftFoot', label: '左脚', bone: 'leftAnkle', color: 0x77dfb0 },
    { key: 'rightFoot', label: '右脚', bone: 'rightAnkle', color: 0xd59bff },
];
const MAX_LINKS = 12, MAX_ITERATIONS = 6;
const MAX_STEP = 12 * Math.PI / 180, MAX_CORRECTION = 45 * Math.PI / 180;
const TARGET_EPSILON = 0.025, UNREACHABLE_DISTANCE = 0.08, MAX_DRAG_DISTANCE = 10;
const ancestor = (bone, parent) => {
    for (let node = bone; node; node = node.parent) if (node === parent) return true;
    return false;
};

// PMX 控制点使用原骨架姿态作为每帧基准，不把 IK 修正累计到 VMD 或物理骨骼。
export function createHumanIK({ getScene, getCamera, canvas, onChange = () => {} } = {}) {
    const raycaster = new Raycaster(), pointer = new Vector2(), plane = new Plane();
    const planeNormal = new Vector3(), intersection = new Vector3();
    const endPosition = new Vector3(), jointPosition = new Vector3(), from = new Vector3(), to = new Vector3();
    const worldChange = new Quaternion(), parentRotation = new Quaternion(), localChange = new Quaternion();
    const baseline = new Map(), linkLimits = new Map(), euler = new Euler();
    let enabled = false, bound = null, helperRoot = null, handles = [], drag = null;
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
        for (const [bone, rotation] of baseline) bone.quaternion.copy(rotation);
        baseline.clear();
        if (bound?.mesh) bound.mesh.updateMatrixWorld(true);
    }
    function resetTargets() {
        restore();
        for (const handle of handles) handle.active = false;
        state = { ...state, activeTargets: 0, unreachable: 0, reason: enabled ? (state.available ? '' : state.reason) : '已关闭' };
        onChange();
    }
    function reset() {
        enabled = false;
        disposeHelpers();
        bound = null;
        baseline.clear();
        state = { enabled: false, available: false, targets: 0, activeTargets: 0, unreachable: 0, reason: '已关闭' };
    }
    function readLimits(model) {
        linkLimits.clear();
        for (const ik of model.mesh.geometry.userData.MMD.iks || []) {
            for (const link of ik.links || []) {
                if (link.rotationMin && link.rotationMax && Number.isInteger(link.index)) linkLimits.set(link.index, link);
            }
        }
    }
    function chainFor(model, endpoint) {
        const chain = [];
        for (let bone = endpoint.bone.parent; bone && chain.length < MAX_LINKS; bone = bone.parent) {
            const index = model.mesh.skeleton.bones.indexOf(bone);
            if (index < 0) break;
            if (!model.bones[index]?.dynamic && !model.groups.root.has(index)) chain.push(model.bones[index]);
            // 不通过PMX全身根骨旋转角色整体；center以上不再参与该末端的定位。
            if (bone.name === model.bindings['bones:center']?.name || bone.name === model.bindings['bones:root']?.name) break;
        }
        return chain;
    }
    function bind(model) {
        if (bound === model) return;
        restore(); disposeHelpers(); bound = model;
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
        // 独立场景容器让控制点留在世界空间，不跟随模型根节点移动。
        helperRoot = new Group();
        scene.add(helperRoot);
        const radius = Math.max(0.018, Math.min(0.09, (model.mesh.geometry.boundingSphere?.radius || 1) * 0.035));
        for (const spec of TARGETS) {
            const endpoint = model.bindings['bones:' + spec.bone];
            if (!endpoint || endpoint.dynamic) continue;
            const chain = chainFor(model, endpoint);
            if (!chain.length || chain.some(link => !ancestor(endpoint.bone, link.bone))) continue;
            const material = new MeshBasicMaterial({ color: spec.color, depthTest: false, depthWrite: false });
            const mesh = new Mesh(new SphereGeometry(radius, 12, 8), material);
            mesh.renderOrder = 1200;
            mesh.userData.humanIKTarget = spec.key;
            helperRoot.add(mesh);
            handles.push({ ...spec, endpoint, chain, mesh, target: new Vector3(), active: false });
        }
        model.mesh.updateMatrixWorld(true);
        for (const handle of handles) {
            handle.endpoint.bone.getWorldPosition(handle.target);
            handle.mesh.position.copy(handle.target);
        }
        const missing = TARGETS.filter(spec => !handles.some(handle => handle.key === spec.key)).map(spec => spec.label);
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
        handle.endpoint.bone.getWorldPosition(handle.target);
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
        const originalAngle = original.angleTo(link.bone.quaternion);
        if (originalAngle > MAX_CORRECTION) {
            link.bone.quaternion.copy(original).slerp(link.bone.quaternion, MAX_CORRECTION / originalAngle);
        }
        const limits = linkLimits.get(link.index);
        if (!limits) return;
        const axisValue = (value, axis) => Array.isArray(value) ? value[['x', 'y', 'z'].indexOf(axis)] : value[axis];
        euler.setFromQuaternion(link.bone.quaternion, 'XYZ');
        for (const axis of ['x', 'y', 'z']) {
            const minimum = axisValue(limits.rotationMin, axis), maximum = axisValue(limits.rotationMax, axis);
            if (Number.isFinite(minimum) && Number.isFinite(maximum)) euler[axis] = Math.max(minimum, Math.min(maximum, euler[axis]));
        }
        link.bone.quaternion.setFromEuler(euler);
    }
    function solve(handle) {
        const model = bound, endpoint = handle.endpoint.bone;
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            endpoint.updateWorldMatrix(true, false);
            endpoint.getWorldPosition(endPosition);
            if (endPosition.distanceTo(handle.target) <= TARGET_EPSILON) break;
            let changed = false;
            for (const link of handle.chain) {
                const bone = link.bone, original = baseline.get(bone);
                bone.updateWorldMatrix(true, false);
                bone.getWorldPosition(jointPosition);
                endpoint.updateWorldMatrix(true, false);
                endpoint.getWorldPosition(endPosition);
                from.subVectors(endPosition, jointPosition); to.subVectors(handle.target, jointPosition);
                if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
                const angle = from.angleTo(to);
                if (angle < 1e-5) continue;
                worldChange.setFromUnitVectors(from.normalize(), to.normalize());
                if (angle > MAX_STEP) worldChange.slerp(new Quaternion(), 1 - MAX_STEP / angle);
                bone.parent?.getWorldQuaternion(parentRotation) || parentRotation.identity();
                localChange.copy(parentRotation).invert().multiply(worldChange).multiply(parentRotation);
                bone.quaternion.premultiply(localChange).normalize();
                applyLimit(link, original);
                bone.updateWorldMatrix(true, false);
                endpoint.updateWorldMatrix(true, false);
                changed = true;
            }
            if (!changed) break;
        }
        endpoint.updateWorldMatrix(true, false);
        endpoint.getWorldPosition(endPosition);
        return endPosition.distanceTo(handle.target);
    }
    function apply(model) {
        if (!enabled || !model) return;
        bind(model);
        if (!state.available) return;
        restore();
        const active = handles.filter(handle => handle.active);
        if (!active.length) { updateMarkers(); return; }
        for (const handle of active) for (const link of handle.chain) {
            if (!baseline.has(link.bone)) baseline.set(link.bone, link.bone.quaternion.clone());
        }
        const unreachable = active.reduce((count, handle) => count + Number(solve(handle) > UNREACHABLE_DISTANCE), 0);
        state.unreachable = unreachable;
        state.reason = unreachable ? '部分目标超出骨骼链或角度限制的可达范围' : '';
        updateMarkers();
    }
    function updateMarkers() {
        if (!bound || !enabled) return;
        bound.mesh.updateMatrixWorld(true);
        for (const handle of handles) {
            if (!handle.active) handle.endpoint.bone.getWorldPosition(handle.target);
            handle.mesh.position.copy(handle.target);
        }
    }
    function setEnabled(value, model) {
        restore(); stopDrag();
        enabled = value === true;
        if (!enabled) {
            disposeHelpers(); bound = null;
            state = { enabled: false, available: false, targets: 0, activeTargets: 0, unreachable: 0, reason: '已关闭' };
            onChange(); return getState();
        }
        bind(model || bound);
        state.enabled = true;
        onChange(); return getState();
    }
    function getState() { return { ...state, enabled, targets: handles.length,
        activeTargets: handles.filter(handle => handle.active).length }; }

    canvas?.addEventListener('pointerdown', pointerDown, true);
    canvas?.addEventListener('pointermove', pointerMove, true);
    canvas?.addEventListener('pointerup', pointerUp, true);
    canvas?.addEventListener('pointercancel', pointerUp, true);
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointercancel', pointerUp, true);

    return {
        apply, restore, reset, resetTargets, setEnabled, getState,
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

import * as THREE from 'three';

// 进入动作与恢复跟随暂时共用600ms，避免两种衔接出现不同的转头速度。
const HEAD_TRANSITION_SECONDS = 0.6;
export const DEFAULT_GAZE = Object.freeze({ head: true, eyes: true, strength: 0.7,
    headYaw: 45, headPitch: 25, eyeYaw: 20, eyePitch: 15,
    headMs: 200, eyeMs: 60, holdSeconds: 3, forward: '+Z', manual: false,
    manualYaw: 0, manualPitch: 0 });
const ranges = { strength: [0, 1], headYaw: [0, 85], headPitch: [0, 60],
    eyeYaw: [0, 45], eyePitch: [0, 40], headMs: [0, 2000], eyeMs: [0, 2000], holdSeconds: [0.2, 30],
    manualYaw: [-30, 30], manualPitch: [-20, 20] };
export function normalizeHumanGaze(value = {}, previous = DEFAULT_GAZE) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('注视设置格式无效');
    const result = { ...previous };
    for (const key of ['head', 'eyes', 'manual']) {
        if (value[key] == null) continue;
        if (typeof value[key] !== 'boolean') throw new Error('注视开关需要布尔值');
        result[key] = value[key];
    }
    for (const [key, [min, max]] of Object.entries(ranges)) {
        if (value[key] == null) continue;
        if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error('注视参数超出范围：' + key);
        result[key] = value[key];
    }
    if (value.forward != null) {
        if (!['+Z', '-Z'].includes(value.forward)) throw new Error('模型正面需为+Z或-Z');
        result.forward = value.forward;
    }
    return result;
}

// 只自动处理能明确解释的骨骼关系；共有眼驱动和左右眼直接驱动不能叠加。
export function humanGazeBinding(model) {
    const bindings = model.bindings, data = model.mesh.geometry.userData.MMD;
    const grants = new Map((data.grants || data.bones?.flatMap((bone, index) => bone.grant ? [{ ...bone.grant, index }] : [] ) || [])
        .filter(g => g.affectRotation).map(g => [g.index, g]));
    const issues = [], common = bindings['bones:eyes'];
    const left = bindings['bones:leftEye'], right = bindings['bones:rightEye'];
    const valid = target => Boolean(target && !target.dynamic);
    const direct = target => valid(target) && !grants.has(target.index);
    const isAncestor = (parent, child) => {
        for (let node = child.bone.parent; node; node = node.parent) if (node === parent.bone) return true;
        return false;
    };
    let head = bindings['bones:head'] || bindings['bones:neck'];
    if (!direct(head)) { issues.push('头部缺失、由物理或旋转继承控制'); head = null; }
    const pair = [left, right].filter(Boolean), distinct = new Set(pair.map(b => b.index));
    const shared = direct(common) && pair.length === 2 && distinct.size === 2 && pair.every(eye => {
        const grant = grants.get(eye.index);
        return valid(eye) && eye.index !== common.index && !isAncestor(common, eye)
            && grant?.parentIndex === common.index && !grant.isLocal && Math.abs(grant.ratio - 1) < 1e-6;
    });
    let eyes = shared ? [{ target: common, reference: left, other: right, inherited: common }]
        : [...new Map(pair.filter(direct).map(eye => [eye.index, { target: eye, reference: eye }])).values()];
    eyes = eyes.filter(item => item.target.index !== head?.index && item.reference.index !== head?.index);
    if (!eyes.length) issues.push('眼球缺失、动态或旋转继承关系不支持自动注视');
    if (!shared && pair.some(eye => !direct(eye))) issues.push('部分眼球旋转继承不支持，已跳过');
    return { head, eyes, occupiedEyes: new Set([common, ...pair].filter(Boolean).map(b => b.index)),
        issues, shared, headName: head?.name || '', eyeNames: eyes.map(item => item.target.name) };
}

export function createHumanGaze() {
    let options = { ...DEFAULT_GAZE }, bindingModel = null, binding = null, temporary = false, expires = 0;
    let headState = null;
    const states = new Map(), clickTarget = new THREE.Vector3(), target = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3(), origin = new THREE.Vector3(), scale = new THREE.Vector3();
    const direction = new THREE.Vector3(), cameraForward = new THREE.Vector3(), projected = new THREE.Vector3();
    const center = new THREE.Vector3(), otherOrigin = new THREE.Vector3(), worldRotation = new THREE.Quaternion(), inverse = new THREE.Quaternion();
    const offset = new THREE.Quaternion(), yawRotation = new THREE.Quaternion(), pitchRotation = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
    const limit = (angle, degrees) => THREE.MathUtils.clamp(angle, -degrees * Math.PI / 180, degrees * Math.PI / 180);
    function resolve(model) {
        if (bindingModel !== model) { states.clear(); headState = null; bindingModel = model; binding = humanGazeBinding(model); }
        return binding;
    }
    function reset() { states.clear(); headState = null; temporary = false; expires = 0; }
    function pose(reference) {
        // 仅更新所需骨骼的祖先链，避免为头和每只眼睛额外遍历整个模型。
        reference.bone.updateWorldMatrix(true, false);
        reference.bone.matrixWorld.decompose(origin, worldRotation, scale);
    }
    function rotate(item, enabled, yawLimit, pitchLimit, milliseconds, delta, save, availability, fixed = null) {
        const { target: bone, reference, other, inherited } = item;
        if (!enabled) { states.delete(bone.index); return; }
        pose(reference);
        if (other) {
            other.bone.updateWorldMatrix(true, false);
            otherOrigin.setFromMatrixPosition(other.bone.matrixWorld);
            origin.add(otherOrigin).multiplyScalar(0.5);
        }
        // 共有眼通常不在眼球父链中。原Helper稍后才施加grant，此处预测它的方向。
        if (inherited) worldRotation.multiply(inherited.bone.quaternion);
        inverse.copy(worldRotation).invert();
        const sign = options.forward === '+Z' ? 1 : -1;
        let yaw, pitch;
        if (fixed) {
            yaw = fixed.yaw * Math.PI / 180;
            pitch = fixed.pitch * Math.PI / 180;
        } else {
            direction.copy(target).sub(origin).applyQuaternion(inverse);
            if (direction.lengthSq() < 1e-10) return;
            yaw = limit(Math.atan2(direction.x * sign, direction.z * sign), yawLimit) * options.strength;
            pitch = limit(-Math.atan2(direction.y * sign, Math.hypot(direction.x, direction.z)), pitchLimit) * options.strength;
        }
        let state = states.get(bone.index);
        if (!state) { state = { yaw: 0, pitch: 0, blocked: false }; states.set(bone.index, state); }
        if (availability <= 1e-5) { state.blocked = true; return; }
        if (state.blocked) { state.yaw = 0; state.pitch = 0; state.blocked = false; }
        const alpha = milliseconds > 0 ? -Math.expm1(-Math.max(0, delta) * 1000 / milliseconds) : 1;
        state.yaw += (yaw - state.yaw) * alpha; state.pitch += (pitch - state.pitch) * alpha;
        // 随显式动作淡入淡出让出同一旋转通道，避免瞬间关闭注视导致头部跳变。
        yawRotation.setFromAxisAngle(yAxis, state.yaw * availability); pitchRotation.setFromAxisAngle(xAxis, state.pitch * availability);
        offset.copy(yawRotation).multiply(pitchRotation);
        save(bone.bone);
        bone.bone.quaternion.multiply(offset).normalize();
    }
    function rotateHead(head, delta, save, availability, channel) {
        if (!options.head) { headState = null; states.delete(head.index); return; }
        if (!headState) headState = { displayed: head.bone.quaternion.clone(), owners: new Set(), released: false, recovery: null, entry: null };
        const owners = channel?.owners || new Set();
        const takeover = [...owners].some(owner => !headState.owners.has(owner));
        let started = false;
        if (takeover) {
            // 新动作从真正显示的姿态接管，包括旧动作播放中和600ms恢复途中。
            headState.entry = { from: headState.displayed.clone(), elapsed: 0 };
            headState.recovery = null; headState.released = false; started = true;
        }
        if (!takeover && !headState.released && headState.owners.size && (!owners.size || channel.releasing)) {
            // 从上一帧真正显示的姿态恢复；动作淡出与直接stop只启动一次。
            headState.recovery = { from: headState.displayed.clone(), elapsed: 0 };
            headState.entry = null;
            headState.released = true; started = true;
        }
        rotate({ target: head, reference: head }, true, options.headYaw, options.headPitch,
            options.headMs, delta, save, availability);
        const transition = headState.entry || headState.recovery;
        if (transition) {
            if (!started) transition.elapsed += Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0;
            const t = Math.min(1, transition.elapsed / HEAD_TRANSITION_SECONDS);
            // 目标仍由普通跟随计算，曲线两端减速；只覆盖当前帧，restore仍恢复基础姿态。
            offset.copy(head.bone.quaternion);
            save(head.bone);
            head.bone.quaternion.copy(transition.from).slerp(offset, t * t * (3 - 2 * t)).normalize();
            if (t >= 1) { headState.entry = null; headState.recovery = null; }
        }
        headState.displayed.copy(head.bone.quaternion);
        headState.owners = owners;
    }
    return {
        reset,
        returnToCamera() { temporary = false; expires = 0; },
        get: () => ({ ...options }),
        set(value) { options = normalizeHumanGaze(value, options); return { ...options }; },
        status(model) {
            const cap = model ? resolve(model) : null;
            return { target: temporary && performance.now() < expires ? 'pointer' : 'camera',
                remaining: temporary ? Math.max(0, (expires - performance.now()) / 1000) : 0,
                head: cap?.headName || '', eyes: cap?.eyeNames || [], shared: cap?.shared || false, issues: cap?.issues || [] };
        },
        point(model, camera, x, y) {
            if (!camera || !Number.isFinite(x) || !Number.isFinite(y) || (!options.head && !options.eyes)) return false;
            const cap = resolve(model), reference = cap.head || cap.eyes[0]?.reference;
            if (!reference) return false;
            pose(reference); camera.updateWorldMatrix(true, false); camera.getWorldPosition(cameraPosition);
            projected.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1), 0.5).unproject(camera);
            if (camera.isOrthographicCamera) {
                center.set(0, 0, 0.5).unproject(camera);
                clickTarget.copy(cameraPosition).add(projected.sub(center));
            } else {
                camera.getWorldDirection(cameraForward);
                direction.copy(projected).sub(cameraPosition).normalize();
                const denominator = direction.dot(cameraForward);
                if (denominator <= 1e-5) return false;
                const depth = Math.max(camera.near || 0.01, center.copy(origin).sub(cameraPosition).dot(cameraForward));
                // 点击点落在观看者所在的虚拟平面上；中央仍看向相机，四周对应视线偏转。
                clickTarget.copy(cameraPosition).addScaledVector(direction, depth / denominator).addScaledVector(cameraForward, -depth);
            }
            temporary = true; expires = performance.now() + options.holdSeconds * 1000;
            return true;
        },
        apply(model, camera, delta, save, occupied, rotations = null) {
            if ((!camera && !options.manual) || (!options.head && !options.eyes) || (options.strength === 0 && !options.manual)) { states.clear(); headState = null; return; }
            const cap = resolve(model);
            if (!options.manual) {
                if (temporary && performance.now() >= expires) temporary = false;
                if (temporary) target.copy(clickTarget); else camera.getWorldPosition(target);
            }
            if (cap.head) rotateHead(cap.head, delta, save, 1 - (occupied.get(cap.head.index) || 0), rotations?.get(cap.head.index));
            // 显式控制任一眼球/共有眼时，整组眼球让位，避免grant把另一只眼睛重复驱动。
            let eyeWeight = 0;
            for (const index of cap.occupiedEyes) eyeWeight = Math.max(eyeWeight, occupied.get(index) || 0);
            for (const eye of cap.eyes) rotate(eye, options.eyes,
                options.eyeYaw, options.eyePitch, options.eyeMs, delta, save, eyeWeight > 1e-5 ? 0 : 1,
                options.manual ? { yaw: options.manualYaw, pitch: options.manualPitch } : null);
        }
    };
}

// 画面轻触兼容鼠标/触屏；拖动、面板操作和取消事件不产生临时注视目标。
export function attachHumanGazePointer(canvas, onPoint) {
    if (!canvas) return () => {};
    let down = null;
    const cancel = () => { down = null; };
    const start = event => {
        if (event.isPrimary === false || event.button !== 0) { cancel(); return; }
        down = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = event => {
        if (down?.id === event.pointerId && Math.hypot(event.clientX - down.x, event.clientY - down.y) >= 8) cancel();
    };
    const end = event => {
        const point = down; cancel();
        if (!point || point.id !== event.pointerId || Math.hypot(event.clientX - point.x, event.clientY - point.y) >= 8) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        // 沿用舞台的横竖屏坐标换算，CSS旋转后点击位置仍对应相机画面。
        const stage = window.DisplayStage, geometry = stage?.getRotationGeometry?.();
        if (geometry && typeof stage.mapViewportPointToStage === 'function') {
            const mapped = stage.mapViewportPointToStage(event.clientX, event.clientY, rect, geometry);
            onPoint(mapped.normalizedX, mapped.normalizedY);
            return;
        }
        onPoint((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    };
    const listeners = { pointerdown: start, pointermove: move, pointerup: end, pointercancel: cancel, pointerleave: cancel };
    for (const [event, handler] of Object.entries(listeners)) canvas.addEventListener(event, handler, { passive: true });
    return () => { cancel(); for (const [event, handler] of Object.entries(listeners)) canvas.removeEventListener(event, handler); };
}

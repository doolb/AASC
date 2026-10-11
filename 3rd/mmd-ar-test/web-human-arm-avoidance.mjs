import { Euler, Quaternion, Vector3 } from 'three';
import { createPrimitiveContacts, prepareCollisionBody } from './web-xpbd-collision.mjs';
import { createHumanRigidSnapshot } from './web-human-rigid-snapshot.mjs';

export const ARM_AVOIDANCE_KEY = 'aasc.mmdArTest.handAvoidance.v1';
export function readArmAvoidancePreference(storage) {
    try { return (storage ?? globalThis.localStorage)?.getItem(ARM_AVOIDANCE_KEY) !== 'false'; }
    catch (error) { return true; }
}
const MAX_ANGLE = 35 * Math.PI / 180, TRANSITION_SECONDS = 0.6, ITERATIONS = 4;
// 同一600ms过渡预算：目标过滤时间常数100ms；断续接触保持100ms后用500ms释放。
const CONTACT_HOLD = TRANSITION_SECONDS / 6;
const descends = (bone, parent) => {
    for (let node = bone; node; node = node.parent) if (node === parent) return true;
    return false;
};
const smooth = value => value * value * (3 - 2 * value);

// 避让只改可靠、非物理驱动的手臂链，不推刚体、不改VMD；每帧从原动作姿态重算。
export function createHumanArmAvoidance() {
    const contacts = createPrimitiveContacts(), saved = new Map();
    const pointA = new Vector3(), pointB = new Vector3(), direction = new Vector3(), target = new Vector3();
    const origin = new Vector3(), from = new Vector3(), to = new Vector3(), effector = new Vector3();
    const worldRotation = new Quaternion(), parentRotation = new Quaternion(), change = new Quaternion(), identity = new Quaternion();
    const euler = new Euler();
    let bound = null, snapshot = null, arms = [], animated = new Set(), sideByIndex = new Map(), excluded = null;
    let state = { available: false, contacts: 0, remaining: 0, candidates: 0, iterations: 0, frameMs: 0,
        correctionDegrees: 0, stepDegrees: 0, penetration: 0, reason: '等待模型' };
    function restore() {
        for (const [bone, rotation] of saved) bone.quaternion.copy(rotation);
        saved.clear();
    }
    function reset() {
        restore(); bound = null; snapshot = null; arms = []; animated = new Set(); sideByIndex = new Map(); excluded = null;
        state = { ...state, available: false, contacts: 0, remaining: 0, correctionDegrees: 0,
            stepDegrees: 0, penetration: 0, reason: '等待模型' };
    }
    function bind(model) {
        if (bound === model) return;
        reset(); bound = model; snapshot = createHumanRigidSnapshot(model.mesh);
        const limits = new Map();
        for (const ik of model.mesh.geometry.userData.MMD.iks || []) for (const link of ik.links || []) {
            if (link.rotationMin && link.rotationMax) limits.set(link.index, link);
        }
        for (const side of ['left', 'right']) {
            const arm = model.bindings['bones:' + side + 'Arm'], elbow = model.bindings['bones:' + side + 'Elbow'], wrist = model.bindings['bones:' + side + 'Wrist'];
            if (!arm || !elbow || !wrist || [arm, elbow, wrist].some(item => item.dynamic)
                || !descends(elbow.bone, arm.bone) || !descends(wrist.bone, elbow.bone)) continue;
            // 肩部是手臂链的父节点，转动臂/肘不能移动肩刚体；不让它阻塞可求解的手部接触。
            const indices = new Set([...model.groups[side + 'Arm']].filter(index =>
                descends(model.mesh.skeleton.bones[index], arm.bone)));
            if (!snapshot.bodies.some(body => body && indices.has(body.params.boneIndex)
                && descends(model.mesh.skeleton.bones[body.params.boneIndex], elbow.bone))) continue;
            const links = [elbow, arm].map(item => ({ ...item, limit: limits.get(item.index), original: new Quaternion(),
                current: new Quaternion(), previous: new Quaternion(), desired: new Quaternion(),
                filtered: new Quaternion(), release: null }));
            arms.push({ side, indices, links, active: false, quiet: 0, touched: false });
            for (const index of indices) {
                animated.add(index);
                // 防穿模检测覆盖前臂/手掌/手指刚体，臂根只承担IK，不检测本来包裹上臂的衣袖。
                if (descends(model.mesh.skeleton.bones[index], elbow.bone)) sideByIndex.set(index, side);
            }
        }
        const n = snapshot.bodies.length, jointPairs = new Set();
        for (const joint of model.mesh.geometry.userData.MMD.constraints || []) {
            jointPairs.add(Math.min(joint.rigidBodyIndex1, joint.rigidBodyIndex2) * n + Math.max(joint.rigidBodyIndex1, joint.rigidBodyIndex2));
        }
        excluded = { has(key) {
            if (jointPairs.has(key)) return true;
            const a = snapshot.bodies[Math.floor(key / n)], b = snapshot.bodies[key % n];
            if (!a?.available || !b?.available) return true;
            const left = sideByIndex.has(a.params.boneIndex), right = sideByIndex.has(b.params.boneIndex);
            return left === right || (left ? b.params.type === 0 : a.params.type === 0);
        } };
        state.available = snapshot.valid && arms.length > 0;
        state.reason = state.available ? '' : '缺少可靠手臂链或对应刚体';
    }
    function scan(physics, fresh = true, paused = false) {
        if (fresh) {
            if (!snapshot.sample(physics, animated, { paused })) {
                // 销毁/重建间隙不能继续使用上一帧衣服快照；后续手部缓存扫描也必须排除它。
                for (const body of snapshot.bodies) if (body) body.available = false;
                return [];
            }
            return contacts.scan(snapshot.bodies, excluded);
        }
        snapshot.sampleAnimated(animated);
        for (const body of snapshot.bodies) if (animated.has(body.params.boneIndex)) prepareCollisionBody(body);
        return contacts.scanPrepared(snapshot.bodies, excluded);
    }
    function depth(contact) {
        pointA.copy(contact.localA).applyQuaternion(contact.a.quaternion).add(contact.a.position);
        pointB.copy(contact.localB).applyQuaternion(contact.b.quaternion).add(contact.b.position);
        return direction.subVectors(pointA, pointB).dot(contact.normal);
    }
    function contactArm(contact) {
        const hand = sideByIndex.has(contact.a.params.boneIndex) ? contact.a : contact.b;
        return arms.find(arm => arm.side === sideByIndex.get(hand.params.boneIndex));
    }
    function markContact(contact, amount) {
        const arm = contactArm(contact);
        // 原窄阶段会保留容差内接触；边界噪声不反复启动新的避让，活跃接触则延续。
        if (amount > Math.max(1e-6, contact.tolerance) || (arm.active && amount > -contact.tolerance)) arm.touched = true;
    }
    function limit(link) {
        const angle = link.original.angleTo(link.bone.quaternion);
        if (angle > MAX_ANGLE) link.bone.quaternion.copy(link.original).slerp(link.bone.quaternion, MAX_ANGLE / angle);
        if (!link.limit) return;
        const vector = (value, axis) => Array.isArray(value) ? value[['x', 'y', 'z'].indexOf(axis)] : value[axis];
        euler.setFromQuaternion(link.bone.quaternion, 'XYZ');
        for (const axis of ['x', 'y', 'z']) euler[axis] = Math.max(vector(link.limit.rotationMin, axis), Math.min(vector(link.limit.rotationMax, axis), euler[axis]));
        link.bone.quaternion.setFromEuler(euler);
    }
    function solve(contact, amount) {
        const aIsHand = sideByIndex.has(contact.a.params.boneIndex), hand = aIsHand ? contact.a : contact.b;
        const arm = arms.find(item => item.side === sideByIndex.get(hand.params.boneIndex));
        const bone = bound.mesh.skeleton.bones[hand.params.boneIndex];
        const local = (aIsHand ? pointA : pointB).clone();
        bound.mesh.localToWorld(local);
        target.copy(contact.normal).multiplyScalar((aIsHand ? -1 : 1) * Math.min(amount + hand.contactTolerance * 2, 0.4));
        // 方向也转换到世界空间；模型缩放不改变碰撞形状定义。
        const destination = (aIsHand ? pointA : pointB).clone().add(target);
        bound.mesh.localToWorld(destination); target.copy(destination);
        bone.worldToLocal(local);
        for (const link of arm.links) {
            if (!descends(bone, link.bone)) continue;
            bone.localToWorld(effector.copy(local)); link.bone.getWorldPosition(origin);
            from.subVectors(effector, origin); to.subVectors(target, origin);
            if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
            change.setFromUnitVectors(from.normalize(), to.normalize());
            const angle = identity.angleTo(change);
            if (angle > 0.12) change.slerp(identity, 1 - 0.12 / angle);
            link.bone.parent?.getWorldQuaternion(parentRotation) || parentRotation.identity();
            worldRotation.copy(parentRotation).invert().multiply(change).multiply(parentRotation);
            link.bone.quaternion.premultiply(worldRotation).normalize(); limit(link);
            link.bone.updateWorldMatrix(true, true);
        }
    }
    function apply(model, physics, delta, enabled = true, { paused = false } = {}) {
        const started = performance.now(); bind(model);
        if (!state.available) return;
        const dt = Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0));
        for (const arm of arms) for (const link of arm.links) {
            link.original.copy(link.bone.quaternion); saved.set(link.bone, link.original.clone());
            link.previous.copy(link.current);
        }
        let initial = 0, iterations = 0;
        for (const arm of arms) arm.touched = false;
        if (enabled) {
            const baseline = scan(physics, true, paused); initial = baseline.length;
            for (const contact of baseline) markContact(contact, depth(contact));
            // 保存原动作之后才暖启动，接触目标沿上一帧显示修正继续求解；
            // 原动作接触用于判断是否仍需保持避让，不能因手已经移开而立刻回拉。
            for (const arm of arms) for (const link of arm.links) {
                link.bone.quaternion.copy(link.original).multiply(link.current); limit(link);
            }
            for (const arm of arms) arm.links[1].bone.updateWorldMatrix(true, true);
        }
        if (enabled) for (let i = 0; i < ITERATIONS; i++) {
            const list = scan(physics, false, paused);
            let worst = null, maximum = 1e-6;
            for (const contact of list) {
                const amount = depth(contact); markContact(contact, amount);
                // 激活由接触容差判断；求解仍移除微小剩余穿透，不能把平滑等同于留在衣服内。
                if (amount > maximum) { maximum = amount; worst = contact; }
            }
            if (!worst) break;
            depth(worst); solve(worst, maximum); iterations++;
        }
        for (const arm of arms) {
            const wasActive = arm.active;
            arm.quiet = enabled && !arm.touched ? arm.quiet + dt : 0;
            arm.active = enabled && (arm.touched || (arm.active && arm.quiet < CONTACT_HOLD));
            for (const link of arm.links) {
                link.desired.copy(link.original).invert().multiply(link.bone.quaternion).normalize();
                if (arm.active) {
                    // 接触重入从当前显示修正开始；四元数低通抑制裙摆法线及最深碰撞对切换噪声。
                    if (!wasActive || link.release) link.filtered.copy(link.current);
                    link.release = null;
                    link.filtered.slerp(link.desired, 1 - Math.exp(-dt / CONTACT_HOLD));
                    link.current.rotateTowards(link.filtered, dt * MAX_ANGLE / TRANSITION_SECONDS);
                } else {
                    const duration = enabled ? TRANSITION_SECONDS - CONTACT_HOLD : TRANSITION_SECONDS;
                    if (!link.release || link.release.duration !== duration) {
                        link.release = { start: link.current.clone(), elapsed: 0, duration };
                        link.filtered.copy(link.current);
                    }
                    link.release.elapsed = Math.min(duration, link.release.elapsed + dt);
                    link.current.copy(link.release.start).slerp(identity, smooth(link.release.elapsed / duration));
                }
                link.bone.quaternion.copy(link.original).multiply(link.current).normalize(); limit(link);
                // 动作/原IK限位变化后，以真正显示的有界修正作为下一帧暖启动，避免旧目标越界。
                link.current.copy(link.original).invert().multiply(link.bone.quaternion).normalize();
            }
        }
        for (const arm of arms) arm.links[1].bone.updateWorldMatrix(true, true);
        let remaining = 0, penetration = 0, correctionDegrees = 0, stepDegrees = 0;
        if (enabled) for (const contact of scan(physics, false)) {
            const amount = depth(contact); if (amount > 1e-6) remaining++;
            penetration = Math.max(penetration, amount);
        }
        for (const arm of arms) for (const link of arm.links) {
            correctionDegrees = Math.max(correctionDegrees, link.current.angleTo(identity) * 180 / Math.PI);
            stepDegrees = Math.max(stepDegrees, link.current.angleTo(link.previous) * 180 / Math.PI);
        }
        state = { ...state, contacts: initial, remaining, candidates: contacts.candidateCount, iterations,
            correctionDegrees, stepDegrees, penetration,
            frameMs: performance.now() - started, reason: physics ? '' : '物理实例未准备，无法读取衣服刚体' };
    }
    return { apply, restore, reset, getState: () => ({ ...state }),
        observe(physics, paused = false) {
            if (state.available) {
                const started = performance.now();
                state.remaining = 0; state.penetration = 0;
                for (const contact of scan(physics, true, paused)) {
                    const amount = depth(contact); if (amount > 1e-6) state.remaining++;
                    state.penetration = Math.max(state.penetration, amount);
                }
                state.frameMs += performance.now() - started;
            }
        },
        dispose() { reset(); contacts.dispose(); } };
}

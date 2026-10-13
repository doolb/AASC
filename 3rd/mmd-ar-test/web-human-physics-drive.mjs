import { Quaternion, Vector3 } from 'three';
import { nodeOffset } from './web-human-physics-rig.mjs';

export const BODY_STATES = Object.freeze(['Off', 'On', 'Hold', 'Comply']);
export function normalizeBodySettings(value = {}) {
    const number = (name, fallback, low, high) => Number.isFinite(value[name]) ? Math.max(low, Math.min(high, value[name])) : fallback;
    return { strength: number('strength', 0.85, 0.05, 1), damping: number('damping', 1, 0.2, 2.5),
        gravity: value.gravity !== false, freePelvis: value.freePelvis === true };
}

// 独立人体世界用通用PD力/力矩驱动：关节、碰撞和惯性由Ammo共同求解，原服饰世界接受骨骼结果。
// 所有本模式原生分配归本实例所有，晚到初始化、模型切换与关闭均可完整释放。
export function createHumanPhysicsDrive(Ammo, rig) {
    const owned = [], bodies = new Map(), constraints = [];
    let disposed = false, accumulator = 0, frameMs = 0, substeps = 0;
    const own = object => { owned.push(object); return object; };
    let world;
    const vector = new Vector3(), delta = new Quaternion();
    const h = 1 / 90;
    function nativeVector(value) { return own(new Ammo.btVector3(value.x, value.y, value.z)); }
    function nativeTransform(position, rotation = new Quaternion()) {
        const transform = own(new Ammo.btTransform()); transform.setIdentity();
        transform.setOrigin(nativeVector(position));
        transform.setRotation(own(new Ammo.btQuaternion(rotation.x, rotation.y, rotation.z, rotation.w)));
        return transform;
    }
    let scratchVector, scratchRotation, scratchTransform, floor;
    function read(record) {
        const transform = record.body.getCenterOfMassTransform(), origin = transform.getOrigin(), q = transform.getRotation();
        const v = record.body.getLinearVelocity(), w = record.body.getAngularVelocity();
        record.position.set(origin.x(), origin.y(), origin.z()); record.quaternion.set(q.x(), q.y(), q.z(), q.w()).normalize();
        record.velocity.set(v.x(), v.y(), v.z()); record.omega.set(w.x(), w.y(), w.z());
        if (![...record.position.toArray(), ...record.quaternion.toArray(), ...record.velocity.toArray(), ...record.omega.toArray()].every(Number.isFinite)) {
            throw new Error('人体物理出现非有限姿态，已停止本模式');
        }
        return record;
    }
    function write(record, position, rotation, clearVelocity = false) {
        scratchTransform.setIdentity();
        scratchVector.setValue(position.x, position.y, position.z); scratchTransform.setOrigin(scratchVector);
        scratchRotation.setValue(rotation.x, rotation.y, rotation.z, rotation.w); scratchTransform.setRotation(scratchRotation);
        record.body.setWorldTransform(scratchTransform); record.motion.setWorldTransform(scratchTransform);
        if (clearVelocity) {
            scratchVector.setValue(0, 0, 0); record.body.setLinearVelocity(scratchVector); record.body.setAngularVelocity(scratchVector);
            record.body.clearForces();
        }
        record.body.activate(); read(record);
    }
    function addBody(shape, mass, position, rotation, group = 1, mask = 3) {
        const inertia = nativeVector(new Vector3()); if (mass) shape.calculateLocalInertia(mass, inertia);
        const transform = nativeTransform(position, rotation), motion = own(new Ammo.btDefaultMotionState(transform));
        const info = own(new Ammo.btRigidBodyConstructionInfo(mass, motion, shape, inertia));
        const body = own(new Ammo.btRigidBody(info));
        body.setDamping(0.03, 0.05); body.setFriction(0.7); body.setRestitution(0);
        if (mass) body.setActivationState(4);
        world.addRigidBody(body, group, mask);
        return { body, motion, mass, inertia: new Vector3(inertia.x(), inertia.y(), inertia.z()),
            position: position.clone(), quaternion: rotation.clone(), velocity: new Vector3(), omega: new Vector3() };
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        if (world) {
            for (const constraint of constraints) world.removeConstraint(constraint);
            for (const record of bodies.values()) world.removeRigidBody(record.body);
            if (floor) world.removeRigidBody(floor.body);
        }
        for (let i = owned.length - 1; i >= 0; i--) Ammo.destroy(owned[i]);
        owned.length = 0; constraints.length = 0; bodies.clear();
    }
    try {
        const config = own(new Ammo.btDefaultCollisionConfiguration());
        const dispatcher = own(new Ammo.btCollisionDispatcher(config));
        const broadphase = own(new Ammo.btDbvtBroadphase()), solver = own(new Ammo.btSequentialImpulseConstraintSolver());
        world = own(new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, config));
        scratchVector = own(new Ammo.btVector3(0, 0, 0)); scratchRotation = own(new Ammo.btQuaternion(0, 0, 0, 1));
        scratchTransform = own(new Ammo.btTransform());
        for (const node of rig.nodes) {
            let shape;
            if (node.length > node.radius * 2) {
                const capsule = own(new Ammo.btCapsuleShape(node.radius, node.length - node.radius * 2));
                shape = own(new Ammo.btCompoundShape());
                const orientation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), node.offset.clone().normalize());
                shape.addChildShape(nativeTransform(new Vector3(), orientation), capsule);
            } else shape = own(new Ammo.btSphereShape(node.radius));
            const record = addBody(shape, node.mass, node.position.clone().add(nodeOffset(node, node.quaternion)), node.quaternion);
            bodies.set(node, record);
        }
        for (const node of rig.nodes) {
            const parent = node.parentNode;
            if (!parent) continue;
            const a = bodies.get(parent), b = bodies.get(node);
            const frameA = node.position.clone().sub(a.position).applyQuaternion(a.quaternion.clone().invert());
            const frameB = node.position.clone().sub(b.position).applyQuaternion(b.quaternion.clone().invert());
            // 关节角度使用实际骨骼父空间，辅助骨偏移包含在A框架，B框架保持当前骨骼坐标轴。
            const frameRotation = node.jointFrameRotation;
            const joint = own(new Ammo.btGeneric6DofSpringConstraint(a.body, b.body,
                nativeTransform(frameA, frameRotation), nativeTransform(frameB), true));
            joint.setLinearLowerLimit(nativeVector(new Vector3())); joint.setLinearUpperLimit(nativeVector(new Vector3()));
            // Bullet约束以B相对A的逆向角度表示此框架，PMX骨骼角范围需反号并交换上下界。
            joint.setAngularLowerLimit(nativeVector(new Vector3(...node.limits.high.map(angle => -angle))));
            joint.setAngularUpperLimit(nativeVector(new Vector3(...node.limits.low.map(angle => -angle))));
            if (joint.setParam) for (let axis = 0; axis < 6; axis++) joint.setParam(2, 0.6, axis);
            world.addConstraint(joint, true); constraints.push(joint);
        }
        const feet = rig.nodes.filter(node => /Ankle$/u.test(node.semantic));
        const ground = feet.length ? Math.min(...feet.map(node => node.position.y - node.radius)) : -0.1;
        const plane = own(new Ammo.btStaticPlaneShape(nativeVector(new Vector3(0, 1, 0)), 0));
        floor = addBody(plane, 0, new Vector3(0, ground, 0), new Quaternion(), 2, 1);
    } catch (error) { dispose(); throw error; }

    function applyForce(record, point, target, frequency, damping, maximumAcceleration = 80) {
        const omega = frequency * Math.PI * 2, denominator = 1 + 2 * damping * omega * h + omega * omega * h * h;
        const lever = point.clone().sub(record.position);
        const velocity = record.omega.clone().cross(lever).add(record.velocity);
        vector.subVectors(target, point).multiplyScalar(omega * omega)
            .addScaledVector(velocity, -2 * damping * omega).multiplyScalar(record.mass / denominator);
        vector.clampLength(0, record.mass * maximumAcceleration);
        scratchVector.setValue(vector.x, vector.y, vector.z);
        const force = scratchVector;
        // 同一原生向量不能同时作为force与lever；relVector为独立可复用分配。
        relVector.setValue(lever.x, lever.y, lever.z); record.body.applyForce(force, relVector); record.body.activate();
    }
    const relVector = own(new Ammo.btVector3(0, 0, 0));
    function applyTorque(record, desired, frequency, damping, parent = null, maximumAcceleration = 150) {
        delta.copy(desired).multiply(record.quaternion.clone().invert()).normalize();
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const sine = Math.hypot(delta.x, delta.y, delta.z);
        const angle = sine > 1e-8 ? 2 * Math.atan2(sine, delta.w) / sine : 2;
        const angularVelocity = record.omega.clone(); if (parent) angularVelocity.sub(parent.omega);
        const omega = frequency * Math.PI * 2, denominator = 1 + 2 * damping * omega * h + omega * omega * h * h;
        vector.set(delta.x, delta.y, delta.z).multiplyScalar(angle * omega * omega)
            .addScaledVector(angularVelocity, -2 * damping * omega).multiplyScalar(1 / denominator).clampLength(0, maximumAcceleration);
        vector.applyQuaternion(record.quaternion.clone().invert()).multiply(record.inertia).applyQuaternion(record.quaternion);
        scratchVector.setValue(vector.x, vector.y, vector.z); record.body.applyTorque(scratchVector);
        if (parent) { scratchVector.setValue(-vector.x, -vector.y, -vector.z); parent.body.applyTorque(scratchVector); }
    }
    // 自然关节保留柔和低频；外部目标的强度同时影响响应和施力预算，Hold更强、Comply更软。
    function targetDrive(state, settings) {
        const factor = ({ On: 1, Hold: 1.2, Comply: 0.55 })[state] || 0;
        return { frequency: (3 + 15 * settings.strength) * factor,
            acceleration: (60 + 240 * settings.strength) * factor,
            angularAcceleration: (150 + 550 * settings.strength) * factor };
    }
    function step(seconds, animated, targets, requestedSettings = {}) {
        if (disposed) throw new Error('人体物理世界已释放');
        const started = performance.now(), settings = normalizeBodySettings(requestedSettings);
        scratchVector.setValue(0, settings.gravity ? -9.81 : 0, 0); world.setGravity(scratchVector);
        accumulator = Math.min(accumulator + Math.max(0, Math.min(0.1, Number.isFinite(seconds) ? seconds : 0)), h * 8);
        substeps = 0;
        while (accumulator + 1e-9 >= h && substeps < 8) {
            for (const record of bodies.values()) read(record);
            for (const node of rig.nodes) {
                const record = bodies.get(node), parent = node.parentNode && bodies.get(node.parentNode);
                const desired = animated.get(node).quaternion.clone();
                if (parent) desired.premultiply(animated.get(node.parentNode).quaternion.clone().invert()).premultiply(parent.quaternion);
                applyTorque(record, desired, 2.4, settings.damping, parent);
            }
            const pelvisControlled = targets.some(target => target.node === rig.pelvis && target.positionState !== 'Off');
            if (!settings.freePelvis && !pelvisControlled) {
                const root = bodies.get(rig.pelvis), origin = root.position.clone().sub(nodeOffset(rig.pelvis, root.quaternion));
                applyForce(root, origin, animated.get(rig.pelvis).position, 12, 1.2);
            }
            for (const target of targets) {
                const record = bodies.get(target.node); if (!record) continue;
                const origin = record.position.clone().sub(nodeOffset(target.node, record.quaternion));
                if (target.positionState !== 'Off') {
                    const goal = rig.targetToLocal(target.target);
                    if (target.positionState === 'Comply' && goal.distanceTo(origin) > 0.01) {
                        target.target.lerp(rig.targetToWorld(origin), 1 - Math.exp(-3 * h));
                    }
                    const drive = targetDrive(target.positionState, settings);
                    applyForce(record, origin, rig.targetToLocal(target.target), drive.frequency, settings.damping, drive.acceleration);
                }
                if (target.rotationState !== 'Off') {
                    if (target.rotationState === 'Comply') target.targetRotation.slerp(rig.targetRotationToWorld(record.quaternion), 1 - Math.exp(-3 * h));
                    const drive = targetDrive(target.rotationState, settings);
                    applyTorque(record, rig.targetRotationToLocal(target.targetRotation), drive.frequency, settings.damping, null, drive.angularAcceleration);
                }
            }
            world.stepSimulation(h, 0, h); accumulator -= h; substeps++;
        }
        const poses = new Map([...bodies].map(([node, record]) => [node, read(record)]));
        const projections = rig.write(poses, animated);
        for (const pose of projections) write(bodies.get(pose.node), pose.position, pose.quaternion);
        frameMs = performance.now() - started;
        return poses;
    }
    function reset(animated = null) {
        rig.restore(); animated ||= rig.animatedPoses(); accumulator = 0;
        for (const [node, record] of bodies) {
            const pose = animated.get(node);
            write(record, pose.position.clone().add(nodeOffset(node, pose.quaternion)), pose.quaternion, true);
        }
    }
    return { step, reset, dispose, getState: () => ({ bodyCount: bodies.size, jointCount: constraints.length,
        frameMs, substeps, disposed, allocations: owned.length }),
        snapshot: () => new Map([...bodies].map(([node, record]) => [node, { position: read(record).position.clone(), quaternion: record.quaternion.clone() }])) };
}

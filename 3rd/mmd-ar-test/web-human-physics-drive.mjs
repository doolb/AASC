import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { nodeOffset } from './web-human-physics-rig.mjs';

export const BODY_STATES = Object.freeze(['Off', 'On', 'Hold', 'Comply']);
export function normalizeBodySettings(value = {}) {
    const number = (name, fallback, low, high) => Number.isFinite(value[name]) ? Math.max(low, Math.min(high, value[name])) : fallback;
    return { strength: number('strength', 0.85, 0.05, 1), damping: number('damping', 1, 0.2, 2.5),
        gravity: value.gravity === true, freePelvis: value.freePelvis === true };
}

// 独立人体世界用原生位置弹簧及PD力矩驱动：关节、碰撞和惯性由Ammo共同求解。
// 所有本模式原生分配归本实例所有，晚到初始化、模型切换与关闭均可完整释放。
export function createHumanPhysicsDrive(Ammo, rig) {
    const owned = [], bodies = new Map(), constraints = [], positionDrives = new Map();
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
        // 放开后线动量也应衰减；只保留很小的线阻尼会使整条关节链长时间继续滑动。
        body.setDamping(0.65, 0.65); body.setFriction(0.7); body.setRestitution(0);
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
            for (const drive of positionDrives.values()) world.removeRigidBody(drive.control.body);
            if (floor) world.removeRigidBody(floor.body);
        }
        for (let i = owned.length - 1; i >= 0; i--) Ammo.destroy(owned[i]);
        owned.length = 0; constraints.length = 0; bodies.clear(); positionDrives.clear();
    }
    try {
        const config = own(new Ammo.btDefaultCollisionConfiguration());
        const dispatcher = own(new Ammo.btCollisionDispatcher(config));
        const broadphase = own(new Ammo.btDbvtBroadphase()), solver = own(new Ammo.btSequentialImpulseConstraintSolver());
        world = own(new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, config));
        world.getSolverInfo().set_m_numIterations(40);
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
            // 同一躯干/肢体内部近邻的简化代理不互相挤压，保留跨分区和地面碰撞。
            const group = /(Shoulder|Arm|Elbow|Wrist)$/u.test(node.semantic) ? (node.semantic.startsWith('left') ? 8 : 16)
                : /(Leg|Knee|Ankle)$/u.test(node.semantic) ? (node.semantic.startsWith('left') ? 32 : 64) : 4;
            const record = addBody(shape, node.mass, node.position.clone().add(nodeOffset(node, node.quaternion)), node.quaternion, group, (124 ^ group) | 2);
            bodies.set(node, record);
        }
        for (const node of rig.nodes) {
            const parent = node.parentNode;
            if (!parent) continue;
            const a = bodies.get(parent), b = bodies.get(node);
            const frameA = node.position.clone().sub(a.position).applyQuaternion(a.quaternion.clone().invert());
            const frameB = node.position.clone().sub(b.position).applyQuaternion(b.quaternion.clone().invert());
            // 关节角度使用实际骨骼父空间，辅助骨偏移包含在A框架，B框架保持当前骨骼坐标轴。
            const freeAxes = [0, 1, 2].filter(axis => node.limits.high[axis] - node.limits.low[axis] > 1e-6);
            const hinge = freeAxes.length === 1 ? freeAxes[0] : null;
            const hingeRotation = hinge === null ? new Quaternion() : new Quaternion().setFromUnitVectors(
                new Vector3(1, 0, 0), new Vector3().setComponent(hinge, 1));
            // 单轴深屈曲统一落在Bullet X轴，避免Y轴超过90度时出现Euler翻转。
            const frameRotation = node.jointFrameRotation.clone().multiply(hingeRotation);
            const joint = own(new Ammo.btGeneric6DofSpringConstraint(a.body, b.body,
                nativeTransform(frameA, frameRotation), nativeTransform(frameB, hingeRotation), true));
            joint.setLinearLowerLimit(nativeVector(new Vector3())); joint.setLinearUpperLimit(nativeVector(new Vector3()));
            const low = hinge === null ? node.limits.high.map(angle => -angle) : [-node.limits.high[hinge], 0, 0];
            const high = hinge === null ? node.limits.low.map(angle => -angle) : [-node.limits.low[hinge], 0, 0];
            joint.setAngularLowerLimit(nativeVector(new Vector3(...low)));
            joint.setAngularUpperLimit(nativeVector(new Vector3(...high)));
            // 关节锚点/限位由迭代逐步纠正，过高的stop ERP会和重力接触反复对抗。
            if (joint.setParam) for (let axis = 0; axis < 6; axis++) joint.setParam(2, 0.2, axis);
            world.addConstraint(joint, true); constraints.push(joint);
        }
        // 位置目标与人体关节在同一原生求解轮里受力；预建关闭的弹簧避免拖动时追加原生分配。
        for (const [node, record] of bodies) {
            const shape = own(new Ammo.btSphereShape(0.001));
            const control = addBody(shape, 0, node.position, new Quaternion(), 0, 0);
            const joint = own(new Ammo.btGeneric6DofSpringConstraint(control.body, record.body,
                nativeTransform(new Vector3()), nativeTransform(node.offset.clone().negate()), true));
            joint.setLinearLowerLimit(nativeVector(new Vector3(1, 1, 1))); joint.setLinearUpperLimit(nativeVector(new Vector3()));
            joint.setAngularLowerLimit(nativeVector(new Vector3(1, 1, 1))); joint.setAngularUpperLimit(nativeVector(new Vector3()));
            for (let axis = 0; axis < 6; axis++) { joint.enableSpring(axis, false); joint.setEquilibriumPoint(axis, 0); }
            world.addConstraint(joint, true); constraints.push(joint); positionDrives.set(node, { control, joint });
        }
        const feet = rig.nodes.filter(node => /Ankle$/u.test(node.semantic));
        const ground = feet.length ? Math.min(...feet.map(node => node.position.y - node.radius)) : -0.1;
        const plane = own(new Ammo.btStaticPlaneShape(nativeVector(new Vector3(0, 1, 0)), 0));
        floor = addBody(plane, 0, new Vector3(0, ground, 0), new Quaternion(), 2, 124);
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
    function inverseInertia(record) {
        if (record.rotationPinned) return new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
        const rotation = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(record.quaternion));
        const inertia = new Matrix3().set(1 / record.inertia.x, 0, 0, 0, 1 / record.inertia.y, 0, 0, 0, 1 / record.inertia.z);
        return rotation.clone().multiply(inertia).multiply(rotation.transpose());
    }
    function applyTorque(record, desired, frequency, damping, parent = null, maximumAcceleration = 150) {
        delta.copy(desired).multiply(record.quaternion.clone().invert()).normalize();
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const sine = Math.hypot(delta.x, delta.y, delta.z);
        const angle = sine > 1e-8 ? 2 * Math.atan2(sine, delta.w) / sine : 2;
        const angularVelocity = record.omega.clone(); if (parent) angularVelocity.sub(parent.omega);
        const omega = frequency * Math.PI * 2, denominator = 1 + 2 * damping * omega * h + omega * omega * h * h;
        vector.set(delta.x, delta.y, delta.z).multiplyScalar(angle * omega * omega)
            .addScaledVector(angularVelocity, -2 * damping * omega).multiplyScalar(1 / denominator).clampLength(0, maximumAcceleration);
        if (parent && !parent.rotationPinned) {
            // 成对力矩必须使用两端有效惯量，避免轻父体被重子体的回复力矩过度加速。
            const total = inverseInertia(record), parentInverse = inverseInertia(parent);
            for (let i = 0; i < 9; i++) total.elements[i] += parentInverse.elements[i];
            vector.applyMatrix3(total.invert());
        } else vector.applyQuaternion(record.quaternion.clone().invert()).multiply(record.inertia).applyQuaternion(record.quaternion);
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
            const rootRecord = bodies.get(rig.pelvis);
            rootRecord.rotationPinned = !settings.freePelvis && !targets.some(target => target.node === rig.pelvis && target.rotationState !== 'Off');
            rootRecord.positionPinned = !settings.freePelvis && !targets.some(target => target.node === rig.pelvis && target.positionState !== 'Off');
            scratchVector.setValue(...(rootRecord.rotationPinned ? [0, 0, 0] : [1, 1, 1])); rootRecord.body.setAngularFactor(scratchVector);
            scratchVector.setValue(...(rootRecord.positionPinned ? [0, 0, 0] : [1, 1, 1])); rootRecord.body.setLinearFactor(scratchVector);
            const fullyPinned = rootRecord.rotationPinned;
            if (rootRecord.fullyPinned !== fullyPinned) {
                scratchVector.setValue(...(fullyPinned ? [0, 0, 0] : rootRecord.inertia.toArray()));
                rootRecord.body.setMassProps(fullyPinned ? 0 : rootRecord.mass, scratchVector);
                rootRecord.body.updateInertiaTensor(); rootRecord.body.setCollisionFlags(fullyPinned ? 1 : 0); rootRecord.fullyPinned = fullyPinned;
            }
            const base = animated.get(rig.pelvis);
            rootRecord.guideVelocity ||= new Vector3();
            let rootGoal = null;
            const rootTarget = targets.find(target => target.node === rig.pelvis && target.positionState !== 'Off');
            if (fullyPinned && rootTarget) {
                const goal = rig.targetToLocal(rootTarget.target), drive = targetDrive(rootTarget.positionState, settings);
                if (rootTarget.positionState === 'Comply') rootTarget.target.lerp(rig.targetToWorld(rootRecord.position), 1 - Math.exp(-3 * h));
                const frequency = drive.frequency * Math.PI * 2;
                const denominator = 1 + 2 * Math.max(1, settings.damping) * frequency * h + frequency * frequency * h * h;
                const acceleration = goal.sub(rootRecord.position).multiplyScalar(frequency * frequency)
                    .addScaledVector(rootRecord.guideVelocity, -2 * Math.max(1, settings.damping) * frequency).multiplyScalar(1 / denominator).clampLength(0, 30);
                rootRecord.guideVelocity.addScaledVector(acceleration, h).clampLength(0, 1.5);
                rootGoal = rootRecord.position.clone().addScaledVector(rootRecord.guideVelocity, h);
            }

            if (fullyPinned) {
                // 骨盆位置导引是整个人体的支撑平移；所有代理共同移动，内部运动和其他世界目标保留。
                const nextPosition = rootRecord.positionPinned ? base.position.clone().add(nodeOffset(rig.pelvis, base.quaternion)) : (rootGoal || rootRecord.position);
                const shift = nextPosition.clone().sub(rootRecord.position);
                if (shift.lengthSq() > 1e-14) for (const [node, record] of bodies) {
                    if (node === rig.pelvis) continue;
                    const velocity = record.velocity.clone();
                    write(record, record.position.clone().add(shift), record.quaternion);
                    scratchVector.setValue(velocity.x, velocity.y, velocity.z); record.body.setLinearVelocity(scratchVector); record.velocity.copy(velocity);
                }
            }
            if (rootRecord.rotationPinned || rootRecord.positionPinned) {
                write(rootRecord, rootRecord.positionPinned ? base.position.clone().add(nodeOffset(rig.pelvis, base.quaternion)) : (rootGoal || rootRecord.position),
                    rootRecord.rotationPinned ? base.quaternion : rootRecord.quaternion);
                if (fullyPinned) {
                    scratchVector.setValue(0, 0, 0); rootRecord.body.setLinearVelocity(scratchVector); rootRecord.velocity.set(0, 0, 0);
                    if (!rootGoal) rootRecord.guideVelocity.set(0, 0, 0);
                }
                scratchVector.setValue(0, 0, 0);
                if (rootRecord.rotationPinned) { rootRecord.body.setAngularVelocity(scratchVector); rootRecord.omega.set(0, 0, 0); }
                if (rootRecord.positionPinned) { rootRecord.body.setLinearVelocity(scratchVector); rootRecord.velocity.set(0, 0, 0); }
            }
            for (const node of rig.nodes) {
                const record = bodies.get(node), parent = node.parentNode && bodies.get(node.parentNode);
                const desired = animated.get(node).quaternion.clone();
                if (parent) desired.premultiply(animated.get(node.parentNode).quaternion.clone().invert()).premultiply(parent.quaternion);
                applyTorque(record, desired, /^(upperBody|chest|neck|head)$/u.test(node.semantic) ? 4 : 3, Math.max(1.3, settings.damping), parent);
            }
            for (const drive of positionDrives.values()) for (let axis = 0; axis < 3; axis++) drive.joint.enableSpring(axis, false);
            for (const target of targets) {
                const record = bodies.get(target.node); if (!record) continue;
                const origin = record.position.clone().sub(nodeOffset(target.node, record.quaternion));
                if (target.positionState !== 'Off') {
                    const goal = rig.targetToLocal(target.target);
                    if (target.positionState === 'Comply' && goal.distanceTo(origin) > 0.01) {
                        target.target.lerp(rig.targetToWorld(origin), 1 - Math.exp(-3 * h));
                    }
                    const drive = targetDrive(target.positionState, settings);
                    if (!(target.node === rig.pelvis && fullyPinned)) {
                        const nativeDrive = positionDrives.get(target.node);
                        const desired = rig.targetToLocal(target.target);
                        if (!settings.freePelvis) {
                            let reach = 0;
                            for (let node = target.node; node.parentNode; node = node.parentNode) reach += node.position.distanceTo(node.parentNode.position);
                            const support = rootRecord.position.clone().sub(nodeOffset(rig.pelvis, rootRecord.quaternion));
                            desired.sub(support).clampLength(0, reach).add(support);
                        }
                        write(nativeDrive.control, desired, new Quaternion());
                        const error = origin.distanceTo(desired);
                        let budgetMass = record.mass;
                        // 脚/膝控制点需驱动整条腿和骨盆，力预算不能只取末端的小质量。
                        if (/(Leg|Knee|Ankle)$/u.test(target.node.semantic)) {
                            budgetMass = 0;
                            for (let node = target.node; node; node = node.parentNode) budgetMass += node.mass;
                        }
                        const stiffness = Math.min(record.mass * Math.pow(drive.frequency * Math.PI * 2, 2), budgetMass * drive.acceleration / Math.max(0.005, error));
                        for (let axis = 0; axis < 3; axis++) {
                            nativeDrive.joint.setStiffness(axis, stiffness);
                            // 此旧Bullet接口的damping参与目标速度换算，并非直接阻尼比。
                            // 将速度明确规范为 responseRate × 误差，避免近目标处仍请求极大速度。
                            const responseRate = (3 + 9 * settings.strength) / Math.max(1, settings.damping);
                            nativeDrive.joint.setDamping(axis, Math.min(1, responseRate * 40 * h / Math.max(1e-6, stiffness)));
                            nativeDrive.joint.enableSpring(axis, true);
                        }
                        applyForce(record, origin, origin, drive.frequency, Math.max(1.3, settings.damping), drive.acceleration);
                    }
                }
                if (target.rotationState !== 'Off') {
                    if (target.rotationState === 'Comply') target.targetRotation.slerp(rig.targetRotationToWorld(record.quaternion), 1 - Math.exp(-3 * h));
                    const drive = targetDrive(target.rotationState, settings);
                    applyTorque(record, rig.targetRotationToLocal(target.targetRotation), drive.frequency, settings.damping, null, drive.angularAcceleration);
                }
            }
            world.stepSimulation(h, 0, h);
            for (const record of bodies.values()) {
                read(record); record.omega.clampLength(0, 8); record.velocity.clampLength(0, 4);
                scratchVector.setValue(record.omega.x, record.omega.y, record.omega.z); record.body.setAngularVelocity(scratchVector);
                scratchVector.setValue(record.velocity.x, record.velocity.y, record.velocity.z); record.body.setLinearVelocity(scratchVector);
            }
            const poses = new Map([...bodies]);
            dissipateJointMotion(rig.write(poses, animated), targets); rig.restore();
            accumulator -= h; substeps++;
        }
        const poses = new Map([...bodies].map(([node, record]) => [node, read(record)]));
        rig.write(poses, animated);
        // 原生关节维护代理锚点，显示骨架只做长度/角度保护，不瞬移反馈接触体。
        frameMs = performance.now() - started;
        return poses;
    }
    // 关节释放后仍耗散相对运动。等反角冲量保留自由身体的整体运动，不重置姿态或清零全部速度。
    function dissipateJointMotion(projections, targets) {
        const inverses = new Map([...bodies].map(([node, record]) => [node, inverseInertia(record)]));
        function correct(node, change) {
            const record = bodies.get(node), parent = node.parentNode && bodies.get(node.parentNode);
            if (record.rotationPinned || change.lengthSq() < 1e-16) return;
            const childInverse = inverses.get(node), total = childInverse.clone();
            if (parent) {
                const parentInverse = inverses.get(node.parentNode);
                for (let i = 0; i < 9; i++) total.elements[i] += parentInverse.elements[i];
            }
            const relative = record.omega.clone(); if (parent) relative.sub(parent.omega);
            const impulse = change.clone().applyMatrix3(total.clone().invert());
            const work = impulse.dot(relative), curvature = impulse.dot(impulse.clone().applyMatrix3(total));
            // 各向异性惯量下，直接夹角速度分量也可能增能；按真实角动能变化限制冲量。
            if (work >= 0 || curvature < 1e-16) return;
            impulse.multiplyScalar(Math.min(1, -work / curvature));
            record.omega.add(impulse.clone().applyMatrix3(childInverse));
            if (parent) parent.omega.sub(impulse.applyMatrix3(inverses.get(node.parentNode)));
        }
        for (const { node, basis, rotation } of projections) {
            const record = bodies.get(node), parent = node.parentNode && bodies.get(node.parentNode);
            const relative = record.omega.clone(); if (parent) relative.sub(parent.omega);
            relative.applyQuaternion(basis.clone().invert());
            const limited = relative.clone(), angle = new Euler().setFromQuaternion(rotation, 'XYZ');
            if (!node.hasModelLimits && node.hingeAxis !== null) {
                const axis = ['x', 'y', 'z'][node.hingeAxis], twist = 2 * Math.atan2(rotation[axis], rotation.w);
                angle[axis] = Math.atan2(Math.sin(twist), Math.cos(twist));
            }
            for (let axis = 0; axis < 3; axis++) {
                const low = node.limits.low[axis], high = node.limits.high[axis], value = limited.getComponent(axis);
                const current = angle[['x', 'y', 'z'][axis]];
                if (high - low < 1e-6 || (current <= low + 1e-5 && value < 0) || (current >= high - 1e-5 && value > 0)) limited.setComponent(axis, 0);
            }
            correct(node, limited.sub(relative).applyQuaternion(basis));
        }
        for (const [node, record] of bodies) {
            if (!node.parentNode) continue;
            const active = targets.some(target => target.node === node && (target.positionState !== 'Off' || target.rotationState !== 'Off'));
            const relative = record.omega.clone().sub(bodies.get(node.parentNode).omega);
            correct(node, relative.multiplyScalar(Math.exp(-(active ? 2 : 12) * h) - 1));
        }
        for (const record of bodies.values()) {
            record.omega.clampLength(0, 8);
            scratchVector.setValue(record.omega.x, record.omega.y, record.omega.z); record.body.setAngularVelocity(scratchVector);
        }
    }
    function reset(animated = null) {
        rig.restore(); animated ||= rig.animatedPoses(); accumulator = 0;
        for (const [node, record] of bodies) {
            const pose = animated.get(node); record.guideVelocity?.set(0, 0, 0);
            write(record, pose.position.clone().add(nodeOffset(node, pose.quaternion)), pose.quaternion, true);
        }
    }
    return { step, reset, dispose, getState: () => ({ bodyCount: bodies.size, jointCount: constraints.length,
        frameMs, substeps, disposed, allocations: owned.length }),
        snapshot: () => new Map([...bodies].map(([node, record]) => [node, { position: read(record).position.clone(), quaternion: record.quaternion.clone() }])) };
}

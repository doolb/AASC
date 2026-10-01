import { Euler, Quaternion, Vector3 } from 'three';
import { createPrimitiveContacts, getRigidBodyTolerance } from './web-xpbd-collision.mjs';

// 算法参考XPBD论文（Macklin/Müller/Chentanez 2016）与Ten Minute Physics第22/25节。
// 独立实现PMX六轴约束：每个弹簧在子步内累积lambda，并使用alpha/h²，不以纠错倍率冒充XPBD。
const EPS = 1e-10;
const CORRECTION_EPS = 1e-6;
const AXES = ['x', 'y', 'z'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createXpbdBody(params, index, position, quaternion) {
    const mass = params.type === 0 ? 0 : Math.max(0, params.weight);
    const inertia = new Vector3();
    const { width: r, height: h, depth: d } = params;
    const inertiaBuilders = {
        0: () => inertia.setScalar(0.4 * mass * r * r),
        1: () => inertia.set(mass * (h * h + d * d) / 3, mass * (r * r + d * d) / 3, mass * (r * r + h * h) / 3),
        2: () => {
            const cylinder = mass * h / Math.max(EPS, h + 4 * r / 3), caps = mass - cylinder;
            const side = cylinder * (3 * r * r + h * h) / 12 + caps * (0.4 * r * r + 0.375 * h * r + h * h / 4);
            inertia.set(side, cylinder * r * r / 2 + caps * 0.4 * r * r, side);
        }
    };
    if (!inertiaBuilders[params.shapeType]) throw new Error('XPBD不支持的PMX形状：' + params.shapeType);
    inertiaBuilders[params.shapeType]();
    return { params, index, dynamic: mass > 0, contactTolerance: getRigidBodyTolerance(params),
        positionDriven: params.type === 2 && params.boneIndex !== -1,
        inverseMass: mass > 0 && !(params.type === 2 && params.boneIndex !== -1) ? 1 / mass : 0,
        inverseInertia: inertia.clone().set(inertia.x > EPS ? 1 / inertia.x : 0,
            inertia.y > EPS ? 1 / inertia.y : 0, inertia.z > EPS ? 1 / inertia.z : 0), inertia,
        position: position.clone(), quaternion: quaternion.clone(), previousPosition: position.clone(), previousQuaternion: quaternion.clone(),
        velocity: new Vector3(), omega: new Vector3(), force: new Vector3(), torque: new Vector3(),
        axes: [new Vector3(), new Vector3(), new Vector3()], halfSize: new Vector3(),
        start: new Vector3(), end: new Vector3(), min: new Vector3(), max: new Vector3() };
}

export function createXpbdJoint(params, a, b) {
    const frame = new Quaternion().setFromEuler(new Euler(...params.rotation));
    const position = new Vector3(...params.position), qa = a.quaternion.clone().invert(), qb = b.quaternion.clone().invert();
    return { params, a, b, localA: position.clone().sub(a.position).applyQuaternion(qa),
        localB: position.clone().sub(b.position).applyQuaternion(qb),
        rotationA: qa.multiply(frame), rotationB: qb.multiply(frame), lambda: new Float64Array(12) };
}

export function createXpbdSolver(bodies, joints) {
    const collision = createPrimitiveContacts();
    const excluded = new Set(joints.map(({ a, b }) => Math.min(a.index, b.index) * bodies.length + Math.max(a.index, b.index)));
    const s = Array.from({ length: 20 }, () => new Vector3());
    const q = Array.from({ length: 6 }, () => new Quaternion());
    const euler = new Euler();
    const zero = new Vector3();
    const gradA = new Vector3(), gradB = new Vector3();
    const inverseA = new Vector3(), inverseB = new Vector3();
    const positionA = new Vector3(), positionB = new Vector3();
    const normal = new Vector3();
    let currentContacts = [];
    let elapsedMs = 0;
    let steps = 0;
    let restitutionThreshold = 0.5;

    const inverseInertia = (body, vector, out) => out.copy(vector)
        .applyQuaternion(q[5].copy(body.quaternion).invert()).multiply(body.inverseInertia).applyQuaternion(body.quaternion);
    const rotate = (body, vector, factor) => {
        const length = vector.length() * Math.abs(factor);
        if (length < EPS) return;
        // 与THREE-XPBD一致的一阶四元数积分；每个刚体独立限角，不缩小另一侧或平移纠正。
        const scale = factor * Math.min(1, 0.5 / length);
        q[4].set(vector.x * scale, vector.y * scale, vector.z * scale, 0).multiply(body.quaternion);
        const orientation = body.quaternion;
        orientation.set(orientation.x + 0.5 * q[4].x, orientation.y + 0.5 * q[4].y,
            orientation.z + 0.5 * q[4].z, orientation.w + 0.5 * q[4].w).normalize();
    };

    const applyPositionCorrection = (a, b, n, dl) => {
        a.position.addScaledVector(n, -a.inverseMass * dl);
        b.position.addScaledVector(n, b.inverseMass * dl);
        rotate(a, inverseA, dl); rotate(b, inverseB, dl);
    };
    // n是B位置的梯度，angularA/B是两侧旋转的梯度；复用矩阵变换临时值。
    const correction = (a, b, n, angularA, angularB, error, compliance, lambda, h) => {
        inverseInertia(a, angularA, inverseA); inverseInertia(b, angularB, inverseB);
        const alpha = compliance / (h * h);
        const weight = n.lengthSq() * (a.inverseMass + b.inverseMass)
            + angularA.dot(inverseA) + angularB.dot(inverseB);
        if (weight < EPS) return 0;
        const dl = (-error - alpha * lambda) / (weight + alpha);
        applyPositionCorrection(a, b, n, dl);
        return dl;
    };

    const anchor = (body, local, out) => out.copy(local).applyQuaternion(body.quaternion).add(body.position);
    // 位置和速度约束共用同一广义坐标梯度，特别是A旋转带动的关节参考轴。
    const linearFrame = (joint, axis) => {
        const { a, b } = joint;
        anchor(a, joint.localA, positionA); anchor(b, joint.localB, positionB);
        q[0].multiplyQuaternions(a.quaternion, joint.rotationA);
        normal.set(0, 0, 0).setComponent(axis, 1).applyQuaternion(q[0]);
        const delta = s[0].subVectors(positionB, positionA);
        // 参考轴随A旋转，A角梯度包含delta项；不能把运动的关节框架当作世界固定轴。
        gradA.crossVectors(s[1].subVectors(positionA, a.position).add(delta), normal).negate();
        gradB.crossVectors(s[2].subVectors(positionB, b.position), normal);
        return delta.dot(normal);
    };
    const linearAxis = (joint, axis, target, compliance, slot, h) => {
        const error = linearFrame(joint, axis) - target;
        const { a, b } = joint;
        joint.lambda[slot] += correction(a, b, normal, gradA, gradB, error, compliance, joint.lambda[slot], h);
    };

    const rotationFrame = (joint, axis) => {
        const { a, b } = joint;
        q[0].multiplyQuaternions(a.quaternion, joint.rotationA);
        q[1].multiplyQuaternions(b.quaternion, joint.rotationB);
        q[2].copy(q[0]).invert().multiply(q[1]);
        euler.setFromQuaternion(q[2], 'XYZ');
        // XYZ Euler角对世界旋转的梯度是三个瞬时轴的对偶基，而不是简单的三个单位轴。
        const ax = s[3].set(1, 0, 0).applyQuaternion(q[0]);
        const ay = s[4].set(0, Math.cos(euler.x), Math.sin(euler.x)).applyQuaternion(q[0]);
        const az = s[5].set(Math.sin(euler.y), -Math.sin(euler.x) * Math.cos(euler.y),
            Math.cos(euler.x) * Math.cos(euler.y)).applyQuaternion(q[0]);
        const determinant = Math.max(0.01, Math.cos(euler.y));
        const first = axis === 0 ? ay : axis === 1 ? az : ax;
        const second = axis === 0 ? az : axis === 1 ? ax : ay;
        gradB.crossVectors(first, second).multiplyScalar(1 / determinant);
        gradA.copy(gradB).negate();
        return euler[AXES[axis]];
    };
    const rotationAxis = (joint, axis, target, compliance, slot, h) => {
        const error = rotationFrame(joint, axis) - target;
        const { a, b } = joint;
        joint.lambda[slot] += correction(a, b, zero, gradA, gradB, error, compliance, joint.lambda[slot], h);
    };

    const solveJoint = (joint, h) => {
        const p = joint.params;
        for (let i = 0; i < 3; i += 1) {
            // 弹簧可能把锚点拉向范围外的0，先求弹簧再求硬限位，避免最后一轮留下越界。
            if (p.springPosition[i] > 0) linearAxis(joint, i, 0, 1 / p.springPosition[i], i + 6, h);
            anchor(joint.a, joint.localA, positionA); anchor(joint.b, joint.localB, positionB);
            q[0].multiplyQuaternions(joint.a.quaternion, joint.rotationA);
            normal.set(0, 0, 0).setComponent(i, 1).applyQuaternion(q[0]);
            const value = s[0].subVectors(positionB, positionA).dot(normal);
            const low = p.translationLimitation1[i], high = p.translationLimitation2[i];
            if (low <= high && (value < low || value > high || low === high)) linearAxis(joint, i, clamp(value, low, high), 0, i, h);
            else joint.lambda[i] = 0;
            if (p.springRotation[i] > 0) rotationAxis(joint, i, 0, 1 / p.springRotation[i], i + 9, h);
            q[0].multiplyQuaternions(joint.a.quaternion, joint.rotationA);
            q[1].multiplyQuaternions(joint.b.quaternion, joint.rotationB);
            euler.setFromQuaternion(q[2].copy(q[0]).invert().multiply(q[1]), 'XYZ');
            const angle = euler[AXES[i]], min = p.rotationLimitation1[i], max = p.rotationLimitation2[i];
            if (min <= max && (angle < min || angle > max || min === max)) rotationAxis(joint, i, clamp(angle, min, max), 0, i + 3, h);
            else joint.lambda[i + 3] = 0;
        }
    };

    const velocityAt = (body, point, out) => out.crossVectors(body.omega, s[8].subVectors(point, body.position)).add(body.velocity);
    const contactPoints = (contact) => {
        anchor(contact.a, contact.localA, contact.pointA); anchor(contact.b, contact.localB, contact.pointB);
    };
    const contactGradients = (contact, direction) => {
        gradA.crossVectors(s[6].subVectors(contact.pointA, contact.a.position), direction).negate();
        gradB.crossVectors(s[7].subVectors(contact.pointB, contact.b.position), direction);
    };
    const solveStaticFriction = (contact) => {
        if (contact.lambda <= 0 || contact.friction <= 0) return;
        const { a, b, normal: n } = contact;
        contactPoints(contact);
        const previousA = s[14].copy(contact.localA).applyQuaternion(a.previousQuaternion).add(a.previousPosition);
        const previousB = s[15].copy(contact.localB).applyQuaternion(b.previousQuaternion).add(b.previousPosition);
        const tangent = s[16].subVectors(contact.pointB, previousB).sub(s[17].subVectors(contact.pointA, previousA));
        tangent.addScaledVector(n, -tangent.dot(n));
        const distance = tangent.length();
        if (distance < CORRECTION_EPS) return;
        tangent.multiplyScalar(1 / distance);
        contactGradients(contact, tangent);
        inverseInertia(a, gradA, inverseA); inverseInertia(b, gradB, inverseB);
        const weight = a.inverseMass + b.inverseMass + gradA.dot(inverseA) + gradB.dot(inverseB);
        if (weight < EPS) return;
        const lambda = distance / weight;
        if (lambda >= contact.friction * contact.lambda) return;
        // 本实现法向lambda为正，切向位移纠正lambda为负；超出静摩擦预算交给速度级动摩擦。
        // 复用预算预计算的两侧逆惯量，不再重复四元数变换。
        applyPositionCorrection(a, b, tangent, -lambda);
    };
    const solveContact = (contact, h) => {
        contactPoints(contact);
        // 容差内允许极小穿透，避免每个小子步都把浮点误差变为位置修正和反向速度。
        const error = s[0].subVectors(contact.pointB, contact.pointA).dot(contact.normal) + contact.tolerance;
        if (error <= -CORRECTION_EPS) {
            contactGradients(contact, contact.normal);
            contact.lambda += correction(contact.a, contact.b, contact.normal, gradA, gradB, error, 0, 0, h);
        }
        solveStaticFriction(contact);
    };

    const velocityCorrection = (a, b, n, change, min = -Infinity, max = Infinity) => {
        inverseInertia(a, gradA, inverseA); inverseInertia(b, gradB, inverseB);
        const weight = n.lengthSq() * (a.inverseMass + b.inverseMass) + gradA.dot(inverseA) + gradB.dot(inverseB);
        if (weight < EPS) return 0;
        const value = clamp(change / weight, min, max);
        // 动态type2的线速度由位置目标计算，碰撞冲量只能改变旋转；静态/运动学保持其目标速度。
        a.velocity.addScaledVector(n, -value * a.inverseMass); b.velocity.addScaledVector(n, value * b.inverseMass);
        a.omega.addScaledVector(inverseA, value); b.omega.addScaledVector(inverseB, value);
        return value;
    };

    // 自由轴和范围内的弹簧运动保持原速度；锁定轴去掉相对速度，边界只限制继续越界的分量。
    // 邻域内仍允许以剩余间距/h闭合，不把尚未接触限位的运动提前冻结。
    const limitSpeedChange = (value, low, high, speed, tolerance, h) => {
        if (low > high) return 0;
        if (low === high) return -speed;
        if (value <= low + tolerance && speed < 0) {
            return Math.max(speed, Math.min(0, (low - value) / h)) - speed;
        }
        if (value >= high - tolerance && speed > 0) {
            return Math.min(speed, Math.max(0, (high - value) / h)) - speed;
        }
        return 0;
    };
    const solveJointVelocity = (joint, h) => {
        const { a, b, params: p } = joint;
        const tolerance = Math.min(a.contactTolerance, b.contactTolerance);
        for (let i = 0; i < 3; i += 1) {
            const value = linearFrame(joint, i);
            const speed = normal.dot(b.velocity) - normal.dot(a.velocity) + gradA.dot(a.omega) + gradB.dot(b.omega);
            const change = limitSpeedChange(value, p.translationLimitation1[i], p.translationLimitation2[i], speed, tolerance, h);
            if (Math.abs(change) > EPS) velocityCorrection(a, b, normal, change);
            const angle = rotationFrame(joint, i);
            const angularSpeed = gradA.dot(a.omega) + gradB.dot(b.omega);
            const angularChange = limitSpeedChange(angle, p.rotationLimitation1[i], p.rotationLimitation2[i], angularSpeed, 1e-4, h);
            if (Math.abs(angularChange) > EPS) velocityCorrection(a, b, zero, angularChange);
        }
    };

    const solveVelocity = (contact, h) => {
        const { a, b, normal: n } = contact;
        contactPoints(contact);
        const relative = s[11].subVectors(velocityAt(b, contact.pointB, s[10]), velocityAt(a, contact.pointA, s[9]));
        const vn = relative.dot(n);
        const separation = s[0].subVectors(contact.pointB, contact.pointA).dot(n);
        // 小步长不能无限降低反弹门限；接触误差带的速度噪声也不能触发恢复系数。
        const threshold = Math.max(restitutionThreshold, contact.tolerance / h);
        const restitution = Math.abs(contact.incoming) > threshold ? contact.restitution : 0;
        // 上游深度d=-separation，其分离支路目标为-d/h；统一法线方向后仍为正separation/h。
        const targetVelocity = separation <= 0 ? Math.max(-contact.incoming * restitution, 0) : separation / h;
        const tangent = s[12].copy(relative).addScaledVector(n, -vn);
        const speed = tangent.length();
        const change = s[18].set(0, 0, 0);
        if (speed > CORRECTION_EPS) change.copy(tangent).multiplyScalar(-Math.min(contact.friction * contact.lambda / h, speed) / speed);
        change.addScaledVector(n, targetVelocity - vn);
        const magnitude = change.length();
        if (magnitude < CORRECTION_EPS) return;
        // 按上游将法向和切向变化合成一次有效质量纠正，避免先后施加冲量改变摩擦方向/预算。
        change.multiplyScalar(1 / magnitude);
        contactGradients(contact, change);
        velocityCorrection(a, b, change, magnitude);
    };

    const reconstructVelocity = (body, h) => {
        if (!body.dynamic) return;
        body.velocity.subVectors(body.position, body.previousPosition).multiplyScalar(1 / h);
        q[3].copy(body.previousQuaternion).invert(); q[3].premultiply(body.quaternion).normalize();
        if (q[3].w < 0) q[3].set(-q[3].x, -q[3].y, -q[3].z, -q[3].w);
        body.omega.set(q[3].x, q[3].y, q[3].z).multiplyScalar(2 / h);
    };

    const step = (h, gravity, applyTargets) => {
        const begin = performance.now();
        restitutionThreshold = Math.max(0.5, 2 * gravity.length() * h);
        for (const body of bodies) {
            body.previousPosition.copy(body.position); body.previousQuaternion.copy(body.quaternion);
        }
        for (const body of bodies) {
            if (!body.dynamic) continue;
            body.velocity.multiplyScalar(Math.pow(1 - clamp(body.params.positionDamping, 0, 1), h));
            body.omega.multiplyScalar(Math.pow(1 - clamp(body.params.rotationDamping, 0, 1), h));
            if (body.inverseMass > 0) body.velocity.addScaledVector(gravity, h).addScaledVector(body.force, body.inverseMass * h);
            inverseInertia(body, body.torque, s[13]); body.omega.addScaledVector(s[13], h);
            if (!body.positionDriven) body.position.addScaledVector(body.velocity, h);
            rotate(body, body.omega, h);
        }
        // 先积分再覆盖type0姿态/type2位置，与THREE-XPBD包装顺序一致；目标速度仍由前姿态回算。
        applyTargets?.(h);
        for (const joint of joints) joint.lambda.fill(0);
        // 每子步重新检测接触；先采集未修正的入射速度，供末尾反弹计算使用。
        currentContacts = collision.scan(bodies, excluded);
        for (const contact of currentContacts) {
            contactPoints(contact);
            contact.incoming = s[11].subVectors(velocityAt(contact.b, contact.pointB, s[10]),
                velocityAt(contact.a, contact.pointA, s[9])).dot(contact.normal);
        }
        // 小子步只求解一轮全部关节/接触，随后立即回算速度，再推进下一子步。
        for (const joint of joints) solveJoint(joint, h);
        for (const contact of currentContacts) solveContact(contact, h);
        for (const body of bodies) reconstructVelocity(body, h);
        // 硬限位位置修正会回算成速度，需在同一子步消除继续冲向限位的速度；只投影约束方向。
        for (const joint of joints) solveJointVelocity(joint, h);
        for (const contact of currentContacts) solveVelocity(contact, h);
        for (const body of bodies) { body.force.set(0, 0, 0); body.torque.set(0, 0, 0); }
        elapsedMs = performance.now() - begin; steps += 1;
    };

    return { step, get contacts() { return currentContacts; }, getState: () => ({ steps, stepMs: elapsedMs,
        contacts: currentContacts.length, candidates: collision.candidateCount, iterations: 1 }), reset() {
        for (const joint of joints) joint.lambda.fill(0);
        currentContacts = [];
    }, dispose() { collision.dispose(); excluded.clear(); currentContacts = []; } };
}

import { Quaternion, Vector3 } from 'three';

// PMX只需要球、盒和胶囊。每个物理实例独占临时值/接触池，避免子步制造短命Vector3。
// 碰撞检测使用解析最近距离及OBB的SAT；不是THREE-XPBD的通用GJK/EPA流程。
const EPS = 1e-9;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const component = (vector, axis) => vector.getComponent(axis);

// 以最薄的实际形状尺寸确定接触误差带，避免小饰物使用大容差或大刚体被数值噪声反复推出。
// 容差只用于接触，不改变PMX形状尺寸；单位沿用物理模型空间。
export function getRigidBodyTolerance(params) {
    const size = params.shapeType === 1 ? Math.min(params.width, params.height, params.depth) : params.width;
    return clamp(size * 0.001, 1e-6, 1e-3);
}

export function prepareCollisionBody(body) {
    const { position: p, quaternion: q, params, axes, halfSize, start, end, min, max } = body;
    for (let i = 0; i < 3; i += 1) axes[i].set(0, 0, 0).setComponent(i, 1).applyQuaternion(q);
    if (params.shapeType === 2) {
        start.copy(p).addScaledVector(axes[1], -params.height / 2);
        end.copy(p).addScaledVector(axes[1], params.height / 2);
    } else { start.copy(p); end.copy(p); }
    if (params.shapeType === 1) {
        halfSize.set(params.width, params.height, params.depth);
        for (let i = 0; i < 3; i += 1) {
            const extent = Math.abs(component(axes[0], i)) * halfSize.x
                + Math.abs(component(axes[1], i)) * halfSize.y + Math.abs(component(axes[2], i)) * halfSize.z;
            min.setComponent(i, component(p, i) - extent);
            max.setComponent(i, component(p, i) + extent);
        }
    } else {
        min.copy(start).min(end).addScalar(-params.width);
        max.copy(start).max(end).addScalar(params.width);
    }
    // 接触带必须进入宽阶段；否则微小正间距时接触消失，重力又把刚体推回穿透状态。
    body.contactTolerance = getRigidBodyTolerance(params);
    min.addScalar(-body.contactTolerance); max.addScalar(body.contactTolerance);
}

export function createPrimitiveContacts() {
    const scratch = Array.from({ length: 16 }, () => new Vector3());
    const polygon = Array.from({ length: 12 }, () => new Vector3());
    const clipped = Array.from({ length: 12 }, () => new Vector3());
    const times = new Float64Array(8);
    const pool = [];
    const contacts = [];
    const order = [];
    const inverse = new Quaternion();
    const sat = { depth: 0, reference: 0, axisA: 0, axisB: 0, normal: new Vector3() };
    let count = 0;
    let candidateCount = 0;

    const emit = (a, b, normal, pointA, pointB) => {
        let contact = pool[count];
        if (!contact) {
            contact = { a: null, b: null, normal: new Vector3(), localA: new Vector3(), localB: new Vector3(),
                pointA: new Vector3(), pointB: new Vector3(), lambda: 0, incoming: 0, frictionBudget: 0, tolerance: 0 };
            pool[count] = contact;
        }
        contact.a = a; contact.b = b;
        contact.tolerance = Math.min(a.contactTolerance, b.contactTolerance);
        contact.normal.copy(normal);
        contact.localA.copy(pointA).sub(a.position).applyQuaternion(inverse.copy(a.quaternion).invert());
        contact.localB.copy(pointB).sub(b.position).applyQuaternion(inverse.copy(b.quaternion).invert());
        contact.lambda = 0; contact.frictionBudget = 0;
        contacts[count++] = contact;
    };

    // 包含点/退化胶囊，平行段使用稳定的端点夹取；返回各段最近点。
    const segmentSegment = (p0, p1, q0, q1, outP, outQ) => {
        const u = scratch[0].subVectors(p1, p0), v = scratch[1].subVectors(q1, q0);
        const w = scratch[2].subVectors(p0, q0);
        const aa = u.lengthSq(), bb = v.lengthSq(), uv = u.dot(v), uw = u.dot(w), vw = v.dot(w);
        let s = aa > EPS ? clamp(-uw / aa, 0, 1) : 0;
        let t = 0;
        if (bb > EPS) {
            const denominator = aa * bb - uv * uv;
            if (denominator > EPS) s = clamp((uv * vw - uw * bb) / denominator, 0, 1);
            t = (uv * s + vw) / bb;
            if (t < 0) { t = 0; s = aa > EPS ? clamp(-uw / aa, 0, 1) : 0; }
            if (t > 1) { t = 1; s = aa > EPS ? clamp((uv - uw) / aa, 0, 1) : 0; }
        }
        outP.copy(p0).addScaledVector(u, s);
        outQ.copy(q0).addScaledVector(v, t);
    };

    const roundedPair = (a, b) => {
        const pa = scratch[3], pb = scratch[4], normal = scratch[5];
        segmentSegment(a.start, a.end, b.start, b.end, pa, pb);
        const distance = normal.subVectors(pb, pa).length(), radius = a.params.width + b.params.width;
        if (distance > radius + Math.min(a.contactTolerance, b.contactTolerance)) return;
        if (distance > EPS) normal.multiplyScalar(1 / distance);
        else {
            normal.subVectors(b.position, a.position);
            if (normal.lengthSq() < EPS) normal.set(1, 0, 0);
            else normal.normalize();
        }
        pa.addScaledVector(normal, a.params.width); pb.addScaledVector(normal, -b.params.width);
        emit(a, b, normal, pa, pb);
    };

    // 分段二次距离：在穿过盒子各边界的时间处分段，逐段求极小值；无需采样或迭代搜索。
    const segmentBox = (rounded, box, outP, outQ) => {
        const local = scratch[0].subVectors(rounded.start, box.position);
        const direction = scratch[1].subVectors(rounded.end, rounded.start);
        const p = scratch[2], d = scratch[6], size = box.halfSize;
        for (let i = 0; i < 3; i += 1) {
            p.setComponent(i, local.dot(box.axes[i])); d.setComponent(i, direction.dot(box.axes[i]));
        }
        let length = 2; times[0] = 0; times[1] = 1;
        for (let i = 0; i < 3; i += 1) {
            if (Math.abs(component(d, i)) < EPS) continue;
            for (const sign of [-1, 1]) {
                const t = (sign * component(size, i) - component(p, i)) / component(d, i);
                if (t > 0 && t < 1) times[length++] = t;
            }
        }
        times.subarray(0, length).sort();
        let best = Infinity, bestTime = 0;
        const evaluate = (t) => {
            let distance = 0;
            for (let i = 0; i < 3; i += 1) {
                const value = component(p, i) + t * component(d, i);
                const offset = value - clamp(value, -component(size, i), component(size, i));
                distance += offset * offset;
            }
            if (distance < best) { best = distance; bestTime = t; }
        };
        for (let j = 0; j < length - 1; j += 1) {
            const mid = (times[j] + times[j + 1]) / 2;
            let numerator = 0, denominator = 0;
            for (let i = 0; i < 3; i += 1) {
                const value = component(p, i) + mid * component(d, i), extent = component(size, i);
                if (Math.abs(value) <= extent) continue;
                numerator += component(d, i) * (component(p, i) - Math.sign(value) * extent);
                denominator += component(d, i) ** 2;
            }
            evaluate(times[j]); evaluate(times[j + 1]);
            if (denominator > EPS) evaluate(clamp(-numerator / denominator, times[j], times[j + 1]));
        }
        outP.copy(rounded.start).addScaledVector(direction, bestTime);
        outQ.copy(box.position);
        for (let i = 0; i < 3; i += 1) outQ.addScaledVector(box.axes[i],
            clamp(component(p, i) + bestTime * component(d, i), -component(size, i), component(size, i)));
        return Math.sqrt(best);
    };

    const roundedBox = (a, b, reversed = false) => {
        const pa = scratch[3], pb = scratch[4], normal = scratch[5];
        const distance = segmentBox(a, b, pa, pb), radius = a.params.width;
        if (distance > radius + Math.min(a.contactTolerance, b.contactTolerance)) return;
        if (distance > EPS) { normal.subVectors(pb, pa).multiplyScalar(1 / distance); pa.addScaledVector(normal, radius); }
        else {
            // 中轴进入盒子时最近距离没有法线：选择能推出整个球/胶囊的最短盒面方向。
            let minimum = Infinity, selected = 0, side = 1;
            for (let i = 0; i < 3; i += 1) {
                const center = scratch[7].subVectors(a.position, b.position).dot(b.axes[i]);
                const extent = Math.abs(a.axes[1].dot(b.axes[i])) * (a.params.shapeType === 2 ? a.params.height / 2 : 0) + radius;
                const negative = center + extent + component(b.halfSize, i);
                const positive = component(b.halfSize, i) - center + extent;
                if (negative < minimum) { minimum = negative; selected = i; side = 1; }
                if (positive < minimum) { minimum = positive; selected = i; side = -1; }
            }
            normal.copy(b.axes[selected]).multiplyScalar(side);
            pa.copy(a.start.dot(normal) > a.end.dot(normal) ? a.start : a.end).addScaledVector(normal, radius);
            pb.copy(pa).addScaledVector(normal, -minimum);
        }
        if (reversed) emit(b, a, scratch[8].copy(normal).negate(), pb, pa);
        else emit(a, b, normal, pa, pb);
    };

    const projection = (body, axis) => body.halfSize.x * Math.abs(axis.dot(body.axes[0]))
        + body.halfSize.y * Math.abs(axis.dot(body.axes[1])) + body.halfSize.z * Math.abs(axis.dot(body.axes[2]));
    const boxSAT = (a, b) => {
        sat.depth = Infinity;
        const tolerance = Math.min(a.contactTolerance, b.contactTolerance);
        const delta = scratch[0].subVectors(b.position, a.position), axis = scratch[1];
        const check = (source, reference, i, j) => {
            const length = source.length();
            if (length < 1e-7) return true;
            axis.copy(source).multiplyScalar(1 / length);
            const distance = delta.dot(axis), depth = projection(a, axis) + projection(b, axis) - Math.abs(distance);
            if (depth < -tolerance) return false;
            if (depth < sat.depth) {
                sat.depth = depth; sat.reference = reference; sat.axisA = i; sat.axisB = j;
                sat.normal.copy(axis).multiplyScalar(distance < 0 ? -1 : 1);
            }
            return true;
        };
        for (let i = 0; i < 3; i += 1) {
            if (!check(a.axes[i], 0, i, -1) || !check(b.axes[i], 1, -1, i)) return false;
        }
        for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
            if (!check(scratch[2].crossVectors(a.axes[i], b.axes[j]), 2, i, j)) return false;
        }
        return true;
    };

    const edge = (body, axis, normal, first, last) => {
        first.copy(body.position);
        for (let i = 0; i < 3; i += 1) if (i !== axis) first.addScaledVector(body.axes[i],
            (body.axes[i].dot(normal) < 0 ? -1 : 1) * component(body.halfSize, i));
        last.copy(first).addScaledVector(body.axes[axis], component(body.halfSize, axis));
        first.addScaledVector(body.axes[axis], -component(body.halfSize, axis));
    };

    const boxPair = (a, b) => {
        if (!boxSAT(a, b)) return;
        const normal = sat.normal, pa = scratch[3], pb = scratch[4];
        if (sat.reference === 2) {
            edge(a, sat.axisA, normal, scratch[9], scratch[10]);
            edge(b, sat.axisB, scratch[8].copy(normal).negate(), scratch[11], scratch[12]);
            segmentSegment(scratch[9], scratch[10], scratch[11], scratch[12], pa, pb);
            emit(a, b, normal, pa, pb);
            return;
        }
        const reference = sat.reference === 0 ? a : b, incident = sat.reference === 0 ? b : a;
        const referenceAxis = sat.reference === 0 ? sat.axisA : sat.axisB;
        const faceNormal = scratch[5].copy(normal).multiplyScalar(sat.reference === 0 ? 1 : -1);
        let incidentAxis = 0;
        for (let i = 1; i < 3; i += 1) if (Math.abs(incident.axes[i].dot(faceNormal))
            > Math.abs(incident.axes[incidentAxis].dot(faceNormal))) incidentAxis = i;
        const center = scratch[6].copy(incident.position).addScaledVector(incident.axes[incidentAxis],
            (incident.axes[incidentAxis].dot(faceNormal) > 0 ? -1 : 1) * component(incident.halfSize, incidentAxis));
        const u = (incidentAxis + 1) % 3, v = (incidentAxis + 2) % 3;
        for (let i = 0; i < 4; i += 1) polygon[i].copy(center)
            .addScaledVector(incident.axes[u], (i === 0 || i === 3 ? -1 : 1) * component(incident.halfSize, u))
            .addScaledVector(incident.axes[v], (i < 2 ? -1 : 1) * component(incident.halfSize, v));
        let length = 4;
        for (let i = 0; i < 3; i += 1) {
            if (i === referenceAxis) continue;
            for (const sign of [-1, 1]) {
                const sideNormal = scratch[7].copy(reference.axes[i]).multiplyScalar(sign);
                const limit = sideNormal.dot(reference.position) + component(reference.halfSize, i);
                let nextLength = 0;
                for (let j = 0; j < length; j += 1) {
                    const first = polygon[j], second = polygon[(j + 1) % length];
                    const d0 = sideNormal.dot(first) - limit, d1 = sideNormal.dot(second) - limit;
                    if (d0 <= 0) clipped[nextLength++].copy(first);
                    if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
                        clipped[nextLength++].copy(first).lerp(second, d0 / (d0 - d1));
                    }
                }
                length = nextLength;
                for (let j = 0; j < length; j += 1) polygon[j].copy(clipped[j]);
            }
        }
        const plane = faceNormal.dot(reference.position) + component(reference.halfSize, referenceAxis);
        for (let i = 0; i < length; i += 1) {
            const separation = faceNormal.dot(polygon[i]) - plane;
            if (separation > Math.min(a.contactTolerance, b.contactTolerance)) continue;
            const projected = scratch[8].copy(polygon[i]).addScaledVector(faceNormal, -separation);
            if (sat.reference === 0) emit(a, b, normal, projected, polygon[i]);
            else emit(a, b, normal, polygon[i], projected);
        }
    };

    const handlers = { '0:0': roundedPair, '0:2': roundedPair, '2:0': roundedPair, '2:2': roundedPair,
        '0:1': roundedBox, '2:1': roundedBox, '1:0': (a, b) => roundedBox(b, a, true),
        '1:2': (a, b) => roundedBox(b, a, true), '1:1': boxPair };
    const scan = (bodies, excluded) => {
        count = 0; candidateCount = 0;
        order.length = bodies.length;
        for (let i = 0; i < bodies.length; i += 1) { prepareCollisionBody(bodies[i]); order[i] = bodies[i]; }
        // 沿X轴排序并提前结束，避免对所有PMX刚体进行完整的二次方窄阶段检查。
        order.sort((a, b) => a.min.x - b.min.x || a.index - b.index);
        for (let i = 0; i < order.length; i += 1) {
            const a = order[i];
            for (let j = i + 1; j < order.length && order[j].min.x <= a.max.x; j += 1) {
                const b = order[j];
                if ((!a.dynamic && !b.dynamic) || a.min.y > b.max.y || a.max.y < b.min.y
                    || a.min.z > b.max.z || a.max.z < b.min.z) continue;
                if (!(a.params.groupTarget & (1 << b.params.groupIndex))
                    || !(b.params.groupTarget & (1 << a.params.groupIndex))) continue;
                if (excluded.has(Math.min(a.index, b.index) * bodies.length + Math.max(a.index, b.index))) continue;
                candidateCount += 1;
                handlers[a.params.shapeType + ':' + b.params.shapeType](a, b);
            }
        }
        contacts.length = count;
        return contacts;
    };
    return { scan, get candidateCount() { return candidateCount; }, dispose() {
        contacts.length = 0; pool.length = 0; order.length = 0;
    } };
}

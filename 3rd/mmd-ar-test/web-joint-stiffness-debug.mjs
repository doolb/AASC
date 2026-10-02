// 关节诊断只读PMX参数与真实刚体姿态，不参与求解、骨骼回写或角色场景渲染。
const AXES = ['X', 'Y', 'Z'];
const RAMP = [0x3b82f6, 0x22d3ee, 0xfacc15, 0xff5a5a];
const ZERO_COLOR = '#9ca3af';
const finiteVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const numberText = value => Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—';
const degrees = value => value * 180 / Math.PI;

function stiffnessScale(values) {
    const positive = values.filter(value => Number.isFinite(value) && value > 0);
    return positive.length ? positive.reduce((result, value) => ({ min: Math.min(result.min, value),
        max: Math.max(result.max, value) }), { min: Infinity, max: 0 }) : null;
}

export function jointStiffnessColor(value, scale) {
    if (!(value > 0) || !scale) return ZERO_COLOR;
    const ratio = scale.min === scale.max ? 0.5
        : Math.max(0, Math.min(1, (Math.log(value) - Math.log(scale.min)) / (Math.log(scale.max) - Math.log(scale.min))));
    const step = ratio * (RAMP.length - 1);
    const index = Math.min(RAMP.length - 2, Math.floor(step));
    const mix = shift => Math.round(((RAMP[index] >> shift) & 255)
        + (((RAMP[index + 1] >> shift) & 255) - ((RAMP[index] >> shift) & 255)) * (step - index));
    return '#' + ((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0');
}

function limitText(lower, upper, angular) {
    const value = angular ? degrees : value => value;
    if (lower > upper) return numberText(value(lower)) + '～' + numberText(value(upper)) + ' 自由';
    if (lower === upper) return '锁 ' + numberText(value(lower));
    return numberText(value(lower)) + '～' + numberText(value(upper));
}

export function createJointStiffnessDebug({ THREE, scene, getSelectedBoneIndex }) {
    const unit = new THREE.Vector3(1, 1, 1);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const physicalSpace = new THREE.Matrix4();
    const space = new THREE.Matrix4();
    const anchorA = new THREE.Vector3();
    const anchorB = new THREE.Vector3();
    const frameA = new THREE.Quaternion();
    const frameB = new THREE.Quaternion();
    const relative = new THREE.Quaternion();
    const angle = new THREE.Euler(0, 0, 0, 'XYZ');
    const frameMatrix = new THREE.Matrix4();
    const frameOffset = new THREE.Matrix4();
    const color = new THREE.Color();
    const markerCoordinates = [0, 0, 0];
    const markerNext = [0, 0, 0];
    let model = null;
    let physics = null;
    let enabled = false;
    let active = false;
    let axisBatch = null;
    let markerBatch = null;
    let layoutDirty = true;
    let axisLength = 0;
    let graphJointCount = 0;
    let markerVertices = 0;
    let entries = [];
    let filtered = [];
    let bodyData = [];
    let translationScale = null;
    let rotationScale = null;
    let selection = null;
    let generation = 0;
    let poseError = '';
    const readRotation = values => new THREE.Quaternion().setFromEuler(new THREE.Euler(...values, 'XYZ'));

    const hide = () => {
        active = false; graphJointCount = 0; markerVertices = 0;
        if (axisBatch) axisBatch.mesh.visible = false;
        if (markerBatch) markerBatch.mesh.visible = false;
    };
    const release = () => {
        for (const batch of [axisBatch, markerBatch]) {
            if (!batch) continue;
            scene.remove(batch.mesh); batch.geometry.dispose(); batch.material.dispose();
        }
        axisBatch = null; markerBatch = null; layoutDirty = true;
    };
    const filter = () => {
        const selected = getSelectedBoneIndex();
        if (selection === selected) return;
        selection = selected; layoutDirty = true;
        filtered = selected < 0 ? entries : entries.filter(entry => entry.ownerBoneIndex === selected);
    };

    const setModel = next => {
        hide(); release(); model = next; physics = null; entries = []; filtered = []; bodyData = [];
        translationScale = null; rotationScale = null; selection = null; poseError = ''; generation += 1;
        if (!model) return;
        const mmd = model.geometry?.userData?.MMD || {};
        const bones = mmd.bones || model.geometry?.bones || [];
        // 加载器保存的中立骨骼坐标不受动画影响；逐层累加，避免临时调用pose污染角色。
        const restPositions = bones.map((bone, index) => {
            const result = new THREE.Vector3();
            const visited = new Set();
            let current = index;
            while (bones[current] && !visited.has(current)) {
                visited.add(current);
                if (finiteVector(bones[current].pos)) result.add(new THREE.Vector3(...bones[current].pos));
                current = bones[current].parent;
            }
            return result;
        });
        bodyData = (mmd.rigidBodies || []).map(params => {
            const valid = finiteVector(params.position) && finiteVector(params.rotation);
            const q = valid ? readRotation(params.rotation) : new THREE.Quaternion();
            const p = valid ? new THREE.Vector3(...params.position) : new THREE.Vector3();
            p.add(restPositions[params.boneIndex] || new THREE.Vector3());
            return { params, valid, boneIndex: params.boneIndex, p, q,
                position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), available: false,
                offset: new THREE.Matrix4().compose(valid ? new THREE.Vector3(...params.position) : new THREE.Vector3(), q, unit) };
        });
        // 关节显示归属于链的下游骨骼；选择父骨骼时不再把下一节也画出来。
        // 按祖先关系判断，反向填写A/B的PMX仍归到同一骨骼；无亲缘时默认第二端。
        const isAncestor = (ancestor, child) => {
            const visited = new Set();
            let current = bones[child]?.parent;
            while (Number.isInteger(current) && current >= 0 && !visited.has(current)) {
                if (current === ancestor) return true;
                visited.add(current); current = bones[current]?.parent;
            }
            return false;
        };
        const ownerBone = (a, b) => {
            if (a === b || b < 0) return a;
            if (a < 0) return b;
            return isAncestor(b, a) ? a : b;
        };
        for (const [index, params] of (mmd.constraints || []).entries()) {
            const a = params.rigidBodyIndex1; const b = params.rigidBodyIndex2;
            const keys = ['position', 'rotation', 'springPosition', 'springRotation', 'translationLimitation1',
                'translationLimitation2', 'rotationLimitation1', 'rotationLimitation2'];
            if (!Number.isInteger(a) || !Number.isInteger(b) || !bodyData[a]?.valid || !bodyData[b]?.valid
                || keys.some(key => !finiteVector(params[key]))) continue;
            const p = new THREE.Vector3(...params.position); const q = readRotation(params.rotation);
            const inverseA = bodyData[a].q.clone().invert(); const inverseB = bodyData[b].q.clone().invert();
            entries.push({ index, a, b, params, ownerBoneIndex: ownerBone(bodyData[a].boneIndex, bodyData[b].boneIndex), name: params.name || ('关节 #' + index),
                relation: (bodyData[a].params.name || ('刚体 #' + a)) + ' ↔ ' + (bodyData[b].params.name || ('刚体 #' + b)),
                localA: p.clone().sub(bodyData[a].p).applyQuaternion(inverseA),
                localB: p.clone().sub(bodyData[b].p).applyQuaternion(inverseB),
                rotationA: inverseA.multiply(q), rotationB: inverseB.multiply(q),
                translationLimits: AXES.map((axis, i) => axis + ' ' + limitText(params.translationLimitation1[i], params.translationLimitation2[i], false)),
                rotationLimits: AXES.map((axis, i) => axis + ' ' + limitText(params.rotationLimitation1[i], params.rotationLimitation2[i], true)) });
        }
        translationScale = stiffnessScale(entries.flatMap(entry => entry.params.springPosition));
        rotationScale = stiffnessScale(entries.flatMap(entry => entry.params.springRotation));
        for (const entry of entries) {
            entry.rows = [entry.params.springPosition, entry.params.springRotation].map((values, row) =>
                values.map((value, i) => ({ text: AXES[i] + ' ' + numberText(value), value,
                    color: jointStiffnessColor(value, row === 0 ? translationScale : rotationScale) })));
            entry.limitRows = [entry.translationLimits.join(' · '), entry.rotationLimits.join(' · ') + ' °'];
            entry.actual = { index: entry.index, status: '未模拟', translation: null, rotation: null };
            entry.actualTranslation = [0, 0, 0]; entry.actualRotation = [0, 0, 0];
            // 面板快照不暴露大型几何数组或借用的物理对象。
            entry.description = { index: entry.index, ownerBoneIndex: entry.ownerBoneIndex, name: entry.name, relation: entry.relation,
                rows: entry.rows, limitRows: entry.limitRows };
        }
        filter();
    };

    const updateSpace = () => {
        model.updateWorldMatrix(true, true);
        model.matrixWorld.decompose(position, rotation, scale);
        const nonUnit = [scale.x, scale.y, scale.z].some(value => Math.abs(value - 1) > 0.001);
        // 与现有刚体诊断和MMDPhysics的非单位缩放分支一致。
        if (nonUnit) physicalSpace.compose(model.position, model.quaternion, unit);
        else physicalSpace.compose(position, rotation, unit);
        space.copy(model.matrixWorld).multiply(physicalSpace.invert());
    };

    const readPose = (index, nativeRotation) => {
        const data = bodyData[index];
        if (data.available) return true;
        if (!physics || physics.disposed) return false;
        if (physics.engine === 'xpbd') data.available = physics.getBodyPose(index, data.position, data.quaternion);
        else {
            const body = physics.bodies?.[index]?.body;
            if (!body || !nativeRotation) return false;
            // 下列对象均为借用引用；只归还manager分配的输出四元数。
            const transform = body.getCenterOfMassTransform(); const origin = transform.getOrigin();
            transform.getBasis().getRotation(nativeRotation);
            data.position.set(origin.x(), origin.y(), origin.z());
            data.quaternion.set(nativeRotation.x(), nativeRotation.y(), nativeRotation.z(), nativeRotation.w());
            data.available = true;
        }
        data.available = !!data.available && Number.isFinite(data.position.x) && Number.isFinite(data.position.y)
            && Number.isFinite(data.position.z) && Number.isFinite(data.quaternion.x) && Number.isFinite(data.quaternion.y)
            && Number.isFinite(data.quaternion.z) && Number.isFinite(data.quaternion.w);
        return data.available;
    };

    const withPoses = action => {
        for (const data of bodyData) data.available = false;
        let nativeRotation = null;
        poseError = '';
        try {
            if (physics?.manager && !physics.disposed) nativeRotation = physics.manager.allocQuaternion();
            return action(nativeRotation);
        } catch (error) { poseError = '姿态暂不可用'; return null; }
        finally { if (nativeRotation) physics.manager.freeQuaternion(nativeRotation); }
    };

    const frames = entry => {
        const actual = physics?.engine === 'xpbd' ? physics.constraints?.[entry.index] : null;
        return actual?.localA && actual?.rotationA ? actual : entry;
    };

    // 轴/限位和实际标记各一个批次，避免每关节产生独立draw call。
    // 局部模板只在模型、选择或尺寸变化时生成；每帧只变换位置缓冲。
    const ensureBatch = (batch, count, name, order) => {
        if (batch && batch.capacity >= count) return batch;
        if (batch) { scene.remove(batch.mesh); batch.geometry.dispose(); batch.material.dispose(); }
        const geometry = new THREE.BufferGeometry();
        const capacity = Math.max(1, count);
        const positions = new Float32Array(capacity * 3); const colors = new Float32Array(capacity * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
        // 球默认属于透明队列；轴也进入该队列再按renderOrder最后绘制。
        // opacity保持1，只调整队列，不让K轴变淡；跨不透明/透明队列的renderOrder无效。
        const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1,
            depthTest: false, depthWrite: false, toneMapped: false });
        const mesh = new THREE.LineSegments(geometry, material);
        mesh.name = name; mesh.renderOrder = order; mesh.frustumCulled = false; mesh.visible = false;
        scene.add(mesh);
        return { geometry, material, mesh, capacity, positions, colors };
    };

    const template = (entry, length) => {
        const positions = []; const colors = []; const spans = [];
        const point = (axis, value, u = 0, v = 0) => {
            const result = [0, 0, 0];
            result[axis] = value; result[(axis + 1) % 3] = u; result[(axis + 2) % 3] = v;
            return result;
        };
        const line = (a, b, tint) => { positions.push(...a, ...b); colors.push(...tint, ...tint); };
        const circlePoint = (axis, radius, theta) => point(axis, 0, radius * Math.cos(theta), radius * Math.sin(theta));
        const arc = (axis, radius, from, to, tint, dashed = false) => {
            const steps = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI * 2) * 64));
            for (let step = 0; step < steps; step += 1) {
                if (dashed && step % 2) continue;
                line(circlePoint(axis, radius, from + (to - from) * step / steps),
                    circlePoint(axis, radius, from + (to - from) * (step + 1) / steps), tint);
            }
        };
        const tick = (axis, value, tint) => line(point(axis, value, length * 0.075 - length * 0.06),
            point(axis, value, length * 0.075 + length * 0.06), tint);
        const lock = (axis, value, tint) => {
            const center = point(axis, value, length * 0.075);
            const u = (axis + 1) % 3; const v = (axis + 2) % 3; const size = length * 0.075;
            const points = [[size, 0], [0, size], [-size, 0], [0, -size]].map(([a, b]) => {
                const p = center.slice(); p[u] += a; p[v] += b; return p;
            });
            for (let i = 0; i < 4; i += 1) line(points[i], points[(i + 1) % 4], tint);
        };
        const radialTick = (axis, radius, theta, tint) => line(circlePoint(axis, radius - length * 0.055, theta),
            circlePoint(axis, radius + length * 0.055, theta), tint);
        for (let axis = 0; axis < 3; axis += 1) {
            const linearColor = color.set(entry.rows[0][axis].color).toArray();
            const angularColor = color.set(entry.rows[1][axis].color).toArray();
            const tip = length * 1.25;
            line(point(axis, 0), point(axis, tip), linearColor);
            line(point(axis, tip), point(axis, tip - length * 0.16, length * 0.08), linearColor);
            line(point(axis, tip), point(axis, tip - length * 0.16, -length * 0.08), linearColor);
            // 一/二/三条短刻度识别XYZ，颜色专门表达K，避免与传统XYZ色冲突。
            for (let i = 0; i <= axis; i += 1) line(point(axis, length * (0.22 + i * 0.08), -length * 0.035),
                point(axis, length * (0.22 + i * 0.08), length * 0.035), linearColor);
            const lower = entry.params.translationLimitation1[axis]; const upper = entry.params.translationLimitation2[axis];
            const span = lower <= upper ? Math.max(length, Math.abs(lower), Math.abs(upper)) : length;
            spans.push(span);
            const lo = lower / span * length; const hi = upper / span * length;
            if (lower > upper) {
                for (let i = 0; i < 16; i += 2) line(point(axis, -length + i / 8 * length, length * 0.075),
                    point(axis, -length + (i + 1) / 8 * length, length * 0.075), linearColor);
            } else if (lower === upper) lock(axis, lo, linearColor);
            else {
                line(point(axis, lo, length * 0.075), point(axis, hi, length * 0.075), linearColor);
                tick(axis, lo, linearColor); tick(axis, hi, linearColor);
            }
            const radius = length * (0.54 + axis * 0.18);
            const end = Math.PI * 1.5;
            arc(axis, radius, 0, end, angularColor);
            const arrow = circlePoint(axis, radius, end);
            const inner = circlePoint(axis, radius - length * 0.07, end - 0.15);
            const outer = circlePoint(axis, radius + length * 0.07, end - 0.15);
            line(arrow, inner, angularColor); line(arrow, outer, angularColor);
            const angularLower = entry.params.rotationLimitation1[axis]; const angularUpper = entry.params.rotationLimitation2[axis];
            const limitRadius = radius + length * 0.035;
            if (angularLower > angularUpper) arc(axis, limitRadius, 0, Math.PI * 2, angularColor, true);
            else if (angularLower === angularUpper) {
                // 切向/径向四边形表示锁定角，零度也可见。
                const center = circlePoint(axis, limitRadius, angularLower);
                const before = circlePoint(axis, limitRadius, angularLower - 0.1);
                const after = circlePoint(axis, limitRadius, angularLower + 0.1);
                const outside = center.map(value => value * (1 + length * 0.055 / limitRadius));
                const inside = center.map(value => value * (1 - length * 0.055 / limitRadius));
                line(before, outside, angularColor); line(outside, after, angularColor);
                line(after, inside, angularColor); line(inside, before, angularColor);
            } else {
                arc(axis, limitRadius, angularLower, Math.min(angularUpper, angularLower + Math.PI * 2), angularColor);
                radialTick(axis, limitRadius, angularLower, angularColor); radialTick(axis, limitRadius, angularUpper, angularColor);
            }
        }
        return { length, positions: new Float32Array(positions), colors: new Float32Array(colors), spans };
    };

    const resetActual = entry => {
        entry.actual.status = physics && !physics.disposed ? '姿态暂不可用' : '未模拟';
        entry.actual.translation = null; entry.actual.rotation = null;
    };
    const readActual = (entry, nativeRotation) => {
        resetActual(entry);
        if (!readPose(entry.a, nativeRotation) || !readPose(entry.b, nativeRotation)) return false;
        const a = bodyData[entry.a]; const b = bodyData[entry.b]; const frame = frames(entry);
        anchorA.copy(frame.localA).applyQuaternion(a.quaternion).add(a.position);
        anchorB.copy(frame.localB).applyQuaternion(b.quaternion).add(b.position);
        frameA.copy(a.quaternion).multiply(frame.rotationA); frameB.copy(b.quaternion).multiply(frame.rotationB);
        relative.copy(frameA).invert(); position.copy(anchorB).sub(anchorA).applyQuaternion(relative);
        relative.multiply(frameB); angle.setFromQuaternion(relative, 'XYZ');
        position.toArray(entry.actualTranslation);
        entry.actualRotation[0] = degrees(angle.x); entry.actualRotation[1] = degrees(angle.y); entry.actualRotation[2] = degrees(angle.z);
        entry.actual.status = '实际'; entry.actual.translation = entry.actualTranslation; entry.actual.rotation = entry.actualRotation;
        return true;
    };

    // 使用同一个矩阵映射局部轴/限位/实际标记，保证模型缩放旋转后一致。
    const worldVertex = (target, offset, x, y, z, elements) => {
        target[offset] = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
        target[offset + 1] = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
        target[offset + 2] = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
    };
    const markerLine = (axis, a, u, v, b, bu, bv, tint) => {
        const elements = frameMatrix.elements;
        const coordinates = markerCoordinates; const next = markerNext;
        coordinates.fill(0); next.fill(0);
        coordinates[axis] = a; coordinates[(axis + 1) % 3] = u; coordinates[(axis + 2) % 3] = v;
        next[axis] = b; next[(axis + 1) % 3] = bu; next[(axis + 2) % 3] = bv;
        const offset = markerVertices * 3;
        worldVertex(markerBatch.positions, offset, ...coordinates, elements);
        worldVertex(markerBatch.positions, offset + 3, ...next, elements);
        markerBatch.colors.set(tint, offset); markerBatch.colors.set(tint, offset + 3); markerVertices += 2;
    };
    const WHITE = [1, 1, 1]; const RED = [1, 0.04, 0.04];
    const outside = (value, lower, upper) => lower <= upper && (value < lower - 1e-4 || value > upper + 1e-4);
    const drawActual = entry => {
        const length = axisLength; const size = length * 0.07;
        for (let axis = 0; axis < 3; axis += 1) {
            const raw = entry.actualTranslation[axis]; const span = entry.template.spans[axis];
            const distance = Math.max(-1.25, Math.min(1.25, raw / span)) * length;
            const tint = Math.abs(raw / span) > 1.25 || outside(raw,
                entry.params.translationLimitation1[axis], entry.params.translationLimitation2[axis]) ? RED : WHITE;
            markerLine(axis, distance, -size, 0, distance, size, 0, tint);
            markerLine(axis, distance, 0, -size, distance, 0, size, tint);
            const theta = entry.actualRotation[axis] * Math.PI / 180;
            const radius = length * (0.54 + axis * 0.18);
            const angularTint = outside(theta, entry.params.rotationLimitation1[axis], entry.params.rotationLimitation2[axis]) ? RED : WHITE;
            const c = Math.cos(theta); const s = Math.sin(theta);
            markerLine(axis, 0, 0, 0, 0, radius * c, radius * s, angularTint);
            markerLine(axis, 0, (radius - size) * c, (radius - size) * s, 0, (radius + size) * c, (radius + size) * s, angularTint);
            markerLine(axis, 0, radius * c - size * s, radius * s + size * c,
                0, radius * c + size * s, radius * s - size * c, angularTint);
        }
    };

    const render = (visible, length) => {
        if (!enabled || !visible || !model) { hide(); return; }
        active = true; filter(); graphJointCount = 0; markerVertices = 0;
        if (!filtered.length) {
            if (axisBatch) axisBatch.mesh.visible = false;
            if (markerBatch) markerBatch.mesh.visible = false;
            return;
        }
        const nextLength = Number.isFinite(length) && length > 0 ? length : 0.1;
        if (axisLength !== nextLength) { axisLength = nextLength; layoutDirty = true; }
        if (layoutDirty) {
            let count = 0;
            for (const entry of filtered) {
                if (entry.template?.length !== axisLength) entry.template = template(entry, axisLength);
                count += entry.template.positions.length / 3;
            }
            axisBatch = ensureBatch(axisBatch, count, 'mmd-ar-joint-axes', 100);
            markerBatch = ensureBatch(markerBatch, filtered.length * 30, 'mmd-ar-joint-actual', 101);
            let offset = 0;
            for (const entry of filtered) { axisBatch.colors.set(entry.template.colors, offset); offset += entry.template.colors.length; }
            axisBatch.geometry.setDrawRange(0, count); axisBatch.geometry.attributes.color.needsUpdate = true;
            layoutDirty = false;
        }
        updateSpace();
        for (const entry of filtered) resetActual(entry);
        const succeeded = withPoses(nativeRotation => {
            let offset = 0;
            for (const entry of filtered) {
                const a = bodyData[entry.a]; const frame = frames(entry);
                if (readPose(entry.a, nativeRotation)) {
                    anchorA.copy(frame.localA).applyQuaternion(a.quaternion).add(a.position);
                    frameA.copy(a.quaternion).multiply(frame.rotationA);
                    frameMatrix.compose(anchorA, frameA, unit).premultiply(space);
                } else {
                    const bone = model.skeleton?.bones?.[a.boneIndex];
                    frameMatrix.copy(bone?.matrixWorld || model.matrixWorld).multiply(a.offset);
                    frameOffset.compose(entry.localA, entry.rotationA, unit); frameMatrix.multiply(frameOffset);
                }
                const values = entry.template.positions; const elements = frameMatrix.elements;
                for (let i = 0; i < values.length; i += 3) worldVertex(axisBatch.positions, offset + i, values[i], values[i + 1], values[i + 2], elements);
                offset += values.length; graphJointCount += 1;
                if (selection >= 0 && readActual(entry, nativeRotation)) drawActual(entry);
            }
            return true;
        });
        axisBatch.mesh.visible = succeeded === true;
        axisBatch.geometry.attributes.position.needsUpdate = true;
        if (!succeeded) { markerVertices = 0; for (const entry of filtered) resetActual(entry); }
        markerBatch.geometry.setDrawRange(0, markerVertices); markerBatch.mesh.visible = markerVertices > 0;
        if (markerVertices) {
            markerBatch.geometry.attributes.position.needsUpdate = true;
            markerBatch.geometry.attributes.color.needsUpdate = true;
        }
    };

    // 图形每帧已经读取姿态；面板只取缓存，隐藏面板不会触发额外物理读取。
    const getState = () => {
        filter();
        return { enabled, active, generation, selectedBoneIndex: selection, representation: 'axes',
            graphJointCount, markerVertices, poseError, translationScale, rotationScale,
            entries: filtered.map(entry => entry.description),
            actual: enabled && active && selection >= 0 ? filtered.map(entry => entry.actual) : [] };
    };

    return Object.freeze({ setModel, render, hide, getState,
        setVisible: value => { enabled = value === true; if (!enabled) hide(); return enabled; },
        observePhysics: next => {
            if (physics === next) return;
            physics = next; for (const entry of entries) resetActual(entry);
        },
        dispose: () => { hide(); setModel(null); release(); } });
}

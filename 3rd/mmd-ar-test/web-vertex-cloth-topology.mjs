import { weldClothSeams } from './web-vertex-cloth-seams.mjs';
// PMX物理骨骼与网格拓扑只读分析；不按名称猜布料，也不沿动态后代传播固定状态。
const EPS = 1e-8;
const THRESHOLD = 0.5;
function unionFind(count) {
    const parent = Int32Array.from({ length: count }, (_, i) => i);
    const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    return { root, join(a, b) { a = root(a); b = root(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); } };
}
function signature(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16);
}
const locked = (joint) => ['translation', 'rotation'].every((kind) => {
    const low = joint[kind + 'Limitation1'], high = joint[kind + 'Limitation2'];
    return low?.length === 3 && high?.length === 3 && low.every((value, i) => Math.abs(value - high[i]) < EPS);
});

// 同一动态链统一启用局部修正；原骨骼驱动始终保留，自由附件另建立表面附着。
function assignDriveFamilies(groups, components) {
    const sets = unionFind(groups.length), byComponent = new Map();
    groups.forEach((group, index) => {
        for (const bone of group.driveBones) {
            const component = components.root(bone);
            if (byComponent.has(component)) sets.join(index, byComponent.get(component));
            else byComponent.set(component, index);
        }
    });
    const families = new Map();
    groups.forEach((group, index) => {
        const key = sets.root(index);
        if (!families.has(key)) families.set(key, []);
        families.get(key).push(group);
    });
    for (const family of families.values()) {
        const relatedGroups = family.map(group => group.id);
        for (const group of family) {
            group.relatedGroups = relatedGroups;
            group.blockedReason = group.fixedCount === group.pins.length ? '全固定区域，沿用原骨骼' : '';
        }
    }
}

export function resolveVertexClothEnabled(topology, requested) {
    return new Set(topology.groups.filter(group => !group.blockedReason
        && group.relatedGroups.every(id => requested.has(id))).map(group => group.id));
}

export function buildVertexClothTopology(geometry, skeleton, materials) {
    const data = geometry.userData.MMD, bodies = data.rigidBodies, joints = data.constraints || [];
    const bones = skeleton.bones, dynamic = new Set(), fixed = new Set(), staticBodies = new Set();
    const components = unionFind(bones.length);
    bodies.forEach((body, index) => {
        if (body.type === 0 || !(body.weight > 0)) {
            staticBodies.add(index); if (body.boneIndex >= 0) fixed.add(body.boneIndex); return;
        }
        if (body.boneIndex >= 0 && body.boneIndex < bones.length) dynamic.add(body.boneIndex);
    });
    // 直接根部的非零锁值同样固定；只查询原静态集合，末端不会被递归变为静态。
    for (const joint of joints) {
        const a = joint.rigidBodyIndex1, b = joint.rigidBodyIndex2;
        if (!bodies[a] || !bodies[b]) continue;
        const ba = bodies[a].boneIndex, bb = bodies[b].boneIndex;
        if (dynamic.has(ba) && dynamic.has(bb)) components.join(ba, bb);
        if (!locked(joint)) continue;
        if (staticBodies.has(a) && dynamic.has(bb)) fixed.add(bb);
        if (staticBodies.has(b) && dynamic.has(ba)) fixed.add(ba);
    }
    const boneIndices = new Map(bones.map((bone, i) => [bone, i]));
    for (const index of dynamic) {
        const parent = boneIndices.get(bones[index].parent);
        if (dynamic.has(parent)) components.join(index, parent);
    }
    const position = geometry.attributes.position, skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
    if (!geometry.index || !skinIndex || !skinWeight) throw new Error('顶点布料需要带索引及蒙皮权重的PMX网格');
    const weights = new Float32Array(position.count), pinned = new Uint8Array(position.count);
    const component = new Int32Array(position.count).fill(-1), weld = new Int32Array(position.count);
    const weldKeys = new Map(), boneWeights = new Array(position.count);
    let geometryHash = signature(bones.map((bone) => bone.name).join('|'));
    for (let vertex = 0; vertex < position.count; vertex++) {
        const influences = new Map(); let fixedWeight = 0, best = 0;
        for (let axis = 0; axis < 4; axis++) {
            const index = skinIndex.getComponent(vertex, axis), weight = skinWeight.getComponent(vertex, axis);
            if (!(weight > EPS)) continue;
            influences.set(index, (influences.get(index) || 0) + weight);
            if (fixed.has(index)) fixedWeight += weight;
            if (!dynamic.has(index)) continue;
            weights[vertex] += weight;
            if (weight > best) { best = weight; component[vertex] = components.root(index); }
        }
        boneWeights[vertex] = [...influences.keys()].filter((index) => dynamic.has(index));
        pinned[vertex] = weights[vertex] < THRESHOLD || fixedWeight >= THRESHOLD ? 1 : 0;
        const sum = [...influences.values()].reduce((a, b) => a + b, 0) || 1;
        const skinKey = [...influences].sort((a, b) => a[0] - b[0])
            .map(([index, weight]) => index + ':' + Math.round(weight / sum * 1e6)).join(',');
        const key = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
            .map((value) => Math.round(value * 1e5)).join(',') + '|' + skinKey;
        if (!weldKeys.has(key)) weldKeys.set(key, weldKeys.size);
        weld[vertex] = weldKeys.get(key); geometryHash = signature(geometryHash + '|' + key);
    }
    const seamCount = weldClothSeams(geometry, weld, component);
    const indices = geometry.index.array, candidates = [], materialForTriangle = new Int32Array(indices.length / 3);
    for (const group of geometry.groups) materialForTriangle.fill(group.materialIndex, group.start / 3, (group.start + group.count) / 3);
    for (let offset = 0; offset < indices.length; offset += 3) {
        const vertices = [indices[offset], indices[offset + 1], indices[offset + 2]];
        let dominant = vertices[0];
        for (const vertex of vertices) if (weights[vertex] > weights[dominant]) dominant = vertex;
        if (weights[dominant] < THRESHOLD) continue;
        if (new Set(vertices.map((vertex) => weld[vertex])).size !== 3) continue;
        const a = vertices[0] * 3, b = vertices[1] * 3, c = vertices[2] * 3, values = position.array;
        const ux = values[b] - values[a], uy = values[b + 1] - values[a + 1], uz = values[b + 2] - values[a + 2];
        const vx = values[c] - values[a], vy = values[c + 1] - values[a + 1], vz = values[c + 2] - values[a + 2];
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < EPS) continue;
        candidates.push({ offset, vertices, component: component[dominant], material: materialForTriangle[offset / 3] });
    }
    const triangleSets = unionFind(candidates.length), adjacent = new Map();
    candidates.forEach((triangle, index) => {
        for (const vertex of triangle.vertices) {
            // 自由顶点被多个骨骼链共用时合组，只共享静态接缝则保持各链独立。
            const key = (weights[vertex] >= THRESHOLD ? 'physical' : triangle.component) + ':' + weld[vertex];
            if (adjacent.has(key)) triangleSets.join(index, adjacent.get(key));
            else adjacent.set(key, index);
        }
    });
    const partitions = new Map();
    candidates.forEach((triangle, index) => {
        const root = triangleSets.root(index);
        if (!partitions.has(root)) partitions.set(root, []);
        partitions.get(root).push(triangle);
    });
    // 模型签名包含拓扑、蒙皮及中性位置，避免两个同顶点数模型误共用组开关。
    let hash = signature(geometryHash + '|' + JSON.stringify(bodies.map((body) => [body.boneIndex, body.type, body.weight > 0]))
        + '|' + joints.map((joint) => [joint.rigidBodyIndex1, joint.rigidBodyIndex2, locked(joint)].join(':')).join('|'));
    for (let vertex = 0; vertex < position.count; vertex++) hash = signature(hash + ':' + weld[vertex] + ':' + component[vertex]);
    for (let i = 0; i < indices.length; i++) hash = signature(hash + ':' + indices[i]);
    const modelKey = position.count + '-' + hash, groups = [], boneGroups = new Map(), driveBoneGroups = new Map(), covered = new Set();
    for (const triangles of partitions.values()) {
        const particles = new Map(), render = new Map(), rawTriangles = [], uniqueTriangles = [], triKeys = new Set(), materialSet = new Set(), groupBones = new Set(), driveBones = new Set();
        const rest = [], pins = [], representatives = [];
        const particle = (vertex) => {
            const key = weld[vertex];
            if (!particles.has(key)) {
                particles.set(key, particles.size); representatives.push(vertex); pins.push(pinned[vertex]);
                rest.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
            }
            const index = particles.get(key);
            if (pinned[vertex] && !pins[index]) representatives[index] = vertex;
            pins[index] = Math.max(pins[index], pinned[vertex]);
            render.set(vertex, index); covered.add(vertex);
            for (const bone of boneWeights[vertex]) {
                groupBones.add(bone);
                if (!pinned[vertex] && !fixed.has(bone)) driveBones.add(bone);
            }
            return index;
        };
        for (const triangle of triangles) {
            const ids = triangle.vertices.map(particle), key = [...ids].sort((a, b) => a - b).join(':');
            rawTriangles.push(...triangle.vertices); materialSet.add(triangle.material);
            if (triKeys.has(key)) continue;
            triKeys.add(key); uniqueTriangles.push(...ids);
        }
        const edges = new Map(), bends = new Map(), mass = new Float32Array(particles.size);
        const distance = (a, b) => Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
        for (let i = 0; i < uniqueTriangles.length; i += 3) {
            const ids = uniqueTriangles.slice(i, i + 3), [a, b, c] = ids.map((id) => id * 3);
            const ux = rest[b] - rest[a], uy = rest[b + 1] - rest[a + 1], uz = rest[b + 2] - rest[a + 2];
            const vx = rest[c] - rest[a], vy = rest[c + 1] - rest[a + 1], vz = rest[c + 2] - rest[a + 2];
            const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
            for (const id of ids) mass[id] += area / 3; // 面密度默认1，正反重叠三角只计一遍质量。
            for (let j = 0; j < 3; j++) {
                const a = ids[j], b = ids[(j + 1) % 3], opposite = ids[(j + 2) % 3], key = Math.min(a, b) + ':' + Math.max(a, b);
                const edge = edges.get(key);
                if (!edge) { edges.set(key, { a, b, opposite }); continue; }
                if (edge.opposite === opposite) continue;
                const keyB = Math.min(opposite, edge.opposite) + ':' + Math.max(opposite, edge.opposite);
                if (!bends.has(keyB)) bends.set(keyB, { a: opposite, b: edge.opposite });
            }
        }
        const pack = (values) => ({ pairs: Uint32Array.from(values.flatMap(({ a, b }) => [a, b])), lengths: Float32Array.from(values.map(({ a, b }) => distance(a, b))) });
        const id = triangles[0].component + '-' + triangles[0].offset;
        const names = [...materialSet].map((index) => materials[index]?.name || '材质' + index);
        const rootName = bones[triangles[0].component]?.name || '物理区域';
        const group = { id, name: rootName + ' · ' + names.slice(0, 3).join('/'), materials: names,
            bones: groupBones, driveBones, rest: Float32Array.from(rest), pins: Uint8Array.from(pins),
            representatives: Uint32Array.from(representatives), vertexIds: Uint32Array.from(render.keys()), particleIds: Uint32Array.from(render.values()),
            triangles: Uint32Array.from(uniqueTriangles), rawTriangles: Uint32Array.from(rawTriangles),
            stretch: pack([...edges.values()]), bend: pack([...bends.values()]),
            inverseMass: Float32Array.from(mass, (value, i) => pins[i] ? 0 : 1 / Math.max(EPS, value)),
            fixedCount: pins.reduce((a, b) => a + b, 0) };
        group.defaultEnabled = group.fixedCount < particles.size;
        groups.push(group);
        for (const bone of driveBones) {
            if (!driveBoneGroups.has(bone)) driveBoneGroups.set(bone, new Set());
            driveBoneGroups.get(bone).add(id);
        }
        for (const bone of groupBones) {
            if (!boneGroups.has(bone)) boneGroups.set(bone, new Set());
            boneGroups.get(bone).add(id);
        }
    }
    // 固定边界不阻塞自由网格；真正遗漏的自由表面才阻止该链被部分替换。
    const uncoveredComponents = new Set();
    for (let vertex = 0; vertex < position.count; vertex++) {
        if (covered.has(vertex)) continue;
        for (const bone of boneWeights[vertex]) {
            if (!boneGroups.has(bone)) boneGroups.set(bone, new Set());
            boneGroups.get(bone).add('__uncovered__');
            if (pinned[vertex] || fixed.has(bone)) continue;
            uncoveredComponents.add(components.root(bone));
            if (!driveBoneGroups.has(bone)) driveBoneGroups.set(bone, new Set());
            driveBoneGroups.get(bone).add('__uncovered__');
        }
    }
    assignDriveFamilies(groups, components);
    geometry.computeBoundingBox();
    const height = Math.max(0.001, geometry.boundingBox.max.y - geometry.boundingBox.min.y);
    return { groups, modelKey, bodies, joints, boneGroups, driveBoneGroups, height, seamCount, threshold: THRESHOLD };
}

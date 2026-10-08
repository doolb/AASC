import { DataTexture, FloatType, RGBAFormat, NearestFilter } from 'three';

export function textureShape(count, limit) {
    const width = Math.min(limit, Math.max(1, Math.ceil(Math.sqrt(count))));
    const height = Math.max(1, Math.ceil(count / width));
    if (height > limit) throw new Error('顶点布料超出GPU纹理容量');
    return { width, height };
}
export function floatTexture(count, limit) {
    const { width, height } = textureShape(count, limit);
    const texture = new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
    return texture;
}
// 只对自由端着色。多条约束可以共享固定端，但不能共享会被写入的自由端。
export function colorConstraints(group) {
    const used = Array.from({ length: group.pins.length }, () => new Set()), batches = [];
    for (const [constraints, compliance] of [[group.stretch, 0], [group.bend, 0.001]]) {
        const start = batches.length;
        used.forEach(set => set.clear());
        for (let i = 0; i < constraints.lengths.length; i++) {
            const a = constraints.pairs[i * 2], b = constraints.pairs[i * 2 + 1];
            if (!group.inverseMass[a] && !group.inverseMass[b]) continue;
            let color = 0;
            while ((group.inverseMass[a] && used[a].has(color)) || (group.inverseMass[b] && used[b].has(color))) color++;
            const index = start + color;
            if (!batches[index]) batches[index] = [];
            batches[index].push({ a, b, constraints, index: i, compliance });
            if (group.inverseMass[a]) used[a].add(color);
            if (group.inverseMass[b]) used[b].add(color);
        }
    }
    return batches;
}
export function packVectors(texture, values, fourth) {
    const data = texture.image.data; data.fill(0);
    for (let i = 0; i < values.length / 3; i++) {
        data.set(values.subarray(i * 3, i * 3 + 3), i * 4);
        data[i * 4 + 3] = fourth?.[i] || 0;
    }
    texture.needsUpdate = true;
}
export function incidentTriangles(group) {
    const adjacency = Array.from({ length: group.pins.length }, () => []);
    for (let i = 0; i < group.triangles.length; i += 3) {
        const face = Array.from(group.triangles.subarray(i, i + 3));
        for (const vertex of face) adjacency[vertex].push(face);
    }
    return adjacency;
}

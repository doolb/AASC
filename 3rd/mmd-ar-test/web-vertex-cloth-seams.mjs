// 只配对几何边界的两侧，不把空间重合的多层网格全局焊接。
export function weldClothSeams(geometry, weld, component) {
    const p = geometry.attributes.position, indices = geometry.index.array;
    const keys = Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]
        .map(value => Math.round(value * 1e5)).join(','));
    const edges = new Map(), parent = Int32Array.from({ length: p.count }, (_, i) => i);
    const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (a, b) => { a = root(a); b = root(b); parent[Math.max(a, b)] = Math.min(a, b); };
    const delta = (a, b) => [p.getX(a) - p.getX(b), p.getY(a) - p.getY(b), p.getZ(a) - p.getZ(b)];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]];
        if (new Set(tri.map(v => keys[v])).size < 3) continue;
        const normal = cross(delta(tri[1], tri[0]), delta(tri[2], tri[0]));
        for (let k = 0; k < 3; k++) {
            const a = tri[k], b = tri[(k + 1) % 3], c = tri[(k + 2) % 3];
            const key = [weld[a], weld[b]].sort((x, y) => x - y).join(':');
            const edge = edges.get(key);
            if (edge) edge.count++;
            else edges.set(key, { a, b, c, normal, count: 1 });
        }
    }
    const boundaries = new Map();
    for (const edge of edges.values()) {
        if (edge.count !== 1) continue;
        const key = [keys[edge.a], keys[edge.b]].sort().join('|');
        if (!boundaries.has(key)) boundaries.set(key, []);
        boundaries.get(key).push(edge);
    }
    const compatible = (a, b) => {
        if (component[a] !== component[b]) return false;
        for (const morph of geometry.morphAttributes.position || []) {
            for (const axis of ['getX', 'getY', 'getZ']) {
                const da = morph[axis](a) - (geometry.morphTargetsRelative ? 0 : p[axis](a));
                const db = morph[axis](b) - (geometry.morphTargetsRelative ? 0 : p[axis](b));
                if (Math.abs(da - db) > 1e-5) return false;
            }
        }
        return true;
    };
    let seams = 0;
    for (const pair of boundaries.values()) {
        if (pair.length !== 2) continue; // 三层以上交汇不猜测对应关系。
        const [a, b] = pair;
        if (keys[a.a] !== keys[b.b] || keys[a.b] !== keys[b.a] || keys[a.c] === keys[b.c]) continue;
        const length = Math.hypot(...a.normal) * Math.hypot(...b.normal);
        const dot = a.normal.reduce((sum, value, i) => sum + value * b.normal[i], 0);
        if (length < 1e-12 || dot / length < 0) continue; // 反面重复层与折回重叠层不焊。
        if (!compatible(a.a, b.b) || !compatible(a.b, b.a)) continue;
        if (component[a.a] < 0 && component[a.b] < 0) continue;
        join(weld[a.a], weld[b.b]); join(weld[a.b], weld[b.a]); seams++;
    }
    for (let i = 0; i < weld.length; i++) weld[i] = root(weld[i]);
    return seams;
}

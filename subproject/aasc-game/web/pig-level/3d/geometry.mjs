// 通用几何工具：部件合并（顶点色 + 动画部件标记）、噪声球、螺旋管。
import * as THREE from '../vendor/three.module.min.js';

// 动画部件编号，与 models.mjs 着色器注入保持一致。
export const PART = { BODY: 0, EYE: 1, EAR: 2, TAIL: 3, LEG_A: 4, LEG_B: 5, HEAD: 6 };

const tmpColor = new THREE.Color();

// 描述一个部件：几何体、sRGB 颜色、变换矩阵、动画部件编号和枢轴点。
export function part(geometry, color, matrix, partId = PART.BODY, pivot = null) {
    return { geometry, color, matrix, partId, pivot };
}

// 由平移/旋转/缩放组合矩阵的便捷函数。
export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    return m;
}

// 合并全部部件为一个非索引 BufferGeometry：position / normal / uv / color / aPart / aPivot。
export function mergeParts(parts, { withUv = false } = {}) {
    const chunks = parts.map(p => {
        const g = (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone());
        g.applyMatrix4(p.matrix || new THREE.Matrix4());
        return { g, p };
    });
    const total = chunks.reduce((sum, c) => sum + c.g.attributes.position.count, 0);
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    const partIds = new Float32Array(total);
    const pivot = new Float32Array(total * 3);
    const uv = withUv ? new Float32Array(total * 2) : null;
    let offset = 0;
    for (const { g, p } of chunks) {
        const count = g.attributes.position.count;
        position.set(g.attributes.position.array, offset * 3);
        if (g.attributes.normal) normal.set(g.attributes.normal.array, offset * 3);
        if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
        const piv = p.pivot || [0, 0, 0];
        const srcColor = g.attributes.color;
        if (srcColor && !p.color) {
            color.set(srcColor.array, offset * 3);
        } else {
            // Color 构造时把 sRGB 字符串转换为线性分量，顶点色需要线性值。
            tmpColor.set(p.color || '#ffffff');
            for (let i = 0; i < count; i++) {
                const k = (offset + i) * 3;
                color[k] = tmpColor.r; color[k + 1] = tmpColor.g; color[k + 2] = tmpColor.b;
            }
        }
        for (let i = 0; i < count; i++) {
            const k = (offset + i) * 3;
            pivot[k] = piv[0]; pivot[k + 1] = piv[1]; pivot[k + 2] = piv[2];
            partIds[offset + i] = p.partId || 0;
        }
        offset += count;
        g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
    merged.setAttribute('aPart', new THREE.BufferAttribute(partIds, 1));
    merged.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3));
    if (uv) merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
}

// 共享棋盘外围起伏地形高度函数（scenery 地面网格与 grass 外坡草叶共用）。
export function groundHeight(x, z, halfW, halfH) {
    const dx = Math.max(0, Math.abs(x) - (halfW + 3.2));
    const dz = Math.max(0, Math.abs(z) - (halfH + 3.2));
    const dist = Math.hypot(dx, dz);
    const hill = Math.min(1, Math.max(0, (dist - 2) / 20));
    const n = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 1.4 + Math.sin(x * 0.05 + z * 0.07) * 2.2;
    return hill * hill * (2.6 + Math.max(0, n));
}

// 按局部坐标轴对几何体写入线性顶点色渐变（支持底部/侧面深饱和到顶部/前部亮暖色过渡）。
export function shadeGradient(geometry, lowHex, highHex, axis = 'y') {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.attributes.position;
    const axisIdx = axis === 'x' ? 0 : axis === 'z' ? 2 : 1;
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const v = axisIdx === 0 ? pos.getX(i) : axisIdx === 2 ? pos.getZ(i) : pos.getY(i);
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
    }
    const span = Math.max(1e-5, maxV - minV);
    const cLow = new THREE.Color(lowHex);
    const cHigh = new THREE.Color(highHex);
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const v = axisIdx === 0 ? pos.getX(i) : axisIdx === 2 ? pos.getZ(i) : pos.getY(i);
        const t = Math.min(1, Math.max(0, (v - minV) / span));
        c.copy(cLow).lerp(cHigh, t);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
}

// 沿法线外扩生成卡通反面描边网格。
export function outlineOf(geometry, thickness = 0.024) {
    const out = geometry.clone();
    const pos = out.attributes.position;
    const norm = out.attributes.normal;
    if (pos && norm) {
        for (let i = 0; i < pos.count; i++) {
            pos.setXYZ(
                i,
                pos.getX(i) + norm.getX(i) * thickness,
                pos.getY(i) + norm.getY(i) * thickness,
                pos.getZ(i) + norm.getZ(i) * thickness
            );
        }
        pos.needsUpdate = true;
    }
    return out;
}

// 噪声扰动球：用于树冠、灌木、云团、石头；flat 为纵向压扁比例。
export function blobSphere(radius, seed = 1, amp = 0.18, detail = 2, flat = 1) {
    const g = new THREE.IcosahedronGeometry(radius, detail);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = Math.sin(v.x * 3.1 + seed) * Math.cos(v.y * 2.7 + seed * 1.7) * Math.sin(v.z * 3.3 + seed * 0.7);
        v.multiplyScalar(1 + n * amp);
        v.y *= flat;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
}

// 螺旋管：卷尾巴、弹簧。轴向为 +Y。
export function helixTube(radius, turns, height, tube, segments = 48) {
    class Helix extends THREE.Curve {
        getPoint(t, target = new THREE.Vector3()) {
            const a = t * turns * Math.PI * 2;
            return target.set(Math.cos(a) * radius, t * height, Math.sin(a) * radius);
        }
    }
    return new THREE.TubeGeometry(new Helix(), segments, tube, 6, false);
}

// 卷尾：逐渐缩小半径的平面螺线管。
export function curlTail(size = 0.07, tube = 0.022) {
    class Curl extends THREE.Curve {
        getPoint(t, target = new THREE.Vector3()) {
            const a = t * Math.PI * 3.2;
            const r = size * (1 - t * 0.55);
            return target.set(-t * size * 1.2, Math.sin(a) * r + t * size * 0.6, Math.cos(a) * r - r);
        }
    }
    return new THREE.TubeGeometry(new Curl(), 24, tube, 5, false);
}

// 把颜色按高度做明暗渐变（树冠底部变暗），直接改写顶点色。
export function shadeByHeight(geometry, minY, maxY, darken = 0.35) {
    const pos = geometry.attributes.position;
    const col = geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp((pos.getY(i) - minY) / (maxY - minY || 1), 0, 1);
        const k = 1 - darken * (1 - t);
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
    col.needsUpdate = true;
}

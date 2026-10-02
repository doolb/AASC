/*
 * 距离约束参考 Ten Minute Physics 14（small steps，每子步各一遍）。
 * Copyright (c) 2022 Matthias Müller
 * MIT License
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const EPS = 1e-10;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// 纯数值粒子求解。形状缓存由PMX桥接插值，子步不分配Vector3/约束对象。
export class VertexCloth {
    constructor(group, thickness) {
        this.group = group; this.thickness = thickness;
        this.positions = group.rest.slice(); this.previous = group.rest.slice();
        this.velocities = new Float32Array(group.rest.length);
        this.targets = group.rest.slice(); this.previousTargets = group.rest.slice();
        this.forces = new Float32Array(group.rest.length);
        this.contact = new Float32Array(group.rest.length);
        this.surfaceVelocity = new Float32Array(group.rest.length);
        this.contacts = 0;
    }
    reset(targets = this.targets) {
        this.targets.set(targets); this.previousTargets.set(targets);
        this.positions.set(targets); this.previous.set(targets); this.velocities.fill(0);
    }
    beginFrame(targets) { this.previousTargets.set(this.targets); this.targets.set(targets); this.contacts = 0; }
    solveDistances(constraints, compliance, h) {
        const { pairs, lengths } = constraints, positions = this.positions, inverseMass = this.group.inverseMass;
        const alpha = compliance / (h * h);
        for (let index = 0; index < lengths.length; index++) {
            const a = pairs[index * 2], b = pairs[index * 2 + 1], wa = inverseMass[a], wb = inverseMass[b];
            if (wa + wb <= EPS) continue;
            const ia = a * 3, ib = b * 3;
            const dx = positions[ia] - positions[ib], dy = positions[ia + 1] - positions[ib + 1], dz = positions[ia + 2] - positions[ib + 2];
            const distance = Math.hypot(dx, dy, dz);
            if (distance <= EPS) continue;
            const scale = -(distance - lengths[index]) / (wa + wb + alpha) / distance;
            positions[ia] += dx * scale * wa; positions[ia + 1] += dy * scale * wa; positions[ia + 2] += dz * scale * wa;
            positions[ib] -= dx * scale * wb; positions[ib + 1] -= dy * scale * wb; positions[ib + 2] -= dz * scale * wb;
        }
    }
    applyWind(wind) {
        const f = this.forces, p = this.positions, triangles = this.group.triangles;
        f.fill(0);
        if (!(wind.strength > 0)) return;
        for (let i = 0; i < triangles.length; i += 3) {
            const a = triangles[i] * 3, b = triangles[i + 1] * 3, c = triangles[i + 2] * 3;
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
            const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const length = Math.hypot(nx, ny, nz);
            if (length <= EPS) continue;
            // 双面薄片压力：面积及入射投影，面密度参与加速度，背面绕序不改变受风方向。
            const force = 10 * wind.strength * Math.abs(nx * wind.x + ny * wind.y + nz * wind.z) / 6;
            for (let corner = 0; corner < 3; corner++) { const id = triangles[i + corner] * 3; f[id] += force * wind.x; f[id + 1] += force * wind.y; f[id + 2] += force * wind.z; }
        }
    }
    collide(index, collider) {
        const p = this.positions, i = index * 3, t = this.thickness;
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x < collider.min[0] - t || x > collider.max[0] + t || y < collider.min[1] - t
            || y > collider.max[1] + t || z < collider.min[2] - t || z > collider.max[2] + t) return;
        const m = collider.rotation, dx = x - collider.x, dy = y - collider.y, dz = z - collider.z;
        let lx = m[0] * dx + m[1] * dy + m[2] * dz;
        let ly = m[3] * dx + m[4] * dy + m[5] * dz;
        let lz = m[6] * dx + m[7] * dy + m[8] * dz;
        const body = collider.params; let nx = 0, ny = 0, nz = 0, depth = 0;
        if (body.shapeType === 1) {
            const ex = body.width + t, ey = body.height + t, ez = body.depth + t;
            if (Math.abs(lx) >= ex || Math.abs(ly) >= ey || Math.abs(lz) >= ez) return;
            const px = ex - Math.abs(lx), py = ey - Math.abs(ly), pz = ez - Math.abs(lz);
            if (px <= py && px <= pz) { nx = lx >= 0 ? 1 : -1; depth = px; }
            else if (py <= pz) { ny = ly >= 0 ? 1 : -1; depth = py; }
            else { nz = lz >= 0 ? 1 : -1; depth = pz; }
        } else {
            if (body.shapeType === 2) ly -= clamp(ly, -body.height / 2, body.height / 2);
            const distance = Math.hypot(lx, ly, lz), radius = body.width + t;
            if (distance >= radius) return;
            if (distance > EPS) { nx = lx / distance; ny = ly / distance; nz = lz / distance; }
            else nx = 1;
            depth = radius - distance;
        }
        const wx = m[0] * nx + m[3] * ny + m[6] * nz;
        const wy = m[1] * nx + m[4] * ny + m[7] * nz;
        const wz = m[2] * nx + m[5] * ny + m[8] * nz;
        p[i] += wx * depth; p[i + 1] += wy * depth; p[i + 2] += wz * depth;
        this.contact[i] += wx; this.contact[i + 1] += wy; this.contact[i + 2] += wz;
        this.surfaceVelocity[i] = collider.vx; this.surfaceVelocity[i + 1] = collider.vy; this.surfaceVelocity[i + 2] = collider.vz;
        this.contacts++;
    }
    step(h, alpha, gravity, wind, colliders) {
        const p = this.positions, prev = this.previous, v = this.velocities, w = this.group.inverseMass;
        this.applyWind(wind); this.contact.fill(0);
        for (let index = 0; index < w.length; index++) {
            const i = index * 3; prev[i] = p[i]; prev[i + 1] = p[i + 1]; prev[i + 2] = p[i + 2];
            if (w[index] === 0) {
                for (let axis = 0; axis < 3; axis++) p[i + axis] = this.previousTargets[i + axis]
                    + (this.targets[i + axis] - this.previousTargets[i + axis]) * alpha;
                continue;
            }
            v[i] += (gravity.x + this.forces[i] * w[index]) * h;
            v[i + 1] += (gravity.y + this.forces[i + 1] * w[index]) * h;
            v[i + 2] += (gravity.z + this.forces[i + 2] * w[index]) * h;
            p[i] += v[i] * h; p[i + 1] += v[i + 1] * h; p[i + 2] += v[i + 2] * h;
        }
        this.solveDistances(this.group.stretch, 0, h);
        this.solveDistances(this.group.bend, 0.001, h);
        for (let index = 0; index < w.length; index++) if (w[index] > 0) for (const collider of colliders) this.collide(index, collider);
        const damping = Math.exp(-2 * h);
        for (let index = 0; index < w.length; index++) {
            const i = index * 3;
            for (let axis = 0; axis < 3; axis++) v[i + axis] = (p[i + axis] - prev[i + axis]) / h;
            if (w[index] === 0) continue;
            const normal = this.contact, length = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
            if (length > EPS) {
                const nx = normal[i] / length, ny = normal[i + 1] / length, nz = normal[i + 2] / length;
                const relativeX = v[i] - this.surfaceVelocity[i], relativeY = v[i + 1] - this.surfaceVelocity[i + 1], relativeZ = v[i + 2] - this.surfaceVelocity[i + 2];
                const dot = relativeX * nx + relativeY * ny + relativeZ * nz, correction = Math.min(0, dot);
                v[i] -= nx * correction; v[i + 1] -= ny * correction; v[i + 2] -= nz * correction;
                // 少量时间相关切向阻尼，避免硬推离后在代理表面持续高速滑动。
                const friction = -Math.expm1(-8 * h);
                v[i] -= (relativeX - dot * nx) * friction; v[i + 1] -= (relativeY - dot * ny) * friction; v[i + 2] -= (relativeZ - dot * nz) * friction;
            }
            v[i] *= damping; v[i + 1] *= damping; v[i + 2] *= damping;
            if (!Number.isFinite(p[i] + p[i + 1] + p[i + 2])) {
                for (let axis = 0; axis < 3; axis++) { p[i + axis] = this.targets[i + axis]; v[i + axis] = 0; }
            }
        }
    }
}

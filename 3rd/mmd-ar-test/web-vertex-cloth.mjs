import { ClothSelfCollision } from './web-vertex-cloth-self.mjs';
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
        this.self = group.bvh ? new ClothSelfCollision(group, thickness * 2) : null;
    }
    reset(targets = this.targets) {
        this.targets.set(targets); this.previousTargets.set(targets);
        this.positions.set(targets); this.previous.set(targets); this.velocities.fill(0);
    }
    beginFrame(targets, rotations) {
        this.previousTargets.set(this.targets);
        if (rotations) for (let id = 0; id < this.group.pins.length; id++) {
            const start = id * 3, qi = id * 4, qx = rotations[qi], qy = rotations[qi + 1], qz = rotations[qi + 2], qw = rotations[qi + 3];
            for (const values of [this.positions, this.velocities]) {
                const base = values === this.positions ? this.previousTargets : null;
                const x = values[start] - (base?.[start] || 0), y = values[start + 1] - (base?.[start + 1] || 0), z = values[start + 2] - (base?.[start + 2] || 0);
                const tx = 2 * (qy*z-qz*y), ty = 2 * (qz*x-qx*z), tz = 2 * (qx*y-qy*x);
                values[start] = x + qw*tx + qy*tz-qz*ty + (base?.[start] || 0);
                values[start + 1] = y + qw*ty + qz*tx-qx*tz + (base?.[start + 1] || 0);
                values[start + 2] = z + qw*tz + qx*ty-qy*tx + (base?.[start + 2] || 0);
            }
        }
        this.targets.set(targets); this.contacts = 0;
    }
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
            let targetSquared = 0;
            for (let axis = 0; axis < 3; axis++) {
                const ta = this.previousTargets[ia + axis] + (this.targets[ia + axis] - this.previousTargets[ia + axis]) * this.stepAlpha;
                const tb = this.previousTargets[ib + axis] + (this.targets[ib + axis] - this.previousTargets[ib + axis]) * this.stepAlpha;
                targetSquared += (ta - tb) * (ta - tb);
            }
            const scale = -(distance - Math.sqrt(targetSquared)) / (wa + wb + alpha) / distance;
            positions[ia] += dx * scale * wa; positions[ia + 1] += dy * scale * wa; positions[ia + 2] += dz * scale * wa;
            positions[ib] -= dx * scale * wb; positions[ib + 1] -= dy * scale * wb; positions[ib + 2] -= dz * scale * wb;
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
    step(h, alpha, targetFraction, colliders) {
        const p = this.positions, prev = this.previous, v = this.velocities, w = this.group.inverseMass;
        this.stepAlpha = alpha; this.contact.fill(0);
        const follow = 1 - Math.exp(-20 * h);
        for (let id = 0; id < w.length; id++) for (let axis = 0; axis < 3; axis++) {
            const i = id * 3 + axis, frameDelta = this.targets[i] - this.previousTargets[i];
            prev[i] = p[i];
            const target = this.previousTargets[i] + frameDelta * alpha;
            if (!w[id]) { p[i] = target; continue; }
            p[i] += frameDelta * targetFraction + v[i] * h;
            p[i] += (target - p[i]) * follow;
        }
        this.solveDistances(this.group.stretch, 0, h);
        this.solveDistances(this.group.bend, 0.001, h);
        this.self?.attach(p, this.targets, this.previousTargets, alpha);
        for (let id = 0; id < w.length; id++) if (w[id]) {
            const allowed = this.group.colliderAllowed?.[this.group.owners[id]];
            for (const collider of allowed || colliders) this.collide(id, collider);
        }
        this.self?.solve(p, prev);
        const damping = Math.exp(-30 * h);
        for (let id = 0; id < w.length; id++) for (let axis = 0; axis < 3; axis++) {
            const i = id * 3 + axis, targetDelta = (this.targets[i] - this.previousTargets[i]) * targetFraction;
            v[i] = w[id] ? (p[i] - prev[i] - targetDelta) / h * damping : 0;
            if (!Number.isFinite(p[i] + v[i])) { p[i] = this.previousTargets[i] + (this.targets[i] - this.previousTargets[i]) * alpha; v[i] = 0; }
        }
    }
}

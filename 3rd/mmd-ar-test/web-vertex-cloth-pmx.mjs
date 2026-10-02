import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Euler, Matrix4, Points, PointsMaterial, Quaternion, Vector3 } from 'three';
import { buildVertexClothTopology } from './web-vertex-cloth-topology.mjs';
import { VertexCloth } from './web-vertex-cloth.mjs';
import { normalizeWebStabilityReference } from './web-physics-rate.mjs';
import { advanceWindState, createWindState, normalizeWindSettings, windFlowDirection } from './web-physics-wind.mjs';

// 同一网格切VMD时允许新旧helper暂时并存；各自几何只由自己的dispose释放。
const geometryOwners = new WeakMap();
const EPS = 1e-9;
const delegatedProperties = ['bodies', 'constraints', 'manager', 'world', 'gravity', 'unitStep', 'maxStepNum', 'onDiagnosticSubstep'];
function relativeGeometry(source) {
    const geometry = source.clone(); geometry.userData = source.userData; geometry.bones = source.bones;
    if (!source.morphTargetsRelative) {
        for (const name of ['position', 'normal']) {
            const base = source.attributes[name];
            for (const morph of geometry.morphAttributes[name] || []) {
                for (let i = 0; i < morph.array.length; i++) morph.array[i] -= base.array[i];
                morph.needsUpdate = true;
            }
        }
    }
    geometry.morphTargetsRelative = true;
    geometry.attributes.position.setUsage(DynamicDrawUsage); geometry.attributes.normal.setUsage(DynamicDrawUsage);
    return geometry;
}
const copySettings = (settings) => ({ groups: { ...(settings.groups || {}) }, preview: settings.preview === true });

export class VertexClothPmxPhysics {
    constructor(mesh, options, createBase) {
        this.mesh = mesh; this.options = options; this.createBase = createBase;
        this.engine = 'vertex-cloth'; this.disposed = false; this.frameMs = 0; this.substeps = 0;
        this.stabilityReferenceHz = normalizeWebStabilityReference(options.stabilityReferenceHz);
        this.windSettings = normalizeWindSettings(); this.windState = createWindState();
        this.matrix = new Matrix4(); this.skinMatrix = new Matrix4(); this.inverse = new Matrix4();
        this.boneMatrix = new Matrix4(); this.inverseWorld = new Matrix4();
        this.vector = new Vector3(); this.normal = new Vector3(); this.edgeA = new Vector3(); this.edgeB = new Vector3();
        this.restNormal = new Vector3(); this.rotation = new Quaternion(); this.scale = new Vector3(1, 1, 1);
        this.frameRotation = new Quaternion(); this.localGravity = new Vector3(); this.localWind = new Vector3();
        const owner = geometryOwners.get(mesh) || { source: mesh.geometry, active: [], frustumCulled: mesh.frustumCulled };
        this.owner = owner; this.source = owner.source;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        this.topology = buildVertexClothTopology(this.source, mesh.skeleton, materials);
        this.storageKey = 'aasc.mmdArTest.vertexCloth.v1.' + this.topology.modelKey;
        this.settings = { groups: {}, preview: false };
        try {
            const saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
            if (saved && typeof saved === 'object') this.settings = copySettings(saved);
        } catch (error) { /* 模型开关存储受限或损坏时使用自动固定组。 */ }
        this.enabled = new Set(this.topology.groups.filter((group) => this.settings.groups[group.id] ?? group.defaultEnabled).map((group) => group.id));
        this.geometry = relativeGeometry(this.source);
        this.desired = new Float32Array(this.source.attributes.position.count * 3);
        this.normals = new Float32Array(this.desired.length);
        this.frame = 0; this.vertexFrames = new Uint32Array(this.source.attributes.position.count);
        this.skinMatrices = new Float32Array(this.source.attributes.position.count * 16);
        this.morphPositions = new Float32Array(this.desired.length); this.previousMorphPositions = new Float32Array(this.desired.length); this.morphNormals = new Float32Array(this.desired.length);
        this.morphKey = ''; this.morphChanged = false;
        this.cloths = this.topology.groups.map((group) => ({ group, solver: new VertexCloth(group, this.topology.height * 0.0008),
            sample: new Float32Array(group.rest.length),
            colliders: [], restFaceNormals: this.faceNormals(group) }));
        try {
            this.base = this.makeBase(this.enabled);
            for (const name of delegatedProperties) Object.defineProperty(this, name, {
                get: () => this.base?.[name], set: (value) => { if (this.base) this.base[name] = value; }
            });
            mesh.geometry = this.geometry; mesh.frustumCulled = false;
            owner.active.push(this); geometryOwners.set(mesh, owner);
            this.createPreview(); this.reset(); this.setPreview(this.settings.preview);
        } catch (error) {
            try { this.dispose(); } catch (cleanupError) { console.warn('清理顶点布料初始化失败:', cleanupError); }
            throw error;
        }
    }
    faceNormals(group) {
        const p = this.source.attributes.position, normals = new Float32Array(group.rawTriangles.length);
        for (let i = 0; i < group.rawTriangles.length; i += 3) {
            this.vector.fromBufferAttribute(p, group.rawTriangles[i]);
            this.edgeA.fromBufferAttribute(p, group.rawTriangles[i + 1]).sub(this.vector);
            this.edgeB.fromBufferAttribute(p, group.rawTriangles[i + 2]).sub(this.vector);
            this.normal.crossVectors(this.edgeA, this.edgeB).normalize().toArray(normals, i);
        }
        return normals;
    }
    replacedBodies(enabled) {
        return new Set(this.topology.bodies.flatMap((body, index) => {
            const groups = this.topology.boneGroups.get(body.boneIndex);
            const replace = body.type !== 0 && groups?.size && [...groups].every((id) => enabled.has(id));
            return replace ? [index] : [];
        }));
    }
    makeBase(enabled) {
        const replaced = this.replacedBodies(enabled);
        const bodies = this.topology.bodies.map((body, index) => replaced.has(index)
            ? { ...body, type: 0, weight: 0, groupTarget: 0 } : body);
        const joints = this.topology.joints.filter((joint) => !replaced.has(joint.rigidBodyIndex1) && !replaced.has(joint.rigidBodyIndex2));
        return this.createBase(this.mesh, bodies, joints, { ...this.options, unitStep: this.base?.unitStep || this.options.unitStep,
            maxStepNum: this.base?.maxStepNum || this.options.maxStepNum, stabilityReferenceHz: this.stabilityReferenceHz });
    }
    createPreview() {
        const count = this.cloths.reduce((sum, { solver }) => sum + solver.group.pins.length, 0);
        const geometry = new BufferGeometry(), colors = new Float32Array(count * 3); let offset = 0;
        for (const { group } of this.cloths) for (const pin of group.pins) {
            colors.set(pin ? [0.13, 0.85, 1] : [1, 0.48, 0.08], offset); offset += 3;
        }
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage));
        geometry.setAttribute('color', new BufferAttribute(colors, 3));
        this.preview = new Points(geometry, new PointsMaterial({ size: this.topology.height * 0.002,
            vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85, toneMapped: false }));
        this.preview.name = 'TMP14固定自由点'; this.preview.renderOrder = 102; this.preview.frustumCulled = false;
        this.mesh.add(this.preview);
    }
    setPreview(value) {
        this.settings.preview = value === true;
        if (this.preview) this.preview.visible = this.settings.preview;
        this.updatePreview(); this.save(); return this.settings.preview;
    }
    save() {
        try { localStorage.setItem(this.storageKey, JSON.stringify(this.settings)); }
        catch (error) { /* 即时操作仍有效，不因本地存储受限撤销。 */ }
    }
    setGroupEnabled(id, enabled) {
        if (this.disposed || !this.topology.groups.some((group) => group.id === id)) return false;
        const next = new Set(this.enabled); if (enabled === true) next.add(id); else next.delete(id);
        if (next.size === this.enabled.size && [...next].every((id) => this.enabled.has(id))) return true;
        // 新基础物理构造成功后才替换旧实例，初始化异常不会留下半组配置。
        const base = this.makeBase(next), previous = this.base;
        try { base.setWindSettings(this.windSettings); base.onDiagnosticSubstep = previous.onDiagnosticSubstep; }
        catch (error) { base.dispose(); throw error; }
        this.base = base; this.enabled = next; this.settings.groups[id] = enabled === true;
        try { previous.dispose(); } catch (error) { console.warn('释放旧布料基础物理:', error); }
        this.reset(); this.save(); return true;
    }
    sampleMorphs() {
        const influences = this.mesh.morphTargetInfluences || [];
        const key = influences.join(','); this.morphChanged = key !== this.morphKey;
        if (!this.morphChanged) return;
        this.morphKey = key; this.previousMorphPositions.set(this.morphPositions); this.morphPositions.fill(0); this.morphNormals.fill(0);
        for (const [name, target] of [['position', this.morphPositions], ['normal', this.morphNormals]]) {
            const attributes = this.geometry.morphAttributes[name] || [];
            for (let morph = 0; morph < attributes.length; morph++) {
                const weight = influences[morph] || 0;
                if (Math.abs(weight) < EPS) continue;
                const array = attributes[morph].array;
                for (let i = 0; i < target.length; i++) target[i] += array[i] * weight;
            }
        }
    }
    skin(vertex) {
        const { skinIndex, skinWeight } = this.source.attributes;
        const start = vertex * 16;
        if (this.vertexFrames[vertex] === this.frame) return this.skinMatrix.fromArray(this.skinMatrices, start);
        const matrix = this.skinMatrix; matrix.elements.fill(0);
        for (let axis = 0; axis < 4; axis++) {
            const weight = skinWeight.getComponent(vertex, axis);
            if (weight === 0) continue;
            this.boneMatrix.fromArray(this.mesh.skeleton.boneMatrices, skinIndex.getComponent(vertex, axis) * 16);
            for (let i = 0; i < 16; i++) matrix.elements[i] += this.boneMatrix.elements[i] * weight;
        }
        matrix.premultiply(this.mesh.bindMatrixInverse).multiply(this.mesh.bindMatrix);
        matrix.toArray(this.skinMatrices, start); this.vertexFrames[vertex] = this.frame; return matrix;
    }
    sampleTargets() {
        // Ammo暂时脱离缩放父级后，必须走SkinnedMesh重写的入口同步bindMatrixInverse。
        this.mesh.parent?.updateWorldMatrix(true, false); this.mesh.updateMatrixWorld(true); this.mesh.skeleton.update(); this.frame++;
        this.sampleMorphs();
        const original = this.source.attributes.position;
        for (const cloth of this.cloths) {
            const { group, sample, solver } = cloth; let groupMorphChanged = false;
            for (let particle = 0; particle < group.representatives.length; particle++) {
                const vertex = group.representatives[particle], i = particle * 3, v = vertex * 3, matrix = this.skin(vertex);
                this.vector.fromBufferAttribute(original, vertex);
                this.vector.x += this.morphPositions[v]; this.vector.y += this.morphPositions[v + 1]; this.vector.z += this.morphPositions[v + 2];
                this.vector.applyMatrix4(matrix).toArray(sample, i);
                // 自由点只跟随表情增量，不跟随骨骼动画整体回摆；随后更新当前中性约束长度。
                if (this.morphChanged) {
                    const e = matrix.elements, dx = this.morphPositions[v] - this.previousMorphPositions[v],
                        dy = this.morphPositions[v + 1] - this.previousMorphPositions[v + 1], dz = this.morphPositions[v + 2] - this.previousMorphPositions[v + 2];
                    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > EPS) groupMorphChanged = true;
                    if (!group.pins[particle]) {
                        solver.positions[i] += e[0] * dx + e[4] * dy + e[8] * dz;
                        solver.positions[i + 1] += e[1] * dx + e[5] * dy + e[9] * dz;
                        solver.positions[i + 2] += e[2] * dx + e[6] * dy + e[10] * dz;
                    }
                }
            }
            if (groupMorphChanged) this.updateRestLengths(cloth);
        }
    }
    updateRestLengths({ group }) {
        for (const constraints of [group.stretch, group.bend]) for (let edge = 0; edge < constraints.lengths.length; edge++) {
            const a = constraints.pairs[edge * 2], b = constraints.pairs[edge * 2 + 1];
            const va = group.representatives[a] * 3, vb = group.representatives[b] * 3;
            constraints.lengths[edge] = Math.hypot(...[0, 1, 2].map((axis) => group.rest[a * 3 + axis] + this.morphPositions[va + axis]
                - group.rest[b * 3 + axis] - this.morphPositions[vb + axis]));
        }
    }
    createColliders() {
        const replaced = this.replacedBodies(this.enabled), bodies = this.topology.bodies;
        this.colliders = bodies.flatMap((params, index) => {
            if (replaced.has(index) || ![0, 1, 2].includes(params.shapeType)) return [];
            const offset = new Matrix4().compose(new Vector3(...params.position), new Quaternion().setFromEuler(new Euler(...params.rotation)), new Vector3(1, 1, 1));
            return [{ params, index, offset, position: new Vector3(), previousPosition: new Vector3(),
                quaternion: new Quaternion(), previousQuaternion: new Quaternion(), stepQuaternion: new Quaternion(),
                rotation: new Float32Array(9), min: new Float32Array(3), max: new Float32Array(3), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }];
        });
        for (const cloth of this.cloths) {
            const own = bodies.filter((body) => cloth.group.bones.has(body.boneIndex));
            cloth.colliders = this.colliders.filter(({ params }) => !cloth.group.bones.has(params.boneIndex)
                && own.some((body) => (body.groupTarget & (1 << params.groupIndex)) && (params.groupTarget & (1 << body.groupIndex))));
        }
    }
    sampleColliders(reset = false, seconds = 1) {
        this.inverseWorld.copy(this.mesh.matrixWorld).invert();
        for (const collider of this.colliders) {
            collider.previousPosition.copy(collider.position); collider.previousQuaternion.copy(collider.quaternion);
            const bone = this.mesh.skeleton.bones[collider.params.boneIndex];
            this.matrix.copy(collider.offset);
            if (bone) this.matrix.premultiply(bone.matrixWorld).premultiply(this.inverseWorld);
            this.matrix.decompose(collider.position, collider.quaternion, this.scale);
            if (reset) { collider.previousPosition.copy(collider.position); collider.previousQuaternion.copy(collider.quaternion); }
            collider.vx = (collider.position.x - collider.previousPosition.x) / seconds;
            collider.vy = (collider.position.y - collider.previousPosition.y) / seconds;
            collider.vz = (collider.position.z - collider.previousPosition.z) / seconds;
        }
    }
    interpolateColliders(alpha) {
        for (const collider of this.colliders) {
            this.vector.lerpVectors(collider.previousPosition, collider.position, alpha);
            collider.x = this.vector.x; collider.y = this.vector.y; collider.z = this.vector.z;
            collider.stepQuaternion.slerpQuaternions(collider.previousQuaternion, collider.quaternion, alpha);
            this.matrix.makeRotationFromQuaternion(collider.stepQuaternion); const e = this.matrix.elements, r = collider.rotation, p = collider.params;
            r[0] = e[0]; r[1] = e[1]; r[2] = e[2]; r[3] = e[4]; r[4] = e[5]; r[5] = e[6]; r[6] = e[8]; r[7] = e[9]; r[8] = e[10];
            for (let axis = 0; axis < 3; axis++) {
                const extent = p.shapeType === 1 ? Math.abs(r[axis]) * p.width + Math.abs(r[3 + axis]) * p.height + Math.abs(r[6 + axis]) * p.depth
                    : p.width + (p.shapeType === 2 ? Math.abs(r[3 + axis]) * p.height / 2 : 0);
                collider.min[axis] = this.vector.getComponent(axis) - extent; collider.max[axis] = this.vector.getComponent(axis) + extent;
            }
        }
    }
    reset() {
        if (this.disposed) return this;
        this.base.reset(); this.sampleTargets();
        for (const cloth of this.cloths) cloth.solver.reset(cloth.sample);
        this.createColliders(); this.sampleColliders(true); this.windState = createWindState(); this.substeps = 0;
        this.writeGeometry(); this.updatePreview(); return this;
    }
    resetMotion() {
        if (this.disposed) return this;
        const zero = this.manager.allocVector3();
        try { zero.setValue(0, 0, 0); for (const { body } of this.bodies) { body.setLinearVelocity(zero); body.setAngularVelocity(zero); body.clearForces(); } }
        finally { this.manager.freeVector3(zero); }
        return this.resetClothMotion();
    }
    resetClothMotion() {
        this.sampleTargets(); for (const cloth of this.cloths) cloth.solver.reset(cloth.sample);
        this.sampleColliders(true); this.writeGeometry(); this.updatePreview(); return this;
    }
    resetAnchorInterpolation() { this.base.resetAnchorInterpolation?.(); this.resetClothMotion(); return this; }
    warmup(cycles) { for (let i = 0; i < cycles; i++) this.update(1 / 60); return this; }
    setStabilityReferenceHz(value) {
        this.stabilityReferenceHz = normalizeWebStabilityReference(value); this.base.setStabilityReferenceHz(this.stabilityReferenceHz); return this;
    }
    setWindSettings(value) {
        this.windSettings = normalizeWindSettings(value); this.base.setWindSettings(this.windSettings);
        if (!this.windSettings.enabled) this.windState.strength = 0;
        return { ...this.windSettings };
    }
    update(delta) {
        if (this.disposed || !Number.isFinite(delta) || delta <= 0) return this;
        this.base.update(delta); this.sampleTargets(); this.sampleColliders(false, delta);
        const steps = normalizeWebStabilityReference(this.stabilityReferenceHz), h = Math.min(0.1, delta) / steps;
        this.mesh.getWorldQuaternion(this.frameRotation).invert();
        this.localGravity.copy(this.gravity).applyQuaternion(this.frameRotation);
        const direction = windFlowDirection(this.windSettings);
        this.localWind.set(direction.x, direction.y, direction.z).applyQuaternion(this.frameRotation);
        const wind = { x: this.localWind.x, y: this.localWind.y, z: this.localWind.z, strength: 0 };
        for (const cloth of this.cloths) {
            cloth.solver.beginFrame(cloth.sample);
            if (!this.enabled.has(cloth.group.id)) cloth.solver.reset(cloth.sample);
        }
        for (let step = 0; step < steps; step++) {
            const alpha = (step + 1) / steps; this.interpolateColliders(alpha);
            wind.strength = advanceWindState(this.windState, h, this.windSettings);
            for (const cloth of this.cloths) if (this.enabled.has(cloth.group.id)) cloth.solver.step(h, alpha, this.localGravity, wind, cloth.colliders);
        }
        this.substeps = steps; this.writeGeometry(); this.updatePreview(); return this;
    }
    writeGeometry() {
        this.mesh.geometry = this.geometry;
        const originalNormal = this.source.attributes.normal, positions = this.geometry.attributes.position, normals = this.geometry.attributes.normal;
        positions.array.set(this.source.attributes.position.array); normals.array.set(originalNormal.array); this.normals.fill(0);
        for (const cloth of this.cloths) {
            if (!this.enabled.has(cloth.group.id)) continue;
            const { group, solver } = cloth;
            for (let i = 0; i < group.vertexIds.length; i++) this.desired.set(solver.positions.subarray(group.particleIds[i] * 3, group.particleIds[i] * 3 + 3), group.vertexIds[i] * 3);
            for (let i = 0; i < group.rawTriangles.length; i += 3) {
                const a = group.rawTriangles[i], b = group.rawTriangles[i + 1], c = group.rawTriangles[i + 2];
                this.vector.fromArray(this.desired, a * 3);
                this.edgeA.fromArray(this.desired, b * 3).sub(this.vector); this.edgeB.fromArray(this.desired, c * 3).sub(this.vector);
                this.normal.crossVectors(this.edgeA, this.edgeB); const area = this.normal.length();
                if (area < EPS) continue;
                this.normal.multiplyScalar(1 / area); this.restNormal.fromArray(cloth.restFaceNormals, i);
                this.rotation.setFromUnitVectors(this.restNormal, this.normal);
                for (let corner = 0; corner < 3; corner++) {
                    const vertex = group.rawTriangles[i + corner], offset = vertex * 3;
                    this.vector.fromBufferAttribute(originalNormal, vertex);
                    this.vector.x += this.morphNormals[offset]; this.vector.y += this.morphNormals[offset + 1]; this.vector.z += this.morphNormals[offset + 2];
                    this.vector.applyQuaternion(this.rotation);
                    this.normals[vertex * 3] += this.vector.x * area; this.normals[vertex * 3 + 1] += this.vector.y * area; this.normals[vertex * 3 + 2] += this.vector.z * area;
                }
            }
            for (const vertex of group.vertexIds) {
                const matrix = this.skin(vertex), index = vertex * 3;
                if (Math.abs(matrix.determinant()) < EPS) continue; // 奇异蒙皮回退原动画顶点。
                this.inverse.copy(matrix).invert(); this.vector.fromArray(this.desired, index).applyMatrix4(this.inverse);
                positions.setXYZ(vertex, this.vector.x - this.morphPositions[index], this.vector.y - this.morphPositions[index + 1], this.vector.z - this.morphPositions[index + 2]);
                this.normal.fromArray(this.normals, index);
                if (this.normal.lengthSq() < EPS) continue;
                this.normal.transformDirection(this.inverse);
                normals.setXYZ(vertex, this.normal.x - this.morphNormals[index], this.normal.y - this.morphNormals[index + 1], this.normal.z - this.morphNormals[index + 2]);
            }
        }
        positions.needsUpdate = true; normals.needsUpdate = true;
    }
    updatePreview() {
        if (!this.preview?.visible) return;
        const positions = this.preview.geometry.attributes.position; let offset = 0;
        for (const cloth of this.cloths) {
            positions.array.set(this.enabled.has(cloth.group.id) ? cloth.solver.positions : cloth.sample, offset);
            offset += cloth.sample.length;
        }
        positions.needsUpdate = true;
    }
    getState() {
        const active = this.cloths.filter(({ group }) => this.enabled.has(group.id));
        return { solver: this.engine, modelKey: this.topology.modelKey, substeps: this.substeps, preview: this.settings.preview,
            particleCount: active.reduce((sum, { group }) => sum + group.pins.length, 0),
            fixedCount: active.reduce((sum, { group }) => sum + group.fixedCount, 0),
            constraintCount: active.reduce((sum, { group }) => sum + group.stretch.lengths.length + group.bend.lengths.length, 0),
            replacedBodyCount: this.replacedBodies(this.enabled).size,
            groups: this.cloths.map(({ group }) => ({ id: group.id, name: group.name, enabled: this.enabled.has(group.id),
                particles: group.pins.length, fixed: group.fixedCount, constraints: group.stretch.lengths.length + group.bend.lengths.length })) };
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        try { this.base?.dispose(); }
        finally {
            this.preview?.removeFromParent(); this.preview?.geometry.dispose(); this.preview?.material.dispose();
            this.owner.active = this.owner.active.filter((owner) => owner !== this);
            if (this.mesh.geometry === this.geometry) this.mesh.geometry = this.owner.active.at(-1)?.geometry || this.source;
            this.geometry.dispose();
            if (!this.owner.active.length) { this.mesh.frustumCulled = this.owner.frustumCulled; geometryOwners.delete(this.mesh); }
            this.cloths.length = 0; this.colliders = []; this.base = null;
        }
    }
}

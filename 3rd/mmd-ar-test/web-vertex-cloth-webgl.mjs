import { BufferAttribute, BufferGeometry, Camera, Color, FloatType, GLSL3, Mesh, NearestFilter,
    NoBlending, PlaneGeometry, Points, RawShaderMaterial, Scene, Vector2, Vector3, Vector4, WebGLMultipleRenderTargets } from 'three';
import { QUAD_VERTEX, COMPUTE_FRAGMENT, SCATTER_VERTEX, SCATTER_FRAGMENT } from './web-vertex-cloth-gpu-shaders.mjs';
import { colorConstraints, floatTexture, packVectors, textureShape } from './web-vertex-cloth-gpu-data.mjs';
import { GpuClothSelfCollision } from './web-vertex-cloth-gpu-self.mjs';
import { ClothGpuBudget } from './web-vertex-cloth-gpu-budget.mjs';
import { bindGpuClothObject } from './web-vertex-cloth-gpu-render.mjs';

class ParticleGpu {
    constructor(owner, cloth) {
        this.owner = owner; this.cloth = cloth; this.group = cloth.group;
        const n = this.group.pins.length, make = count => owner.texture(count);
        this.targets = make(n); this.oldTargets = make(n); this.rotations = make(n);
        this.ping = owner.createTarget(n, 3); this.pong = owner.createTarget(n, 3);
        this.batches = colorConstraints(this.group).map(edges => ({ edges, texture: make(n) }));
        this.particleMeta = make(n);
        for (let i = 0; i < n; i++) this.particleMeta.image.data.set([this.group.owners[i], this.group.active[i], 0, 0], i * 4);
        this.colliders = make(Math.max(1, cloth.colliders.length * 8));
        this.colliderMask = make(this.group.colliderAllowed.length * cloth.colliders.length);
        this.group.colliderAllowed.forEach((allowed, ownerIndex) => cloth.colliders.forEach((collider, index) => {
            this.colliderMask.image.data[(ownerIndex * cloth.colliders.length + index) * 4] = allowed.has(collider) ? 1 : 0;
        }));
        this.buildScatter(); this.reset(); this.self = new GpuClothSelfCollision(this);
    }
    uploadEdges() {
        for (const { edges, texture } of this.batches) {
            const data = texture.image.data; data.fill(0);
            for (const { a, b, constraints, index, compliance } of edges) {
                if (this.group.inverseMass[a]) data.set([b, constraints.lengths[index], compliance, 1], a * 4);
                if (this.group.inverseMass[b]) data.set([a, constraints.lengths[index], compliance, 1], b * 4);
            }
            texture.needsUpdate = true;
        }
    }
    reset() {
        this.uploadEdges();
        this.group.colliderAllowed.forEach((allowed, ownerIndex) => this.cloth.colliders.forEach((collider, index) => {
            this.colliderMask.image.data[(ownerIndex * this.cloth.colliders.length + index) * 4] = allowed.has(collider) ? 1 : 0;
        }));
        this.colliderMask.needsUpdate = true;
        packVectors(this.targets, this.cloth.sample, this.group.inverseMass);
        packVectors(this.oldTargets, this.cloth.sample, this.group.inverseMass);
        this.pass(0);
    }
    beginFrame() {
        packVectors(this.oldTargets, this.cloth.solver.previousTargets, this.group.inverseMass);
        packVectors(this.targets, this.cloth.sample, this.group.inverseMass);
        this.rotations.image.data.set(this.cloth.rotations); this.rotations.needsUpdate = true; this.pass(1);
    }
    pass(mode, edge = this.targets) {
        const { owner } = this, u = owner.compute.uniforms;
        u.mode.value = mode; u.particleCount.value = this.group.pins.length;
        u.posTex.value = this.ping.texture[0]; u.velTex.value = this.ping.texture[1]; u.prevTex.value = this.ping.texture[2];
        u.targetTex.value = this.targets; u.oldTargetTex.value = this.oldTargets; u.rotationTex.value = this.rotations;
        u.edgeTex.value = edge; u.particleMetaTex.value = this.particleMeta; u.colliderMaskTex.value = this.colliderMask;
        u.colliderTex.value = this.colliders; u.colliderCount.value = this.cloth.colliders.length;
        u.thickness.value = this.cloth.solver.thickness;
        owner.quad.material = owner.compute;
        owner.renderer.setRenderTarget(this.pong); owner.renderer.render(owner.scene, owner.camera);
        [this.ping, this.pong] = [this.pong, this.ping];
    }
    *steps(h, alpha, targetFraction) {
        const u = this.owner.compute.uniforms;
        u.h.value = h; u.alpha.value = alpha; u.targetFraction.value = targetFraction;
        this.pass(2); yield;
        for (const batch of this.batches) { this.pass(3, batch.texture); yield; }
        this.self.attach(alpha); yield;
        const data = this.colliders.image.data;
        this.cloth.colliders.forEach((c, index) => {
            const start = index * 32, p = c.params;
            data.set([c.x, c.y, c.z, p.shapeType, p.width, p.height, p.depth, 0], start);
            for (let axis = 0; axis < 3; axis++) data.set(c.rotation.subarray(axis * 3, axis * 3 + 3), start + 8 + axis * 4);
            data.set([c.vx, c.vy, c.vz, 0, ...c.min, 0, ...c.max, 0], start + 20);
        });
        this.colliders.needsUpdate = true; this.pass(4); yield;
        yield* this.self.steps(); this.pass(5); yield;
    }
    buildScatter() {
        const { group, owner } = this, { width } = owner.targetSize;
        const map = new Map(Array.from(group.vertexIds, (vertex, i) => [vertex, group.particleIds[i]]));
        const incident = new Map(Array.from(group.vertexIds, vertex => [vertex, []]));
        for (let i = 0; i < group.rawTriangles.length; i += 3) {
            for (let k = 0; k < 3; k++) incident.get(group.rawTriangles[i + k]).push(i);
        }
        const count = group.rawTriangles.length, faces = owner.texture(count), normals = owner.texture(count);
        const pixels = new Float32Array(group.vertexIds.length * 2), ranges = new Float32Array(pixels.length);
        const sourceNormals = new Float32Array(group.vertexIds.length * 3), source = owner.bridge.source.attributes.normal;
        let cursor = 0;
        group.vertexIds.forEach((vertex, i) => {
            pixels.set([vertex % width, Math.floor(vertex / width)], i * 2);
            const list = incident.get(vertex); ranges.set([cursor, list.length], i * 2);
            sourceNormals.set([source.getX(vertex), source.getY(vertex), source.getZ(vertex)], i * 3);
            for (const start of list) {
                faces.image.data.set([map.get(group.rawTriangles[start]), map.get(group.rawTriangles[start + 1]), map.get(group.rawTriangles[start + 2])], cursor * 4);
                normals.image.data.set(this.cloth.restFaceNormals.subarray(start, start + 3), cursor * 4); cursor++;
            }
        });
        const geometry = owner.keep(new BufferGeometry());
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(group.vertexIds.length * 3), 3));
        geometry.setAttribute('particleId', new BufferAttribute(Float32Array.from(group.particleIds), 1));
        geometry.setAttribute('particleActive', new BufferAttribute(Float32Array.from(group.particleIds, id => group.active[id]), 1));
        geometry.setAttribute('outputPixel', new BufferAttribute(pixels, 2));
        geometry.setAttribute('faceRange', new BufferAttribute(ranges, 2));
        geometry.setAttribute('sourceNormal', new BufferAttribute(sourceNormals, 3));
        const material = owner.keep(new RawShaderMaterial({ glslVersion: GLSL3,
            vertexShader: SCATTER_VERTEX, fragmentShader: SCATTER_FRAGMENT,
            uniforms: { posTex: { value: null }, normalFacesTex: { value: faces }, restNormalsTex: { value: normals },
                morphNormalTex: { value: owner.morphNormals }, outputSize: { value: new Vector2(owner.targetSize.width, owner.targetSize.height) } },
            depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false }));
        this.scatter = new Points(geometry, material); this.scatter.frustumCulled = false;
        this.scatterScene = new Scene(); this.scatterScene.add(this.scatter);
    }
    draw() {
        this.scatter.material.uniforms.posTex.value = this.ping.texture[0];
        this.owner.renderer.render(this.scatterScene, this.owner.camera);
    }
}

export class VertexClothWebGL {
    constructor(bridge, renderer) {
        this.bridge = bridge; this.renderer = renderer; this.resources = []; this.unbind = []; this.ready = false;
        if (!renderer?.capabilities.isWebGL2 || !renderer.extensions.has('EXT_color_buffer_float')) throw new Error('需要WebGL2及浮点渲染目标');
        const gl = renderer.getContext();
        if (gl.isContextLost()) throw new Error('WebGL上下文已丢失');
        if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 3 || renderer.capabilities.maxVertexTextures < 4) throw new Error('GPU纹理/渲染附件数量不足');
        this.budget = new ClothGpuBudget(this);
        this.limit = renderer.capabilities.maxTextureSize;
        try {
            this.run(() => {
                this.targetSize = textureShape(bridge.source.attributes.position.count, this.limit);
                this.target = this.targetForShape(this.targetSize, 2);
                this.morphNormals = this.texture(bridge.source.attributes.position.count);
                const uniforms = Object.fromEntries(['posTex', 'velTex', 'prevTex', 'targetTex', 'oldTargetTex', 'rotationTex',
                    'edgeTex', 'particleMetaTex', 'colliderMaskTex', 'colliderTex'].map(name => [name, { value: null }]));
                for (const name of ['mode', 'particleCount', 'colliderCount', 'h', 'alpha', 'thickness', 'targetFraction', 'windStrength']) uniforms[name] = { value: 0 };
                uniforms.gravity = { value: new Vector3() }; uniforms.wind = { value: new Vector3() };
                this.compute = this.keep(new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: QUAD_VERTEX, fragmentShader: COMPUTE_FRAGMENT,
                    uniforms, depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false }));
                this.camera = new Camera(); this.scene = new Scene();
                const quad = new Mesh(this.keep(new PlaneGeometry(2, 2)), this.compute); quad.frustumCulled = false; this.scene.add(quad); this.quad = quad;
                this.entries = [new ParticleGpu(this, bridge.surface)];
                this.drawInternal();
            });
            // 曾经CPU回退的几何可能已被改写；GPU启用后未选区域仍使用原网格。
            for (const name of ['position', 'normal']) {
                bridge.geometry.attributes[name].array.set(bridge.source.attributes[name].array);
                bridge.geometry.attributes[name].needsUpdate = true;
            }
            const uv = new Float32Array(bridge.source.attributes.position.count * 2);
            for (let i = 0; i < uv.length / 2; i++) uv.set([(i % this.targetSize.width + 0.5) / this.targetSize.width,
                (Math.floor(i / this.targetSize.width) + 0.5) / this.targetSize.height], i * 2);
            this.unbind.push(bindGpuClothObject(bridge.mesh, bridge.geometry, this, uv));
            const previewUv = new Float32Array(bridge.preview.geometry.attributes.position.count * 2); let cursor = 0;
            for (const cloth of bridge.cloths) for (const vertex of cloth.group.representatives) {
                previewUv.set(uv.subarray(vertex * 2, vertex * 2 + 2), cursor); cursor += 2;
            }
            this.unbind.push(bindGpuClothObject(bridge.preview, bridge.preview.geometry, this, previewUv));
            this.ready = true;
        } catch (error) { this.dispose(); throw error; }
    }
    keep(resource) { this.resources.push(resource); return resource; }
    texture(count) { return this.keep(floatTexture(count, this.limit)); }
    createTarget(count, attachments) { return this.targetForShape(textureShape(count, this.limit), attachments); }
    targetForShape({ width, height }, count) {
        const target = this.keep(new WebGLMultipleRenderTargets(width, height, count, { type: FloatType,
            minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false }));
        this.renderer.setRenderTarget(target);
        const gl = this.renderer.getContext();
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('浮点帧缓冲不可用');
        return target;
    }
    // 计算共享显示renderer，必须恢复XR、阴影、清屏、视口及渲染目标，不能污染AR/AO。
    run(action) {
        const r = this.renderer;
        if (r.getContext().isContextLost()) throw new Error('WebGL上下文已丢失');
        const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
        const viewport = r.getViewport(new Vector4()), scissor = r.getScissor(new Vector4()), scissorTest = r.getScissorTest();
        const color = r.getClearColor(new Color()), clearAlpha = r.getClearAlpha(), auto = r.autoClear;
        const xr = r.xr.enabled, shadow = r.shadowMap.autoUpdate, onError = r.debug.onShaderError;
        try {
            r.autoClear = false; r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.setScissorTest(false);
            r.debug.onShaderError = () => { throw new Error('顶点布料GPU着色器编译失败'); };
            return action();
        } finally {
            r.debug.onShaderError = onError; r.xr.enabled = xr; r.shadowMap.autoUpdate = shadow; r.autoClear = auto;
            r.setViewport(viewport); r.setScissor(scissor); r.setScissorTest(scissorTest);
            r.setRenderTarget(target, face, mip); r.setClearColor(color, clearAlpha);
        }
    }
    get pending() { return Boolean(this.budget.job); }
    *frameSteps(h, steps) {
        for (const entry of this.entries) { entry.beginFrame(); yield; }
        for (let step = 0; step < steps; step++) {
            const alpha = (step + 1) / steps;
            this.bridge.interpolateColliders(alpha);
            for (const entry of this.entries) yield* entry.steps(h, alpha, 1 / steps);
        }
        this.drawInternal(); yield;
    }
    submit(h, steps, started) { this.budget.start(this.frameSteps(h, steps), () => {}, started); }
    reset() {
        const started = performance.now();
        this.budget.cancel();
        this.run(() => { for (const entry of this.entries) entry.reset(); this.drawInternal(); });
        if (performance.now() - started > 500) throw new Error('顶点GPU复位超过500ms');
    }
    drawInternal() {
        packVectors(this.morphNormals, this.bridge.morphNormals);
        this.renderer.setRenderTarget(this.target); this.renderer.setClearColor(0, 0); this.renderer.clear(true, false, false);
        for (const entry of this.entries) entry.draw();
    }
    draw() { /* 显示纹理由完整异步任务更新，渲染帧不再重复提交计算。 */ }
    dispose() {
        this.ready = false; this.budget?.cancel();
        for (const unbind of this.unbind.splice(0).reverse()) unbind();
        for (const resource of this.resources.splice(0).reverse()) resource.dispose();
    }
}

import { Matrix4, Vector3 } from 'three';
import { createGpuState } from './web-xpbd-webgl-state.mjs';
import { common, integrate, bindings, recoverVelocity, copy } from './web-xpbd-webgl-shaders.mjs';
import { prepareTopology, jointShader, jointGather } from './web-xpbd-webgl-joints.mjs';
import { contactShader, contactSolve, contactGather } from './web-xpbd-webgl-collision.mjs';
import { advanceWindState } from './web-physics-wind.mjs';

const put = (array, index, values) => array.set(values, index * 4);
const pack = common + `uniform sampler2D uFlags;void main(){int idx=pixelIndex();outputValue=idx<uCount*6?fetchData(uState,idx):idx<uCount*6+uPairCount?fetchData(uFlags,idx-uCount*6):vec4(0);}`;
const clearShader = common + 'void main(){outputValue=vec4(0); }';
const flagsShader = common + `uniform sampler2D uFlags;uniform sampler2D uCorrections;void main(){int idx=pixelIndex();if(idx>=uPairCount){outputValue=vec4(0);return;}outputValue=vec4(max(fetchData(uFlags,idx).x,fetchData(uCorrections,idx*7+6).x),0,0,0);}`;

export function createWebglSolver(renderer, bodies, joints) {
    if (bodies.length > 4096) throw new Error('刚体数量超过WebGL XPBD预算');
    const topology = prepareTopology(bodies, joints), n = bodies.length, np = topology.pairs.length;
    // 数量预算先判定再分配，失败后由包装回退；不把超限候选对裁掉。
    if (np > 32768 || n > 4096 || topology.colors > 128) throw new Error('模型超出WebGL XPBD容量预算，使用CPU XPBD');
    const gpu = createGpuState(renderer);
    let disposed = false, state, other, flags, nextFlags, readbackMs = 0, gpuMs = null, readbacks = 0, contacts = [];
    const queries = [], gl = gpu.gl, timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    try {
        state = gpu.target(n * 6); other = gpu.target(n * 6);
        const seed = gpu.data(new Float32Array(n * 24));
        const targets = gpu.data(new Float32Array(n * 16));
        const metadata = new Float32Array(n * 28);
        bodies.forEach((b, i) => {
            const fixed = topology.fixed.has(i), p = b.params;
            put(metadata, i * 7, [fixed ? 0 : b.inverseMass, fixed ? 1 : 0, b.positionDriven ? 1 : 0, p.shapeType]);
            put(metadata, i * 7 + 1, [...(fixed ? [0, 0, 0] : b.inverseInertia.toArray()), b.contactTolerance]);
            put(metadata, i * 7 + 2, [p.width, p.height, p.depth, p.weight]);
            put(metadata, i * 7 + 3, [p.positionDamping, p.rotationDamping, p.friction, p.restitution]);
            put(metadata, i * 7 + 4, [...b.windLever.toArray(), p.type === 0 ? 1 : 0]);
            const binding = topology.bindings.get(i);
            if (binding) { put(metadata, i * 7 + 5, [...binding.offset.toArray(), binding.anchor + 1]); put(metadata, i * 7 + 6, binding.rotation.toArray()); }
        });
        const jm = new Float32Array(Math.max(1, joints.length) * 48);
        joints.forEach((j, i) => {
            put(jm, i * 12, [j.a.index, j.b.index, topology.jointColors[i], 0]);
            const fields = [j.localA.toArray(), j.localB.toArray(), j.rotationA.toArray(), j.rotationB.toArray(),
                j.params.translationLimitation1, j.params.translationLimitation2, j.params.rotationLimitation1,
                j.params.rotationLimitation2, j.params.springPosition, j.params.springRotation];
            fields.forEach((value, k) => put(jm, i * 12 + k + 1, value));
        });
        const pairs = new Float32Array(Math.max(1, np) * 4);
        topology.pairs.forEach((pair, i) => put(pairs, i, pair));
        const adjacent = [], ranges = new Float32Array(n * 4);
        topology.adjacent.forEach((list, i) => { put(ranges, i, [adjacent.length / 4, list.length]); for (const value of list) adjacent.push(value, 0, 0, 0); });
        const jr = gpu.target(joints.length * 11), ct = gpu.target(np * 24), cr = gpu.target(np * 7), vr = gpu.target(np * 7);
        flags = gpu.target(np); nextFlags = gpu.target(np); const emptyFlags = gpu.data(new Float32Array(Math.max(1, np) * 4));
        const packed = gpu.target(n * 6 + np), output = new Float32Array(packed.width * packed.height * 4);
        const shaders = Object.fromEntries(Object.entries({ integrate, bindings, recoverVelocity, copy, jointShader, jointGather,
            contactShader, contactSolve, contactGather, pack, flagsShader, clearShader }).map(([key, source]) => [key, gpu.material(source)]));
        const uniforms = { uCount: n, uJointCount: joints.length, uPairCount: np, uMeta: gpu.data(metadata), uJoints: gpu.data(jm),
            uMap: gpu.data(topology.map), uPairs: gpu.data(pairs), uAdj: gpu.data(new Float32Array(adjacent.length ? adjacent : [0, 0, 0, 0])),
            uRanges: gpu.data(ranges), uTargets: targets, uH: 1 / 60, uAlpha: 1, uGravity: new Vector3(), uWind: new Vector3(),
            uWindDirection: new Vector3(), uWindMatrix: new Matrix4(), uMode: 0, uColor: 0 };
        const draw = (name, target, extra = {}) => gpu.draw(shaders[name], target, { ...uniforms, uState: state.texture, ...extra });
        const advance = (name, extra) => { draw(name, other, extra); [state, other] = [other, state]; };
        const jointsPass = mode => { uniforms.uMode = mode;
            for (let c = 0; c < topology.colors; c += 1) { uniforms.uColor = c; draw('jointShader', jr); advance('jointGather', { uCorrections: jr.texture }); }
        };
        const reset = () => {
            if (disposed) return;
            // reset同步直接全锁绑定，避免第一子步把非零锁定值误算成速度。
            for (const [id, binding] of topology.bindings) {
                const b = bodies[id], a = bodies[binding.anchor];
                b.quaternion.copy(a.quaternion).multiply(binding.rotation).normalize();
                b.position.copy(binding.offset).applyQuaternion(a.quaternion).add(a.position);
                b.previousPosition.copy(b.position); b.previousQuaternion.copy(b.quaternion);
                b.velocity.set(0, 0, 0); b.omega.set(0, 0, 0);
            }
            const data = seed.image.data; data.fill(0);
            bodies.forEach((b, i) => {
                put(data, i * 6, b.position.toArray()); put(data, i * 6 + 1, b.quaternion.toArray());
                put(data, i * 6 + 4, b.position.toArray()); put(data, i * 6 + 5, b.quaternion.toArray());
            }); seed.needsUpdate = true;
            gpu.scope(() => { draw('copy', state, { uState: seed }); draw('copy', other, { uState: seed });
                draw('copy', flags, { uState: emptyFlags }); draw('copy', nextFlags, { uState: emptyFlags });
                for (const target of [jr, ct, cr, vr]) draw('clearShader', target);
            }); contacts = []; readbacks = 0;
        };
        const pollQueries = () => {
            if (!timer) return;
            const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
            for (let i = queries.length - 1; i >= 0; i -= 1) {
                const q = queries[i];
                if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
                if (!disjoint) gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
                gl.deleteQuery(q); queries.splice(i, 1);
            }
            if (disjoint) gpuMs = null;
        };
        const runFrame = (owner, steps, h) => gpu.scope(() => {
            if (disposed || gl.isContextLost()) return;
            gpu.resetStats(); pollQueries();
            bodies.forEach((b, i) => {
                put(targets.image.data, i * 4, b.previousTargetPosition.toArray()); put(targets.image.data, i * 4 + 1, b.previousTargetQuaternion.toArray());
                put(targets.image.data, i * 4 + 2, b.targetPosition.toArray()); put(targets.image.data, i * 4 + 3, b.targetQuaternion.toArray());
            }); targets.needsUpdate = true; uniforms.uH = h; uniforms.uGravity.copy(owner.gravity);
            owner.frameRotation.copy(owner.windSceneRotation).invert();
            uniforms.uWindDirection.set(owner.windDirection.x, owner.windDirection.y, owner.windDirection.z).applyQuaternion(owner.frameRotation);
            owner.mesh.getWorldQuaternion(owner.frameRotation); uniforms.uWindDirection.applyQuaternion(owner.frameRotation);
            uniforms.uWindMatrix.copy(owner.mesh.matrixWorld).invert().premultiply(owner.windSceneMatrix);
            const query = timer && queries.length < 4 && !gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) ? gl.createQuery() : null;
            if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
            try {
                draw('copy', flags, { uState: emptyFlags });
                for (let step = 0; step < steps; step += 1) {
                    uniforms.uAlpha = (step + 1) / steps;
                    const average = advanceWindState(owner.windState, h, owner.windSettings, false);
                    uniforms.uWind.set(average, owner.windState.time - h / 2, owner.windSettings.gust / 100);
                    advance('integrate'); if (topology.bindings.size) advance('bindings');
                    // 接触与入射速度取预测姿态，与CPU扫描阶段一致，修正阶段仅使用局部锚点。
                    if (np) draw('contactShader', ct);
                    jointsPass(0);
                    if (np) {
                        uniforms.uMode = 0; draw('contactSolve', cr, { uContacts: ct.texture, uPreviousCorrections: vr.texture });
                        advance('contactGather', { uCorrections: cr.texture });
                        draw('flagsShader', nextFlags, { uCorrections: cr.texture, uFlags: flags.texture }); [flags, nextFlags] = [nextFlags, flags];
                    }
                    jointsPass(1); advance('recoverVelocity');
                    if (np) {
                        uniforms.uMode = 1; draw('contactSolve', vr, { uContacts: ct.texture, uPreviousCorrections: cr.texture });
                        advance('contactGather', { uCorrections: vr.texture });
                    }
                    jointsPass(2);
                }
                draw('pack', packed, { uFlags: flags.texture });
            } finally { if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); } }
            const begin = performance.now(); renderer.readRenderTargetPixels(packed, 0, 0, packed.width, packed.height, output);
            readbackMs = performance.now() - begin; readbacks += 1;
            // 全部检查通过再提交CPU快照，异常时保留最后一次有效骨骼姿态。
            for (let i = 0; i < n * 24; i += 1) if (!Number.isFinite(output[i])) throw new Error('WebGL XPBD产生非有限位姿');
            for (let i = 0; i < n; i += 1) if (Math.hypot(...output.subarray(i * 24 + 4, i * 24 + 8)) < .5) throw new Error('WebGL XPBD未产生有效四元数');
            bodies.forEach((b, i) => {
                b.position.fromArray(output, i * 24); b.quaternion.fromArray(output, i * 24 + 4).normalize();
                b.velocity.fromArray(output, i * 24 + 8); b.omega.fromArray(output, i * 24 + 12);
                b.previousPosition.fromArray(output, i * 24 + 16); b.previousQuaternion.fromArray(output, i * 24 + 20);
            });
            contacts = [];
            topology.pairs.forEach(([a, b], i) => { if (output[n * 24 + i * 4] > .5) contacts.push({ a: bodies[a], b: bodies[b] }); });
        });
        reset();
        return { reset, runFrame, get contacts() { return contacts; }, getState: () => ({ computeBackend: 'webgl2', solver: 'xpbd-webgl',
            candidates: np, contacts: contacts.length, jointColors: topology.colors, passCount: gpu.passes, gpuMs, readbackMs,
            readbacks, memoryBytes: gpu.bytes, diagnosticSampling: 'frame-accumulated', anchoredBodyCount: topology.bindings.size,
            rotationLockProjections: joints.some((j, i) => topology.jointColors[i] >= 0 && j.params.rotationLimitation1.some((v, k) => v === j.params.rotationLimitation2[k])) ? 1 : 0, iterations: 1 }), dispose() {
            if (disposed) return; disposed = true; for (const q of queries) gl.deleteQuery(q); queries.length = 0; gpu.dispose(); contacts = [];
        } };
    } catch (error) { gpu.dispose(); throw error; }
}

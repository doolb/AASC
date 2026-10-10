import * as THREE from 'three';

// 直接采样已有clip的插值器，按轨道混合；不新建AnimationHelper，也不重置物理。
export function createHumanMixer() {
    let serial = 0, clock = 0;
    const requests = new Map(), history = new Map(), saved = new Map();
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), weighted = new THREE.Quaternion();
    const clamp = value => Math.max(0, Math.min(1, value));
    function finish(request, reason) {
        requests.delete(request.id);
        history.set(request.id, { id: request.id, owner: request.owner, duration: request.duration,
            completed: reason === 'ended', reason, time: Math.min(request.duration, clock - request.start), active: false });
        if (history.size > 64) history.delete(history.keys().next().value);
    }
    function stop(owner) {
        for (const request of [...requests.values()]) if (!owner || request.owner === owner) finish(request, 'stopped');
    }
    function restore() {
        for (const [bone, pose] of saved) {
            bone.position.copy(pose.position); bone.quaternion.copy(pose.rotation);
        }
        saved.clear();
    }
    function save(bone) {
        if (!saved.has(bone)) saved.set(bone, { position: bone.position.clone(), rotation: bone.quaternion.clone() });
    }
    return {
        restore, stop,
        advance(delta) { clock += Math.max(0, Math.min(0.1, delta)); },
        get clock() { return clock; },
        start({ owner, layers, duration, loop = false, priority = 50, fade = 0.12 }) {
            if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('动作时长需在0–3600秒内');
            stop(owner);
            if (requests.size >= 16) throw new Error('并行动作最多16个，请停止部分动作');
            const id = ++serial;
            requests.set(id, { id, owner, layers, duration, loop, priority, fade, start: clock });
            return { request: id, id, owner, duration };
        },
        state(id) {
            const request = requests.get(id);
            return request ? { id, owner: request.owner, active: true, completed: false,
                duration: request.duration, time: Math.max(0, clock - request.start), loop: request.loop }
                : history.get(id) || { id, active: false, completed: false, reason: 'missing' };
        },
        occupiedEyes(model) {
            return [...requests.values()].some(request => request.layers.some(layer =>
                layer.sampler.tracks.some(track => track.kind === 'morph'
                    && model.morphs.find(m => m.index === track.index)?.panel === 2 && model.allowed(track, layer.mask))));
        },
        mix(model, physiological = [], external = [], gaze = null) {
            const morphs = new Map();
            const occupied = new Map();
            const applyBone = (target, values, property, weight, mode) => {
                save(target.bone);
                if (property === 'position') {
                    position.fromArray(values);
                    if (mode === 'additive') target.bone.position.addScaledVector(position.sub(target.restPosition), weight);
                    else target.bone.position.lerp(position, weight);
                } else {
                    rotation.fromArray(values).normalize();
                    if (mode === 'additive') {
                        rotation.premultiply(target.restQuaternion.clone().invert());
                        weighted.identity().slerp(rotation, weight);
                        target.bone.quaternion.multiply(weighted).normalize();
                    } else target.bone.quaternion.slerp(rotation, weight);
                }
            };
            for (const contribution of physiological) {
                if (contribution.kind === 'morph') morphs.set(contribution.index, contribution.value);
                else {
                    const target = model.bones[contribution.index];
                    if (target.dynamic) continue;
                    save(target.bone);
                    rotation.setFromAxisAngle(contribution.axis, contribution.angle);
                    target.bone.quaternion.multiply(rotation).normalize();
                }
            }
            for (const request of [...requests.values(), ...external].sort((a, b) => a.priority - b.priority || a.id - b.id)) {
                if (request.weights) {
                    for (const [index, value] of request.weights) morphs.set(index, value);
                    continue;
                }
                let time = clock - request.start;
                if (!request.loop && time >= request.duration) { finish(request, 'ended'); continue; }
                if (request.loop) time %= request.duration;
                const fade = Math.min(request.fade, request.duration / 3);
                const envelope = fade ? clamp(Math.min(time / fade,
                    request.loop ? 1 : (request.duration - time) / fade)) : 1;
                for (const layer of request.layers) {
                    if (time < layer.start || time > layer.start + layer.duration) continue;
                    const local = time - layer.start, windowFade = Math.min(fade, layer.duration / 3);
                    const windowEnvelope = windowFade && (layer.start > 0 || layer.duration < request.duration)
                        ? clamp(Math.min(local / windowFade, (layer.duration - local) / windowFade)) : 1;
                    const weight = clamp(layer.strength * envelope * windowEnvelope);
                    const sampleTime = Math.min(layer.sampler.duration, (time - layer.start) * (layer.speed || 1));
                    for (const track of layer.sampler.tracks) {
                        if (!model.allowed(track, layer.mask)) continue;
                        const values = track.evaluate(sampleTime);
                        if (track.kind === 'bone') {
                            if (track.property === 'quaternion') occupied.set(track.index, Math.max(occupied.get(track.index) || 0, weight));
                            applyBone(model.bones[track.index], values, track.property, weight, layer.mode);
                        }
                        else {
                            const underlying = morphs.get(track.index) ?? model.mesh.morphTargetInfluences[track.index] ?? 0;
                            morphs.set(track.index, clamp(layer.mode === 'additive' ? underlying + values[0] * weight
                                : underlying + (values[0] - underlying) * weight));
                        }
                    }
                }
            }
            // 注视在显式动作后计算，但让位给本帧已占用的旋转轨道，眼球使用最终头部姿态。
            gaze?.(save, occupied);
            model.mesh.updateMatrixWorld(true);
            return morphs;
        },
        snapshot: () => [...requests.values()].map(r => ({ id: r.id, owner: r.owner, duration: r.duration,
            loop: r.loop, time: clock - r.start, priority: r.priority })),
        clear() { stop(); restore(); history.clear(); clock = 0; },
    };
}

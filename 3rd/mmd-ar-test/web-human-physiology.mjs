import * as THREE from 'three';
const axis = new THREE.Vector3(1, 0, 0);
export function createHumanPhysiology() {
    let options = { breathing: true, blinking: true, strength: 0.35 }, next = 2, blinkAt = -1;
    return {
        set(value) {
            for (const key of ['breathing', 'blinking']) if (value[key] != null && typeof value[key] !== 'boolean') throw new Error('生理开关需要布尔值');
            const strength = value.strength ?? options.strength;
            if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('生理强度需为0–1');
            options = { breathing: value.breathing ?? options.breathing, blinking: value.blinking ?? options.blinking, strength };
            return { ...options };
        },
        get: () => ({ ...options }),
        reset() { next = 2; blinkAt = -1; },
        sample(model, clock, occupiedEyes, manual) {
            const contributions = [];
            if (options.breathing) {
                const amount = (Math.sin(clock * Math.PI / 2) + 1) / 2 * options.strength;
                const morph = model.bindings['morphs:breath'], chest = model.bindings['bones:chest'];
                if (morph) contributions.push({ kind: 'morph', index: morph.index, value: amount });
                else if (chest && !chest.dynamic) contributions.push({ kind: 'bone', index: chest.index, axis, angle: amount * 0.025 });
            }
            const blink = model.bindings['morphs:blink'];
            const explicitEyes = manual.some(item => item.selected && item.panel === 2)
                || occupiedEyes || model.morphs.some(item => item.panel === 2 && model.mesh.morphTargetInfluences[item.index] > 0.1);
            if (!options.blinking || !blink || explicitEyes) {
                blinkAt = -1; next = clock + 2 + Math.random() * 4;
                return contributions;
            }
            if (clock >= next && blinkAt < 0) blinkAt = clock;
            if (blinkAt >= 0) {
                const elapsed = clock - blinkAt;
                const weight = elapsed < 0.08 ? elapsed / 0.08 : elapsed < 0.12 ? 1 : Math.max(0, 1 - (elapsed - 0.12) / 0.16);
                if (elapsed >= 0.28) { blinkAt = -1; next = clock + 2 + Math.random() * 4; }
                else contributions.push({ kind: 'morph', index: blink.index,
                    value: Math.max(model.mesh.morphTargetInfluences[blink.index] || 0, weight) });
            }
            return contributions;
        }
    };
}

import * as THREE from 'three';
import { resolveReplyExpression } from './web-reply-expressions.mjs';

// 语义绑定保存名称，真实索引只属于当前mesh；物理驱动骨骼不被控制层强制覆写。
export const BONE_NAMES = Object.freeze({
    root: ['全ての親', 'Root', 'root'], center: ['センター', 'Center', 'center'],
    chest: ['上半身2', '上半身２', '上半身', 'Chest', 'chest', 'UpperBody'],
    upperBody: ['上半身', 'UpperBody', 'Spine'], waist: ['腰', 'Waist'],
    hips: ['下半身', 'Hips', 'hips'], neck: ['首', 'Neck', 'neck'], head: ['頭', 'Head', 'head'],
    leftShoulder: ['左肩', 'LeftShoulder'], rightShoulder: ['右肩', 'RightShoulder'],
    leftArm: ['左腕', 'LeftArm'], rightArm: ['右腕', 'RightArm'],
    leftElbow: ['左ひじ', '左肘', 'LeftForeArm'], rightElbow: ['右ひじ', '右肘', 'RightForeArm'],
    leftWrist: ['左手首', 'LeftHand'], rightWrist: ['右手首', 'RightHand'],
    leftLeg: ['左足', 'LeftUpLeg'], rightLeg: ['右足', 'RightUpLeg'],
    leftKnee: ['左ひざ', 'LeftLeg'], rightKnee: ['右ひざ', 'RightLeg'],
    leftAnkle: ['左足首', 'LeftFoot'], rightAnkle: ['右足首', 'RightFoot'],
    leftToe: ['左足先EX', '左つま先', 'LeftToeBase'], rightToe: ['右足先EX', '右つま先', 'RightToeBase'],
});
export const MORPH_NAMES = Object.freeze({
    blink: ['まばたき', '瞬き', '眨眼', 'blink'], breath: ['呼吸', 'breath', 'breathing'],
    a: ['あ', 'a', 'mouth_a'], i: ['い', 'i', 'mouth_i'], u: ['う', 'u', 'mouth_u'],
    e: ['え', 'e', 'mouth_e'], o: ['お', 'o', 'mouth_o'],
});
const MPL_NAMES = { base: 'root', center: 'center', upper_body: 'upperBody', lower_body: 'hips', waist: 'waist',
    neck: 'neck', head: 'head', shoulder_l: 'leftShoulder', shoulder_r: 'rightShoulder',
    arm_l: 'leftArm', arm_r: 'rightArm', elbow_l: 'leftElbow', elbow_r: 'rightElbow',
    wrist_l: 'leftWrist', wrist_r: 'rightWrist', leg_l: 'leftLeg', leg_r: 'rightLeg',
    knee_l: 'leftKnee', knee_r: 'rightKnee', ankle_l: 'leftAnkle', ankle_r: 'rightAnkle',
    toe_l: 'leftToe', toe_r: 'rightToe' };
const GROUPS = { head: ['neck', 'head'], torso: ['chest', 'upperBody', 'waist', 'hips'], root: ['root', 'center'],
    leftArm: ['leftShoulder', 'leftArm', 'leftElbow', 'leftWrist'],
    rightArm: ['rightShoulder', 'rightArm', 'rightElbow', 'rightWrist'],
    legs: ['leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftToe', 'rightToe'] };
const key = value => String(value || '').trim().toLowerCase();
export function modelSignature(mesh) {
    const data = mesh.geometry.userData.MMD;
    const text = JSON.stringify([data.bones.map(b => [b.name, b.parent, b.pos, b.rigidBodyType]),
        data.morphs.map(m => [m.name, m.type, m.panel])]);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    return 'pmx-' + hash.toString(16) + '-' + data.bones.length + '-' + data.morphs.length;
}
export function createHumanModel(mesh, state, mappings = {}) {
    const data = mesh.geometry.userData.MMD, bindings = {}, missing = [];
    const bones = mesh.skeleton.bones.map((bone, index) => ({ bone, index, name: bone.name,
        dynamic: data.bones[index]?.rigidBodyType > 0,
        restPosition: new THREE.Vector3().fromArray(data.bones[index]?.pos || bone.position.toArray()),
        restQuaternion: new THREE.Quaternion().fromArray(data.bones[index]?.rotq || [0, 0, 0, 1]) }));
    const morphs = state.items.filter(item => item.supported);
    for (const [kind, definitions, choices] of [['bones', BONE_NAMES, bones], ['morphs', MORPH_NAMES, morphs]]) {
        for (const [semantic, aliases] of Object.entries(definitions)) {
            const override = mappings[kind]?.[semantic];
            let found = [];
            if (override) found = choices.filter(item => item.name === override);
            else for (const alias of aliases) {
                found = choices.filter(item => key(item.name) === key(alias));
                if (found.length) break;
            }
            bindings[kind + ':' + semantic] = found.length === 1 ? found[0] : null;
            if (found.length !== 1) missing.push(kind + ':' + semantic + (found.length ? '（名称有歧义）' : '（缺失）'));
        }
    }
    const groups = Object.fromEntries(Object.entries(GROUPS).map(([name, keys]) => [name,
        new Set(keys.map(name => bindings['bones:' + name]?.index).filter(Number.isInteger))]));
    data.bones.forEach((bone, index) => { if (bone.parent < 0) groups.root.add(index); });
    // 手臂部位包含手指，腿部包含足趾；躯干遮罩不扩张到整个人的子树。
    for (const [group, semantic] of [['leftArm', 'leftWrist'], ['rightArm', 'rightWrist'],
        ['legs', 'leftAnkle'], ['legs', 'rightAnkle']]) {
        const root = bindings['bones:' + semantic]?.bone;
        if (!root) continue;
        root.traverse(child => {
            const index = mesh.skeleton.bones.indexOf(child);
            if (index >= 0) groups[group].add(index);
        });
    }
    function allowed(track, mask) {
        if (track.kind === 'bone' && bones[track.index].dynamic) return false;
        if (!mask?.length) return track.kind !== 'bone' || !groups.root.has(track.index);
        return mask.some(part => {
            if (part === 'all') return true;
            if (track.kind === 'bone') return part === 'body' ? !groups.root.has(track.index)
                : groups[part]?.has(track.index) || part === 'bone:' + bones[track.index].name;
            const item = state.items[track.index];
            return part === 'face' || part === 'morph:' + item.name
                || (part === 'eyes' && item.panel === 2) || (part === 'mouth' && item.panel === 3);
        });
    }
    return { mesh, token: mesh.uuid, signature: modelSignature(mesh), bones, morphs, bindings, missing, groups,
        expression: name => resolveReplyExpression(state.items, name), allowed,
        mplBone(name) {
            const semantic = Object.values(MPL_NAMES).find(key => BONE_NAMES[key][0] === name)
                || Object.keys(BONE_NAMES).find(key => BONE_NAMES[key].includes(name));
            return semantic ? bindings['bones:' + semantic]?.name : bones.find(b => b.name === name)?.name;
        },
        mplRequested(source) {
            const commands = [...source.matchAll(/\b([a-z][a-z0-9_]*)\s+(?:bend|turn|sway|move|reset)\b/gu)].map(m => m[1]);
            return new Set(commands.flatMap(command => {
                if (MPL_NAMES[command]) return [BONE_NAMES[MPL_NAMES[command]][0]];
                const finger = command.match(/^(thumb|index|middle|ring|pinky)(?:_([012]))?_([lr])$/u);
                if (!finger) return [];
                const prefix = (finger[3] === 'l' ? '左' : '右') + ({ thumb: '親指', index: '人指', middle: '中指', ring: '薬指', pinky: '小指' })[finger[1]];
                const joints = finger[2] == null ? (finger[1] === 'thumb' ? [0, 1] : [0, 1, 2]) : [Number(finger[2])];
                return joints.map(index => prefix + ['１', '２', '３'][index]);
            }));
        },
        snapshot: () => ({ token: mesh.uuid, signature: modelSignature(mesh), missing: [...missing],
            bindings: Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name, value?.name || ''])),
            bones: bones.map(b => ({ name: b.name, dynamic: b.dynamic })),
            morphs: morphs.map(m => ({ name: m.name, index: m.index, panel: m.panel })) }),
    };
}

import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import * as MMDParser from './vendor/three/libs/mmdparser.module.js';
import { isRegisteredLocalAsset, configureLocalLoader } from './web-local-assets.mjs';

// 先检查角色帧的计数/长度，再让Parser读取；相机等非角色尾段不进入控制接口。
export function inspectHumanVmd(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 58 || buffer.byteLength > 16 * 1024 * 1024) throw new Error('VMD需为有效文件，最多16MiB');
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    if (!new TextDecoder().decode(bytes.subarray(0, 30)).startsWith('Vocaloid Motion Data 0002')) throw new Error('VMD版本不支持');
    const count = view.getUint32(50, true), end = 54 + count * 111;
    if (count > 70000 || end + 4 > buffer.byteLength) throw new Error('VMD骨骼帧边界无效');
    const morphs = view.getUint32(end, true), morphEnd = end + 4 + morphs * 23;
    if (morphs > 70000 || morphEnd > buffer.byteLength || (!count && !morphs)) throw new Error('VMD角色帧无效');
    for (let i = 0; i < count; i++) {
        const offset = 54 + i * 111;
        if (view.getUint32(offset + 15, true) > 108000) throw new Error('VMD最长一小时');
        for (let j = 0; j < 7; j++) if (!Number.isFinite(view.getFloat32(offset + 19 + 4 * j, true))) throw new Error('VMD骨骼数值无效');
    }
    for (let i = 0; i < morphs; i++) {
        const offset = end + 4 + i * 23;
        if (view.getUint32(offset + 15, true) > 108000 || !Number.isFinite(view.getFloat32(offset + 19, true))) throw new Error('VMD表情数值无效');
    }
    const result = new Uint8Array(morphEnd + 16);
    result.set(bytes.subarray(0, morphEnd));
    return result.buffer;
}
export async function readHumanVmd(asset, signal) {
    if (asset instanceof ArrayBuffer) return asset.slice(0);
    if (asset instanceof Blob) { if (asset.size > 16 * 1024 * 1024) throw new Error('VMD最多16MiB'); return asset.arrayBuffer(); }
    if (typeof asset !== 'string') throw new Error('需要登记的VMD文件或同源资源');
    const local = isRegisteredLocalAsset(asset, '.vmd'), url = new URL(asset, location.href);
    if (!local && (url.origin !== location.origin || !url.pathname.toLowerCase().endsWith('.vmd') || url.search || url.hash
        || !/\/mmd\//u.test(url.pathname))) throw new Error('VMD只允许已登记本地资源或同源mmd目录');
    const manager = new THREE.LoadingManager();
    if (local) configureLocalLoader({ manager }, asset);
    const response = await fetch(manager.resolveURL(asset), { signal });
    if (!response.ok) throw new Error('读取VMD失败：HTTP ' + response.status);
    if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('VMD最多16MiB');
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16 * 1024 * 1024) throw new Error('VMD最多16MiB');
            parts.push(value);
        }
    } catch (error) { await reader.cancel(); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let cursor = 0;
    for (const part of parts) { bytes.set(part, cursor); cursor += part.length; }
    return bytes.buffer;
}
export function createHumanSampler(buffer, model, mplSource = null) {
    const vmd = new MMDParser.Parser().parseVmd(inspectHumanVmd(buffer), true);
    const requested = mplSource === null ? null : model.mplRequested(mplSource), missing = new Set();
    vmd.motions = vmd.motions.filter(motion => {
        if (requested && !requested.has(motion.boneName)) return false;
        const name = requested ? model.mplBone(motion.boneName) : motion.boneName;
        if (!name || Object.hasOwn(Object.prototype, name) || model.bones.filter(b => b.name === name).length !== 1) { missing.add(motion.boneName); return false; }
        motion.boneName = name;
        return true;
    });
    vmd.metadata.motionCount = vmd.motions.length;
    vmd.morphs = vmd.morphs.filter(morph => {
        if (!Object.hasOwn(Object.prototype, morph.morphName) && model.morphs.filter(m => m.name === morph.morphName).length === 1) return true;
        missing.add(morph.morphName); return false;
    });
    vmd.metadata.morphCount = vmd.morphs.length;
    // 使用绑定姿态的代理骨骼建立位移轨道，不把屏幕上正在播放的姿态当作基准。
    const restBones = model.bones.map(b => ({ name: b.name, position: b.restPosition }));
    const target = { skeleton: { bones: restBones, getBoneByName: name => restBones.find(b => b.name === name) },
        morphTargetDictionary: model.mesh.morphTargetDictionary };
    const clip = new MMDLoader().animationBuilder.build(vmd, target), tracks = [];
    for (const track of clip.tracks) {
        const bone = track.name.match(/^\.bones\[(.*)\]\.(position|quaternion)$/u);
        const morph = track.name.match(/^\.morphTargetInfluences\[(\d+)\]$/u);
        const index = bone ? model.bones.findIndex(b => b.name === bone[1]) : morph ? Number(morph[1]) : -1;
        if (index < 0) continue;
        const interpolant = track.createInterpolant(new Float32Array(track.getValueSize()));
        tracks.push({ kind: bone ? 'bone' : 'morph', index, property: bone?.[2] || 'weight',
            evaluate: time => interpolant.evaluate(time) });
    }
    if (!tracks.length) throw new Error('动作与当前PMX没有匹配轨道');
    return { tracks, duration: Math.max(1 / 30, clip.duration), warnings: [...missing].map(name => '未匹配：' + name) };
}

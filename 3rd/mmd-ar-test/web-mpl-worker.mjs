import init, { WasmMPLCompiler } from './vendor/mmd-mpl/0.3.6-2d3b1c7e3429/mmd_mpl.js';
import { decodeVmdName, prepareMpl } from './web-mpl-morphs.mjs';

// 编译器在Worker内运行；两类关键帧都需验证，不能让纯表情被零骨骼检查拒绝。
function inspectVmd(bytes, allowEmpty = false) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 58 || bytes.byteLength > 8 * 1024 * 1024) throw new Error('生成的 VMD 为空或超过8MiB');
    const header = new TextDecoder().decode(bytes.subarray(0, 30));
    if (!header.startsWith('Vocaloid Motion Data 0002')) throw new Error('编译器未返回有效 VMD');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(50, true);
    const boneEnd = 54 + count * 111;
    if (count > 70000 || boneEnd + 4 > bytes.byteLength) throw new Error('VMD 骨骼帧数量或长度无效');
    const bones = new Set();
    let lastFrame = 0;
    for (let index = 0; index < count; index++) {
        const offset = 54 + index * 111;
        const name = decodeVmdName(bytes.subarray(offset, offset + 15));
        if (!name) throw new Error('VMD 存在空骨骼名');
        bones.add(name);
        const frame = view.getUint32(offset + 15, true);
        if (frame > 108000) throw new Error('MPL 时间线不能超过一小时');
        lastFrame = Math.max(lastFrame, frame);
        for (let component = 0; component < 7; component++) {
            if (!Number.isFinite(view.getFloat32(offset + 19 + component * 4, true))) {
                throw new Error(`骨骼 ${name} 的位移或旋转包含无效数值`);
            }
        }
    }
    const morphCount = view.getUint32(boneEnd, true);
    const morphEnd = boneEnd + 4 + morphCount * 23;
    if (morphCount > 70000 || morphEnd > bytes.byteLength) throw new Error('VMD 表情帧数量或长度无效');
    if (!allowEmpty && !count && !morphCount) throw new Error('MPL 没有生成骨骼或表情关键帧');
    const morphs = new Set();
    for (let index = 0; index < morphCount; index++) {
        const offset = boneEnd + 4 + index * 23;
        const name = decodeVmdName(bytes.subarray(offset, offset + 15));
        const frame = view.getUint32(offset + 15, true);
        const weight = view.getFloat32(offset + 19, true);
        if (!name || frame > 108000 || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error('VMD 表情名称/时间/权重无效');
        morphs.add(name);
        lastFrame = Math.max(lastFrame, frame);
    }
    return { bones: [...bones], boneFrames: count, morphs: [...morphs], morphFrames: morphCount,
        duration: lastFrame / 30, boneEnd, morphEnd };
}

function allocate(size) {
    if (size > 8 * 1024 * 1024) throw new Error('生成的 VMD 超过8MiB');
    return new Uint8Array(size);
}

function mergeMorphs(bytes, frames) {
    const { boneEnd, morphEnd } = inspectVmd(bytes, true);
    if (!frames.length) return bytes;
    const nextMorphEnd = boneEnd + 4 + frames.length * 23;
    const result = allocate(nextMorphEnd + bytes.length - morphEnd);
    result.set(bytes.subarray(0, boneEnd));
    const view = new DataView(result.buffer);
    view.setUint32(boneEnd, frames.length, true);
    for (let index = 0; index < frames.length; index++) {
        const item = frames[index], offset = boneEnd + 4 + index * 23;
        result.set(item.bytes, offset);
        view.setUint32(offset + 15, item.frame, true);
        view.setFloat32(offset + 19, item.weight, true);
    }
    // 相机、灯光、阴影和IK属性区段保持原样，不重新生成或丢弃。
    result.set(bytes.subarray(morphEnd), nextMorphEnd);
    return result;
}

function holdPose(bytes, metadata) {
    // 零时长骨骼/表情均复制到第30帧，避免Three循环零时长除零。
    const { boneFrames, morphFrames, boneEnd, morphEnd } = metadata;
    if (boneFrames * 2 > 70000 || morphFrames * 2 > 70000) throw new Error('静态保持补帧后超过70,000条限制');
    const boneBytes = boneFrames * 111, morphBytes = morphFrames * 23;
    const nextBoneEnd = boneEnd + boneBytes;
    const result = allocate(bytes.length + boneBytes + morphBytes);
    result.set(bytes.subarray(0, boneEnd));
    result.set(bytes.subarray(54, boneEnd), boneEnd);
    result.set(bytes.subarray(boneEnd, morphEnd), nextBoneEnd);
    result.set(bytes.subarray(boneEnd + 4, morphEnd), nextBoneEnd + 4 + morphBytes);
    result.set(bytes.subarray(morphEnd), nextBoneEnd + 4 + morphBytes * 2);
    const view = new DataView(result.buffer);
    view.setUint32(50, boneFrames * 2, true);
    view.setUint32(nextBoneEnd, morphFrames * 2, true);
    for (let index = 0; index < boneFrames; index++) view.setUint32(boneEnd + index * 111 + 15, 30, true);
    for (let index = 0; index < morphFrames; index++) view.setUint32(nextBoneEnd + 4 + morphBytes + index * 23 + 15, 30, true);
    return result;
}

self.onmessage = async ({ data }) => {
    let compiler;
    try {
        const source = data?.source;
        if (typeof source !== 'string' || !source.trim()) throw new Error('请输入 MPL 代码');
        if (new TextEncoder().encode(source).length > 64 * 1024) throw new Error('MPL 输入不能超过64KiB');
        const { boneSource, frames } = prepareMpl(source, data?.morphs);
        await init();
        compiler = new WasmMPLCompiler();
        let bytes = mergeMorphs(compiler.compile(boneSource), frames);
        let metadata = inspectVmd(bytes);
        const poseHold = metadata.duration === 0;
        if (poseHold) {
            bytes = holdPose(bytes, metadata);
            metadata = inspectVmd(bytes);
        }
        // 显式复制后转移，不能转移 WASM 堆内存。
        const buffer = bytes.slice().buffer;
        const { boneEnd, morphEnd, ...publicMetadata } = metadata;
        self.postMessage({ buffer, ...publicMetadata, poseHold }, [buffer]);
    } catch (error) {
        self.postMessage({ error: error?.message || String(error) });
    } finally {
        compiler?.free();
    }
};

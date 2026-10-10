import init, { WasmMPLCompiler } from '__MPL_COMPILER_URL__';

// 编译器在 Worker 内运行；只把验证后的二进制和少量骨骼元数据送回界面。
function inspectVmd(bytes) {
    if (bytes.byteLength < 54 || bytes.byteLength > 8 * 1024 * 1024) throw new Error('生成的 VMD 为空或超过8MiB');
    const header = new TextDecoder().decode(bytes.subarray(0, 30));
    if (!header.startsWith('Vocaloid Motion Data 0002')) throw new Error('编译器未返回有效 VMD');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(50, true);
    if (!count || count > 70000 || 54 + count * 111 > bytes.byteLength) throw new Error('VMD 骨骼帧数量或长度无效');
    const decoder = new TextDecoder('shift-jis');
    const bones = new Set();
    let lastFrame = 0;
    for (let index = 0; index < count; index++) {
        const offset = 54 + index * 111;
        const nameBytes = bytes.subarray(offset, offset + 15);
        const end = nameBytes.indexOf(0);
        const name = decoder.decode(end < 0 ? nameBytes : nameBytes.subarray(0, end));
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
    return { bones: [...bones], boneFrames: count, duration: lastFrame / 30 };
}

function holdPose(bytes, count) {
    // 单帧姿势的 clip.duration 为0，Three LoopRepeat会除以0；补一个相同末帧。
    const boneEnd = 54 + count * 111;
    const result = new Uint8Array(bytes.length + count * 111);
    result.set(bytes.subarray(0, boneEnd));
    result.set(bytes.subarray(54, boneEnd), boneEnd);
    result.set(bytes.subarray(boneEnd), boneEnd + count * 111);
    const view = new DataView(result.buffer);
    view.setUint32(50, count * 2, true);
    for (let index = 0; index < count; index++) view.setUint32(boneEnd + index * 111 + 15, 30, true);
    return result;
}

self.onmessage = async ({ data }) => {
    let compiler;
    try {
        const source = data?.source;
        if (typeof source !== 'string' || !source.trim()) throw new Error('请输入 MPL 代码');
        if (new TextEncoder().encode(source).length > 64 * 1024) throw new Error('MPL 输入不能超过64KiB');
        await init();
        compiler = new WasmMPLCompiler();
        let bytes = compiler.compile(source);
        let metadata = inspectVmd(bytes);
        const poseHold = metadata.duration === 0;
        if (poseHold) {
            bytes = holdPose(bytes, metadata.boneFrames);
            metadata = inspectVmd(bytes);
        }
        // 显式复制后转移，不能转移 WASM 堆内存。
        const buffer = bytes.slice().buffer;
        self.postMessage({ buffer, ...metadata, poseHold }, [buffer]);
    } catch (error) {
        self.postMessage({ error: error?.message || String(error) });
    } finally {
        compiler?.free();
    }
};

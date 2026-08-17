// 服务器端声纹提取（voiceprint.extraction='server' 时注册用）
// 懒加载 sherpa-onnx-node SpeakerEmbeddingExtractor，提取完释放（不长期占用 40MB 模型内存）
const path = require('path');
// 从 src/apps/server/modules/voiceprint 上溯 4 级到 src/，再进入 external/asr
const asr = require('../../../../external/asr/asr-service');

const EMBEDDING_MODEL = path.join(__dirname, '../../../../../res/models/voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx');

let extractor = null;
let sherpa = null;

function getSherpa() {
    if (!sherpa) {
        try {
            sherpa = require('sherpa-onnx-node');
        } catch (e) {
            throw new Error('sherpa-onnx-node 未安装');
        }
    }
    return sherpa;
}

function getExtractor() {
    if (!extractor) {
        const onnx = getSherpa();
        extractor = new onnx.SpeakerEmbeddingExtractor({
            model: EMBEDDING_MODEL,
            numThreads: 1,
            debug: false,
            provider: 'cpu'
        });
    }
    return extractor;
}

// 提取音频文件的说话人特征；返回普通 Array（便于 JSON 持久化）
async function extractEmbedding(audioPath) {
    // 用无状态 readWavFileFromPath 读取 16k mono Float32 样本，
    // 避免为提取一次声纹而加载整个 ASR 模型（234MB）
    const { samples, sampleRate } = asr.readWavFileFromPath(audioPath);
    if (!samples || samples.length === 0) {
        throw new Error('音频数据为空');
    }
    const ex = getExtractor();
    const stream = ex.createStream();
    try {
        // 用实际采样率喂给模型（sherpa-onnx 内部重采样到模型期望的 16k）。
        // 若硬编码 16000，48k/44.1k 的 RIFF wav 会绕过 ffmpeg 重采样，
        // 模型收到被误标的样本 → 无声纹提取错误但特征为垃圾
        stream.acceptWaveform({ samples, sampleRate: sampleRate || 16000 });
        const emb = ex.compute(stream);
        return Array.from(emb);
    } finally {
        // 注意：sherpa-onnx-node 的 OnlineStream 未暴露 delete/free 方法，
        // 只能调用原生对象释放；不存在时直接跳过，交由 GC 回收（避免 TypeError）
        if (stream && typeof stream.delete === 'function') stream.delete();
    }
}

function release() {
    if (extractor) {
        extractor = null;
    }
}

module.exports = { extractEmbedding, release, dim: () => getExtractor().dim };

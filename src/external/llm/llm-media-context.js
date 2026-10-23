'use strict';
const { createHash } = require('node:crypto');

/** 只迁移本应用生成的参考图清单；用户真正修改角色设定或模型仍应重新建立上下文。 */
function equivalentResponsesFingerprint(previous, current) {
    if (previous === current) return true;
    const normalize = value => {
        const parsed = JSON.parse(value);
        if (typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.includes('SubAI 指令调用行')) {
            parsed.systemPrompt = parsed.systemPrompt.replace(/(?:^|\n\n)可用参考图ID：[^\n]*(?=\n\n|$)/g, '');
        }
        return JSON.stringify(parsed);
    };
    try { return normalize(previous) === normalize(current); } catch { return false; }
}

const imageKey = image => image.id ? `id:${String(image.id).slice(0, 128)}`
    : `image:${createHash('sha256').update(image.dataUrl || image.url || '').digest('hex')}`;

/** 本地历史始终保留URL；仅实际需要发给模型的图片才读取并转换为请求内的Data URL。 */
async function prepareMediaImages({ current = [], history = [], allowed = true, sameUpstream = false,
    knownIds = [], profileName, readImage, signal }) {
    if (!allowed && current.length) throw new Error('当前 LLM 配置不支持上传图片，请移除图片或切换配置');
    if (!allowed) return { images: [], sentImageIds: sameUpstream ? [...knownIds] : [] };
    const byKey = new Map();
    for (const image of [...history, ...current]) byKey.set(imageKey(image), { ...byKey.get(imageKey(image)), ...image });
    const sent = new Set(sameUpstream ? knownIds : []); const images = [];
    for (const [key, image] of byKey) {
        signal?.throwIfAborted();
        const alreadyNative = sameUpstream && image.origin === 'main' && image.originProfile === profileName;
        if (alreadyNative || sent.has(key)) { sent.add(key); continue; }
        let dataUrl = image.dataUrl;
        if (!dataUrl && image.url?.startsWith('/uploads/chat-images/')) {
            if (typeof readImage !== 'function') throw new Error('当前服务无法读取本地聊天图片');
            const file = await readImage(image);
            if (!Buffer.isBuffer(file.data) || file.data.length > 20 * 1024 * 1024) throw new Error('聊天图片大小无效');
            dataUrl = `data:${file.mimeType};base64,${file.data.toString('base64')}`;
        }
        const url = dataUrl || image.url;
        if (typeof url !== 'string' || !/^(https:\/\/|data:image\/(?:png|jpeg|jpg|webp|gif);base64,)/.test(url)) {
            throw new Error('聊天图片内容或地址无效');
        }
        images.push({ ...image, dataUrl: url }); sent.add(key);
    }
    return { images, sentImageIds: [...sent].slice(-256) };
}

module.exports = { equivalentResponsesFingerprint, prepareMediaImages };

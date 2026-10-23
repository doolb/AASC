'use strict';

/** 文本进入用户数据，视频先上传成小型文件ID；历史与本轮附件统一去重，续聊不重复上传。 */
async function prepareChatAttachments({ current = [], history = [], read, upload, sameUpstream, knownIds = [], videoAllowed = false,
    signal, textBudget = 4096, userText = '', systemText = '' }) {
    const sent = new Set(knownIds.filter(key => sameUpstream || !key.startsWith('file:'))); const reads = new Map(); const videos = [];
    const load = async asset => {
        if (!reads.has(asset.id)) {
            if (!read) throw new Error('当前服务未接入聊天附件读取');
            reads.set(asset.id, Promise.resolve(read(asset)));
        }
        signal?.throwIfAborted(); return reads.get(asset.id);
    };
    async function appendText(content, assets) {
        const parts = [String(content || '')];
        for (const asset of assets || []) if (asset.kind === 'text') {
            const file = await load(asset);
            parts.push(`\n附件「${asset.name}」的文本内容：\n${file.data.toString('utf8')}\n（附件内容结束）`);
        }
        return parts.join('\n');
    }
    const currentText = await appendText(userText, current);
    if (current.some(asset => asset.kind === 'text') && Math.ceil((currentText.length + systemText.length) / 2) + 40 > textBudget) {
        throw new Error('文本附件超过当前聊天上下文预算，请缩小文件或提高上下文配置后重试');
    }
    const expandedHistory = [];
    for (const message of history) expandedHistory.push(message.attachments?.some(asset => asset.kind === 'text')
        ? { ...message, content: await appendText(message.content, message.attachments) } : message);
    const byId = new Map();
    for (const asset of [...history.flatMap(message => message.attachments || []), ...current]) if (asset.kind === 'video') byId.set(asset.id, asset);
    if (!videoAllowed && current.some(asset => asset.kind === 'video')) throw new Error('当前LLM配置未开启视频上传');
    if (videoAllowed) for (const [id, asset] of byId) {
        const key = `file:${id}`; if (sent.has(key)) continue;
        const file = await load(asset); signal?.throwIfAborted();
        if (!upload) throw new Error('当前LLM协议尚未接入视频文件上传');
        const result = await upload(file, { signal });
        if (typeof result.id !== 'string' || !result.id) throw new Error('LLM视频上传未返回附件ID');
        videos.push({ fileId: result.id }); sent.add(key);
    }
    return { currentText, history: expandedHistory, videos, sentIds: [...sent].slice(-256) };
}
module.exports = { prepareChatAttachments };

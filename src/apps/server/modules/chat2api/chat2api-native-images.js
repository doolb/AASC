'use strict';
const { normalizeOutputImages } = require('../../../../core/utils/chat-output-images');
const list = value => Array.isArray(value) ? value : [];

/** 原生生图只检查协议中明确的作品卡片，避免将搜索图或头像当作生成结果。 */
function inspectNativeImages(providerId, data) {
    const images = [];
    let started = false;
    if (providerId === 'glm') {
        for (const part of list(data.parts)) for (const content of list(part?.content)) {
            if (content.type !== 'image') continue;
            started = true;
            for (const image of list(content.image)) images.push({ url: image?.image_url });
        }
    }
    if (providerId === 'doubaochat') {
        const blocks = [data.block, ...list(data.content_block), ...list(data.message?.content_block),
            ...list(data.content?.content_block), ...list(data.patch_op).flatMap(patch => list(patch?.patch_value?.content_block))];
        for (const block of blocks) {
            const creation = block?.content?.creation_block;
            if (!creation) continue;
            if (list(creation.creations).some(item => item?.video) && !list(creation.creations).some(item => item?.image)) continue;
            started = true;
            for (const item of list(creation.creations)) if (item?.image?.image_ori?.url) images.push({ url: item.image.image_ori.url });
        }
    }
    if (providerId === 'qwen') {
        for (const message of list(data.data?.messages || data.messages)) {
            if (list(message?.meta_data?.multi_load).some(card => card?.type === 'ai_generate_image_list')) started = true;
        }
    }
    return { started, images: normalizeOutputImages(images) };
}

module.exports = { inspectNativeImages };

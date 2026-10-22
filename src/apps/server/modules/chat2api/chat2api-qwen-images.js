'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const { imageError } = require('./chat2api-image-catalog');

function extractQwenImages(events) {
    let pending = false; const images = [];
    for (const event of events) {
        if (event.ret?.some(value => /FAIL_SYS_USER_VALIDATE/.test(value))) throw imageError('qwen_risk_control', '千问要求安全验证，请在官网登录后重试', 403);
        if (event.error_code || event.error) throw imageError('qwen_image_failed', '千问生图失败', 502);
        for (const message of event.data?.messages || []) {
            for (const card of message.meta_data?.multi_load || []) {
                if (card.type !== 'ai_generate_image_list') continue;
                const content = card.content || {};
                if (content.status === 'failed') throw imageError('qwen_image_failed', '千问图片生成失败', 502);
                pending = content.status !== 'complete';
                if (pending) continue;
                // resource_infos同时包含缩略图和水印变体；按display_list读取每张实际作品。
                for (const item of content.display_list || []) {
                    for (const image of item.watermark_image?.length ? item.watermark_image : item.image || []) {
                        if (/^https:\/\//.test(image.url || '')) images.push({ url: image.url });
                    }
                }
            }
        }
    }
    return { pending, images: [...new Map(images.map(image => [image.url, image])).values()] };
}
async function completeQwenImages(events, { http, headers, signal, prepared }) {
    const { parseImageEvents } = require('./chat2api-image-service');
    let state = extractQwenImages(events);
    if (state.images.length) return state.images;
    const url = new URL(prepared.url); url.pathname = '/api/v1/chat/snap';
    for (let index = 1; index <= 60; index += 1) {
        await delay(2000, undefined, { signal });
        const response = await http.post(url.toString(), { ...prepared.data, snap_index: index }, {
            headers, signal, timeout: 30000, responseType: 'text', maxContentLength: 16 * 1024 * 1024 });
        state = extractQwenImages(parseImageEvents(response.data));
        if (state.images.length) return state.images;
    }
    throw imageError('qwen_image_timeout', '千问生图等待超时', 504);
}
module.exports = { extractQwenImages, completeQwenImages };

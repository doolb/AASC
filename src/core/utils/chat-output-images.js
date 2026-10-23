'use strict';

/** 只读取明确的图片字段；正文、链接、头像和工具参数不会被猜测为生成图片。 */
function normalizeOutputImages(images = []) {
    if (!Array.isArray(images)) return [];
    const result = new Map();
    for (const image of images) {
        const value = typeof image === 'string' ? image : image?.dataUrl || image?.url || image?.image_url?.url || image?.image_url;
        if (typeof value !== 'string') continue;
        if (/^https:\/\//.test(value)) result.set(value, { url: value });
        if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) result.set(value, { dataUrl: value });
    }
    return [...result.values()];
}

function extractOutputImages(message) {
    if (!message || typeof message !== 'object') return [];
    const images = [...(Array.isArray(message.images) ? message.images : [])];
    for (const part of Array.isArray(message.content) ? message.content : []) {
        if (['output_image', 'image_url', 'image'].includes(part?.type)) images.push(part);
    }
    // Responses原生生图工具的result是已生成图片的base64，不需要再次调用生图接口。
    for (const item of Array.isArray(message.output) ? message.output : []) {
        if (item.type === 'image_generation_call' && item.status === 'completed' && typeof item.result === 'string') {
            images.push({ dataUrl: `data:image/${item.output_format === 'jpeg' ? 'jpeg' : item.output_format === 'webp' ? 'webp' : 'png'};base64,${item.result}` });
        }
        images.push(...extractOutputImages(item));
    }
    return normalizeOutputImages(images);
}

const mergeOutputImages = (...groups) => normalizeOutputImages(groups.flat());
const extractOutputText = message => typeof message?.content === 'string' ? message.content
    : (Array.isArray(message?.content) ? message.content : [])
        .filter(part => ['text', 'output_text'].includes(part?.type) && typeof part.text === 'string')
        .map(part => part.text).join('');

/** 图片可先来自增量，再在完成消息中重复出现；只发布状态变化或新增作品。 */
function createOutputImageCollector(onImages) {
    let images = []; let status;
    const push = (incoming, nextStatus) => {
        const next = mergeOutputImages(images, incoming);
        const changed = next.length !== images.length || nextStatus !== status;
        images = next; status = nextStatus;
        if (changed) onImages?.({ images: [...images], status });
    };
    return {
        pushMessage(message) {
            const incoming = extractOutputImages(message);
            if (message?.image_generation?.status === 'pending') push([], 'pending');
            if (incoming.length) push(incoming, 'completed');
        },
        pushEvent(event) {
            if (event?.type === 'response.output_images') push(event.images || [], event.status || 'completed');
            if (event?.type === 'response.output_item.added' && event.item?.type === 'image_generation_call') push([], 'pending');
            if (event?.type === 'response.image_generation_call.in_progress') push([], 'pending');
            if (event?.type === 'response.output_item.done') this.pushMessage({ output: [event.item] });
            if (event?.type === 'response.completed') this.pushMessage(event.response);
        },
        getImages: () => [...images],
    };
}

module.exports = { normalizeOutputImages, extractOutputImages, extractOutputText, mergeOutputImages, createOutputImageCollector };
